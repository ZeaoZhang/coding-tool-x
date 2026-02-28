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
const { PATHS, ensureStorageDirMigrated } = require('../config/paths');
const { resolveModelPricing } = require('./utils/pricing');
const { getDefaultSpeedTestModelByToolType } = require('../config/model-metadata');
const { recordRequest: recordOpenCodeRequest } = require('./services/opencode-statistics-service');
const { saveProxyStartTime, clearProxyStartTime, getProxyStartTime, getProxyRuntime } = require('./services/proxy-runtime');
const { getEnabledChannels, getEffectiveApiKey } = require('./services/opencode-channels');
const { fetchModelsFromProvider, getCachedModelInfo } = require('./services/model-detector');

let proxyServer = null;
let proxyApp = null;
let currentPort = null;

// 用于存储每个请求的元数据
const requestMetadata = new Map();

// 用于缓存已打印过的模型重定向规则，避免重复打印
// 格式: { channelId: { "originalModel": "redirectedModel", ... } }
const printedRedirectCache = new Map();

// OpenAI 模型定价（每百万 tokens 的价格，单位：美元）
// 作为 model-metadata 未覆盖时的兜底值
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
const CLAUDE_CODE_BETA_HEADER = 'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14,prompt-caching-2024-07-31';
const CLAUDE_CODE_USER_AGENT = 'claude-cli/2.1.44 (external, sdk-cli)';
const CODEX_CLI_VERSION = '0.101.0';
const CODEX_CLI_USER_AGENT = 'codex_cli_rs/0.101.0 (Mac OS 26.0.1; arm64) Apple_Terminal/464';
const GEMINI_CLI_USER_AGENT = 'google-api-nodejs-client/9.15.1';
const GEMINI_CLI_API_CLIENT = 'gl-node/22.17.0';
const GEMINI_CLI_CLIENT_METADATA = 'ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI';
const CLAUDE_SESSION_USER_ID_TTL_MS = 60 * 60 * 1000;
const CLAUDE_SESSION_USER_ID_CACHE_MAX = 2000;
const claudeSessionUserIdCache = new Map();
const FILE_EXTENSION_MIME_TYPES = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

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
  let fallbackPricing = PRICING[model];
  if (!fallbackPricing) {
    const modelLower = String(model || '').toLowerCase();
    if (modelLower.includes('gpt-4o-mini')) {
      fallbackPricing = PRICING['gpt-4o-mini'];
    } else if (modelLower.includes('gpt-4o')) {
      fallbackPricing = PRICING['gpt-4o'];
    } else if (modelLower.includes('gpt-4')) {
      fallbackPricing = PRICING['gpt-4'];
    } else if (modelLower.includes('gpt-3.5')) {
      fallbackPricing = PRICING['gpt-3.5-turbo'];
    } else if (modelLower.includes('o1-mini')) {
      fallbackPricing = PRICING['o1-mini'];
    } else if (modelLower.includes('o1-pro')) {
      fallbackPricing = PRICING['o1-pro'];
    } else if (modelLower.includes('o1')) {
      fallbackPricing = PRICING['o1'];
    } else if (modelLower.includes('o3-mini')) {
      fallbackPricing = PRICING['o3-mini'];
    } else if (modelLower.includes('o3')) {
      fallbackPricing = PRICING['o3'];
    } else if (modelLower.includes('o4-mini')) {
      fallbackPricing = PRICING['o4-mini'];
    }
  }

  const pricing = resolveModelPricing('opencode', model, fallbackPricing, OPENCODE_BASE_PRICING);
  const inputRate = typeof pricing.input === 'number' ? pricing.input : OPENCODE_BASE_PRICING.input;
  const outputRate = typeof pricing.output === 'number' ? pricing.output : OPENCODE_BASE_PRICING.output;
  const cacheCreationRate = typeof pricing.cacheCreation === 'number' ? pricing.cacheCreation : inputRate * 1.25;
  const cacheReadRate = typeof pricing.cacheRead === 'number' ? pricing.cacheRead : inputRate * 0.1;

  const cacheCreationTokens = tokens.cacheCreation || 0;
  const cacheReadTokens = tokens.cacheRead || 0;
  const regularInputTokens = Math.max(0, (tokens.input || 0) - cacheCreationTokens - cacheReadTokens);

  return (
    regularInputTokens * inputRate / ONE_MILLION +
    cacheCreationTokens * cacheCreationRate / ONE_MILLION +
    cacheReadTokens * cacheReadRate / ONE_MILLION +
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

function normalizeSessionKeyValue(value) {
  const source = Array.isArray(value) ? value[0] : value;
  return typeof source === 'string' ? source.trim() : '';
}

function extractSessionIdFromBody(body = {}) {
  if (!body || typeof body !== 'object') return '';

  return normalizeSessionKeyValue(
    body.session_id ||
    body.sessionId ||
    body.conversation_id ||
    body.conversationId ||
    body.metadata?.session_id ||
    body.metadata?.sessionId ||
    body.metadata?.conversation_id ||
    body.metadata?.conversationId ||
    body.workspace?.workspace_id ||
    body.project_id ||
    body.projectId ||
    ''
  );
}

function extractSessionIdFromRequest(req, body = {}) {
  if (!req || typeof req !== 'object') {
    return extractSessionIdFromBody(body);
  }

  const headerSessionId = normalizeSessionKeyValue(
    req.headers?.['x-session-id'] ||
    req.headers?.['x-claude-session'] ||
    req.headers?.['x-cc-session'] ||
    req.headers?.['x-conversation-id'] ||
    req.headers?.['x-session']
  );

  return headerSessionId || extractSessionIdFromBody(body);
}

function cleanupExpiredClaudeSessionUserIds(now = Date.now()) {
  for (const [sessionKey, entry] of claudeSessionUserIdCache.entries()) {
    if (!entry || typeof entry !== 'object') {
      claudeSessionUserIdCache.delete(sessionKey);
      continue;
    }
    const lastUsedAt = Number(entry.lastUsedAt);
    if (!Number.isFinite(lastUsedAt) || now - lastUsedAt > CLAUDE_SESSION_USER_ID_TTL_MS) {
      claudeSessionUserIdCache.delete(sessionKey);
    }
  }
}

function trimClaudeSessionUserIdCache() {
  while (claudeSessionUserIdCache.size > CLAUDE_SESSION_USER_ID_CACHE_MAX) {
    const oldestKey = claudeSessionUserIdCache.keys().next().value;
    if (!oldestKey) break;
    claudeSessionUserIdCache.delete(oldestKey);
  }
}

function resolveClaudeUserIdBySession(sessionKey, preferredUserId = '') {
  const normalizedSessionKey = normalizeSessionKeyValue(sessionKey);
  const providedUserId = normalizeSessionKeyValue(preferredUserId);
  const now = Date.now();

  cleanupExpiredClaudeSessionUserIds(now);

  if (!normalizedSessionKey) {
    return providedUserId || buildClaudeCodeUserId();
  }

  const cached = claudeSessionUserIdCache.get(normalizedSessionKey);
  if (cached && typeof cached.userId === 'string' && cached.userId.trim()) {
    const userId = cached.userId.trim();
    claudeSessionUserIdCache.delete(normalizedSessionKey);
    claudeSessionUserIdCache.set(normalizedSessionKey, {
      userId,
      lastUsedAt: now
    });
    return userId;
  }

  const generatedUserId = providedUserId || buildClaudeCodeUserId();
  claudeSessionUserIdCache.set(normalizedSessionKey, {
    userId: generatedUserId,
    lastUsedAt: now
  });
  trimClaudeSessionUserIdCache();
  return generatedUserId;
}

function normalizeGatewaySourceType(channel) {
  const value = String(channel?.gatewaySourceType || '').trim().toLowerCase();
  if (value === 'claude') return 'claude';
  if (value === 'gemini') return 'gemini';
  return 'codex';
}

function isConverterEntryChannel(channel) {
  const presetId = String(channel?.presetId || '').trim().toLowerCase();
  return presetId === 'entry_claude' || presetId === 'entry_codex' || presetId === 'entry_gemini';
}

function getDefaultModelsByGatewaySourceType(gatewaySourceType) {
  if (gatewaySourceType === 'claude') return [getDefaultSpeedTestModelByToolType('claude')];
  if (gatewaySourceType === 'gemini') return [getDefaultSpeedTestModelByToolType('gemini')];
  return [getDefaultSpeedTestModelByToolType('codex')];
}

function mapStainlessOs() {
  switch (process.platform) {
    case 'darwin':
      return 'MacOS';
    case 'win32':
      return 'Windows';
    case 'linux':
      return 'Linux';
    default:
      return `other::${process.platform}`;
  }
}

function mapStainlessArch() {
  switch (process.arch) {
    case 'x64':
      return 'x64';
    case 'arm64':
      return 'arm64';
    case 'ia32':
      return 'x86';
    default:
      return `other::${process.arch}`;
  }
}

function getRequestPathname(urlPath = '') {
  try {
    const parsed = new URL(urlPath, 'http://localhost');
    return parsed.pathname || '/';
  } catch {
    return String(urlPath || '').split('?')[0] || '/';
  }
}

function normalizeGatewayPath(pathname = '') {
  const normalized = String(pathname || '').trim();
  if (!normalized) return '/';
  return normalized.replace(/\/+$/, '') || '/';
}

function isResponsesPath(pathname) {
  const normalized = normalizeGatewayPath(pathname);
  return normalized.endsWith('/v1/responses') || normalized.endsWith('/responses');
}

function isChatCompletionsPath(pathname) {
  const normalized = normalizeGatewayPath(pathname);
  return normalized.endsWith('/v1/chat/completions') || normalized.endsWith('/chat/completions');
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

function parseBase64DataUrl(dataUrl = '') {
  const value = typeof dataUrl === 'string' ? dataUrl.trim() : '';
  if (!value) return null;
  const matched = value.match(/^data:([^;,]+)?;base64,(.+)$/i);
  if (!matched) return null;
  return {
    mediaType: String(matched[1] || '').trim(),
    data: String(matched[2] || '')
  };
}

function inferMimeTypeFromFilename(filename = '', fallback = 'application/octet-stream') {
  const ext = path.extname(String(filename || '').trim()).toLowerCase();
  if (!ext) return fallback;
  return FILE_EXTENSION_MIME_TYPES[ext] || fallback;
}

function normalizeOpenAiImageBlock(value) {
  let imageUrl = '';
  if (typeof value === 'string') {
    imageUrl = value;
  } else if (value && typeof value === 'object') {
    if (typeof value.url === 'string') {
      imageUrl = value.url;
    } else if (typeof value.image_url === 'string') {
      imageUrl = value.image_url;
    } else if (value.image_url && typeof value.image_url === 'object' && typeof value.image_url.url === 'string') {
      imageUrl = value.image_url.url;
    }
  }

  const normalizedUrl = String(imageUrl || '').trim();
  if (!normalizedUrl) return null;

  const parsedDataUrl = parseBase64DataUrl(normalizedUrl);
  if (parsedDataUrl && parsedDataUrl.data) {
    const mediaType = parsedDataUrl.mediaType && parsedDataUrl.mediaType.startsWith('image/')
      ? parsedDataUrl.mediaType
      : 'image/png';
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: parsedDataUrl.data
      }
    };
  }

  return {
    type: 'image',
    source: {
      type: 'url',
      url: normalizedUrl
    }
  };
}

function normalizeOpenAiFileBlock(value) {
  if (!value || typeof value !== 'object') return null;
  const filePayload = (value.file && typeof value.file === 'object' && !Array.isArray(value.file))
    ? value.file
    : value;
  const filename = typeof filePayload.filename === 'string' ? filePayload.filename.trim() : '';
  const rawMediaType = typeof filePayload.mime_type === 'string'
    ? filePayload.mime_type.trim()
    : (typeof filePayload.media_type === 'string' ? filePayload.media_type.trim() : '');
  const mediaType = rawMediaType || inferMimeTypeFromFilename(filename);
  const fileData = typeof filePayload.file_data === 'string' ? filePayload.file_data.trim() : '';
  const fileUrl = typeof filePayload.file_url === 'string'
    ? filePayload.file_url.trim()
    : (typeof filePayload.url === 'string' ? filePayload.url.trim() : '');
  const fileId = typeof filePayload.file_id === 'string' ? filePayload.file_id.trim() : '';

  if (fileData) {
    const parsedDataUrl = parseBase64DataUrl(fileData);
    if (parsedDataUrl && parsedDataUrl.data) {
      return {
        type: 'document',
        source: {
          type: 'base64',
          media_type: parsedDataUrl.mediaType || mediaType,
          data: parsedDataUrl.data
        }
      };
    }

    return {
      type: 'document',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: fileData
      }
    };
  }

  if (fileUrl) {
    return {
      type: 'document',
      source: {
        type: 'url',
        url: fileUrl
      }
    };
  }

  if (fileId) {
    return {
      type: 'text',
      text: `[input_file:${fileId}]`
    };
  }

  return null;
}

function normalizeOpenAiContentItemToClaudeBlocks(item) {
  if (item === null || item === undefined) return [];

  if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
    const text = String(item);
    return text.trim() ? [{ type: 'text', text }] : [];
  }

  if (Array.isArray(item)) {
    return item.flatMap(normalizeOpenAiContentItemToClaudeBlocks);
  }

  if (typeof item !== 'object') return [];

  const itemType = String(item.type || '').trim().toLowerCase();
  if (itemType === 'tool_use' || itemType === 'tool_result') {
    return [item];
  }

  if (itemType === 'image' && item.source && typeof item.source === 'object') {
    return [item];
  }
  if (itemType === 'document' && item.source && typeof item.source === 'object') {
    return [item];
  }

  if (itemType === 'text' || itemType === 'input_text' || itemType === 'output_text') {
    const text = typeof item.text === 'string' ? item.text : '';
    if (!text.trim()) return [];
    const block = { type: 'text', text };
    if (item.cache_control && typeof item.cache_control === 'object') {
      block.cache_control = item.cache_control;
    }
    return [block];
  }

  if (itemType === 'image_url' || itemType === 'input_image') {
    const imageBlock = normalizeOpenAiImageBlock(item);
    return imageBlock ? [imageBlock] : [];
  }

  if (itemType === 'file' || itemType === 'input_file') {
    const fileBlock = normalizeOpenAiFileBlock(item);
    return fileBlock ? [fileBlock] : [];
  }

  if (item.image_url !== undefined || item.url !== undefined) {
    const imageBlock = normalizeOpenAiImageBlock(item);
    if (imageBlock) return [imageBlock];
  }

  if (item.file !== undefined || item.file_data !== undefined || item.file_url !== undefined || item.file_id !== undefined) {
    const fileBlock = normalizeOpenAiFileBlock(item);
    if (fileBlock) return [fileBlock];
  }

  const fallbackText = extractText(item);
  return fallbackText ? [{ type: 'text', text: fallbackText }] : [];
}

function normalizeOpenAiContentToClaudeBlocks(content) {
  return normalizeOpenAiContentItemToClaudeBlocks(content);
}

function normalizeOpenAiRole(role) {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'assistant' || value === 'model') return 'assistant';
  if (value === 'system' || value === 'developer') return 'system';
  if (value === 'tool') return 'tool';
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

