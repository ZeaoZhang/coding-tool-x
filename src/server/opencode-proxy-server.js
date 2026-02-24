const express = require('express');
const httpProxy = require('http-proxy');
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const chalk = require('chalk');
const { broadcastLog, broadcastSchedulerState } = require('./websocket-server');
const { allocateChannel, releaseChannel, getSchedulerState } = require('./services/channel-scheduler');
const { recordSuccess, recordFailure } = require('./services/channel-health');
const { loadConfig } = require('../config/loader');
const DEFAULT_CONFIG = require('../config/default');
const { resolvePricing } = require('./utils/pricing');
const { recordRequest: recordOpenCodeRequest } = require('./services/opencode-statistics-service');
const { saveProxyStartTime, clearProxyStartTime, getProxyStartTime, getProxyRuntime } = require('./services/proxy-runtime');
const { getEnabledChannels, getEffectiveApiKey } = require('./services/opencode-channels');
const { probeModelAvailability } = require('./services/model-detector');
const { CLAUDE_MODEL_PRICING } = require('../config/model-pricing');

let proxyServer = null;
let proxyApp = null;
let currentPort = null;

// 用于存储每个请求的元数据
const requestMetadata = new Map();

// 用于缓存已打印过的模型重定向规则，避免重复打印
// 格式: { channelId: { "originalModel": "redirectedModel", ... } }
const printedRedirectCache = new Map();

// OpenAI 模型定价（每百万 tokens 的价格，单位：美元）
// Claude 模型使用 config/model-pricing.js 中的集中定价
const PRICING = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-2024-11-20': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-4': { input: 30, output: 60 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'o1': { input: 15, output: 60 },
  'o1-mini': { input: 3, output: 12 },
  'o1-pro': { input: 150, output: 600 },
  'o3': { input: 10, output: 40 },
  'o3-mini': { input: 1.1, output: 4.4 },
  'o4-mini': { input: 1.1, output: 4.4 }
};

const OPENCODE_BASE_PRICING = DEFAULT_CONFIG.pricing.opencode || DEFAULT_CONFIG.pricing.codex;
const ONE_MILLION = 1000000;

/**
 * 检测模型层级
 * @param {string} modelName - 模型名称
 * @returns {string|null} 模型层级 (opus/sonnet/haiku) 或 null
 */
function detectModelTier(modelName) {
  if (!modelName) return null;
  const lower = modelName.toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('haiku')) return 'haiku';
  return null;
}

/**
 * 应用模型重定向
 * @param {string} originalModel - 原始模型名称
 * @param {object} channel - 渠道对象，包含 modelConfig 和 modelRedirects
 * @returns {string} 重定向后的模型名称
 */
function redirectModel(originalModel, channel) {
  if (!originalModel) return originalModel;

  // 优先使用新的 modelRedirects 数组格式
  const modelRedirects = channel?.modelRedirects;
  if (Array.isArray(modelRedirects) && modelRedirects.length > 0) {
    for (const rule of modelRedirects) {
      if (rule.from && rule.to && rule.from === originalModel) {
        return rule.to;
      }
    }
  }

  // 向后兼容：使用旧的 modelConfig 格式
  const modelConfig = channel?.modelConfig;
  if (!modelConfig) return originalModel;

  const tier = detectModelTier(originalModel);

  // 优先级：层级特定配置 > 通用模型覆盖
  if (tier === 'opus' && modelConfig.opusModel) {
    return modelConfig.opusModel;
  }
  if (tier === 'sonnet' && modelConfig.sonnetModel) {
    return modelConfig.sonnetModel;
  }
  if (tier === 'haiku' && modelConfig.haikuModel) {
    return modelConfig.haikuModel;
  }

  // 回退到通用模型覆盖
  if (modelConfig.model) {
    return modelConfig.model;
  }

  return originalModel;
}

/**
 * 解析 OpenCode 代理目标 URL
 *
 * OpenCode CLI 发送请求到我们的代理时，请求路径格式：
 * - /v1/responses (OpenAI Responses API)
 * - /v1/chat/completions (OpenAI Chat Completions API)
 *
 * 渠道配置的 base_url 可能是:
 * - https://api.openai.com/v1
 * - https://example.com/openai/v1
 * - https://example.com
 *
 * 最终转发目标示例：
 * - base_url: https://example.com/openai/v1, path: /v1/responses
 *   -> target: https://example.com/openai, 最终: https://example.com/openai/v1/responses
 *
 * 这个函数返回要传给 http-proxy 的 target，http-proxy 会自动拼接 req.url
 */
function resolveOpenCodeTarget(baseUrl = '', requestPath = '') {
  let target = baseUrl || '';

  // 移除末尾斜杠
  if (target.endsWith('/')) {
    target = target.slice(0, -1);
  }

  // 核心逻辑：避免 /v1/v1 重复
  // 如果 base_url 以 /v1 结尾，且请求路径以 /v1 开头，去掉 base_url 的 /v1
  // 因为 http-proxy 会将 requestPath 追加到 target 后面
  if (target.endsWith('/v1') && requestPath.startsWith('/v1')) {
    target = target.slice(0, -3);
  }

  return target;
}

/**
 * 计算请求成本
 */
function calculateCost(model, tokens) {
  let pricing;

  // 首先检查是否是 Claude 模型，使用集中定价
  if (model.startsWith('claude-') || model.toLowerCase().includes('claude')) {
    pricing = CLAUDE_MODEL_PRICING[model];

    // 如果没有精确匹配，尝试模糊匹配 Claude 模型
    if (!pricing) {
      const modelLower = model.toLowerCase();
      // 查找最接近的 Claude 模型
      for (const [key, value] of Object.entries(CLAUDE_MODEL_PRICING)) {
        if (key.toLowerCase().includes(modelLower) || modelLower.includes(key.toLowerCase())) {
          pricing = value;
          break;
        }
      }
    }

    // 如果仍然没有找到，使用默认 Sonnet 定价
    if (!pricing) {
      pricing = CLAUDE_MODEL_PRICING['claude-sonnet-4-5-20250929'];
    }
  } else {
    // 非 Claude 模型，使用 PRICING 对象（OpenAI 等）
    pricing = PRICING[model];

    // 如果没有精确匹配，尝试模糊匹配
    if (!pricing) {
      const modelLower = model.toLowerCase();
      if (modelLower.includes('gpt-4o-mini')) {
        pricing = PRICING['gpt-4o-mini'];
      } else if (modelLower.includes('gpt-4o')) {
        pricing = PRICING['gpt-4o'];
      } else if (modelLower.includes('gpt-4')) {
        pricing = PRICING['gpt-4'];
      } else if (modelLower.includes('gpt-3.5')) {
        pricing = PRICING['gpt-3.5-turbo'];
      } else if (modelLower.includes('o1-mini')) {
        pricing = PRICING['o1-mini'];
      } else if (modelLower.includes('o1-pro')) {
        pricing = PRICING['o1-pro'];
      } else if (modelLower.includes('o1')) {
        pricing = PRICING['o1'];
      } else if (modelLower.includes('o3-mini')) {
        pricing = PRICING['o3-mini'];
      } else if (modelLower.includes('o3')) {
        pricing = PRICING['o3'];
      } else if (modelLower.includes('o4-mini')) {
        pricing = PRICING['o4-mini'];
      }
    }
  }

  // 默认使用基础定价
  pricing = resolvePricing('opencode', pricing, OPENCODE_BASE_PRICING);
  const inputRate = typeof pricing.input === 'number' ? pricing.input : OPENCODE_BASE_PRICING.input;
  const outputRate = typeof pricing.output === 'number' ? pricing.output : OPENCODE_BASE_PRICING.output;

  return (
    (tokens.input || 0) * inputRate / ONE_MILLION +
    (tokens.output || 0) * outputRate / ONE_MILLION
  );
}