function normalizeReasoningEffortToClaude(reasoningEffort) {
  const effort = String(reasoningEffort || '').trim().toLowerCase();
  if (!effort) return undefined;
  if (effort === 'none') return { type: 'disabled' };
  if (effort === 'auto') return { type: 'enabled' };
  if (effort === 'low') return { type: 'enabled', budget_tokens: 2048 };
  if (effort === 'medium') return { type: 'enabled', budget_tokens: 8192 };
  if (effort === 'high') return { type: 'enabled', budget_tokens: 24576 };
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
  const systemBlocks = [];
  const messages = [];

  if (isResponsesPath(pathname) && typeof payload.instructions === 'string' && payload.instructions.trim()) {
    systemBlocks.push({ type: 'text', text: payload.instructions.trim() });
  }

  const appendMessage = (role, content, topLevelCacheControl) => {
    const normalizedRole = normalizeOpenAiRole(role);
    const contentBlocks = normalizeOpenAiContentToClaudeBlocks(content);
    if (normalizedRole === 'system') {
      const blocks = contentBlocks
        .filter(block => block && block.type === 'text' && typeof block.text === 'string' && block.text.trim());
      blocks.forEach((block, idx) => {
        const systemBlock = { type: 'text', text: block.text };
        if (block.cache_control && typeof block.cache_control === 'object') {
          systemBlock.cache_control = block.cache_control;
        } else if (topLevelCacheControl && typeof topLevelCacheControl === 'object' && idx === blocks.length - 1) {
          // 消息顶层的 cache_control（OpenCode/Vercel AI SDK 注入方式）打在最后一个 block 上
          systemBlock.cache_control = topLevelCacheControl;
        }
        systemBlocks.push(systemBlock);
      });
      return;
    }

    if (!Array.isArray(contentBlocks) || contentBlocks.length === 0) return;
    // 将消息顶层的 cache_control 传递到最后一个 content block 上
    if (topLevelCacheControl && typeof topLevelCacheControl === 'object' && contentBlocks.length > 0) {
      const lastBlock = contentBlocks[contentBlocks.length - 1];
      if (!lastBlock.cache_control) lastBlock.cache_control = topLevelCacheControl;
    }
    messages.push({
      role: normalizedRole === 'assistant' ? 'assistant' : 'user',
      content: contentBlocks
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
          appendMessage(item.role, item.content, item.cache_control);
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
        const assistantContent = normalizeOpenAiContentToClaudeBlocks(message.content);

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
      appendMessage(message.role, message.content, message.cache_control);
    });
  }

  if (messages.length === 0) {
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: 'Hello' }]
    });
  }

  return {
    systemBlocks,
    messages
  };
}

function buildClaudeCodeUserId() {
  const sessionId = Math.random().toString(36).substring(2, 15);
  return `user_0000000000000000000000000000000000000000000000000000000000000000_account__session_${sessionId}`;
}

function normalizeClaudeMetadata(metadata, fallbackUserId = '') {
  const normalized = (metadata && typeof metadata === 'object' && !Array.isArray(metadata))
    ? { ...metadata }
    : {};
  const userId = typeof normalized.user_id === 'string' ? normalized.user_id.trim() : '';
  normalized.user_id = userId || normalizeSessionKeyValue(fallbackUserId) || buildClaudeCodeUserId();
  return normalized;
}

function applyPromptCachingToClaudePayload(converted) {
  const EPHEMERAL = { type: 'ephemeral' };

  // 统计 messages 中上游（OpenCode）已注入的缓存断点数量
  // OpenCode 策略：对最后2条非system消息打断点，我们不重复注入
  let messageBreakpoints = 0;
  if (Array.isArray(converted.messages)) {
    converted.messages.forEach(msg => {
      if (Array.isArray(msg.content)) {
        msg.content.forEach(block => {
          if (block.cache_control) messageBreakpoints++;
          if (block.type === 'tool_result' && Array.isArray(block.content)) {
            block.content.forEach(inner => {
              if (inner.cache_control) messageBreakpoints++;
            });
          }
        });
      }
    });
  }

  // 统计 system 中已有的断点
  let systemBreakpoints = 0;
  if (Array.isArray(converted.system)) {
    converted.system.forEach(block => {
      if (block.cache_control) systemBreakpoints++;
    });
  }

  // 若 messages 已有断点，说明上游（OpenCode）已处理，不再注入 messages 断点
  // 只在 system blocks 没有断点时补充（OpenCode 不操作 system，由我们负责）
  if (systemBreakpoints === 0 && Array.isArray(converted.system) && converted.system.length > 0) {
    const last = converted.system[converted.system.length - 1];
    if (!last.cache_control) last.cache_control = EPHEMERAL;
  }

  // 若上游完全没有注入任何断点（非 OpenCode 客户端），按原策略补充 messages 断点
  if (messageBreakpoints === 0 && systemBreakpoints === 0) {
    // 对最后2条消息打断点，与 OpenCode 策略对齐
    if (Array.isArray(converted.messages) && converted.messages.length > 0) {
      for (const msg of converted.messages.slice(-2)) {
        if (Array.isArray(msg.content) && msg.content.length > 0) {
          const last = msg.content[msg.content.length - 1];
          if (!last.cache_control) last.cache_control = EPHEMERAL;
        }
      }
    }
  }
}

function convertOpenCodePayloadToClaude(pathname, payload = {}, fallbackModel = '', options = {}) {
  const normalized = normalizeOpenCodeMessages(pathname, payload);
  const maxTokens = Number(payload.max_output_tokens ?? payload.max_tokens);
  const stopSequences = normalizeStopSequences(payload.stop);
  const thinking = normalizeReasoningEffortToClaude(payload.reasoning_effort);

  const converted = {
    model: payload.model || fallbackModel || 'claude-sonnet-4-20250514',
    max_tokens: Number.isFinite(maxTokens) && maxTokens > 0 ? Math.round(maxTokens) : 4096,
    stream: false,
    messages: normalized.messages
  };

  if (normalized.systemBlocks && normalized.systemBlocks.length > 0) {
    // 部分 relay 仅接受 Claude system 的 block 数组格式，不接受纯字符串
    // 保留原始 cache_control 字段，确保 prompt cache 正常命中
    converted.system = normalized.systemBlocks;
  }

  const tools = normalizeOpenAiToolsToClaude(payload.tools || []);
  if (tools.length > 0) {
    converted.tools = tools;
  }

  const toolChoice = normalizeToolChoiceToClaude(payload.tool_choice);
  if (toolChoice) {
    converted.tool_choice = toolChoice;
  }
  if (stopSequences) {
    converted.stop_sequences = stopSequences;
  }
  if (thinking) {
    converted.thinking = thinking;
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

  // 某些 Claude relay 会校验 metadata.user_id 以识别 Claude Code 请求
  converted.metadata = normalizeClaudeMetadata(payload.metadata, options.sessionUserId);

  // 注入 prompt cache 断点，对齐 Anthropic AI SDK 的自动缓存行为
  applyPromptCachingToClaudePayload(converted);

  return converted;
}

function normalizeOpenAiToolsToGemini(tools = []) {
  if (!Array.isArray(tools)) return [];

  const functionDeclarations = [];
  const builtInTools = [];
  const appendBuiltInTool = (toolNode) => {
    if (!toolNode || typeof toolNode !== 'object') return;
    builtInTools.push(toolNode);
  };

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
      continue;
    }

    const normalizedType = String(tool.type || '').trim().toLowerCase();

    if (tool.google_search && typeof tool.google_search === 'object') {
      appendBuiltInTool({ googleSearch: tool.google_search });
      continue;
    }
    if (tool.code_execution && typeof tool.code_execution === 'object') {
      appendBuiltInTool({ codeExecution: tool.code_execution });
      continue;
    }
    if (tool.url_context && typeof tool.url_context === 'object') {
      appendBuiltInTool({ urlContext: tool.url_context });
      continue;
    }

    if (normalizedType === 'google_search' || normalizedType === 'web_search' || normalizedType === 'web_search_preview') {
      const searchConfig = (tool.web_search && typeof tool.web_search === 'object')
        ? tool.web_search
        : ((tool.googleSearch && typeof tool.googleSearch === 'object') ? tool.googleSearch : {});
      appendBuiltInTool({ googleSearch: searchConfig });
      continue;
    }

    if (normalizedType === 'code_execution' || normalizedType === 'code_interpreter') {
      const executionConfig = (tool.codeExecution && typeof tool.codeExecution === 'object')
        ? tool.codeExecution
        : {};
      appendBuiltInTool({ codeExecution: executionConfig });
      continue;
    }

    if (normalizedType === 'url_context') {
      const urlContextConfig = (tool.urlContext && typeof tool.urlContext === 'object')
        ? tool.urlContext
        : {};
      appendBuiltInTool({ urlContext: urlContextConfig });
    }
  }

  const normalizedTools = [];
  if (functionDeclarations.length > 0) {
    normalizedTools.push({ functionDeclarations });
  }
  if (builtInTools.length > 0) {
    normalizedTools.push(...builtInTools);
  }
  return normalizedTools;
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

function normalizeReasoningEffortToGemini(reasoningEffort) {
  const effort = String(reasoningEffort || '').trim().toLowerCase();
  if (!effort) return undefined;
  if (effort === 'none') {
    return {
      includeThoughts: false,
      thinkingBudget: 0
    };
  }
  if (effort === 'auto') {
    return {
      includeThoughts: true,
      thinkingBudget: -1
    };
  }
  if (effort === 'low' || effort === 'medium' || effort === 'high') {
    return {
      includeThoughts: true,
      thinkingLevel: effort
    };
  }
  return undefined;
}

function normalizeGeminiResponseModalities(modalities) {
  if (!Array.isArray(modalities)) return undefined;
  const mapped = modalities
    .map(item => String(item || '').trim().toLowerCase())
    .filter(Boolean)
    .map(item => {
      if (item === 'text') return 'TEXT';
      if (item === 'image') return 'IMAGE';
      return '';
    })
    .filter(Boolean);
  return mapped.length > 0 ? mapped : undefined;
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

function normalizeGeminiFunctionResponsePayload(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return { content: '' };
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return { content: value };
    }
    return { content: value };
  }
  return { content: normalizeToolResultContent(value) };
}

function normalizeGeminiMediaType(value, fallback = 'application/octet-stream') {
  const mediaType = typeof value === 'string' ? value.trim() : '';
  return mediaType || fallback;
}

function buildGeminiPartFromClaudeMediaBlock(block) {
  if (!block || typeof block !== 'object') return null;
  const source = (block.source && typeof block.source === 'object') ? block.source : null;
  if (!source) return null;

  const blockType = String(block.type || '').trim().toLowerCase();
  const defaultMimeType = blockType === 'image' ? 'image/png' : 'application/octet-stream';
  const sourceType = String(source.type || '').trim().toLowerCase();
  const mediaType = normalizeGeminiMediaType(source.media_type || source.mime_type, defaultMimeType);

  if (sourceType === 'base64' && typeof source.data === 'string' && source.data.trim()) {
    return {
      inlineData: {
        mimeType: mediaType,
        data: source.data
      }
    };
  }

  if (sourceType === 'url' && typeof source.url === 'string' && source.url.trim()) {
    return {
      fileData: {
        mimeType: mediaType,
        fileUri: source.url.trim()
      }
    };
  }

  return null;
}

function buildGeminiContents(messages = []) {
  const contents = [];
  const toolNameById = new Map();

  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const role = message.role === 'assistant' ? 'model' : 'user';
    const contentBlocks = Array.isArray(message.content) ? message.content : [message.content];
    const parts = [];

    for (const block of contentBlocks) {
      if (!block || typeof block !== 'object') {
        const text = extractText(block);
        if (text) {
          parts.push({ text });
        }
        continue;
      }

      if (block.type === 'tool_use' && block.name) {
        const callId = String(block.id || generateToolCallId());
        const args = (block.input && typeof block.input === 'object' && !Array.isArray(block.input))
          ? block.input
          : {};
        toolNameById.set(callId, block.name);
        parts.push({
          functionCall: {
            name: block.name,
            args
          }
        });
        continue;
      }

      if (block.type === 'tool_result') {
        const toolUseId = String(block.tool_use_id || block.id || '');
        const toolName = block.name || toolNameById.get(toolUseId);
        if (!toolName) {
          const text = normalizeToolResultContent(block.content);
          if (text) {
            parts.push({ text });
          }
          continue;
        }

        parts.push({
          functionResponse: {
            name: toolName,
            response: normalizeGeminiFunctionResponsePayload(block.content)
          }
        });
        continue;
      }

      if (block.type === 'image' || block.type === 'document') {
        const mediaPart = buildGeminiPartFromClaudeMediaBlock(block);
        if (mediaPart) {
          parts.push(mediaPart);
          continue;
        }
      }

      const text = extractText(block);
      if (text) {
        parts.push({ text });
      }
    }

    if (parts.length === 0) continue;
    contents.push({ role, parts });
  }
  return contents;
}

function cloneJsonCompatible(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function normalizeCodexResponsesInput(inputValue) {
  if (typeof inputValue === 'string') {
    return [
      {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: inputValue
          }
        ]
      }
    ];
  }

  if (!Array.isArray(inputValue)) return undefined;
  return inputValue.map(item => {
    if (!item || typeof item !== 'object') return item;
    const clonedItem = cloneJsonCompatible(item);
    if (String(clonedItem?.role || '').trim().toLowerCase() === 'system') {
      clonedItem.role = 'developer';
    }
    return clonedItem;
  });
}

function convertOpenCodePayloadToCodexResponses(payload = {}, fallbackModel = '') {
  const requestBody = cloneJsonCompatible((payload && typeof payload === 'object') ? payload : {});
  if (requestBody.model === undefined && fallbackModel) {
    requestBody.model = fallbackModel;
  }

  const normalizedInput = normalizeCodexResponsesInput(requestBody.input);
  if (normalizedInput !== undefined) {
    requestBody.input = normalizedInput;
  }

  requestBody.stream = true;
  requestBody.store = false;
  if (requestBody.parallel_tool_calls === undefined) {
    requestBody.parallel_tool_calls = true;
  }
  if (typeof requestBody.instructions !== 'string') {
    requestBody.instructions = '';
  }

  const include = Array.isArray(requestBody.include)
    ? requestBody.include.filter(item => typeof item === 'string' && item.trim())
    : [];
  if (!include.includes('reasoning.encrypted_content')) {
    include.push('reasoning.encrypted_content');
  }
  requestBody.include = include;

  delete requestBody.max_output_tokens;
  delete requestBody.max_completion_tokens;
  delete requestBody.temperature;
  delete requestBody.top_p;
  delete requestBody.service_tier;
  delete requestBody.user;
  delete requestBody.previous_response_id;
  delete requestBody.prompt_cache_retention;
  delete requestBody.safety_identifier;

  return {
    requestBody,
    model: requestBody.model || fallbackModel || ''
  };
}

function convertOpenCodePayloadToGemini(pathname, payload = {}, fallbackModel = '') {
  const normalized = normalizeOpenCodeMessages(pathname, payload);
  const maxTokens = Number(payload.max_output_tokens ?? payload.max_tokens);
  const stopSequences = normalizeStopSequences(payload.stop);
  const tools = normalizeOpenAiToolsToGemini(payload.tools || []);
  const toolConfig = normalizeToolChoiceToGemini(payload.tool_choice);
  const thinkingConfig = normalizeReasoningEffortToGemini(payload.reasoning_effort);
  const candidateCount = Number(payload.n);
  const responseModalities = normalizeGeminiResponseModalities(payload.modalities);
  const imageConfig = (payload.image_config && typeof payload.image_config === 'object' && !Array.isArray(payload.image_config))
    ? payload.image_config
    : null;

  const requestBody = {
    contents: buildGeminiContents(normalized.messages)
  };

  if (normalized.systemBlocks && normalized.systemBlocks.length > 0) {
    requestBody.systemInstruction = {
      parts: normalized.systemBlocks.map(block => ({ text: block.text || '' })).filter(p => p.text)
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
  if (thinkingConfig) {
    generationConfig.thinkingConfig = thinkingConfig;
  }
  if (Number.isFinite(candidateCount) && candidateCount > 1) {
    generationConfig.candidateCount = Math.round(candidateCount);
  }
  if (responseModalities) {
    generationConfig.responseModalities = responseModalities;
  }
  if (imageConfig) {
    const mappedImageConfig = {};
    if (typeof imageConfig.aspect_ratio === 'string' && imageConfig.aspect_ratio.trim()) {
      mappedImageConfig.aspectRatio = imageConfig.aspect_ratio.trim();
    }
    if (typeof imageConfig.image_size === 'string' && imageConfig.image_size.trim()) {
      mappedImageConfig.imageSize = imageConfig.image_size.trim();
    }
    if (Object.keys(mappedImageConfig).length > 0) {
      generationConfig.imageConfig = mappedImageConfig;
    }
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
  let targetUrl;
  try {
    targetUrl = new URL(String(baseUrl || '').trim() || 'https://api.anthropic.com');
  } catch {
    targetUrl = new URL('https://api.anthropic.com');
  }

  let pathname = targetUrl.pathname.replace(/\/+$/, '');
  if (!pathname || pathname === '/') {
    pathname = '/v1/messages';
  } else if (pathname.endsWith('/messages')) {
    // noop
  } else if (pathname.endsWith('/v1')) {
    pathname = `${pathname}/messages`;
  } else {
    pathname = `${pathname}/v1/messages`;
  }

  targetUrl.pathname = pathname;
  targetUrl.searchParams.set('beta', 'true');
  return targetUrl.toString();
}

function shouldUseGeminiCliFormat(baseUrl = '') {
  let parsedUrl;
  try {
    parsedUrl = new URL(String(baseUrl || '').trim() || 'https://generativelanguage.googleapis.com');
  } catch {
    return false;
  }

  const host = String(parsedUrl.hostname || '').toLowerCase();
  const pathname = parsedUrl.pathname.replace(/\/+$/, '');

  if (pathname.includes('/v1internal') || pathname.endsWith(':generateContent') || pathname.endsWith(':streamGenerateContent')) {
    return true;
  }
  if (pathname.includes('/v1beta') || pathname.includes('/models/')) {
    return false;
  }
  if (host.includes('cloudcode-pa.googleapis.com')) {
    return true;
  }
  if (!pathname || pathname === '/') {
    return !host.includes('generativelanguage.googleapis.com') && !host.includes('aiplatform.googleapis.com');
  }
  return false;
}

function buildGeminiCliTargetPath(parsedUrl, stream = false) {
  let pathname = parsedUrl.pathname.replace(/\/+$/, '');
  const method = stream ? 'streamGenerateContent' : 'generateContent';

  if (!pathname || pathname === '/') {
    return `/v1internal:${method}`;
  }
  if (pathname.endsWith(':streamGenerateContent')) {
    return stream
      ? pathname
      : pathname.replace(/:streamGenerateContent$/, ':generateContent');
  }
  if (pathname.endsWith(':generateContent')) {
    return stream
      ? pathname.replace(/:generateContent$/, ':streamGenerateContent')
      : pathname;
  }
  if (pathname.endsWith('/v1internal')) {
    return `${pathname}:${method}`;
  }
  return `${pathname}/v1internal:${method}`;
}

function buildGeminiCliTargetUrl(baseUrl = '', options = {}) {
  const stream = !!options.stream;

  let targetUrl;
  try {
    targetUrl = new URL(String(baseUrl || '').trim() || 'https://cloudcode-pa.googleapis.com');
  } catch {
    targetUrl = new URL('https://cloudcode-pa.googleapis.com');
  }

  targetUrl.pathname = buildGeminiCliTargetPath(targetUrl, stream);
  if (stream) {
    targetUrl.searchParams.set('alt', 'sse');
  }
  return targetUrl.toString();
}

function buildGeminiNativeTargetUrl(baseUrl = '', model = '', apiKey = '', options = {}) {
  const modelName = String(model || '').trim();
  if (!modelName) return '';
  const stream = !!options.stream;

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

  const method = stream ? 'streamGenerateContent' : 'generateContent';
  targetUrl.pathname = `${apiBasePath}/models/${encodeURIComponent(modelName)}:${method}`;
  if (apiKey) {
    targetUrl.searchParams.set('key', apiKey);
  }
  if (stream) {
    targetUrl.searchParams.set('alt', 'sse');
  }

  return targetUrl.toString();
}

function buildGeminiTargetUrl(baseUrl = '', model = '', apiKey = '', options = {}) {
  if (options.useCli) {
    return buildGeminiCliTargetUrl(baseUrl, options);
  }
  return buildGeminiNativeTargetUrl(baseUrl, model, apiKey, options);
}

function buildCodexTargetUrl(baseUrl = '') {
  let targetUrl;
  try {
    targetUrl = new URL(String(baseUrl || '').trim());
  } catch {
    return '';
  }

  let pathname = targetUrl.pathname.replace(/\/+$/, '');
  if (!pathname || pathname === '/') {
    pathname = '/responses';
  } else if (pathname.endsWith('/responses') || pathname.endsWith('/v1/responses')) {
    // noop
  } else if (pathname.endsWith('/v1')) {
    pathname = `${pathname}/responses`;
  } else {
    pathname = `${pathname}/responses`;
  }

  targetUrl.pathname = pathname;
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

function postJsonStream(url, headers, payload, timeoutMs = 120000) {
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
      resolve({
        statusCode: response.statusCode || 500,
        headers: response.headers || {},
        response
      });
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
  const reasoningItems = [];
  const nestedResponse = claudeResponse?.response && typeof claudeResponse.response === 'object'
    ? claudeResponse.response
    : null;
  const contentBlocks = Array.isArray(claudeResponse.content)
    ? claudeResponse.content
    : (Array.isArray(nestedResponse?.content) ? nestedResponse.content : null);

  if (!Array.isArray(contentBlocks)) {
    const messageContent = claudeResponse?.choices?.[0]?.message?.content;
    if (typeof messageContent === 'string' && messageContent.trim()) {
      return { text: messageContent.trim(), functionCalls: [], reasoningItems: [] };
    }
    return { text: '', functionCalls: [], reasoningItems: [] };
  }

  contentBlocks.forEach(block => {
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

    if (block.type === 'thinking') {
      const thinkingText = String(block.thinking || block.text || '').trim();
      if (thinkingText) {
        reasoningItems.push({
          id: `rs_${Date.now()}_${reasoningItems.length}`,
          text: thinkingText
        });
      }
    }
  });

  return {
    text: textFragments.join('\n').trim(),
    functionCalls,
    reasoningItems
  };
}

function toNumberOrZero(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function pickFirstFiniteNumber(values = []) {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function extractClaudeLikeUsage(claudeResponse = {}) {
  const nestedResponse = claudeResponse?.response && typeof claudeResponse.response === 'object'
    ? claudeResponse.response
    : {};
  const messageObject = claudeResponse?.message && typeof claudeResponse.message === 'object'
    ? claudeResponse.message
    : {};

  const usageCandidates = [
    claudeResponse?.usage,
    nestedResponse?.usage,
    messageObject?.usage
  ].filter(item => item && typeof item === 'object');

  const metadataCandidates = [
    claudeResponse?.providerMetadata,
    nestedResponse?.providerMetadata,
    claudeResponse?.metadata,
    nestedResponse?.metadata
  ].filter(item => item && typeof item === 'object');

  const inputTokens = pickFirstFiniteNumber(
    usageCandidates.flatMap(usage => [
      usage.input_tokens,
      usage.prompt_tokens,
      usage.inputTokens,
      usage.promptTokens
    ])
  );

  const outputTokens = pickFirstFiniteNumber(
    usageCandidates.flatMap(usage => [
      usage.output_tokens,
      usage.completion_tokens,
      usage.outputTokens,
      usage.completionTokens
    ])
  );

  const totalTokens = pickFirstFiniteNumber(
    usageCandidates.flatMap(usage => [
      usage.total_tokens,
      usage.totalTokens
    ])
  );

  const cacheReadTokens = pickFirstFiniteNumber(
    usageCandidates.flatMap(usage => [
      usage.cache_read_input_tokens,
      usage.cacheReadInputTokens,
      usage.input_tokens_details?.cached_tokens,
      usage.prompt_tokens_details?.cached_tokens
    ])
  );

  const cacheCreationFromUsage = pickFirstFiniteNumber(
    usageCandidates.flatMap(usage => [
      usage.cache_creation_input_tokens,
      usage.cacheCreationInputTokens
    ])
  );
  const cacheCreationFromMetadata = pickFirstFiniteNumber(
    metadataCandidates.flatMap(metadata => [
      metadata?.anthropic?.cacheCreationInputTokens,
      metadata?.venice?.usage?.cacheCreationInputTokens,
      metadata?.bedrock?.usage?.cacheWriteInputTokens
    ])
  );

  const reasoningTokens = pickFirstFiniteNumber(
    usageCandidates.flatMap(usage => [
      usage.output_tokens_details?.reasoning_tokens,
      usage.completion_tokens_details?.reasoning_tokens,
      usage.reasoning_tokens,
      usage.reasoningTokens
    ])
  );

  return {
    inputTokens: toNumberOrZero(inputTokens),
    outputTokens: toNumberOrZero(outputTokens),
    totalTokens: toNumberOrZero(totalTokens),
    cacheReadTokens: toNumberOrZero(cacheReadTokens),
    cacheCreationTokens: toNumberOrZero(
      cacheCreationFromMetadata !== null ? cacheCreationFromMetadata : cacheCreationFromUsage
    ),
    reasoningTokens: toNumberOrZero(reasoningTokens)
  };
}

function extractClaudeResponseText(claudeResponse = {}) {
  return extractClaudeResponseContent(claudeResponse).text;
}

function buildGeminiFunctionCallRecord(functionCall = {}, callIndex = 0) {
  if (!functionCall || typeof functionCall !== 'object' || !functionCall.name) return null;
  const callId = String(functionCall.id || functionCall.callId || `call_${callIndex + 1}`);
  const argsObject = (functionCall.args && typeof functionCall.args === 'object' && !Array.isArray(functionCall.args))
    ? functionCall.args
    : {};

  return {
    id: `fc_${callId}`,
    call_id: callId,
    name: functionCall.name,
    arguments: JSON.stringify(argsObject)
  };
}

function extractGeminiResponseContent(geminiResponse = {}) {
  const fragments = [];
  const functionCalls = [];
  const reasoningItems = [];
  let functionIndex = 0;
  let reasoningIndex = 0;

  if (!Array.isArray(geminiResponse.candidates)) {
    return { text: '', functionCalls: [], reasoningItems: [] };
  }

  for (const candidate of geminiResponse.candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const parts = candidate.content?.parts;
    if (!Array.isArray(parts)) continue;

    for (const part of parts) {
      if (!part || typeof part !== 'object') continue;
      if (part.functionCall && typeof part.functionCall === 'object') {
        const functionCall = buildGeminiFunctionCallRecord(part.functionCall, functionIndex);
        if (functionCall) {
          functionCalls.push(functionCall);
          functionIndex += 1;
        }
        continue;
      }

      if (typeof part.text === 'string' && part.text.trim() && part.thought === true) {
        reasoningItems.push({
          id: `rs_${Date.now()}_${reasoningIndex}`,
          text: part.text
        });
        reasoningIndex += 1;
        continue;
      }

      if (typeof part.text === 'string' && part.text.trim()) {
        fragments.push(part.text);
      }
    }
  }

  return {
    text: fragments.join('\n').trim(),
    functionCalls,
    reasoningItems
  };
}

function extractGeminiUsage(geminiResponse = {}) {
  const usageMetadata = (geminiResponse.usageMetadata && typeof geminiResponse.usageMetadata === 'object')
    ? geminiResponse.usageMetadata
    : {};
  const inputTokens = Number(usageMetadata.promptTokenCount || 0);
  const outputTokens = Number(usageMetadata.candidatesTokenCount || 0);
  const totalTokens = Number(usageMetadata.totalTokenCount || (inputTokens + outputTokens));
  const cachedTokens = Number(usageMetadata.cachedContentTokenCount || 0);
  const reasoningTokens = Number(usageMetadata.thoughtsTokenCount || 0);

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedTokens,
    reasoningTokens
  };
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
  const usage = extractClaudeLikeUsage(claudeResponse);
  const inputTokens = usage.inputTokens;
  const outputTokens = usage.outputTokens;
  const totalTokens = usage.totalTokens > 0 ? usage.totalTokens : (inputTokens + outputTokens);
  const cacheCreationTokens = usage.cacheCreationTokens;
  const cacheReadTokens = usage.cacheReadTokens;
  const parsedContent = extractClaudeResponseContent(claudeResponse);
  const text = parsedContent.text;
  const estimatedReasoningTokens = parsedContent.reasoningItems.reduce((acc, item) => acc + Math.floor((item.text || '').length / 4), 0);
  const reasoningTokens = usage.reasoningTokens > 0 ? usage.reasoningTokens : estimatedReasoningTokens;
  const model = claudeResponse.model || claudeResponse?.response?.model || fallbackModel || '';
  const responseId = `resp_${String(claudeResponse.id || Date.now()).replace(/[^a-zA-Z0-9_]/g, '')}`;
  const messageId = claudeResponse.id || `msg_${Date.now()}`;
  const createdAt = Math.floor(Date.now() / 1000);
  const output = [];

  parsedContent.reasoningItems.forEach(item => {
    output.push({
      id: item.id,
      type: 'reasoning',
      summary: [
        {
          type: 'summary_text',
          text: item.text
        }
      ]
    });
  });

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

  const responseObject = {
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status: 'completed',
    model,
    output,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      ...(cacheReadTokens > 0 ? { input_tokens_details: { cached_tokens: cacheReadTokens } } : {}),
      ...(reasoningTokens > 0 ? { output_tokens_details: { reasoning_tokens: reasoningTokens } } : {})
    }
  };

  if (cacheCreationTokens > 0 || cacheReadTokens > 0) {
    responseObject.providerMetadata = {
      anthropic: {
        ...(cacheCreationTokens > 0 ? { cacheCreationInputTokens: cacheCreationTokens } : {}),
        ...(cacheReadTokens > 0 ? { cacheReadInputTokens: cacheReadTokens } : {})
      }
    };
  }

  return responseObject;
}

function buildOpenAiResponsesObjectFromGemini(geminiResponse = {}, fallbackModel = '') {
  const usage = extractGeminiUsage(geminiResponse);
  const parsedContent = extractGeminiResponseContent(geminiResponse);
  const text = parsedContent.text;
  const reasoningTokens = usage.reasoningTokens > 0
    ? usage.reasoningTokens
    : parsedContent.reasoningItems.reduce((acc, item) => acc + Math.floor((item.text || '').length / 4), 0);
  const model = geminiResponse.modelVersion || fallbackModel || '';
  const responseId = `resp_${Date.now()}`;
  const messageId = `msg_${Date.now()}`;
  const createdAt = Math.floor(Date.now() / 1000);
  const output = [];

  parsedContent.reasoningItems.forEach(item => {
    output.push({
      id: item.id,
      type: 'reasoning',
      summary: [
        {
          type: 'summary_text',
          text: item.text
        }
      ]
    });
  });

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
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      total_tokens: usage.totalTokens,
      ...(usage.cachedTokens > 0 ? { input_tokens_details: { cached_tokens: usage.cachedTokens } } : {}),
      ...(reasoningTokens > 0 ? { output_tokens_details: { reasoning_tokens: reasoningTokens } } : {})
    }
  };
}

function buildOpenAiChatCompletionsObject(claudeResponse = {}, fallbackModel = '') {
  const usage = extractClaudeLikeUsage(claudeResponse);
  const inputTokens = usage.inputTokens;
  const outputTokens = usage.outputTokens;
  const totalTokens = usage.totalTokens > 0 ? usage.totalTokens : (inputTokens + outputTokens);
  const cachedTokens = usage.cacheReadTokens;
  const parsedContent = extractClaudeResponseContent(claudeResponse);
  const estimatedReasoningTokens = parsedContent.reasoningItems.reduce((acc, item) => acc + Math.floor((item.text || '').length / 4), 0);
  const reasoningTokens = usage.reasoningTokens > 0 ? usage.reasoningTokens : estimatedReasoningTokens;
  const text = parsedContent.text;
  const model = claudeResponse.model || claudeResponse?.response?.model || fallbackModel || '';
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
      total_tokens: totalTokens,
      ...(cachedTokens > 0 ? { prompt_tokens_details: { cached_tokens: cachedTokens } } : {}),
      ...(reasoningTokens > 0 ? { completion_tokens_details: { reasoning_tokens: reasoningTokens } } : {})
    }
  };
}