const jsonBodyParser = express.json({
  limit: '100mb',
  verify: (req, res, buf) => {
    req.rawBody = Buffer.from(buf);
  }
});

function shouldParseJson(req) {
  const contentType = req.headers['content-type'] || '';
  return req.method === 'POST' && contentType.includes('application/json');
}

function normalizeGatewaySourceType(channel) {
  const value = String(channel?.gatewaySourceType || '').trim().toLowerCase();
  if (value === 'claude') return 'claude';
  if (value === 'gemini') return 'gemini';
  return 'codex';
}

function getRequestPathname(urlPath = '') {
  try {
    const parsed = new URL(urlPath, 'http://localhost');
    return parsed.pathname || '/';
  } catch {
    return String(urlPath || '').split('?')[0] || '/';
  }
}

function isResponsesPath(pathname) {
  return pathname === '/v1/responses' || pathname === '/responses';
}

function isChatCompletionsPath(pathname) {
  return pathname === '/v1/chat/completions' || pathname === '/chat/completions';
}

function extractTextFragments(value, fragments) {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (value.trim()) fragments.push(value);
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    fragments.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(item => extractTextFragments(item, fragments));
    return;
  }
  if (typeof value !== 'object') return;

  if (typeof value.text === 'string') {
    extractTextFragments(value.text, fragments);
    return;
  }
  if (typeof value.input_text === 'string') {
    extractTextFragments(value.input_text, fragments);
    return;
  }
  if (typeof value.output_text === 'string') {
    extractTextFragments(value.output_text, fragments);
    return;
  }
  if (value.content !== undefined) {
    extractTextFragments(value.content, fragments);
    return;
  }
  if (Array.isArray(value.parts)) {
    extractTextFragments(value.parts, fragments);
  }
}

function extractText(value) {
  const fragments = [];
  extractTextFragments(value, fragments);
  return fragments.join('\n').trim();
}

function normalizeOpenAiRole(role) {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'assistant' || value === 'model') return 'assistant';
  if (value === 'system') return 'system';
  return 'user';
}

function normalizeOpenAiToolsToClaude(tools = []) {
  if (!Array.isArray(tools)) return [];

  const normalized = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue;

    if (tool.type === 'function' && tool.function && typeof tool.function === 'object') {
      const fn = tool.function;
      if (!fn.name) continue;
      normalized.push({
        name: fn.name,
        description: fn.description || '',
        input_schema: fn.parameters || { type: 'object', properties: {} }
      });
      continue;
    }

    if (tool.type === 'function' && tool.name) {
      normalized.push({
        name: tool.name,
        description: tool.description || '',
        input_schema: tool.parameters || { type: 'object', properties: {} }
      });
    }
  }

  return normalized;
}

function normalizeToolChoiceToClaude(toolChoice) {
  if (!toolChoice) return undefined;

  if (typeof toolChoice === 'string') {
    if (toolChoice === 'auto') return { type: 'auto' };
    if (toolChoice === 'required') return { type: 'any' };
    return undefined;
  }

  if (typeof toolChoice === 'object') {
    if (toolChoice.type === 'function' && toolChoice.function?.name) {
      return { type: 'tool', name: toolChoice.function.name };
    }
    if (toolChoice.type === 'function' && toolChoice.name) {
      return { type: 'tool', name: toolChoice.name };
    }
    if (toolChoice.type === 'auto') return { type: 'auto' };
    if (toolChoice.type === 'required') return { type: 'any' };
  }

  return undefined;
}