function buildOpenAiChatCompletionsObjectFromGemini(geminiResponse = {}, fallbackModel = '') {
  const usage = extractGeminiUsage(geminiResponse);
  const parsedContent = extractGeminiResponseContent(geminiResponse);
  const text = parsedContent.text;
  const reasoningTokens = usage.reasoningTokens > 0
    ? usage.reasoningTokens
    : parsedContent.reasoningItems.reduce((acc, item) => acc + Math.floor((item.text || '').length / 4), 0);
  const model = geminiResponse.modelVersion || fallbackModel || '';
  const chatId = `chatcmpl_${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const firstCandidate = Array.isArray(geminiResponse.candidates) ? geminiResponse.candidates[0] : null;
  const functionCalls = parsedContent.functionCalls;
  const hasToolCalls = functionCalls.length > 0;

  const message = {
    role: 'assistant',
    content: text || (hasToolCalls ? null : '')
  };

  if (hasToolCalls) {
    message.tool_calls = functionCalls.map(call => ({
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
        finish_reason: mapGeminiFinishReasonToChatFinishReason(firstCandidate?.finishReason, hasToolCalls)
      }
    ],
    usage: {
      prompt_tokens: usage.inputTokens,
      completion_tokens: usage.outputTokens,
      total_tokens: usage.totalTokens,
      ...(usage.cachedTokens > 0 ? { prompt_tokens_details: { cached_tokens: usage.cachedTokens } } : {}),
      ...(reasoningTokens > 0 ? { completion_tokens_details: { reasoning_tokens: reasoningTokens } } : {})
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
  // 兼容多种 usage 格式：
  // - 标准 OpenAI/Anthropic 格式: {input_tokens, output_tokens} 或 {prompt_tokens, completion_tokens}
  // - 网关内部格式 (relayChatCompletionsStream 等返回): {input, output, cacheCreation, cacheRead}
  const inputTokens = Number(usage?.input_tokens || usage?.prompt_tokens || usage?.input || 0);
  const outputTokens = Number(usage?.output_tokens || usage?.completion_tokens || usage?.output || 0);
  const totalTokens = Number(usage?.total_tokens || usage?.total || (inputTokens + outputTokens));
  const cacheReadTokens = Number(
    usage?.input_tokens_details?.cached_tokens
      || usage?.prompt_tokens_details?.cached_tokens
      || usage?.providerMetadata?.anthropic?.cacheReadInputTokens
      || usage?.cacheRead
      || 0
  );
  const cacheCreationTokens = Number(
    usage?.providerMetadata?.anthropic?.cacheCreationInputTokens
      || usage?.cacheCreation
      || 0
  );
  const cachedTokens = cacheReadTokens + cacheCreationTokens;
  const reasoningTokens = Number(
    usage?.output_tokens_details?.reasoning_tokens
      || usage?.completion_tokens_details?.reasoning_tokens
      || usage?.reasoning
      || 0
  );
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
    total: totalTokens,
    cacheRead: cacheReadTokens,
    cacheCreation: cacheCreationTokens
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
    cachedTokens,
    reasoningTokens,
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
      reasoning: reasoningTokens,
      cached: cachedTokens,
      total: totalTokens
    },
    duration: Date.now() - startTime,
    success: true,
    cost
  });
}

function setSseHeaders(res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
}

function writeSseData(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function writeSseDone(res) {
  res.write('data: [DONE]\n\n');
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

  setSseHeaders(res);

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
  writeSseData(res, createdPayload);

  if (text) {
    const deltaPayload = {
      type: 'response.output_text.delta',
      delta: text
    };
    writeSseData(res, deltaPayload);
  }

  if (functionCalls.length > 0) {
    functionCalls.forEach((item, index) => {
      const payload = {
        type: 'response.output_item.added',
        output_index: index,
        item
      };
      writeSseData(res, payload);
    });
  }

  const completedPayload = {
    type: 'response.completed',
    response: responseObject
  };
  writeSseData(res, completedPayload);
  writeSseDone(res);
  res.end();
}

function normalizeChatCompletionsDeltaToolCalls(toolCalls = []) {
  if (!Array.isArray(toolCalls)) return [];

  const normalizeIndex = (value, fallbackIndex) => {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (/^\d+$/.test(trimmed)) return Number(trimmed);
    }
    return fallbackIndex;
  };

  const normalizedToolCalls = [];
  let fallbackIndex = 0;

  toolCalls.forEach(toolCall => {
    if (!toolCall || typeof toolCall !== 'object') return;

    const rawFunction = (toolCall.function && typeof toolCall.function === 'object')
      ? toolCall.function
      : {};
    const fallbackName = typeof toolCall.name === 'string' ? toolCall.name : '';
    const name = typeof rawFunction.name === 'string' ? rawFunction.name : fallbackName;
    const rawArguments = Object.prototype.hasOwnProperty.call(rawFunction, 'arguments')
      ? rawFunction.arguments
      : toolCall.arguments;
    const argumentsString = normalizeFunctionArgumentsString(
      typeof rawArguments === 'string'
        ? rawArguments
        : JSON.stringify(rawArguments && typeof rawArguments === 'object' ? rawArguments : {})
    );

    normalizedToolCalls.push({
      index: normalizeIndex(toolCall.index, fallbackIndex),
      id: typeof toolCall.id === 'string' && toolCall.id.trim() ? toolCall.id.trim() : generateToolCallId(),
      type: 'function',
      function: {
        name,
        arguments: argumentsString
      }
    });
    fallbackIndex += 1;
  });

  return normalizedToolCalls;
}

function sendChatCompletionsSse(res, responseObject) {
  const message = responseObject?.choices?.[0]?.message || {};
  const text = message?.content || '';
  const toolCalls = normalizeChatCompletionsDeltaToolCalls(message?.tool_calls);
  const finishReason = responseObject?.choices?.[0]?.finish_reason || 'stop';

  setSseHeaders(res);

  const firstChunk = {
    id: responseObject.id,
    object: 'chat.completion.chunk',
    created: responseObject.created,
    model: responseObject.model,
    choices: [
      {
        index: 0,
        delta: {
          role: 'assistant',
          ...(text ? { content: text } : {}),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
        },
        finish_reason: null
      }
    ]
  };
  writeSseData(res, firstChunk);

  const doneChunk = {
    id: responseObject.id,
    object: 'chat.completion.chunk',
    created: responseObject.created,
    model: responseObject.model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: finishReason
      }
    ]
  };
  writeSseData(res, doneChunk);
  // Match OpenAI stream_options.include_usage behavior: emit a final usage chunk.
  writeSseData(res, {
    id: responseObject.id,
    object: 'chat.completion.chunk',
    created: responseObject.created,
    model: responseObject.model,
    choices: [],
    usage: responseObject?.usage && typeof responseObject.usage === 'object'
      ? responseObject.usage
      : {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
  });
  writeSseDone(res);
  res.end();
}

function nextResponsesSequence(state) {
  state.sequence = Number(state.sequence || 0) + 1;
  return state.sequence;
}

function createClaudeResponsesStreamState(fallbackModel = '') {
  return {
    sequence: 0,
    responseId: '',
    createdAt: Math.floor(Date.now() / 1000),
    model: fallbackModel || '',
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    usageSeen: false,
    blockTypeByIndex: new Map(),
    messageIdByIndex: new Map(),
    messageTextByIndex: new Map(),
    functionCallIdByIndex: new Map(),
    functionNameByIndex: new Map(),
    functionArgsByIndex: new Map(),
    reasoningIdByIndex: new Map(),
    reasoningTextByIndex: new Map(),
    completed: false,
    completedResponse: null
  };
}

function sortedNumericKeys(map) {
  return Array.from(map.keys())
    .map(v => Number(v))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

function normalizeFunctionArgumentsString(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '{}';
  try {
    return JSON.stringify(JSON.parse(raw));
  } catch {
    return raw;
  }
}

function buildResponsesOutputFromClaudeStreamState(state) {
  const output = [];

  sortedNumericKeys(state.reasoningIdByIndex).forEach(index => {
    const reasoningId = state.reasoningIdByIndex.get(index) || `rs_${state.responseId || 'response'}_${index}`;
    const text = state.reasoningTextByIndex.get(index) || '';
    output.push({
      id: reasoningId,
      type: 'reasoning',
      summary: [
        {
          type: 'summary_text',
          text
        }
      ]
    });
  });

  sortedNumericKeys(state.messageIdByIndex).forEach(index => {
    const messageId = state.messageIdByIndex.get(index) || `msg_${state.responseId || 'response'}_${index}`;
    const text = state.messageTextByIndex.get(index) || '';
    if (!text && state.functionCallIdByIndex.size > 0) {
      return;
    }
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
  });

  sortedNumericKeys(state.functionCallIdByIndex).forEach(index => {
    const callId = state.functionCallIdByIndex.get(index) || generateToolCallId();
    const name = state.functionNameByIndex.get(index) || '';
    const args = normalizeFunctionArgumentsString(state.functionArgsByIndex.get(index));
    output.push({
      id: `fc_${callId}`,
      type: 'function_call',
      status: 'completed',
      arguments: args,
      call_id: callId,
      name
    });
  });

  if (output.length === 0) {
    output.push({
      id: `msg_${state.responseId || Date.now()}_0`,
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text: '',
          annotations: []
        }
      ]
    });
  }

  return output;
}

function buildCompletedResponsesObjectFromStreamState(state) {
  const output = buildResponsesOutputFromClaudeStreamState(state);
  const reasoningTokens = sortedNumericKeys(state.reasoningTextByIndex)
    .map(index => state.reasoningTextByIndex.get(index) || '')
    .reduce((acc, text) => acc + Math.floor(text.length / 4), 0);
  const totalTokens = Number(state.inputTokens || 0) + Number(state.outputTokens || 0);

  const response = {
    id: state.responseId || `resp_${Date.now()}`,
    object: 'response',
    created_at: Number(state.createdAt) || Math.floor(Date.now() / 1000),
    status: 'completed',
    model: state.model || '',
    output
  };

  // 始终输出 usage 字段，确保 OpenCode Context 面板能正确读取 token 数据
  response.usage = {
    input_tokens: Number(state.inputTokens || 0),
    output_tokens: Number(state.outputTokens || 0),
    total_tokens: totalTokens
  };
  if (reasoningTokens > 0) {
    response.usage.output_tokens_details = { reasoning_tokens: reasoningTokens };
  }
  if ((state.cacheReadTokens || 0) > 0) {
    response.usage.input_tokens_details = { cached_tokens: Number(state.cacheReadTokens || 0) };
  }
  // 注入 providerMetadata.anthropic，供 OpenCode Session.getUsage() 读取 cache write/read tokens
  if ((state.cacheCreationTokens || 0) > 0 || (state.cacheReadTokens || 0) > 0) {
    response.providerMetadata = {
      anthropic: {
        ...(Number(state.cacheCreationTokens || 0) > 0
          ? { cacheCreationInputTokens: Number(state.cacheCreationTokens || 0) }
          : {}),
        ...(Number(state.cacheReadTokens || 0) > 0
          ? { cacheReadInputTokens: Number(state.cacheReadTokens || 0) }
          : {})
      }
    };
  }

  return response;
}

function processClaudeResponsesSseEvent(parsed, state, res) {
  if (!parsed || typeof parsed !== 'object') return;

  const type = parsed.type;
  if (!type) return;

  if (type === 'message_start') {
    const message = parsed.message && typeof parsed.message === 'object' ? parsed.message : {};
    state.responseId = message.id || state.responseId || `resp_${Date.now()}`;
    state.model = message.model || state.model;
    state.createdAt = Math.floor(Date.now() / 1000);

    if (message.usage && typeof message.usage === 'object') {
      if (Number.isFinite(Number(message.usage.input_tokens))) {
        state.inputTokens = Number(message.usage.input_tokens);
        state.usageSeen = true;
      }
      if (Number.isFinite(Number(message.usage.output_tokens))) {
        state.outputTokens = Number(message.usage.output_tokens);
        state.usageSeen = true;
      }
      const cacheCreation = Number(message.usage.cache_creation_input_tokens || 0);
      const cacheRead = Number(message.usage.cache_read_input_tokens || 0);
      if (Number.isFinite(cacheCreation + cacheRead) && (cacheCreation + cacheRead) > 0) {
        state.cacheCreationTokens = cacheCreation;
        state.cacheReadTokens = cacheRead;
        state.cachedTokens = cacheCreation + cacheRead;
        state.usageSeen = true;
      }
    }

    writeSseData(res, {
      type: 'response.created',
      sequence_number: nextResponsesSequence(state),
      response: {
        id: state.responseId,
        object: 'response',
        created_at: state.createdAt,
        model: state.model,
        status: 'in_progress'
      }
    });

    writeSseData(res, {
      type: 'response.in_progress',
      sequence_number: nextResponsesSequence(state),
      response: {
        id: state.responseId,
        object: 'response',
        created_at: state.createdAt,
        model: state.model,
        status: 'in_progress'
      }
    });
    return;
  }

  if (type === 'content_block_start') {
    const index = Number(parsed.index);
    const blockIndex = Number.isFinite(index) ? index : 0;
    const block = parsed.content_block && typeof parsed.content_block === 'object' ? parsed.content_block : {};
    const blockType = block.type;
    state.blockTypeByIndex.set(blockIndex, blockType);

    if (blockType === 'text') {
      const messageId = `msg_${state.responseId || Date.now()}_${blockIndex}`;
      state.messageIdByIndex.set(blockIndex, messageId);
      if (!state.messageTextByIndex.has(blockIndex)) {
        state.messageTextByIndex.set(blockIndex, '');
      }

      writeSseData(res, {
        type: 'response.output_item.added',
        sequence_number: nextResponsesSequence(state),
        output_index: blockIndex,
        item: {
          id: messageId,
          type: 'message',
          status: 'in_progress',
          role: 'assistant',
          content: []
        }
      });

      writeSseData(res, {
        type: 'response.content_part.added',
        sequence_number: nextResponsesSequence(state),
        item_id: messageId,
        output_index: blockIndex,
        content_index: 0,
        part: {
          type: 'output_text',
          text: '',
          annotations: [],
          logprobs: []
        }
      });
      return;
    }

    if (blockType === 'tool_use') {
      const callId = String(block.id || generateToolCallId());
      const name = block.name || '';
      state.functionCallIdByIndex.set(blockIndex, callId);
      state.functionNameByIndex.set(blockIndex, name);
      if (!state.functionArgsByIndex.has(blockIndex)) {
        state.functionArgsByIndex.set(blockIndex, '');
      }
      if (block.input && typeof block.input === 'object' && !Array.isArray(block.input)) {
        state.functionArgsByIndex.set(blockIndex, JSON.stringify(block.input));
      }

      writeSseData(res, {
        type: 'response.output_item.added',
        sequence_number: nextResponsesSequence(state),
        output_index: blockIndex,
        item: {
          id: `fc_${callId}`,
          type: 'function_call',
          status: 'in_progress',
          arguments: '',
          call_id: callId,
          name
        }
      });
      return;
    }

    if (blockType === 'thinking') {
      const reasoningId = `rs_${state.responseId || Date.now()}_${blockIndex}`;
      state.reasoningIdByIndex.set(blockIndex, reasoningId);
      if (!state.reasoningTextByIndex.has(blockIndex)) {
        state.reasoningTextByIndex.set(blockIndex, '');
      }

      writeSseData(res, {
        type: 'response.output_item.added',
        sequence_number: nextResponsesSequence(state),
        output_index: blockIndex,
        item: {
          id: reasoningId,
          type: 'reasoning',
          status: 'in_progress',
          summary: []
        }
      });

      writeSseData(res, {
        type: 'response.reasoning_summary_part.added',
        sequence_number: nextResponsesSequence(state),
        item_id: reasoningId,
        output_index: blockIndex,
        summary_index: 0,
        part: {
          type: 'summary_text',
          text: ''
        }
      });
    }
    return;
  }

  if (type === 'content_block_delta') {
    const index = Number(parsed.index);
    const blockIndex = Number.isFinite(index) ? index : 0;
    const delta = parsed.delta && typeof parsed.delta === 'object' ? parsed.delta : {};
    const deltaType = delta.type;

    if (deltaType === 'text_delta') {
      const text = typeof delta.text === 'string' ? delta.text : '';
      if (!text) return;
      const previous = state.messageTextByIndex.get(blockIndex) || '';
      state.messageTextByIndex.set(blockIndex, previous + text);
      const messageId = state.messageIdByIndex.get(blockIndex) || `msg_${state.responseId || Date.now()}_${blockIndex}`;
      state.messageIdByIndex.set(blockIndex, messageId);

      writeSseData(res, {
        type: 'response.output_text.delta',
        sequence_number: nextResponsesSequence(state),
        item_id: messageId,
        output_index: blockIndex,
        content_index: 0,
        delta: text,
        logprobs: []
      });
      return;
    }

    if (deltaType === 'input_json_delta') {
      const partialJson = typeof delta.partial_json === 'string' ? delta.partial_json : '';
      const previous = state.functionArgsByIndex.get(blockIndex) || '';
      state.functionArgsByIndex.set(blockIndex, previous + partialJson);
      const callId = state.functionCallIdByIndex.get(blockIndex) || generateToolCallId();
      state.functionCallIdByIndex.set(blockIndex, callId);

      writeSseData(res, {
        type: 'response.function_call_arguments.delta',
        sequence_number: nextResponsesSequence(state),
        item_id: `fc_${callId}`,
        output_index: blockIndex,
        delta: partialJson
      });
      return;
    }

    if (deltaType === 'thinking_delta') {
      const thinking = typeof delta.thinking === 'string' ? delta.thinking : '';
      if (!thinking) return;
      const previous = state.reasoningTextByIndex.get(blockIndex) || '';
      state.reasoningTextByIndex.set(blockIndex, previous + thinking);
      const reasoningId = state.reasoningIdByIndex.get(blockIndex) || `rs_${state.responseId || Date.now()}_${blockIndex}`;
      state.reasoningIdByIndex.set(blockIndex, reasoningId);

      writeSseData(res, {
        type: 'response.reasoning_summary_text.delta',
        sequence_number: nextResponsesSequence(state),
        item_id: reasoningId,
        output_index: blockIndex,
        summary_index: 0,
        delta: thinking
      });
    }
    return;
  }

  if (type === 'content_block_stop') {
    const index = Number(parsed.index);
    const blockIndex = Number.isFinite(index) ? index : 0;
    const blockType = state.blockTypeByIndex.get(blockIndex);

    if (blockType === 'text') {
      const messageId = state.messageIdByIndex.get(blockIndex) || `msg_${state.responseId || Date.now()}_${blockIndex}`;
      const text = state.messageTextByIndex.get(blockIndex) || '';

      writeSseData(res, {
        type: 'response.output_text.done',
        sequence_number: nextResponsesSequence(state),
        item_id: messageId,
        output_index: blockIndex,
        content_index: 0,
        text,
        logprobs: []
      });

      writeSseData(res, {
        type: 'response.content_part.done',
        sequence_number: nextResponsesSequence(state),
        item_id: messageId,
        output_index: blockIndex,
        content_index: 0,
        part: {
          type: 'output_text',
          text,
          annotations: [],
          logprobs: []
        }
      });

      writeSseData(res, {
        type: 'response.output_item.done',
        sequence_number: nextResponsesSequence(state),
        output_index: blockIndex,
        item: {
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
      });
      return;
    }

    if (blockType === 'tool_use') {
      const callId = state.functionCallIdByIndex.get(blockIndex) || generateToolCallId();
      const name = state.functionNameByIndex.get(blockIndex) || '';
      const args = normalizeFunctionArgumentsString(state.functionArgsByIndex.get(blockIndex));

      writeSseData(res, {
        type: 'response.function_call_arguments.done',
        sequence_number: nextResponsesSequence(state),
        item_id: `fc_${callId}`,
        output_index: blockIndex,
        arguments: args
      });

      writeSseData(res, {
        type: 'response.output_item.done',
        sequence_number: nextResponsesSequence(state),
        output_index: blockIndex,
        item: {
          id: `fc_${callId}`,
          type: 'function_call',
          status: 'completed',
          arguments: args,
          call_id: callId,
          name
        }
      });
      return;
    }

    if (blockType === 'thinking') {
      const reasoningId = state.reasoningIdByIndex.get(blockIndex) || `rs_${state.responseId || Date.now()}_${blockIndex}`;
      const text = state.reasoningTextByIndex.get(blockIndex) || '';

      writeSseData(res, {
        type: 'response.reasoning_summary_text.done',
        sequence_number: nextResponsesSequence(state),
        item_id: reasoningId,
        output_index: blockIndex,
        summary_index: 0,
        text
      });

      writeSseData(res, {
        type: 'response.reasoning_summary_part.done',
        sequence_number: nextResponsesSequence(state),
        item_id: reasoningId,
        output_index: blockIndex,
        summary_index: 0,
        part: {
          type: 'summary_text',
          text
        }
      });
    }
    return;
  }

  if (type === 'message_delta') {
    const usage = parsed.usage && typeof parsed.usage === 'object' ? parsed.usage : {};
    if (Number.isFinite(Number(usage.input_tokens)) && Number(usage.input_tokens) > 0) {
      state.inputTokens = Number(usage.input_tokens);
      state.usageSeen = true;
    }
    if (Number.isFinite(Number(usage.output_tokens))) {
      state.outputTokens = Number(usage.output_tokens);
      state.usageSeen = true;
    }
    const cacheCreation = Number(usage.cache_creation_input_tokens || 0);
    const cacheRead = Number(usage.cache_read_input_tokens || 0);
    if (Number.isFinite(cacheCreation + cacheRead) && (cacheCreation + cacheRead) > 0) {
      state.cacheCreationTokens = cacheCreation;
      state.cacheReadTokens = cacheRead;
      state.cachedTokens = cacheCreation + cacheRead;
      state.usageSeen = true;
    }
    return;
  }

  if (type === 'message_stop') {
    const completedResponse = buildCompletedResponsesObjectFromStreamState(state);
    state.completed = true;
    state.completedResponse = completedResponse;
    writeSseData(res, {
      type: 'response.completed',
      sequence_number: nextResponsesSequence(state),
      response: completedResponse
    });
  }
}

async function relayClaudeResponsesStream(upstreamResponse, res, fallbackModel = '') {
  setSseHeaders(res);
  const state = createClaudeResponsesStreamState(fallbackModel);
  const stream = createDecodedStream(upstreamResponse);

  return new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;

    const safeResolve = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const safeReject = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const processSseBlock = (block) => {
      if (!block || !block.trim()) return;
      const dataLines = block
        .split('\n')
        .map(line => line.trimEnd())
        .filter(line => line.trim().startsWith('data:'))
        .map(line => line.replace(/^data:\s?/, ''));
      if (dataLines.length === 0) return;
      const payload = dataLines.join('\n').trim();
      if (!payload || payload === '[DONE]') return;

      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return;
      }
      processClaudeResponsesSseEvent(parsed, state, res);
    };

    stream.on('data', (chunk) => {
      buffer += chunk.toString('utf8').replace(/\r\n/g, '\n');
      let separatorIndex = buffer.indexOf('\n\n');
      while (separatorIndex >= 0) {
        const block = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        processSseBlock(block);
        separatorIndex = buffer.indexOf('\n\n');
      }
    });

    stream.on('end', () => {
      if (buffer.trim()) {
        processSseBlock(buffer);
      }

      if (!state.completed) {
        const completedResponse = buildCompletedResponsesObjectFromStreamState(state);
        state.completed = true;
        state.completedResponse = completedResponse;
        writeSseData(res, {
          type: 'response.completed',
          sequence_number: nextResponsesSequence(state),
          response: completedResponse
        });
      }

      if (!res.writableEnded) {
        writeSseDone(res);
        res.end();
      }

      safeResolve(state.completedResponse || buildCompletedResponsesObjectFromStreamState(state));
    });

    stream.on('error', (error) => {
      if (!res.writableEnded) {
        writeSseData(res, {
          type: 'error',
          error: {
            message: `Claude stream decode error: ${error.message || String(error)}`
          }
        });
        writeSseDone(res);
        res.end();
      }
      safeReject(error);
    });

    upstreamResponse.on('error', (error) => {
      if (!res.writableEnded) {
        writeSseData(res, {
          type: 'error',
          error: {
            message: `Claude stream upstream error: ${error.message || String(error)}`
          }
        });
        writeSseDone(res);
        res.end();
      }
      safeReject(error);
    });
  });
}

function buildProxyAbsoluteTargetUrl(baseUrl = '', requestPath = '') {
  const target = String(resolveOpenCodeTarget(baseUrl, requestPath) || '').trim().replace(/\/+$/, '');
  if (!target || !/^https?:\/\//i.test(target)) return '';
  const pathname = String(requestPath || '').trim();
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${target}${normalizedPath}`;
}

function patchCodexResponsesInstructionsEvent(parsed, originalPayload = {}) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const type = parsed.type;
  if (type !== 'response.created' && type !== 'response.in_progress' && type !== 'response.completed') {
    return parsed;
  }
  const response = parsed.response;
  if (!response || typeof response !== 'object') return parsed;
  if (!Object.prototype.hasOwnProperty.call(response, 'instructions')) return parsed;
  if (typeof originalPayload.instructions !== 'string') return parsed;
  return {
    ...parsed,
    response: {
      ...response,
      instructions: originalPayload.instructions
    }
  };
}

async function relayCodexResponsesStream(upstreamResponse, res, originalPayload = {}) {
  setSseHeaders(res);
  const stream = createDecodedStream(upstreamResponse);

  return new Promise((resolve, reject) => {
    let buffer = '';
    let completedResponse = null;
    let doneWritten = false;
    let settled = false;

    const safeResolve = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const safeReject = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const processSseBlock = (block) => {
      if (!block || !block.trim()) return;
      const dataLines = block
        .split('\n')
        .map(line => line.trimEnd())
        .filter(line => line.trim().startsWith('data:'))
        .map(line => line.replace(/^data:\s?/, ''));
      if (dataLines.length === 0) return;
      const payload = dataLines.join('\n').trim();
      if (!payload) return;

      if (payload === '[DONE]') {
        if (!doneWritten) {
          writeSseDone(res);
          doneWritten = true;
        }
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return;
      }
      const patched = patchCodexResponsesInstructionsEvent(parsed, originalPayload);
      if (patched?.type === 'response.completed' && patched?.response && typeof patched.response === 'object') {
        completedResponse = patched.response;
      }
      writeSseData(res, patched);
    };

    stream.on('data', (chunk) => {
      buffer += chunk.toString('utf8').replace(/\r\n/g, '\n');
      let separatorIndex = buffer.indexOf('\n\n');
      while (separatorIndex >= 0) {
        const block = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        processSseBlock(block);
        separatorIndex = buffer.indexOf('\n\n');
      }
    });

    stream.on('end', () => {
      if (buffer.trim()) {
        processSseBlock(buffer);
      }

      if (!doneWritten && !res.writableEnded) {
        writeSseDone(res);
      }
      if (!res.writableEnded) {
        res.end();
      }
      safeResolve(completedResponse);
    });

    stream.on('error', (error) => {
      if (!res.writableEnded) {
        writeSseData(res, {
          type: 'error',
          error: {
            message: `Codex stream decode error: ${error.message || String(error)}`
          }
        });
        writeSseDone(res);
        res.end();
      }
      safeReject(error);
    });

    upstreamResponse.on('error', (error) => {
      if (!res.writableEnded) {
        writeSseData(res, {
          type: 'error',
          error: {
            message: `Codex stream upstream error: ${error.message || String(error)}`
          }
        });
        writeSseDone(res);
        res.end();
      }
      safeReject(error);
    });
  });
}

async function collectCodexResponsesNonStream(upstreamResponse, originalPayload = {}) {
  const stream = createDecodedStream(upstreamResponse);

  return new Promise((resolve, reject) => {
    let buffer = '';
    let rawBuffer = '';
    let completedResponse = null;

    const processSseBlock = (block) => {
      if (!block || !block.trim()) return;
      const dataLines = block
        .split('\n')
        .map(line => line.trimEnd())
        .filter(line => line.trim().startsWith('data:'))
        .map(line => line.replace(/^data:\s?/, ''));
      if (dataLines.length === 0) return;
      const payload = dataLines.join('\n').trim();
      if (!payload || payload === '[DONE]') return;

      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return;
      }
      const patched = patchCodexResponsesInstructionsEvent(parsed, originalPayload);
      if (patched?.type === 'response.completed' && patched?.response && typeof patched.response === 'object') {
        completedResponse = patched.response;
      }
    };

    stream.on('data', (chunk) => {
      const textChunk = chunk.toString('utf8').replace(/\r\n/g, '\n');
      rawBuffer += textChunk;
      buffer += textChunk;
      let separatorIndex = buffer.indexOf('\n\n');
      while (separatorIndex >= 0) {
        const block = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        processSseBlock(block);
        separatorIndex = buffer.indexOf('\n\n');
      }
    });

    stream.on('end', () => {
      if (buffer.trim()) {
        processSseBlock(buffer);
      }
      if (completedResponse) {
        resolve(completedResponse);
        return;
      }

      const trimmedRaw = rawBuffer.trim();
      if (trimmedRaw) {
        try {
          const parsed = JSON.parse(trimmedRaw);
          if (parsed?.response && typeof parsed.response === 'object') {
            resolve(parsed.response);
            return;
          }
          if (parsed && typeof parsed === 'object') {
            resolve(parsed);
            return;
          }
        } catch {
          // ignore JSON fallback parse error
        }
      }
      resolve(null);
    });

    stream.on('error', reject);
    upstreamResponse.on('error', reject);
  });
}