function generateToolCallId() {
  return `toolu_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseToolArguments(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function normalizeToolResultContent(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildAssistantToolUseMessageFromFunctionCall(item) {
  const functionPayload = (item?.function && typeof item.function === 'object')
    ? item.function
    : item;
  const name = functionPayload?.name || item?.name;
  if (!name) return null;

  const callId = functionPayload?.call_id || item?.call_id || functionPayload?.id || item?.id || generateToolCallId();
  const argumentsSource = functionPayload?.arguments ?? item?.arguments ?? functionPayload?.input ?? item?.input;
  const input = parseToolArguments(argumentsSource);

  return {
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: callId,
        name,
        input
      }
    ]
  };
}

function buildUserToolResultMessage(item) {
  const callId = item?.call_id || item?.tool_call_id || item?.id || generateToolCallId();
  const outputSource = item?.output ?? item?.content ?? '';
  const content = normalizeToolResultContent(outputSource);

  return {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: callId,
        content
      }
    ]
  };
}

function normalizeOpenCodeMessages(pathname, payload = {}) {
  const systemParts = [];
  const messages = [];

  if (isResponsesPath(pathname) && typeof payload.instructions === 'string' && payload.instructions.trim()) {
    systemParts.push(payload.instructions.trim());
  }

  const appendMessage = (role, content) => {
    const normalizedRole = normalizeOpenAiRole(role);
    const text = extractText(content);
    if (!text) return;
    if (normalizedRole === 'system') {
      systemParts.push(text);
      return;
    }
    messages.push({
      role: normalizedRole === 'assistant' ? 'assistant' : 'user',
      content: [{ type: 'text', text }]
    });
  };

  if (isResponsesPath(pathname)) {
    if (typeof payload.input === 'string') {
      appendMessage('user', payload.input);
    } else if (Array.isArray(payload.input)) {
      payload.input.forEach(item => {
        if (!item || typeof item !== 'object') return;
        if (item.type === 'function_call') {
          const assistantToolUse = buildAssistantToolUseMessageFromFunctionCall(item);
          if (assistantToolUse) {
            messages.push(assistantToolUse);
          }
          return;
        }
        if (item.type === 'function_call_output') {
          messages.push(buildUserToolResultMessage(item));
          return;
        }
        if (item.type === 'message' || item.role) {
          appendMessage(item.role, item.content);
        }
      });
    }
  }

  if (isChatCompletionsPath(pathname) && Array.isArray(payload.messages)) {
    payload.messages.forEach(message => {
      if (!message || typeof message !== 'object') return;
      if (message.role === 'tool') {
        messages.push(buildUserToolResultMessage(message));
        return;
      }
      if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
        const assistantContent = [];
        const text = extractText(message.content);
        if (text) {
          assistantContent.push({ type: 'text', text });
        }

        message.tool_calls.forEach(toolCall => {
          if (!toolCall || typeof toolCall !== 'object') return;
          const functionPayload = (toolCall.function && typeof toolCall.function === 'object')
            ? toolCall.function
            : toolCall;
          const name = functionPayload.name || toolCall.name;
          if (!name) return;
          assistantContent.push({
            type: 'tool_use',
            id: toolCall.id || functionPayload.call_id || generateToolCallId(),
            name,
            input: parseToolArguments(functionPayload.arguments ?? functionPayload.input)
          });
        });

        if (assistantContent.length > 0) {
          messages.push({
            role: 'assistant',
            content: assistantContent
          });
        }
        return;
      }
      appendMessage(message.role, message.content);
    });
  }

  if (messages.length === 0) {
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: 'Hello' }]
    });
  }

  return {
    system: systemParts.join('\n\n').trim(),
    messages
  };
}

function convertOpenCodePayloadToClaude(pathname, payload = {}) {
  const normalized = normalizeOpenCodeMessages(pathname, payload);
  const maxTokens = Number(payload.max_output_tokens ?? payload.max_tokens);

  const converted = {
    model: payload.model || 'claude-sonnet-4-20250514',
    max_tokens: Number.isFinite(maxTokens) && maxTokens > 0 ? Math.round(maxTokens) : 4096,
    stream: false,
    messages: normalized.messages
  };

  if (normalized.system) {
    converted.system = normalized.system;
  }

  const tools = normalizeOpenAiToolsToClaude(payload.tools || []);
  if (tools.length > 0) {
    converted.tools = tools;
  }

  const toolChoice = normalizeToolChoiceToClaude(payload.tool_choice);
  if (toolChoice) {
    converted.tool_choice = toolChoice;
  }

  if (Number.isFinite(Number(payload.temperature))) {
    converted.temperature = Number(payload.temperature);
  }
  if (Number.isFinite(Number(payload.top_p))) {
    converted.top_p = Number(payload.top_p);
  }
  if (Number.isFinite(Number(payload.top_k))) {
    converted.top_k = Number(payload.top_k);
  }

  return converted;
}

function normalizeOpenAiToolsToGemini(tools = []) {
  if (!Array.isArray(tools)) return [];

  const functionDeclarations = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue;

    if (tool.type === 'function' && tool.function && typeof tool.function === 'object') {
      const fn = tool.function;
      if (!fn.name) continue;
      functionDeclarations.push({
        name: fn.name,
        description: fn.description || '',
        parameters: fn.parameters || { type: 'object', properties: {} }
      });
      continue;
    }

    if (tool.type === 'function' && tool.name) {
      functionDeclarations.push({
        name: tool.name,
        description: tool.description || '',
        parameters: tool.parameters || { type: 'object', properties: {} }
      });
    }
  }

  if (functionDeclarations.length === 0) return [];
  return [{ functionDeclarations }];
}

function normalizeToolChoiceToGemini(toolChoice) {
  if (!toolChoice) return undefined;

  if (typeof toolChoice === 'string') {
    if (toolChoice === 'auto') {
      return { functionCallingConfig: { mode: 'AUTO' } };
    }
    if (toolChoice === 'required') {
      return { functionCallingConfig: { mode: 'ANY' } };
    }
    if (toolChoice === 'none') {
      return { functionCallingConfig: { mode: 'NONE' } };
    }
    return undefined;
  }

  if (typeof toolChoice === 'object') {
    const functionName = toolChoice.function?.name || toolChoice.name;
    if (toolChoice.type === 'function' && functionName) {
      return {
        functionCallingConfig: {
          mode: 'ANY',
          allowedFunctionNames: [functionName]
        }
      };
    }
    if (toolChoice.type === 'auto') {
      return { functionCallingConfig: { mode: 'AUTO' } };
    }
    if (toolChoice.type === 'required') {
      return { functionCallingConfig: { mode: 'ANY' } };
    }
    if (toolChoice.type === 'none') {
      return { functionCallingConfig: { mode: 'NONE' } };
    }
  }

  return undefined;
}

function normalizeStopSequences(stopValue) {
  if (!stopValue) return undefined;
  if (typeof stopValue === 'string' && stopValue.trim()) {
    return [stopValue];
  }
  if (Array.isArray(stopValue)) {
    const sequences = stopValue
      .filter(item => typeof item === 'string')
      .map(item => item.trim())
      .filter(Boolean);
    return sequences.length > 0 ? sequences : undefined;
  }
  return undefined;
}

function buildGeminiContents(messages = []) {
  const contents = [];
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const text = extractText(message.content);
    if (!text) continue;
    const role = message.role === 'assistant' ? 'model' : 'user';
    contents.push({
      role,
      parts: [{ text }]
    });
  }
  return contents;
}

function convertOpenCodePayloadToGemini(pathname, payload = {}, fallbackModel = '') {
  const normalized = normalizeOpenCodeMessages(pathname, payload);
  const maxTokens = Number(payload.max_output_tokens ?? payload.max_tokens);
  const stopSequences = normalizeStopSequences(payload.stop);
  const tools = normalizeOpenAiToolsToGemini(payload.tools || []);
  const toolConfig = normalizeToolChoiceToGemini(payload.tool_choice);

  const requestBody = {
    contents: buildGeminiContents(normalized.messages)
  };

  if (normalized.system) {
    requestBody.systemInstruction = {
      parts: [{ text: normalized.system }]
    };
  }

  const generationConfig = {};
  if (Number.isFinite(maxTokens) && maxTokens > 0) {
    generationConfig.maxOutputTokens = Math.round(maxTokens);
  }
  if (Number.isFinite(Number(payload.temperature))) {
    generationConfig.temperature = Number(payload.temperature);
  }
  if (Number.isFinite(Number(payload.top_p))) {
    generationConfig.topP = Number(payload.top_p);
  }
  if (Number.isFinite(Number(payload.top_k))) {
    generationConfig.topK = Number(payload.top_k);
  }
  if (stopSequences) {
    generationConfig.stopSequences = stopSequences;
  }
  if (Object.keys(generationConfig).length > 0) {
    requestBody.generationConfig = generationConfig;
  }

  if (tools.length > 0) {
    requestBody.tools = tools;
  }
  if (toolConfig) {
    requestBody.toolConfig = toolConfig;
  }

  return {
    model: payload.model || fallbackModel || '',
    requestBody
  };
}

function buildClaudeTargetUrl(baseUrl = '') {
  const trimmed = String(baseUrl || '').replace(/\/+$/, '');
  if (!trimmed) return '/v1/messages';
  if (trimmed.endsWith('/v1')) return `${trimmed}/messages`;
  if (trimmed.endsWith('/messages')) return trimmed;
  return `${trimmed}/v1/messages`;
}

function buildGeminiTargetUrl(baseUrl = '', model = '', apiKey = '') {
  const modelName = String(model || '').trim();
  if (!modelName) return '';

  let targetUrl;
  try {
    targetUrl = new URL(String(baseUrl || '').trim() || 'https://generativelanguage.googleapis.com');
  } catch {
    targetUrl = new URL('https://generativelanguage.googleapis.com');
  }

  let pathname = targetUrl.pathname.replace(/\/+$/, '');
  const modelsIndex = pathname.indexOf('/models');
  if (modelsIndex >= 0) {
    pathname = pathname.slice(0, modelsIndex);
  }

  let apiBasePath;
  if (!pathname || pathname === '/') {
    apiBasePath = '/v1beta';
  } else if (pathname.endsWith('/v1beta') || pathname.endsWith('/v1')) {
    apiBasePath = pathname;
  } else {
    apiBasePath = `${pathname}/v1beta`;
  }

  targetUrl.pathname = `${apiBasePath}/models/${encodeURIComponent(modelName)}:generateContent`;
  if (apiKey) {
    targetUrl.searchParams.set('key', apiKey);
  }

  return targetUrl.toString();
}

function createDecodedStream(res) {
  const encoding = String(res.headers['content-encoding'] || '').toLowerCase();
  if (encoding.includes('gzip')) return res.pipe(zlib.createGunzip());
  if (encoding.includes('deflate')) return res.pipe(zlib.createInflate());
  if (encoding.includes('br') && typeof zlib.createBrotliDecompress === 'function') {
    return res.pipe(zlib.createBrotliDecompress());
  }
  return res;
}

function collectHttpResponseBody(res) {
  return new Promise((resolve, reject) => {
    const stream = createDecodedStream(res);
    const chunks = [];
    stream.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
    res.on('error', reject);
  });
}

function postJson(url, headers, payload, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const isHttps = target.protocol === 'https:';
    const client = isHttps ? https : http;
    const body = JSON.stringify(payload || {});
    const request = client.request({
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      timeout: timeoutMs,
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (response) => {
      collectHttpResponseBody(response)
        .then((rawBody) => {
          resolve({
            statusCode: response.statusCode || 500,
            headers: response.headers || {},
            rawBody
          });
        })
        .catch(reject);
    });

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy(new Error('Gateway request timeout'));
    });
    request.write(body);
    request.end();
  });
}

function extractClaudeResponseContent(claudeResponse = {}) {
  const textFragments = [];
  const functionCalls = [];

  if (!Array.isArray(claudeResponse.content)) {
    return { text: '', functionCalls: [] };
  }

  claudeResponse.content.forEach(block => {
    if (!block || typeof block !== 'object') return;

    if (typeof block.text === 'string' && block.text.trim()) {
      textFragments.push(block.text);
    }

    if (block.type === 'tool_use' && block.name) {
      const callId = String(block.id || generateToolCallId());
      const argsObject = (block.input && typeof block.input === 'object' && !Array.isArray(block.input))
        ? block.input
        : {};
      functionCalls.push({
        id: `fc_${callId}`,
        call_id: callId,
        name: block.name,
        arguments: JSON.stringify(argsObject)
      });
    }
  });

  return {
    text: textFragments.join('\n').trim(),
    functionCalls
  };
}

function extractClaudeResponseText(claudeResponse = {}) {
  return extractClaudeResponseContent(claudeResponse).text;
}

function extractGeminiResponseText(geminiResponse = {}) {
  if (!Array.isArray(geminiResponse.candidates)) return '';
  const fragments = [];
  for (const candidate of geminiResponse.candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const parts = candidate.content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (typeof part?.text === 'string' && part.text.trim()) {
        fragments.push(part.text);
      }
    }
  }
  return fragments.join('\n').trim();
}

function extractGeminiFunctionCalls(geminiResponse = {}) {
  if (!Array.isArray(geminiResponse.candidates)) return [];
  const calls = [];
  for (const candidate of geminiResponse.candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const parts = candidate.content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (!part || typeof part !== 'object') continue;
      const functionCall = part.functionCall;
      if (!functionCall || typeof functionCall !== 'object' || !functionCall.name) continue;
      calls.push(functionCall);
    }
  }
  return calls;
}

function mapClaudeStopReasonToChatFinishReason(stopReason) {
  if (stopReason === 'max_tokens') return 'length';
  if (stopReason === 'tool_use') return 'tool_calls';
  if (stopReason === 'pause_turn') return 'stop';
  return 'stop';
}

function mapGeminiFinishReasonToChatFinishReason(finishReason, hasToolCalls = false) {
  if (hasToolCalls) return 'tool_calls';
  const normalized = String(finishReason || '').trim().toUpperCase();
  if (normalized === 'MAX_TOKENS') return 'length';
  if (normalized === 'SAFETY' || normalized === 'RECITATION' || normalized === 'SPII') return 'content_filter';
  return 'stop';
}

function buildOpenAiResponsesObject(claudeResponse = {}, fallbackModel = '') {
  const inputTokens = Number(claudeResponse?.usage?.input_tokens || 0);
  const outputTokens = Number(claudeResponse?.usage?.output_tokens || 0);
  const totalTokens = Number(claudeResponse?.usage?.total_tokens || (inputTokens + outputTokens));
  const parsedContent = extractClaudeResponseContent(claudeResponse);
  const text = parsedContent.text;
  const model = claudeResponse.model || fallbackModel || '';
  const responseId = `resp_${String(claudeResponse.id || Date.now()).replace(/[^a-zA-Z0-9_]/g, '')}`;
  const messageId = claudeResponse.id || `msg_${Date.now()}`;
  const createdAt = Math.floor(Date.now() / 1000);
  const output = [];

  if (text || parsedContent.functionCalls.length === 0) {
    output.push({
      id: messageId,
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text,
          annotations: []
        }
      ]
    });
  }

  parsedContent.functionCalls.forEach(call => {
    output.push({
      id: call.id,
      type: 'function_call',
      status: 'completed',
      arguments: call.arguments,
      call_id: call.call_id,
      name: call.name
    });
  });

  return {
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status: 'completed',
    model,
    output,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens
    }
  };
}

function buildOpenAiResponsesObjectFromGemini(geminiResponse = {}, fallbackModel = '') {
  const inputTokens = Number(geminiResponse?.usageMetadata?.promptTokenCount || 0);
  const outputTokens = Number(geminiResponse?.usageMetadata?.candidatesTokenCount || 0);
  const totalTokens = Number(geminiResponse?.usageMetadata?.totalTokenCount || (inputTokens + outputTokens));
  const text = extractGeminiResponseText(geminiResponse);
  const model = geminiResponse.modelVersion || fallbackModel || '';
  const responseId = `resp_${Date.now()}`;
  const messageId = `msg_${Date.now()}`;
  const createdAt = Math.floor(Date.now() / 1000);

  return {
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status: 'completed',
    model,
    output: [
      {
        id: messageId,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text,
            annotations: []
          }
        ]
      }
    ],
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens
    }
  };
}

function buildOpenAiChatCompletionsObject(claudeResponse = {}, fallbackModel = '') {
  const inputTokens = Number(claudeResponse?.usage?.input_tokens || 0);
  const outputTokens = Number(claudeResponse?.usage?.output_tokens || 0);
  const totalTokens = Number(claudeResponse?.usage?.total_tokens || (inputTokens + outputTokens));
  const parsedContent = extractClaudeResponseContent(claudeResponse);
  const text = parsedContent.text;
  const model = claudeResponse.model || fallbackModel || '';
  const chatId = `chatcmpl_${String(claudeResponse.id || Date.now()).replace(/[^a-zA-Z0-9_]/g, '')}`;
  const created = Math.floor(Date.now() / 1000);
  const hasToolCalls = parsedContent.functionCalls.length > 0;
  const message = {
    role: 'assistant',
    content: text || (hasToolCalls ? null : '')
  };

  if (hasToolCalls) {
    message.tool_calls = parsedContent.functionCalls.map(call => ({
      id: call.call_id,
      type: 'function',
      function: {
        name: call.name,
        arguments: call.arguments
      }
    }));
  }

  return {
    id: chatId,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: hasToolCalls ? 'tool_calls' : mapClaudeStopReasonToChatFinishReason(claudeResponse.stop_reason)
      }
    ],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: totalTokens
    }
  };
}

function buildOpenAiChatCompletionsObjectFromGemini(geminiResponse = {}, fallbackModel = '') {
  const inputTokens = Number(geminiResponse?.usageMetadata?.promptTokenCount || 0);
  const outputTokens = Number(geminiResponse?.usageMetadata?.candidatesTokenCount || 0);
  const totalTokens = Number(geminiResponse?.usageMetadata?.totalTokenCount || (inputTokens + outputTokens));
  const text = extractGeminiResponseText(geminiResponse);
  const model = geminiResponse.modelVersion || fallbackModel || '';
  const chatId = `chatcmpl_${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const firstCandidate = Array.isArray(geminiResponse.candidates) ? geminiResponse.candidates[0] : null;
  const functionCalls = extractGeminiFunctionCalls(geminiResponse);
  const hasToolCalls = functionCalls.length > 0;

  const message = {
    role: 'assistant',
    content: text || (hasToolCalls ? null : '')
  };

  if (hasToolCalls) {
    message.tool_calls = functionCalls.map((call, index) => ({
      id: `call_${index + 1}`,
      type: 'function',
      function: {
        name: call.name,
        arguments: JSON.stringify(call.args || {})
      }
    }));
  }

  return {
    id: chatId,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: mapGeminiFinishReasonToChatFinishReason(firstCandidate?.finishReason, hasToolCalls)
      }
    ],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: totalTokens
    }
  };
}

function sendOpenAiStyleError(res, statusCode, message, type = 'invalid_request_error') {
  const code = Number(statusCode) || 500;
  res.status(code).json({
    error: {
      message: message || 'Gateway request failed',
      type
    }
  });
}

function publishOpenCodeUsageLog({ requestId, channel, model, usage, startTime }) {
  const inputTokens = Number(usage?.input_tokens || usage?.prompt_tokens || 0);
  const outputTokens = Number(usage?.output_tokens || usage?.completion_tokens || 0);
  const totalTokens = Number(usage?.total_tokens || (inputTokens + outputTokens));
  const now = new Date();
  const time = now.toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const tokens = {
    input: inputTokens,
    output: outputTokens,
    total: totalTokens
  };
  const cost = calculateCost(model || '', tokens);

  broadcastLog({
    type: 'log',
    id: requestId,
    time,
    channel: channel.name,
    model: model || '',
    inputTokens,
    outputTokens,
    cachedTokens: 0,
    reasoningTokens: 0,
    totalTokens,
    cost,
    source: 'opencode'
  });

  recordOpenCodeRequest({
    id: requestId,
    timestamp: new Date(startTime).toISOString(),
    toolType: 'opencode',
    channel: channel.name,
    channelId: channel.id,
    model: model || '',
    tokens: {
      input: inputTokens,
      output: outputTokens,
      reasoning: 0,
      cached: 0,
      total: totalTokens
    },
    duration: Date.now() - startTime,
    success: true,
    cost
  });
}