async function relayChatCompletionsStream(upstreamResponse, res, fallbackModel = '') {
  setSseHeaders(res);
  const stream = createDecodedStream(upstreamResponse);

  const chatId = `chatcmpl_${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  // state tracked across SSE events
  const state = {
    model: fallbackModel || '',
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    stopReason: 'stop',
    // per-block tracking
    blockTypeByIndex: new Map(),
    functionCallIdByIndex: new Map(),
    functionNameByIndex: new Map(),
    functionArgsByIndex: new Map(),
    // tool_call index emitted to client (sequential, starting at 0)
    toolCallClientIndexByBlockIndex: new Map(),
    nextToolCallClientIndex: 0
  };

  return new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;

    const safeResolve = (value) => { if (!settled) { settled = true; resolve(value); } };
    const safeReject = (error) => { if (!settled) { settled = true; reject(error); } };

    // Send the initial role chunk once
    writeSseData(res, {
      id: chatId,
      object: 'chat.completion.chunk',
      created,
      model: state.model || fallbackModel,
      choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }]
    });

    const processSseBlock = (block) => {
      if (!block || !block.trim()) return;
      const dataLines = block
        .split('\n')
        .map(line => line.trimEnd())
        .filter(line => line.trim().startsWith('data:'))
        .map(line => line.replace(/^data:\s?/, ''));
      if (dataLines.length === 0) return;
      const payload = dataLines.join('\n').trim();
      if (!payload || payload === '[DONE]') return;

      let parsed;
      try { parsed = JSON.parse(payload); } catch { return; }
      if (!parsed || typeof parsed !== 'object') return;

      const type = parsed.type;
      if (!type) return;

      if (type === 'message_start') {
        const msg = parsed.message && typeof parsed.message === 'object' ? parsed.message : {};
        if (msg.model) state.model = msg.model;
        if (msg.usage) {
          state.inputTokens = Number(msg.usage.input_tokens || 0);
          state.cacheCreationTokens = Number(msg.usage.cache_creation_input_tokens || 0);
          state.cacheReadTokens = Number(msg.usage.cache_read_input_tokens || 0);
        }
        return;
      }

      if (type === 'content_block_start') {
        const blockIndex = Number.isFinite(Number(parsed.index)) ? Number(parsed.index) : 0;
        const block = parsed.content_block && typeof parsed.content_block === 'object' ? parsed.content_block : {};
        const blockType = block.type;
        state.blockTypeByIndex.set(blockIndex, blockType);

        if (blockType === 'tool_use') {
          const callId = String(block.id || generateToolCallId());
          const name = block.name || '';
          state.functionCallIdByIndex.set(blockIndex, callId);
          state.functionNameByIndex.set(blockIndex, name);
          state.functionArgsByIndex.set(blockIndex, '');
          const clientIndex = state.nextToolCallClientIndex++;
          state.toolCallClientIndexByBlockIndex.set(blockIndex, clientIndex);

          // Emit tool_call start chunk
          writeSseData(res, {
            id: chatId,
            object: 'chat.completion.chunk',
            created,
            model: state.model || fallbackModel,
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: clientIndex,
                  id: callId,
                  type: 'function',
                  function: { name, arguments: '' }
                }]
              },
              finish_reason: null
            }]
          });
        }
        return;
      }

      if (type === 'content_block_delta') {
        const blockIndex = Number.isFinite(Number(parsed.index)) ? Number(parsed.index) : 0;
        const delta = parsed.delta && typeof parsed.delta === 'object' ? parsed.delta : {};
        const deltaType = delta.type;

        if (deltaType === 'text_delta') {
          const text = typeof delta.text === 'string' ? delta.text : '';
          if (!text) return;
          writeSseData(res, {
            id: chatId,
            object: 'chat.completion.chunk',
            created,
            model: state.model || fallbackModel,
            choices: [{ index: 0, delta: { content: text }, finish_reason: null }]
          });
          return;
        }

        if (deltaType === 'input_json_delta') {
          const partialJson = typeof delta.partial_json === 'string' ? delta.partial_json : '';
          if (!partialJson) return;
          const prev = state.functionArgsByIndex.get(blockIndex) || '';
          state.functionArgsByIndex.set(blockIndex, prev + partialJson);
          const clientIndex = state.toolCallClientIndexByBlockIndex.get(blockIndex) ?? 0;
          writeSseData(res, {
            id: chatId,
            object: 'chat.completion.chunk',
            created,
            model: state.model || fallbackModel,
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: clientIndex,
                  function: { arguments: partialJson }
                }]
              },
              finish_reason: null
            }]
          });
          return;
        }
        // thinking_delta: silently skip (no equivalent in chat completions)
        return;
      }

      if (type === 'message_delta') {
        const usage = parsed.usage && typeof parsed.usage === 'object' ? parsed.usage : {};
        if (Number.isFinite(Number(usage.output_tokens))) {
          state.outputTokens = Number(usage.output_tokens);
        }
        const stopReason = parsed.delta && parsed.delta.stop_reason;
        if (stopReason) state.stopReason = stopReason;
        return;
      }

      if (type === 'message_stop') {
        const finishReason = mapClaudeStopReasonToChatFinishReason(state.stopReason);
        const hasToolCalls = state.nextToolCallClientIndex > 0;

        // Final finish chunk
        writeSseData(res, {
          id: chatId,
          object: 'chat.completion.chunk',
          created,
          model: state.model || fallbackModel,
          choices: [{ index: 0, delta: {}, finish_reason: hasToolCalls ? 'tool_calls' : finishReason }]
        });

        // Usage chunk (stream_options.include_usage)
        const inputTokens = state.inputTokens;
        const outputTokens = state.outputTokens;
        const cachedTokens = state.cacheCreationTokens + state.cacheReadTokens;
        writeSseData(res, {
          id: chatId,
          object: 'chat.completion.chunk',
          created,
          model: state.model || fallbackModel,
          choices: [],
          usage: {
            prompt_tokens: inputTokens,
            completion_tokens: outputTokens,
            total_tokens: inputTokens + outputTokens,
            ...(cachedTokens > 0 ? { prompt_tokens_details: { cached_tokens: cachedTokens } } : {})
          }
        });

        writeSseDone(res);
        res.end();
        safeResolve({
          model: state.model || fallbackModel,
          usage: {
            input: inputTokens,
            output: outputTokens,
            cacheCreation: state.cacheCreationTokens,
            cacheRead: state.cacheReadTokens
          }
        });
      }
    };

    stream.on('data', (chunk) => {
      buffer += chunk.toString('utf8').replace(/\r\n/g, '\n');
      let separatorIndex = buffer.indexOf('\n\n');
      while (separatorIndex >= 0) {
        const block = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        processSseBlock(block);
        separatorIndex = buffer.indexOf('\n\n');
      }
    });

    stream.on('end', () => {
      if (buffer.trim()) processSseBlock(buffer);
      if (!res.writableEnded) {
        writeSseDone(res);
        res.end();
      }
      safeResolve({ model: state.model || fallbackModel, usage: { input: state.inputTokens, output: state.outputTokens, cacheCreation: state.cacheCreationTokens, cacheRead: state.cacheReadTokens } });
    });

    stream.on('error', (error) => {
      if (!res.writableEnded) {
        writeSseDone(res);
        res.end();
      }
      safeReject(error);
    });

    upstreamResponse.on('error', (error) => {
      if (!res.writableEnded) {
        writeSseDone(res);
        res.end();
      }
      safeReject(error);
    });
  });
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
  const streamResponses = wantsStream && isResponsesPath(pathname);
  const streamChatCompletions = wantsStream && isChatCompletionsPath(pathname);
  const sessionKey = extractSessionIdFromRequest(req, originalPayload);
  const sessionScope = normalizeSessionKeyValue(channel?.id || channel?.name || '');
  const scopedSessionKey = sessionKey && sessionScope
    ? `${sessionScope}::${sessionKey}`
    : sessionKey;
  const preferredUserId = normalizeSessionKeyValue(originalPayload?.metadata?.user_id);
  const sessionUserId = resolveClaudeUserIdBySession(scopedSessionKey, preferredUserId);
  const claudePayload = convertOpenCodePayloadToClaude(pathname, originalPayload, channel.model, {
    sessionUserId
  });
  claudePayload.stream = streamResponses || streamChatCompletions;

  const headers = {
    'x-api-key': effectiveKey,
    'authorization': `Bearer ${effectiveKey}`,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': CLAUDE_CODE_BETA_HEADER,
    'anthropic-dangerous-direct-browser-access': 'true',
    'x-app': 'cli',
    'x-stainless-helper-method': 'stream',
    'x-stainless-retry-count': '0',
    'x-stainless-runtime-version': 'v24.3.0',
    'x-stainless-package-version': '0.74.0',
    'x-stainless-runtime': 'node',
    'x-stainless-lang': 'js',
    'x-stainless-arch': mapStainlessArch(),
    'x-stainless-os': mapStainlessOs(),
    'x-stainless-timeout': '600',
    'content-type': 'application/json',
    'accept': (streamResponses || streamChatCompletions) ? 'text/event-stream' : 'application/json',
    'accept-encoding': 'gzip, deflate, br, zstd',
    'connection': 'keep-alive',
    'user-agent': CLAUDE_CODE_USER_AGENT
  };

  if (streamChatCompletions) {
    let streamUpstream;
    try {
      streamUpstream = await postJsonStream(buildClaudeTargetUrl(channel.baseUrl), headers, claudePayload, 120000);
    } catch (error) {
      recordFailure(channel.id, 'opencode', error);
      sendOpenAiStyleError(res, 502, `Claude gateway network error: ${error.message}`, 'proxy_error');
      return true;
    }

    const statusCode = Number(streamUpstream.statusCode) || 500;
    if (statusCode < 200 || statusCode >= 300) {
      let rawBody = '';
      try {
        rawBody = await collectHttpResponseBody(streamUpstream.response);
      } catch {
        rawBody = '';
      }
      let parsedError = null;
      try {
        parsedError = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        parsedError = null;
      }
      const upstreamMessage = parsedError?.error?.message || parsedError?.message || rawBody || `HTTP ${statusCode}`;
      recordFailure(channel.id, 'opencode', new Error(String(upstreamMessage).slice(0, 200)));
      sendOpenAiStyleError(res, statusCode, String(upstreamMessage).slice(0, 1000), 'upstream_error');
      return true;
    }

    try {
      const streamedResponseObject = await relayChatCompletionsStream(streamUpstream.response, res, originalPayload.model || '');
      publishOpenCodeUsageLog({
        requestId,
        channel,
        model: streamedResponseObject?.model || originalPayload.model || '',
        usage: streamedResponseObject?.usage || {},
        startTime
      });
      recordSuccess(channel.id, 'opencode');
    } catch (error) {
      recordFailure(channel.id, 'opencode', error);
      if (!res.headersSent) {
        sendOpenAiStyleError(res, 502, `Claude stream relay error: ${error.message}`, 'proxy_error');
      }
    }
    return true;
  }

  if (streamResponses) {
    let streamUpstream;
    try {
      streamUpstream = await postJsonStream(buildClaudeTargetUrl(channel.baseUrl), headers, claudePayload, 120000);
    } catch (error) {
      recordFailure(channel.id, 'opencode', error);
      sendOpenAiStyleError(res, 502, `Claude gateway network error: ${error.message}`, 'proxy_error');
      return true;
    }

    const statusCode = Number(streamUpstream.statusCode) || 500;
    if (statusCode < 200 || statusCode >= 300) {
      let rawBody = '';
      try {
        rawBody = await collectHttpResponseBody(streamUpstream.response);
      } catch {
        rawBody = '';
      }

      let parsedError = null;
      try {
        parsedError = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        parsedError = null;
      }
      const upstreamMessage = parsedError?.error?.message || parsedError?.message || rawBody || `HTTP ${statusCode}`;
      recordFailure(channel.id, 'opencode', new Error(String(upstreamMessage).slice(0, 200)));
      sendOpenAiStyleError(res, statusCode, String(upstreamMessage).slice(0, 1000), 'upstream_error');
      return true;
    }

    try {
      const streamedResponseObject = await relayClaudeResponsesStream(streamUpstream.response, res, originalPayload.model || '');
      publishOpenCodeUsageLog({
        requestId,
        channel,
        model: streamedResponseObject?.model || originalPayload.model || '',
        usage: streamedResponseObject?.providerMetadata
          ? { ...(streamedResponseObject.usage || {}), providerMetadata: streamedResponseObject.providerMetadata }
          : streamedResponseObject?.usage || {},
        startTime
      });
      recordSuccess(channel.id, 'opencode');
    } catch (error) {
      recordFailure(channel.id, 'opencode', error);
      if (!res.headersSent) {
        sendOpenAiStyleError(res, 502, `Claude stream relay error: ${error.message}`, 'proxy_error');
      }
    }
    return true;
  }

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

async function handleCodexGatewayRequest(req, res, channel, effectiveKey) {
  const pathname = getRequestPathname(req.url);
  if (!isResponsesPath(pathname)) {
    return false;
  }

  if (!shouldParseJson(req)) {
    sendOpenAiStyleError(res, 400, 'Codex gateway only supports JSON POST payload');
    return true;
  }

  const requestId = `opencode-${Date.now()}-${Math.random()}`;
  const startTime = Date.now();
  const originalPayload = (req.body && typeof req.body === 'object') ? req.body : {};
  const wantsStream = !!originalPayload.stream;
  const converted = convertOpenCodePayloadToCodexResponses(originalPayload, channel.model);
  const targetModel = converted.model;

  if (!targetModel) {
    sendOpenAiStyleError(res, 400, 'Missing model in request and channel configuration');
    return true;
  }

  const targetUrl = buildCodexTargetUrl(channel.baseUrl);
  if (!targetUrl) {
    sendOpenAiStyleError(res, 400, 'Failed to build Codex target URL');
    return true;
  }

  const codexSessionId = extractSessionIdFromRequest(req, originalPayload);
  const stableSessionKey = codexSessionId || `${channel.id || 'ch'}-${channel.baseUrl || ''}`;
  const promptCacheKey = (typeof converted.requestBody.prompt_cache_key === 'string' && converted.requestBody.prompt_cache_key.trim())
    ? converted.requestBody.prompt_cache_key.trim()
    : stableSessionKey;
  converted.requestBody.prompt_cache_key = promptCacheKey;

  const headers = {
    authorization: `Bearer ${effectiveKey}`,
    'openai-beta': 'responses=experimental',
    accept: 'text/event-stream',
    'accept-encoding': 'gzip, deflate, br',
    connection: 'Keep-Alive',
    'content-type': 'application/json',
    Version: CODEX_CLI_VERSION,
    Session_id: promptCacheKey,
    Conversation_id: promptCacheKey,
    Originator: 'codex_cli_rs',
    'user-agent': CODEX_CLI_USER_AGENT
  };

  let streamUpstream;
  try {
    streamUpstream = await postJsonStream(targetUrl, headers, converted.requestBody, 120000);
  } catch (error) {
    recordFailure(channel.id, 'opencode', error);
    sendOpenAiStyleError(res, 502, `Codex gateway network error: ${error.message}`, 'proxy_error');
    return true;
  }

  const statusCode = Number(streamUpstream.statusCode) || 500;
  if (statusCode < 200 || statusCode >= 300) {
    let rawBody = '';
    try {
      rawBody = await collectHttpResponseBody(streamUpstream.response);
    } catch {
      rawBody = '';
    }

    let parsedError = null;
    try {
      parsedError = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      parsedError = null;
    }

    const upstreamMessage = parsedError?.error?.message || parsedError?.message || rawBody || `HTTP ${statusCode}`;
    recordFailure(channel.id, 'opencode', new Error(String(upstreamMessage).slice(0, 200)));
    sendOpenAiStyleError(res, statusCode, String(upstreamMessage).slice(0, 1000), 'upstream_error');
    return true;
  }

  try {
    if (wantsStream) {
      const completedResponse = await relayCodexResponsesStream(streamUpstream.response, res, originalPayload);
      publishOpenCodeUsageLog({
        requestId,
        channel,
        model: completedResponse?.model || targetModel,
        usage: completedResponse?.usage || {},
        startTime
      });
      recordSuccess(channel.id, 'opencode');
      return true;
    }

    const responseObject = await collectCodexResponsesNonStream(streamUpstream.response, originalPayload);
    if (!responseObject || typeof responseObject !== 'object') {
      recordFailure(channel.id, 'opencode', new Error('Invalid Codex gateway response'));
      sendOpenAiStyleError(res, 502, 'Invalid Codex gateway response', 'proxy_error');
      return true;
    }
    res.json(responseObject);
    publishOpenCodeUsageLog({
      requestId,
      channel,
      model: responseObject.model || targetModel,
      usage: responseObject.usage || {},
      startTime
    });
    recordSuccess(channel.id, 'opencode');
    return true;
  } catch (error) {
    recordFailure(channel.id, 'opencode', error);
    if (!res.headersSent) {
      sendOpenAiStyleError(res, 502, `Codex stream relay error: ${error.message}`, 'proxy_error');
    }
    return true;
  }
}

function createGeminiResponsesStreamState(fallbackModel = '') {
  return {
    sequence: 0,
    responseId: `resp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    createdAt: Math.floor(Date.now() / 1000),
    model: fallbackModel || '',
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    usageSeen: false,
    started: false,
    completed: false,
    completedResponse: null,
    itemTypeByIndex: new Map(),
    messageIdByIndex: new Map(),
    messageTextByIndex: new Map(),
    functionCallIdByIndex: new Map(),
    functionNameByIndex: new Map(),
    functionArgsByIndex: new Map(),
    reasoningIdByIndex: new Map(),
    reasoningTextByIndex: new Map()
  };
}