function sendResponsesSse(res, responseObject) {
  const outputItems = Array.isArray(responseObject?.output) ? responseObject.output : [];
  const text = outputItems
    .filter(item => item?.type === 'message')
    .map(item => item?.content?.[0]?.text || '')
    .filter(Boolean)
    .join('\n')
    .trim();
  const functionCalls = outputItems.filter(item => item?.type === 'function_call');

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const createdPayload = {
    type: 'response.created',
    response: {
      id: responseObject.id,
      object: 'response',
      created_at: responseObject.created_at,
      model: responseObject.model,
      status: 'in_progress'
    }
  };
  res.write(`data: ${JSON.stringify(createdPayload)}\n\n`);

  if (text) {
    const deltaPayload = {
      type: 'response.output_text.delta',
      delta: text
    };
    res.write(`data: ${JSON.stringify(deltaPayload)}\n\n`);
  }

  if (functionCalls.length > 0) {
    functionCalls.forEach((item, index) => {
      const payload = {
        type: 'response.output_item.added',
        output_index: index,
        item
      };
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    });
  }

  const completedPayload = {
    type: 'response.completed',
    response: responseObject
  };
  res.write(`data: ${JSON.stringify(completedPayload)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

function sendChatCompletionsSse(res, responseObject) {
  const text = responseObject?.choices?.[0]?.message?.content || '';
  const finishReason = responseObject?.choices?.[0]?.finish_reason || 'stop';

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const chunk = {
    id: responseObject.id,
    object: 'chat.completion.chunk',
    created: responseObject.created,
    model: responseObject.model,
    choices: [
      {
        index: 0,
        delta: {
          role: 'assistant',
          content: text
        },
        finish_reason: finishReason
      }
    ]
  };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

async function handleClaudeGatewayRequest(req, res, channel, effectiveKey) {
  const pathname = getRequestPathname(req.url);
  if (!isResponsesPath(pathname) && !isChatCompletionsPath(pathname)) {
    return false;
  }

  if (!shouldParseJson(req)) {
    sendOpenAiStyleError(res, 400, 'Claude gateway only supports JSON POST payload');
    return true;
  }

  const requestId = `opencode-${Date.now()}-${Math.random()}`;
  const startTime = Date.now();
  const originalPayload = (req.body && typeof req.body === 'object') ? req.body : {};
  const wantsStream = !!originalPayload.stream;
  const claudePayload = convertOpenCodePayloadToClaude(pathname, originalPayload);

  const headers = {
    'x-api-key': effectiveKey,
    'authorization': `Bearer ${effectiveKey}`,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'claude-code-20250219,interleaved-thinking-2025-05-14',
    'accept': 'application/json',
    'accept-encoding': 'gzip, deflate, br',
    'user-agent': 'claude-cli/2.0.53 (external, cli)'
  };

  let upstream;
  try {
    upstream = await postJson(buildClaudeTargetUrl(channel.baseUrl), headers, claudePayload, 120000);
  } catch (error) {
    recordFailure(channel.id, 'opencode', error);
    sendOpenAiStyleError(res, 502, `Claude gateway network error: ${error.message}`, 'proxy_error');
    return true;
  }

  const statusCode = Number(upstream.statusCode) || 500;
  let parsedBody = null;
  try {
    parsedBody = upstream.rawBody ? JSON.parse(upstream.rawBody) : {};
  } catch {
    parsedBody = null;
  }

  if (statusCode < 200 || statusCode >= 300) {
    const upstreamMessage = parsedBody?.error?.message || parsedBody?.message || upstream.rawBody || `HTTP ${statusCode}`;
    recordFailure(channel.id, 'opencode', new Error(String(upstreamMessage).slice(0, 200)));
    sendOpenAiStyleError(res, statusCode, String(upstreamMessage).slice(0, 1000), 'upstream_error');
    return true;
  }

  if (!parsedBody || typeof parsedBody !== 'object') {
    recordFailure(channel.id, 'opencode', new Error('Invalid Claude gateway response'));
    sendOpenAiStyleError(res, 502, 'Invalid Claude gateway response', 'proxy_error');
    return true;
  }

  if (isResponsesPath(pathname)) {
    const responseObject = buildOpenAiResponsesObject(parsedBody, originalPayload.model);
    if (wantsStream) {
      sendResponsesSse(res, responseObject);
    } else {
      res.json(responseObject);
    }
    publishOpenCodeUsageLog({
      requestId,
      channel,
      model: responseObject.model,
      usage: responseObject.usage,
      startTime
    });
    recordSuccess(channel.id, 'opencode');
    return true;
  }

  const chatResponseObject = buildOpenAiChatCompletionsObject(parsedBody, originalPayload.model);
  if (wantsStream) {
    sendChatCompletionsSse(res, chatResponseObject);
  } else {
    res.json(chatResponseObject);
  }
  publishOpenCodeUsageLog({
    requestId,
    channel,
    model: chatResponseObject.model,
    usage: chatResponseObject.usage,
    startTime
  });
  recordSuccess(channel.id, 'opencode');
  return true;
}

async function handleGeminiGatewayRequest(req, res, channel, effectiveKey) {
  const pathname = getRequestPathname(req.url);
  if (!isResponsesPath(pathname) && !isChatCompletionsPath(pathname)) {
    return false;
  }

  if (!shouldParseJson(req)) {
    sendOpenAiStyleError(res, 400, 'Gemini gateway only supports JSON POST payload');
    return true;
  }

  const requestId = `opencode-${Date.now()}-${Math.random()}`;
  const startTime = Date.now();
  const originalPayload = (req.body && typeof req.body === 'object') ? req.body : {};
  const wantsStream = !!originalPayload.stream;
  const converted = convertOpenCodePayloadToGemini(pathname, originalPayload, channel.model);
  const targetModel = converted.model;

  if (!targetModel) {
    sendOpenAiStyleError(res, 400, 'Missing model in request and channel configuration');
    return true;
  }

  const targetUrl = buildGeminiTargetUrl(channel.baseUrl, targetModel, effectiveKey);
  if (!targetUrl) {
    sendOpenAiStyleError(res, 400, 'Failed to build Gemini target URL');
    return true;
  }

  const headers = {
    'x-goog-api-key': effectiveKey,
    'authorization': `Bearer ${effectiveKey}`,
    'accept': 'application/json',
    'accept-encoding': 'gzip, deflate, br',
    'user-agent': 'google-genai-sdk/0.8.0'
  };

  let upstream;
  try {
    upstream = await postJson(targetUrl, headers, converted.requestBody, 120000);
  } catch (error) {
    recordFailure(channel.id, 'opencode', error);
    sendOpenAiStyleError(res, 502, `Gemini gateway network error: ${error.message}`, 'proxy_error');
    return true;
  }

  const statusCode = Number(upstream.statusCode) || 500;
  let parsedBody = null;
  try {
    parsedBody = upstream.rawBody ? JSON.parse(upstream.rawBody) : {};
  } catch {
    parsedBody = null;
  }

  if (statusCode < 200 || statusCode >= 300) {
    const upstreamMessage = parsedBody?.error?.message || parsedBody?.message || upstream.rawBody || `HTTP ${statusCode}`;
    recordFailure(channel.id, 'opencode', new Error(String(upstreamMessage).slice(0, 200)));
    sendOpenAiStyleError(res, statusCode, String(upstreamMessage).slice(0, 1000), 'upstream_error');
    return true;
  }

  if (!parsedBody || typeof parsedBody !== 'object') {
    recordFailure(channel.id, 'opencode', new Error('Invalid Gemini gateway response'));
    sendOpenAiStyleError(res, 502, 'Invalid Gemini gateway response', 'proxy_error');
    return true;
  }

  if (isResponsesPath(pathname)) {
    const responseObject = buildOpenAiResponsesObjectFromGemini(parsedBody, targetModel);
    if (wantsStream) {
      sendResponsesSse(res, responseObject);
    } else {
      res.json(responseObject);
    }
    publishOpenCodeUsageLog({
      requestId,
      channel,
      model: responseObject.model,
      usage: responseObject.usage,
      startTime
    });
    recordSuccess(channel.id, 'opencode');
    return true;
  }

  const chatResponseObject = buildOpenAiChatCompletionsObjectFromGemini(parsedBody, targetModel);
  if (wantsStream) {
    sendChatCompletionsSse(res, chatResponseObject);
  } else {
    res.json(chatResponseObject);
  }
  publishOpenCodeUsageLog({
    requestId,
    channel,
    model: chatResponseObject.model,
    usage: chatResponseObject.usage,
    startTime
  });
  recordSuccess(channel.id, 'opencode');
  return true;
}

async function collectProxyModelList(channels = [], options = {}) {
  const seen = new Set();
  const models = [];

  const add = (value) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    models.push(trimmed);
  };

  // 仅返回渠道明确声明或探测到的模型，不再注入默认模型列表
  for (const channel of channels) {
    add(channel?.model);
    add(channel?.speedTestModel);

    const modelRedirects = channel?.modelRedirects;
    if (Array.isArray(modelRedirects)) {
      modelRedirects.forEach(rule => {
        add(rule?.from);
        add(rule?.to);
      });
    }

    // 向后兼容：旧版 modelConfig
    const modelConfig = channel?.modelConfig;
    if (modelConfig && typeof modelConfig === 'object') {
      add(modelConfig.model);
      add(modelConfig.opusModel);
      add(modelConfig.sonnetModel);
      add(modelConfig.haikuModel);
    }
  }

  const forceRefresh = options.forceRefresh === true;
  if (forceRefresh) {
    await Promise.all(channels.map(async (channel) => {
      try {
        const channelType = normalizeGatewaySourceType(channel);
        const probe = await probeModelAvailability(channel, channelType, { forceRefresh: true });
        const available = Array.isArray(probe?.availableModels) ? probe.availableModels : [];
        available.forEach(add);
      } catch (err) {
        console.warn(`[OpenCode Proxy] Live model probe failed for ${channel?.name || channel?.id || 'unknown'}:`, err.message);
      }
    }));
    return models;
  }

  // 最后补充缓存探测到的模型（来自 channel-models.json）
  try {
    const cachePath = path.join(os.homedir(), '.claude', 'cc-tool', 'channel-models.json');
    if (fs.existsSync(cachePath)) {
      const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8') || '{}');
      for (const channel of channels) {
        const entry = cache?.[channel?.id];
        if (!entry || typeof entry !== 'object') continue;
        const fetched = entry.fetchedModels;
        const probed = entry.availableModels;
        if (Array.isArray(fetched)) fetched.forEach(add);
        if (Array.isArray(probed)) probed.forEach(add);
      }
    }
  } catch (err) {
    console.warn('[OpenCode Proxy] Failed to load channel-models cache:', err.message);
  }

  return models;
}

// 启动 OpenCode 代理服务器
async function startOpenCodeProxyServer(options = {}) {
  // 兼容旧调用：startOpenCodeProxyServer(portNumber)
  if (typeof options === 'number') {
    options = { port: options };
  }

  // options.preserveStartTime - 是否保留现有的启动时间（用于切换渠道时）
  const preserveStartTime = options.preserveStartTime || false;

  if (proxyServer) {
    console.log('OpenCode proxy server already running on port', currentPort);
    return { success: true, port: currentPort };
  }

  try {
    const config = loadConfig();
    const configuredPort = config.ports?.opencodeProxy || 20091;
    const port = options.port !== undefined ? Number(options.port) : configuredPort;

    if (!Number.isFinite(port) || port < 0) {
      throw new Error(`Invalid proxy port: ${options.port}`);
    }

    currentPort = port;

    proxyApp = express();

    proxyApp.use((req, res, next) => {
      if (shouldParseJson(req)) {
        return jsonBodyParser(req, res, next);
      }
      return next();
    });

    const proxy = httpProxy.createProxyServer({});

    proxy.on('proxyReq', (proxyReq, req) => {
      const activeChannel = req.selectedChannel;
      if (!activeChannel) return;

      const requestId = `opencode-${Date.now()}-${Math.random()}`;
      requestMetadata.set(req, {
        id: requestId,
      channel: activeChannel.name,
      channelId: activeChannel.id,
      startTime: Date.now()
      });

      proxyReq.removeHeader('authorization');
      // Use pre-fetched effective key from async middleware
      const effectiveKey = req.effectiveApiKey;
      proxyReq.setHeader('authorization', `Bearer ${effectiveKey}`);
      proxyReq.setHeader('openai-beta', 'responses=experimental');
      if (!proxyReq.getHeader('content-type')) {
        proxyReq.setHeader('content-type', 'application/json');
      }

      if (shouldParseJson(req) && (req.rawBody || req.body)) {
        const bodyBuffer = req.rawBody
          ? Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(req.rawBody)
          : Buffer.from(JSON.stringify(req.body));
        proxyReq.setHeader('Content-Length', bodyBuffer.length);
        proxyReq.write(bodyBuffer);
        proxyReq.end();
      }
    });

    // OpenCode 会先调用 /v1/models(or /models) 获取模型列表
    // 但很多第三方 OpenAI 兼容端点并不实现该接口（例如返回 404）。
    // 为保证 OpenCode 可用，这里优先返回本地聚合的模型列表。
    proxyApp.get(['/v1/models', '/models'], async (req, res) => {
      try {
        const channels = getEnabledChannels();
        const models = await collectProxyModelList(channels, { forceRefresh: true });
        res.json({
          object: 'list',
          data: models.map(id => ({ id, object: 'model' }))
        });
      } catch (err) {
        console.error('[OpenCode Proxy] Failed to build models list:', err);
        res.status(500).json({
          error: {
            message: err.message || 'Failed to list models',
            type: 'internal_error'
          }
        });
      }
    });

    proxyApp.use(async (req, res) => {
      try {
        const channel = await allocateChannel({ source: 'opencode', enableSessionBinding: false });
        req.selectedChannel = channel;

        // 检查 API key 是否有效
        const effectiveKey = await getEffectiveApiKey(channel);
        if (!effectiveKey) {
          releaseChannel(channel.id, 'opencode');
          broadcastSchedulerState('opencode', getSchedulerState('opencode'));
          return res.status(401).json({
            error: {
              message: 'API key not configured or expired. Please update your channel key.',
              type: 'authentication_error'
            }
          });
        }

        // Store the effective key on the request for use in proxyReq handler
        req.effectiveApiKey = effectiveKey;

        // 应用模型重定向（当 proxy 开启时）
        if (req.body && typeof req.body === 'object' && !Array.isArray(req.body) && req.body.model) {
          const originalModel = req.body.model;
          const redirectedModel = redirectModel(originalModel, channel);

          if (redirectedModel !== originalModel) {
            req.body.model = redirectedModel;
            // 更新 rawBody 以匹配修改后的 body
            req.rawBody = Buffer.from(JSON.stringify(req.body));

            // 只在重定向规则变化时打印日志（避免每次请求都打印）
            const cachedRedirects = printedRedirectCache.get(channel.id) || {};
            if (cachedRedirects[originalModel] !== redirectedModel) {
              cachedRedirects[originalModel] = redirectedModel;
              printedRedirectCache.set(channel.id, cachedRedirects);
              console.log(`[OpenCode Model Redirect] ${originalModel} → ${redirectedModel} (channel: ${channel.name})`);
            }
          }
        }

        const release = (() => {
          let released = false;
          return () => {
            if (released) return;
            released = true;
            releaseChannel(channel.id, 'opencode');
            broadcastSchedulerState('opencode', getSchedulerState('opencode'));
          };
        })();

        res.on('close', release);
        res.on('error', release);

        broadcastSchedulerState('opencode', getSchedulerState('opencode'));

        const gatewaySourceType = normalizeGatewaySourceType(channel);
        if (gatewaySourceType === 'claude') {
          const handled = await handleClaudeGatewayRequest(req, res, channel, effectiveKey);
          if (handled) {
            return;
          }
        }
        if (gatewaySourceType === 'gemini') {
          const handled = await handleGeminiGatewayRequest(req, res, channel, effectiveKey);
          if (handled) {
            return;
          }
        }

        const target = resolveOpenCodeTarget(channel.baseUrl, req.url);

        proxy.web(req, res, {
          target,
          changeOrigin: true,
          proxyTimeout: 120000,  // 代理连接超时 2 分钟
          timeout: 120000        // 请求超时 2 分钟
        }, (err) => {
          release();
          if (err) {
            recordFailure(channel.id, 'opencode', err);
            console.error('OpenCode proxy error:', err);
            if (res && !res.headersSent) {
              res.status(502).json({
                error: {
                  message: 'Proxy error: ' + err.message,
                  type: 'proxy_error'
                }
              });
            }
          }
        });
      } catch (error) {
        console.error('OpenCode channel allocation error:', error);
        if (!res.headersSent) {
          res.status(503).json({
            error: {
              message: error.message || 'No OpenCode channel available',
              type: 'channel_pool_exhausted'
            }
          });
        }
      }
    });

    // 监听代理响应 (OpenAI 格式)
    proxy.on('proxyRes', (proxyRes, req, res) => {
      const metadata = requestMetadata.get(req);
      if (!metadata) {
        return;
      }

      // 检查响应是否已关闭
      if (res.writableEnded || res.destroyed) {
        requestMetadata.delete(req);
        return;
      }

      // 标记响应是否已关闭
      let isResponseClosed = false;

      // 监听响应关闭事件
      res.on('close', () => {
        isResponseClosed = true;
        requestMetadata.delete(req);
      });

      // 监听响应错误事件
      res.on('error', (err) => {
        isResponseClosed = true;
        // 忽略客户端断开连接的常见错误
        if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
          console.error('Response error:', err);
        }
        requestMetadata.delete(req);
      });

      let buffer = '';
      let tokenData = {
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        model: ''
      };

      proxyRes.on('data', (chunk) => {
        // 如果响应已关闭，停止处理
        if (isResponseClosed) {
          return;
        }

        buffer += chunk.toString();

        // 检查是否是 SSE 流
        if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
          // 处理 SSE 事件
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';

          events.forEach((eventText, index) => {
            if (!eventText.trim()) return;

            try {
              const lines = eventText.split('\n');
              let data = '';

              lines.forEach(line => {
                if (line.startsWith('data:')) {
                  data = line.substring(5).trim();
                }
              });

              if (!data) return;

              if (data === '[DONE]') return;

              const parsed = JSON.parse(data);

              // OpenAI Responses API: 在 response.completed 事件中获取 usage
              if (parsed.type === 'response.completed' && parsed.response) {
                // 从 response 对象中提取模型和 usage
                if (parsed.response.model) {
                  tokenData.model = parsed.response.model;
                }

                if (parsed.response.usage) {
                  tokenData.inputTokens = parsed.response.usage.input_tokens || 0;
                  tokenData.outputTokens = parsed.response.usage.output_tokens || 0;
                  tokenData.totalTokens = parsed.response.usage.total_tokens || 0;

                  // 提取详细信息
                  if (parsed.response.usage.input_tokens_details) {
                    tokenData.cachedTokens = parsed.response.usage.input_tokens_details.cached_tokens || 0;
                  }
                  if (parsed.response.usage.output_tokens_details) {
                    tokenData.reasoningTokens = parsed.response.usage.output_tokens_details.reasoning_tokens || 0;
                  }
                }
              }

              // 兼容其他格式：直接在顶层的 model 和 usage
              if (parsed.model && !tokenData.model) {
                tokenData.model = parsed.model;
              }

              if (parsed.usage && tokenData.inputTokens === 0) {
                // 兼容 Responses API 和 Chat Completions API
                tokenData.inputTokens = parsed.usage.input_tokens || parsed.usage.prompt_tokens || 0;
                tokenData.outputTokens = parsed.usage.output_tokens || parsed.usage.completion_tokens || 0;
              }
            } catch (err) {
              // 忽略解析错误
            }
          });
        }
      });

      proxyRes.on('end', () => {
        // 如果不是流式响应，尝试从完整响应中解析
        if (!proxyRes.headers['content-type']?.includes('text/event-stream')) {
          try {
            const parsed = JSON.parse(buffer);
            if (parsed.model) {
              tokenData.model = parsed.model;
            }
            if (parsed.usage) {
              // 兼容两种格式
              tokenData.inputTokens = parsed.usage.input_tokens || parsed.usage.prompt_tokens || 0;
              tokenData.outputTokens = parsed.usage.output_tokens || parsed.usage.completion_tokens || 0;
            }
          } catch (err) {
            // 忽略解析错误
          }
        }

        // 只有当有 token 数据时才记录
        if (tokenData.inputTokens > 0 || tokenData.outputTokens > 0) {
          const now = new Date();
          const time = now.toLocaleTimeString('zh-CN', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          });

          // 记录统计数据（先计算）
          const tokens = {
            input: tokenData.inputTokens,
            output: tokenData.outputTokens,
            total: tokenData.inputTokens + tokenData.outputTokens
          };
          const cost = calculateCost(tokenData.model, tokens);

          // 广播日志（仅当响应仍然开放时）
          if (!isResponseClosed) {
            broadcastLog({
              type: 'log',
              id: metadata.id,
              time: time,
              channel: metadata.channel,
              model: tokenData.model,
              inputTokens: tokenData.inputTokens,
              outputTokens: tokenData.outputTokens,
              cachedTokens: tokenData.cachedTokens,
              reasoningTokens: tokenData.reasoningTokens,
              totalTokens: tokenData.totalTokens,
              cost: cost,
              source: 'opencode'
            });
          }

          const duration = Date.now() - metadata.startTime;

          recordOpenCodeRequest({
            id: metadata.id,
            timestamp: new Date(metadata.startTime).toISOString(),
            toolType: 'opencode',
            channel: metadata.channel,
            channelId: metadata.channelId,
            model: tokenData.model,
            tokens: {
              input: tokenData.inputTokens,
              output: tokenData.outputTokens,
              reasoning: tokenData.reasoningTokens,
              cached: tokenData.cachedTokens,
              total: tokens.total
            },
            duration: duration,
            success: true,
            cost: cost
          });

          recordSuccess(metadata.channelId, 'opencode');
        }

        if (!isResponseClosed) {
          requestMetadata.delete(req);
        }
      });

      proxyRes.on('error', (err) => {
        // 忽略代理响应错误（可能是网络问题）
        if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
          console.error('Proxy response error:', err);
        }
        isResponseClosed = true;
        recordFailure(metadata.channelId, 'opencode', err);
        requestMetadata.delete(req);
      });
    });

    // 处理代理错误
    proxy.on('error', (err, req, res) => {
      console.error('OpenCode proxy error:', err);
      if (req && req.selectedChannel) {
        recordFailure(req.selectedChannel.id, 'opencode', err);
        releaseChannel(req.selectedChannel.id, 'opencode');
        broadcastSchedulerState('opencode', getSchedulerState('opencode'));
      }
      if (res && !res.headersSent) {
        res.status(502).json({
          error: {
            message: 'Proxy error: ' + err.message,
            type: 'proxy_error'
          }
        });
      }
    });

    // 启动服务器
    proxyServer = http.createServer(proxyApp);

    return new Promise((resolve, reject) => {
      proxyServer.listen(port, '127.0.0.1', () => {
        const actualPort = proxyServer.address()?.port || port;
        currentPort = actualPort;
        console.log(`OpenCode proxy server started on http://127.0.0.1:${actualPort}`);

        // 保存代理启动时间（如果是切换渠道，保留原有启动时间）
        saveProxyStartTime('opencode', preserveStartTime);

        resolve({ success: true, port: actualPort });
      });

      proxyServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.error(chalk.red(`\nOpenCode proxy port ${port} is already in use`));
        } else {
          console.error('Failed to start OpenCode proxy server:', err);
        }
        proxyServer = null;
        proxyApp = null;
        currentPort = null;
        reject(err);
      });
    });
  } catch (err) {
    console.error('Error starting OpenCode proxy server:', err);
    throw err;
  }
}

// 停止 OpenCode 代理服务器
async function stopOpenCodeProxyServer(options = {}) {
  // options.clearStartTime - 是否清除启动时间（默认 true）
  const clearStartTime = options.clearStartTime !== false;

  if (!proxyServer) {
    return { success: true, message: 'OpenCode proxy server not running' };
  }

  requestMetadata.clear();

  return new Promise((resolve) => {
    proxyServer.close(() => {
      console.log('OpenCode proxy server stopped');

      // 清除代理启动时间（仅当明确要求时）
      if (clearStartTime) {
        clearProxyStartTime('opencode');
      }

      proxyServer = null;
      proxyApp = null;
      const stoppedPort = currentPort;
      currentPort = null;
      resolve({ success: true, port: stoppedPort });
    });
  });
}

// 获取代理服务器状态
function getOpenCodeProxyStatus() {
  const config = loadConfig();
  const startTime = getProxyStartTime('opencode');
  const runtime = getProxyRuntime('opencode');

  return {
    running: !!proxyServer,
    port: currentPort,
    defaultPort: config.ports?.opencodeProxy || 20091,
    startTime,
    runtime
  };
}

/**
 * 清除指定渠道的模型重定向日志缓存
 * 用于在渠道配置更新后触发重新打印日志
 * @param {string} channelId - 渠道 ID
 */
function clearOpenCodeRedirectCache(channelId) {
  if (channelId) {
    printedRedirectCache.delete(channelId);
  } else {
    printedRedirectCache.clear();
  }
}

module.exports = {
  startOpenCodeProxyServer,
  stopOpenCodeProxyServer,
  getOpenCodeProxyStatus,
  clearOpenCodeRedirectCache
};