function ensureGeminiResponsesStarted(state, res) {
  if (state.started) return;
  state.started = true;

  const inProgressResponse = {
    id: state.responseId,
    object: 'response',
    created_at: state.createdAt,
    model: state.model,
    status: 'in_progress'
  };

  writeSseData(res, {
    type: 'response.created',
    sequence_number: nextResponsesSequence(state),
    response: inProgressResponse
  });

  writeSseData(res, {
    type: 'response.in_progress',
    sequence_number: nextResponsesSequence(state),
    response: inProgressResponse
  });
}

function mergeGeminiStreamText(previousValue, incomingValue) {
  const previous = typeof previousValue === 'string' ? previousValue : '';
  const incoming = typeof incomingValue === 'string' ? incomingValue : '';
  if (!incoming) return previous;
  if (!previous) return incoming;
  if (incoming.startsWith(previous)) return incoming;
  return `${previous}${incoming}`;
}

function mergeGeminiStreamArguments(previousValue, incomingValue) {
  const previous = typeof previousValue === 'string' ? previousValue : '';
  const incoming = typeof incomingValue === 'string' ? incomingValue : '';
  if (!incoming) return previous;
  if (!previous) return incoming;
  if (incoming.startsWith(previous)) return incoming;
  if (previous.startsWith(incoming)) return previous;

  const trimmed = incoming.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return incoming;
  }
  return `${previous}${incoming}`;
}

function computeIncrementalDelta(previousValue, nextValue) {
  const previous = typeof previousValue === 'string' ? previousValue : '';
  const next = typeof nextValue === 'string' ? nextValue : '';
  if (!next || next === previous) return '';
  if (!previous) return next;
  if (next.startsWith(previous)) return next.slice(previous.length);
  return next;
}

function applyGeminiUsageMetadataToStreamState(parsed, state) {
  const usageMetadata = (parsed?.usageMetadata && typeof parsed.usageMetadata === 'object')
    ? parsed.usageMetadata
    : null;
  if (!usageMetadata) return;

  if (Number.isFinite(Number(usageMetadata.promptTokenCount))) {
    state.inputTokens = Number(usageMetadata.promptTokenCount);
    state.usageSeen = true;
  }
  if (Number.isFinite(Number(usageMetadata.candidatesTokenCount))) {
    state.outputTokens = Number(usageMetadata.candidatesTokenCount);
    state.usageSeen = true;
  }
  if (Number.isFinite(Number(usageMetadata.totalTokenCount))) {
    state.totalTokens = Number(usageMetadata.totalTokenCount);
    state.usageSeen = true;
  } else if (state.usageSeen) {
    state.totalTokens = state.inputTokens + state.outputTokens;
  }
  if (Number.isFinite(Number(usageMetadata.cachedContentTokenCount))) {
    state.cachedTokens = Number(usageMetadata.cachedContentTokenCount);
    state.usageSeen = true;
  }
  if (Number.isFinite(Number(usageMetadata.thoughtsTokenCount))) {
    state.reasoningTokens = Number(usageMetadata.thoughtsTokenCount);
    state.usageSeen = true;
  }
}

function processGeminiResponsesSseEvent(parsed, state, res) {
  if (!parsed || typeof parsed !== 'object') return;
  if (typeof parsed.modelVersion === 'string' && parsed.modelVersion.trim()) {
    state.model = parsed.modelVersion;
  }
  ensureGeminiResponsesStarted(state, res);
  applyGeminiUsageMetadataToStreamState(parsed, state);

  const firstCandidate = Array.isArray(parsed.candidates)
    ? parsed.candidates.find(candidate => candidate && typeof candidate === 'object')
    : null;
  if (!firstCandidate) return;

  const parts = Array.isArray(firstCandidate.content?.parts) ? firstCandidate.content.parts : [];
  parts.forEach((part, index) => {
    if (!part || typeof part !== 'object') return;

    if (part.functionCall && typeof part.functionCall === 'object') {
      const existingType = state.itemTypeByIndex.get(index);
      if (existingType && existingType !== 'function_call') return;
      state.itemTypeByIndex.set(index, 'function_call');

      const functionCall = part.functionCall;
      const callId = String(
        state.functionCallIdByIndex.get(index)
        || functionCall.id
        || functionCall.callId
        || `call_${index + 1}`
      );
      const name = typeof functionCall.name === 'string'
        ? functionCall.name
        : (state.functionNameByIndex.get(index) || '');
      const argsObject = (functionCall.args && typeof functionCall.args === 'object' && !Array.isArray(functionCall.args))
        ? functionCall.args
        : {};
      const argsString = JSON.stringify(argsObject);
      const previousArgs = state.functionArgsByIndex.get(index) || '';
      const mergedArgs = mergeGeminiStreamArguments(previousArgs, argsString);
      const delta = computeIncrementalDelta(previousArgs, mergedArgs);

      if (!state.functionCallIdByIndex.has(index)) {
        writeSseData(res, {
          type: 'response.output_item.added',
          sequence_number: nextResponsesSequence(state),
          output_index: index,
          item: {
            id: `fc_${callId}`,
            type: 'function_call',
            status: 'in_progress',
            arguments: '',
            call_id: callId,
            name
          }
        });
      }

      if (delta) {
        writeSseData(res, {
          type: 'response.function_call_arguments.delta',
          sequence_number: nextResponsesSequence(state),
          item_id: `fc_${callId}`,
          output_index: index,
          delta
        });
      }

      state.functionCallIdByIndex.set(index, callId);
      state.functionNameByIndex.set(index, name);
      state.functionArgsByIndex.set(index, mergedArgs);
      return;
    }

    if (typeof part.text !== 'string' || !part.text) {
      return;
    }

    if (part.thought === true) {
      const existingType = state.itemTypeByIndex.get(index);
      if (existingType && existingType !== 'reasoning') return;
      state.itemTypeByIndex.set(index, 'reasoning');

      const reasoningId = state.reasoningIdByIndex.get(index) || `rs_${state.responseId}_${index}`;
      const previousText = state.reasoningTextByIndex.get(index) || '';
      const mergedText = mergeGeminiStreamText(previousText, part.text);
      const delta = computeIncrementalDelta(previousText, mergedText);

      if (!state.reasoningIdByIndex.has(index)) {
        writeSseData(res, {
          type: 'response.output_item.added',
          sequence_number: nextResponsesSequence(state),
          output_index: index,
          item: {
            id: reasoningId,
            type: 'reasoning',
            status: 'in_progress',
            summary: []
          }
        });

        writeSseData(res, {
          type: 'response.reasoning_summary_part.added',
          sequence_number: nextResponsesSequence(state),
          item_id: reasoningId,
          output_index: index,
          summary_index: 0,
          part: {
            type: 'summary_text',
            text: ''
          }
        });
      }

      if (delta) {
        writeSseData(res, {
          type: 'response.reasoning_summary_text.delta',
          sequence_number: nextResponsesSequence(state),
          item_id: reasoningId,
          output_index: index,
          summary_index: 0,
          delta
        });
      }

      state.reasoningIdByIndex.set(index, reasoningId);
      state.reasoningTextByIndex.set(index, mergedText);
      return;
    }

    const existingType = state.itemTypeByIndex.get(index);
    if (existingType && existingType !== 'message') return;
    state.itemTypeByIndex.set(index, 'message');

    const messageId = state.messageIdByIndex.get(index) || `msg_${state.responseId}_${index}`;
    const previousText = state.messageTextByIndex.get(index) || '';
    const mergedText = mergeGeminiStreamText(previousText, part.text);
    const delta = computeIncrementalDelta(previousText, mergedText);

    if (!state.messageIdByIndex.has(index)) {
      writeSseData(res, {
        type: 'response.output_item.added',
        sequence_number: nextResponsesSequence(state),
        output_index: index,
        item: {
          id: messageId,
          type: 'message',
          status: 'in_progress',
          role: 'assistant',
          content: []
        }
      });

      writeSseData(res, {
        type: 'response.content_part.added',
        sequence_number: nextResponsesSequence(state),
        item_id: messageId,
        output_index: index,
        content_index: 0,
        part: {
          type: 'output_text',
          text: '',
          annotations: [],
          logprobs: []
        }
      });
    }

    if (delta) {
      writeSseData(res, {
        type: 'response.output_text.delta',
        sequence_number: nextResponsesSequence(state),
        item_id: messageId,
        output_index: index,
        content_index: 0,
        delta,
        logprobs: []
      });
    }

    state.messageIdByIndex.set(index, messageId);
    state.messageTextByIndex.set(index, mergedText);
  });
}

function buildCompletedResponsesObjectFromGeminiStreamState(state) {
  const output = [];
  sortedNumericKeys(state.itemTypeByIndex).forEach(index => {
    const itemType = state.itemTypeByIndex.get(index);
    if (itemType === 'message') {
      const messageId = state.messageIdByIndex.get(index) || `msg_${state.responseId}_${index}`;
      const text = state.messageTextByIndex.get(index) || '';
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
      return;
    }

    if (itemType === 'reasoning') {
      const reasoningId = state.reasoningIdByIndex.get(index) || `rs_${state.responseId}_${index}`;
      const text = state.reasoningTextByIndex.get(index) || '';
      output.push({
        id: reasoningId,
        type: 'reasoning',
        summary: [
          {
            type: 'summary_text',
            text
          }
        ]
      });
      return;
    }

    if (itemType === 'function_call') {
      const callId = state.functionCallIdByIndex.get(index) || `call_${index + 1}`;
      const name = state.functionNameByIndex.get(index) || '';
      const args = normalizeFunctionArgumentsString(state.functionArgsByIndex.get(index));
      output.push({
        id: `fc_${callId}`,
        type: 'function_call',
        status: 'completed',
        arguments: args,
        call_id: callId,
        name
      });
    }
  });

  if (output.length === 0) {
    output.push({
      id: `msg_${state.responseId}_0`,
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text: '',
          annotations: []
        }
      ]
    });
  }

  const estimatedReasoningTokens = sortedNumericKeys(state.reasoningTextByIndex)
    .map(index => state.reasoningTextByIndex.get(index) || '')
    .reduce((acc, text) => acc + Math.floor(text.length / 4), 0);
  const reasoningTokens = state.reasoningTokens > 0 ? state.reasoningTokens : estimatedReasoningTokens;
  const totalTokens = state.totalTokens > 0
    ? state.totalTokens
    : Number(state.inputTokens || 0) + Number(state.outputTokens || 0);

  const response = {
    id: state.responseId,
    object: 'response',
    created_at: state.createdAt,
    status: 'completed',
    model: state.model || '',
    output
  };

  if (state.usageSeen || totalTokens > 0 || state.cachedTokens > 0 || reasoningTokens > 0) {
    response.usage = {
      input_tokens: Number(state.inputTokens || 0),
      output_tokens: Number(state.outputTokens || 0),
      total_tokens: totalTokens
    };
    if (state.cachedTokens > 0) {
      response.usage.input_tokens_details = {
        cached_tokens: Number(state.cachedTokens || 0)
      };
    }
    if (reasoningTokens > 0) {
      response.usage.output_tokens_details = {
        reasoning_tokens: Number(reasoningTokens || 0)
      };
    }
  }

  return response;
}

function finalizeGeminiResponsesStream(state, res) {
  if (state.completed) {
    return state.completedResponse || buildCompletedResponsesObjectFromGeminiStreamState(state);
  }

  ensureGeminiResponsesStarted(state, res);
  sortedNumericKeys(state.itemTypeByIndex).forEach(index => {
    const itemType = state.itemTypeByIndex.get(index);
    if (itemType === 'message') {
      const messageId = state.messageIdByIndex.get(index) || `msg_${state.responseId}_${index}`;
      const text = state.messageTextByIndex.get(index) || '';
      writeSseData(res, {
        type: 'response.output_text.done',
        sequence_number: nextResponsesSequence(state),
        item_id: messageId,
        output_index: index,
        content_index: 0,
        text,
        logprobs: []
      });

      writeSseData(res, {
        type: 'response.content_part.done',
        sequence_number: nextResponsesSequence(state),
        item_id: messageId,
        output_index: index,
        content_index: 0,
        part: {
          type: 'output_text',
          text,
          annotations: [],
          logprobs: []
        }
      });

      writeSseData(res, {
        type: 'response.output_item.done',
        sequence_number: nextResponsesSequence(state),
        output_index: index,
        item: {
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
      });
      return;
    }

    if (itemType === 'reasoning') {
      const reasoningId = state.reasoningIdByIndex.get(index) || `rs_${state.responseId}_${index}`;
      const text = state.reasoningTextByIndex.get(index) || '';

      writeSseData(res, {
        type: 'response.reasoning_summary_text.done',
        sequence_number: nextResponsesSequence(state),
        item_id: reasoningId,
        output_index: index,
        summary_index: 0,
        text
      });

      writeSseData(res, {
        type: 'response.reasoning_summary_part.done',
        sequence_number: nextResponsesSequence(state),
        item_id: reasoningId,
        output_index: index,
        summary_index: 0,
        part: {
          type: 'summary_text',
          text
        }
      });

      writeSseData(res, {
        type: 'response.output_item.done',
        sequence_number: nextResponsesSequence(state),
        output_index: index,
        item: {
          id: reasoningId,
          type: 'reasoning',
          status: 'completed',
          summary: [
            {
              type: 'summary_text',
              text
            }
          ]
        }
      });
      return;
    }

    if (itemType === 'function_call') {
      const callId = state.functionCallIdByIndex.get(index) || `call_${index + 1}`;
      const name = state.functionNameByIndex.get(index) || '';
      const args = normalizeFunctionArgumentsString(state.functionArgsByIndex.get(index));

      writeSseData(res, {
        type: 'response.function_call_arguments.done',
        sequence_number: nextResponsesSequence(state),
        item_id: `fc_${callId}`,
        output_index: index,
        arguments: args
      });

      writeSseData(res, {
        type: 'response.output_item.done',
        sequence_number: nextResponsesSequence(state),
        output_index: index,
        item: {
          id: `fc_${callId}`,
          type: 'function_call',
          status: 'completed',
          arguments: args,
          call_id: callId,
          name
        }
      });
    }
  });

  const completedResponse = buildCompletedResponsesObjectFromGeminiStreamState(state);
  state.completed = true;
  state.completedResponse = completedResponse;
  writeSseData(res, {
    type: 'response.completed',
    sequence_number: nextResponsesSequence(state),
    response: completedResponse
  });
  return completedResponse;
}

async function relayGeminiResponsesStream(upstreamResponse, res, fallbackModel = '') {
  setSseHeaders(res);
  const state = createGeminiResponsesStreamState(fallbackModel);
  const stream = createDecodedStream(upstreamResponse);

  return new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;

    const safeResolve = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const safeReject = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const processSseBlock = (block) => {
      if (!block || !block.trim()) return;
      const dataLines = block
        .split('\n')
        .map(line => line.trimEnd())
        .filter(line => line.trim().startsWith('data:'))
        .map(line => line.replace(/^data:\s?/, ''));
      if (dataLines.length === 0) return;
      const payload = dataLines.join('\n').trim();
      if (!payload) return;

      if (payload === '[DONE]') {
        finalizeGeminiResponsesStream(state, res);
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return;
      }

      if (Array.isArray(parsed)) {
        parsed.forEach(item => processGeminiResponsesSseEvent(item, state, res));
        return;
      }
      processGeminiResponsesSseEvent(parsed, state, res);
    };

    stream.on('data', (chunk) => {
      buffer += chunk.toString('utf8').replace(/\r\n/g, '\n');
      let separatorIndex = buffer.indexOf('\n\n');
      while (separatorIndex >= 0) {
        const block = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        processSseBlock(block);
        separatorIndex = buffer.indexOf('\n\n');
      }
    });

    stream.on('end', () => {
      if (buffer.trim()) {
        processSseBlock(buffer);
      }

      if (!state.completed) {
        finalizeGeminiResponsesStream(state, res);
      }

      if (!res.writableEnded) {
        writeSseDone(res);
        res.end();
      }

      safeResolve(state.completedResponse || buildCompletedResponsesObjectFromGeminiStreamState(state));
    });

    stream.on('error', (error) => {
      if (!res.writableEnded) {
        writeSseData(res, {
          type: 'error',
          error: {
            message: `Gemini stream decode error: ${error.message || String(error)}`
          }
        });
        writeSseDone(res);
        res.end();
      }
      safeReject(error);
    });

    upstreamResponse.on('error', (error) => {
      if (!res.writableEnded) {
        writeSseData(res, {
          type: 'error',
          error: {
            message: `Gemini stream upstream error: ${error.message || String(error)}`
          }
        });
        writeSseDone(res);
        res.end();
      }
      safeReject(error);
    });
  });
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
  const streamResponses = wantsStream && isResponsesPath(pathname);
  const converted = convertOpenCodePayloadToGemini(pathname, originalPayload, channel.model);
  const targetModel = converted.model;
  const useGeminiCli = shouldUseGeminiCliFormat(channel.baseUrl);

  if (!targetModel) {
    sendOpenAiStyleError(res, 400, 'Missing model in request and channel configuration');
    return true;
  }

  const targetUrl = buildGeminiTargetUrl(channel.baseUrl, targetModel, effectiveKey, {
    stream: streamResponses,
    useCli: useGeminiCli
  });
  if (!targetUrl) {
    sendOpenAiStyleError(res, 400, 'Failed to build Gemini target URL');
    return true;
  }

  const geminiPayload = useGeminiCli
    ? {
      project: '',
      model: targetModel,
      request: converted.requestBody
    }
    : converted.requestBody;

  const headers = useGeminiCli
    ? {
      'x-goog-api-key': effectiveKey,
      'authorization': `Bearer ${effectiveKey}`,
      'content-type': 'application/json',
      'accept': streamResponses ? 'text/event-stream' : 'application/json',
      'accept-encoding': 'gzip, deflate, br',
      'user-agent': GEMINI_CLI_USER_AGENT,
      'x-goog-api-client': GEMINI_CLI_API_CLIENT,
      'client-metadata': GEMINI_CLI_CLIENT_METADATA
    }
    : {
      'x-goog-api-key': effectiveKey,
      'authorization': `Bearer ${effectiveKey}`,
      'content-type': 'application/json',
      'accept': streamResponses ? 'text/event-stream' : 'application/json',
      'accept-encoding': 'gzip, deflate, br',
      'user-agent': 'google-genai-sdk/0.8.0'
    };

  if (streamResponses) {
    let streamUpstream;
    try {
      streamUpstream = await postJsonStream(targetUrl, headers, geminiPayload, 120000);
    } catch (error) {
      recordFailure(channel.id, 'opencode', error);
      sendOpenAiStyleError(res, 502, `Gemini gateway network error: ${error.message}`, 'proxy_error');
      return true;
    }

    const statusCode = Number(streamUpstream.statusCode) || 500;
    if (statusCode < 200 || statusCode >= 300) {
      let rawBody = '';
      try {
        rawBody = await collectHttpResponseBody(streamUpstream.response);
      } catch {
        rawBody = '';
      }

      let parsedError = null;
      try {
        parsedError = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        parsedError = null;
      }
      const upstreamMessage = parsedError?.error?.message || parsedError?.message || rawBody || `HTTP ${statusCode}`;
      recordFailure(channel.id, 'opencode', new Error(String(upstreamMessage).slice(0, 200)));
      sendOpenAiStyleError(res, statusCode, String(upstreamMessage).slice(0, 1000), 'upstream_error');
      return true;
    }

    try {
      const streamedResponseObject = await relayGeminiResponsesStream(streamUpstream.response, res, originalPayload.model || targetModel);
      publishOpenCodeUsageLog({
        requestId,
        channel,
        model: streamedResponseObject?.model || originalPayload.model || targetModel || '',
        usage: streamedResponseObject?.usage || {},
        startTime
      });
      recordSuccess(channel.id, 'opencode');
    } catch (error) {
      recordFailure(channel.id, 'opencode', error);
      if (!res.headersSent) {
        sendOpenAiStyleError(res, 502, `Gemini stream relay error: ${error.message}`, 'proxy_error');
      }
    }
    return true;
  }

  let upstream;
  try {
    upstream = await postJson(targetUrl, headers, geminiPayload, 120000);
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
    res.json(responseObject);
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
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    models.push(trimmed);
  };

  const forceRefresh = options.forceRefresh === true;
  const useCacheOnly = options.useCacheOnly === true;
  // 模型列表聚合改为串行探测，避免并发触发上游会话窗口限流
  for (const channel of channels) {
    if (isConverterEntryChannel(channel)) {
      const defaults = getDefaultModelsByGatewaySourceType(normalizeGatewaySourceType(channel));
      defaults.forEach(add);
      continue;
    }

    if (useCacheOnly) {
      const cacheEntry = getCachedModelInfo(channel?.id);
      const cachedFetched = Array.isArray(cacheEntry?.fetchedModels) ? cacheEntry.fetchedModels : [];
      const cachedAvailable = Array.isArray(cacheEntry?.availableModels) ? cacheEntry.availableModels : [];
      cachedFetched.forEach(add);
      cachedAvailable.forEach(add);
      continue;
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      const listResult = await fetchModelsFromProvider(channel, 'openai_compatible', { forceRefresh });
      const listedModels = Array.isArray(listResult?.models) ? listResult.models : [];
      if (listedModels.length > 0) {
        listedModels.forEach(add);
      }
    } catch (err) {
      console.warn(`[OpenCode Proxy] Build model list failed for ${channel?.name || channel?.id || 'unknown'}:`, err.message);
    }
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
      // 禁止上游返回压缩响应，避免在 proxyRes 监听器中出现双消费者竞争
      proxyReq.removeHeader('accept-encoding');

      if (shouldParseJson(req) && (req.rawBody || req.body)) {
        let body = req.body;
        // 对 Chat Completions 流式请求注入 stream_options.include_usage = true
        // OpenCode 使用 @ai-sdk/openai-compatible，该 SDK 不一定发送此字段
        // 缺少此字段时，大多数 OpenAI 兼容端点不会在响应中附带 usage，
        // 导致 OpenCode Context 面板所有 token 显示为 0
        if (body && body.stream === true && !body.stream_options?.include_usage) {
          body = { ...body, stream_options: { ...body.stream_options, include_usage: true } };
        }
        const bodyBuffer = body !== req.body
          ? Buffer.from(JSON.stringify(body))
          : req.rawBody
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
        const models = await collectProxyModelList(channels, { forceRefresh: false });
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
        if (gatewaySourceType === 'codex') {
          const handled = await handleCodexGatewayRequest(req, res, channel, effectiveKey);
          if (handled) {
            return;
          }
        }
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
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        model: '',
        _parseErrorLogged: false
      };

      const decodedStream = createDecodedStream(proxyRes);

      decodedStream.on('data', (chunk) => {
        // 如果响应已关闭，停止处理
        if (isResponseClosed) {
          return;
        }

        buffer += chunk.toString('utf8');

        // 检查是否是 SSE 流
        if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
          // 处理 SSE 事件
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';

          events.forEach((eventText) => {
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
                if (parsed.response.model) {
                  tokenData.model = parsed.response.model;
                }

                if (parsed.response.usage) {
                  tokenData.inputTokens = parsed.response.usage.input_tokens || 0;
                  tokenData.outputTokens = parsed.response.usage.output_tokens || 0;
                  tokenData.totalTokens = parsed.response.usage.total_tokens || 0;

                  if (parsed.response.usage.input_tokens_details) {
                    tokenData.cachedTokens = parsed.response.usage.input_tokens_details.cached_tokens || 0;
                  }
                  if (parsed.response.usage.output_tokens_details) {
                    tokenData.reasoningTokens = parsed.response.usage.output_tokens_details.reasoning_tokens || 0;
                  }
                }
              }

              // Anthropic SSE: message_start 含初始 usage 和模型
              if (parsed.type === 'message_start' && parsed.message) {
                if (parsed.message.model) {
                  tokenData.model = parsed.message.model;
                }
                if (parsed.message.usage) {
                  const u = parsed.message.usage;
                  if (Number.isFinite(Number(u.input_tokens))) {
                    tokenData.inputTokens = Number(u.input_tokens);
                  }
                  if (Number.isFinite(Number(u.output_tokens))) {
                    tokenData.outputTokens = Number(u.output_tokens);
                  }
                  const cacheCreation = Number(u.cache_creation_input_tokens || 0);
                  const cacheRead = Number(u.cache_read_input_tokens || 0);
                  if (cacheCreation + cacheRead > 0) {
                    tokenData.cacheCreationTokens = cacheCreation;
                    tokenData.cacheReadTokens = cacheRead;
                    tokenData.cachedTokens = cacheCreation + cacheRead;
                  }
                }
              }

              // Anthropic SSE: message_delta 含最终 output_tokens
              if (parsed.type === 'message_delta' && parsed.usage) {
                const u = parsed.usage;
                if (Number.isFinite(Number(u.output_tokens))) {
                  tokenData.outputTokens = Number(u.output_tokens);
                }
                const cacheCreation = Number(u.cache_creation_input_tokens || 0);
                const cacheRead = Number(u.cache_read_input_tokens || 0);
                if (cacheCreation + cacheRead > 0) {
                  tokenData.cacheCreationTokens = cacheCreation;
                  tokenData.cacheReadTokens = cacheRead;
                  tokenData.cachedTokens = cacheCreation + cacheRead;
                }
              }

              // 兼容其他格式：直接在顶层的 model 和 usage
              if (parsed.model && !tokenData.model) {
                tokenData.model = parsed.model;
              }

              if (parsed.usage && tokenData.inputTokens === 0) {
                tokenData.inputTokens = parsed.usage.input_tokens || parsed.usage.prompt_tokens || 0;
                tokenData.outputTokens = parsed.usage.output_tokens || parsed.usage.completion_tokens || 0;
                const cacheCreation = Number(parsed.usage.cache_creation_input_tokens || 0);
                const cacheRead = Number(parsed.usage.cache_read_input_tokens || 0);
                if (cacheCreation + cacheRead > 0) {
                  tokenData.cacheCreationTokens = cacheCreation;
                  tokenData.cacheReadTokens = cacheRead;
                  tokenData.cachedTokens = cacheCreation + cacheRead;
                }
              }

              // Gemini SSE: usageMetadata
              if (parsed.usageMetadata) {
                const u = parsed.usageMetadata;
                tokenData.inputTokens = Number(u.promptTokenCount || 0);
                tokenData.outputTokens = Number(u.candidatesTokenCount || 0);
                tokenData.cachedTokens = Number(u.cachedContentTokenCount || 0);
                tokenData.totalTokens = Number(u.totalTokenCount || 0);
              }
            } catch (err) {
              if (!tokenData._parseErrorLogged) {
                tokenData._parseErrorLogged = true;
                const snippet = typeof data === 'string' ? data.slice(0, 100) : '';
                console.warn(`[OpenCode Passthrough] SSE parse error (channel: ${metadata?.channel}): ${err.message}, data: ${snippet}`);
              }
            }
          });
        }
      });

      decodedStream.on('end', () => {
        // 如果不是流式响应，尝试从完整响应中解析
        if (!proxyRes.headers['content-type']?.includes('text/event-stream')) {
          try {
            const parsed = JSON.parse(buffer);
            if (parsed.model) {
              tokenData.model = parsed.model;
            }
            if (parsed.usage) {
              tokenData.inputTokens = parsed.usage.input_tokens || parsed.usage.prompt_tokens || 0;
              tokenData.outputTokens = parsed.usage.output_tokens || parsed.usage.completion_tokens || 0;
              const cacheCreation = Number(parsed.usage.cache_creation_input_tokens || 0);
              const cacheRead = Number(parsed.usage.cache_read_input_tokens || 0);
              if (cacheCreation + cacheRead > 0) {
                tokenData.cacheCreationTokens = cacheCreation;
                tokenData.cacheReadTokens = cacheRead;
                tokenData.cachedTokens = cacheCreation + cacheRead;
              }
            }
          } catch (err) {
            if (!tokenData._parseErrorLogged) {
              tokenData._parseErrorLogged = true;
              console.warn(`[OpenCode Passthrough] Non-SSE response parse error (channel: ${metadata?.channel}): ${err.message}`);
            }
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
            cacheCreation: tokenData.cacheCreationTokens,
            cacheRead: tokenData.cacheReadTokens,
            total: tokenData.totalTokens || (tokenData.inputTokens + tokenData.outputTokens)
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

      decodedStream.on('error', (err) => {
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
  clearOpenCodeRedirectCache,
  collectProxyModelList
};
