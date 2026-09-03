const express = require('express');
const httpProxy = require('http-proxy');
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const chalk = require('chalk');
const { broadcastLog, broadcastSchedulerState } = require('../../../server/websocket-server');
const { allocateChannel, releaseChannel, getSchedulerState } = require('../../../server/services/channel-scheduler');
const { recordSuccess, recordFailure } = require('../../../server/services/channel-health');
const { loadConfig } = require('../../../config/loader');
const DEFAULT_CONFIG = require('../../../config/default');
const { PATHS, ensureStorageDirMigrated } = require('../../../config/paths');
const { resolveModelPricing, calculateTokenCost } = require('../../../server/utils/pricing');
const { recordRequest: recordOpenCodeRequest } = require('./statistics-implementation');
const { saveProxyStartTime, clearProxyStartTime, getProxyStartTime, getProxyRuntime } = require('../../../server/services/proxy-runtime');
const { getEnabledChannels, getEffectiveApiKey } = require('./channels-implementation');
const { persistProxyRequestSnapshot, loadClaudeRequestTemplate } = require('../../../server/services/request-logger');
const { probeModelAvailability, fetchModelsFromProvider } = require('../../../server/services/model-detector');
const { publishUsageLog, publishFailureLog } = require('../../../server/services/proxy-log-helper');
const {
  redirectModel,
  resolveTargetUrl,
  ensureOpenAiStreamUsage
} = require('../../../shared/proxy-utils');
const { attachServerShutdownHandling, expediteServerShutdown } = require('../../../server/services/server-shutdown');
const { buildCodexTargetUrl, createCodexRequest } = require('../codex/wire');
const {
  parseSSEUsage,
  parseNonStreamingUsage,
  mergeUsageIntoTokenData,
  createTokenData
} = require('../../../shared/response-usage-parser');
const { createClaudeRequest, buildClaudeTargetUrl, buildClaudeCountTokensTargetUrl, buildClaudeCountTokensHeaders } = require('../claude/wire');
const { createGeminiRequest, buildGeminiTargetUrl, shouldUseGeminiCliFormat } = require('../gemini/wire');

let proxyServer = null;
let proxyApp = null;
let currentPort = null;

// 用于存储每个请求的元数据
const requestMetadata = new Map();

// 用于缓存已打印过的模型重定向规则，避免重复打印
// 格式: { channelId: { "originalModel": "redirectedModel", ... } }
const printedRedirectCache = new Map();

// OpenAI/Claude pricing is sourced from config/model-metadata.js
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
const CLAUDE_SESSION_USER_ID_TTL_MS = 60 * 60 * 1000;
const CLAUDE_SESSION_USER_ID_CACHE_MAX = 2000;
const claudeSessionUserIdCache = new Map();
const CLAUDE_USER_ID_ACCOUNT_RE = /^user_([0-9a-f]{64})_account__session_[a-z0-9._-]+$/i;
const CLAUDE_USER_ID_FULL_RE = /^user_[0-9a-f]{64}_account__session_[a-z0-9._-]+$/i;
let cachedClaudeAccountId = '';
let cachedClaudeUserId = '';

// detectModelTier, redirectModel, resolveTargetUrl imported from shared/proxy-utils
const resolveOpenCodeTarget = resolveTargetUrl;

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
  return calculateTokenCost(pricing, tokens, OPENCODE_BASE_PRICING);
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

function resolveClaudeAccountIdFromUserId(userId = '') {
  const value = normalizeSessionKeyValue(userId);
  if (!value) return '';
  const matched = value.match(CLAUDE_USER_ID_ACCOUNT_RE);
  return matched ? matched[1].toLowerCase() : '';
}

function resolveClaudeAccountIdFromLogs() {
  try {
    const template = loadClaudeRequestTemplate();
    const userId = normalizeSessionKeyValue(template?.userId || '');
    const accountId = resolveClaudeAccountIdFromUserId(userId);
    return (accountId && accountId !== '0'.repeat(64)) ? accountId : '';
  } catch {
    return '';
  }
}

function resolveClaudeUserIdFromLogs() {
  try {
    const template = loadClaudeRequestTemplate();
    const userId = normalizeSessionKeyValue(template?.userId || '');
    if (!CLAUDE_USER_ID_FULL_RE.test(userId)) return '';
    const accountId = resolveClaudeAccountIdFromUserId(userId);
    if (!accountId || accountId === '0'.repeat(64)) return '';
    return userId;
  } catch {
    return '';
  }
}

function resolveClaudePreferredUserId() {
  if (cachedClaudeUserId) {
    return cachedClaudeUserId;
  }

  const envUserId = normalizeSessionKeyValue(
    process.env.OPENCODE_CLAUDE_USER_ID || process.env.CLAUDE_CODE_USER_ID
  );
  if (CLAUDE_USER_ID_FULL_RE.test(envUserId)) {
    cachedClaudeUserId = envUserId;
    return cachedClaudeUserId;
  }

  const requestTemplate = loadClaudeRequestTemplate();
  if (requestTemplate && CLAUDE_USER_ID_FULL_RE.test(requestTemplate.userId || '')) {
    cachedClaudeUserId = requestTemplate.userId;
    return cachedClaudeUserId;
  }

  const fromLogs = resolveClaudeUserIdFromLogs();
  if (fromLogs) {
    cachedClaudeUserId = fromLogs;
    return cachedClaudeUserId;
  }

  return '';
}

function resolveClaudeAccountId() {
  if (cachedClaudeAccountId) {
    return cachedClaudeAccountId;
  }

  const envAccountId = normalizeSessionKeyValue(
    process.env.OPENCODE_CLAUDE_ACCOUNT_ID || process.env.CLAUDE_CODE_ACCOUNT_ID
  ).toLowerCase();

  if (/^[0-9a-f]{64}$/.test(envAccountId)) {
    cachedClaudeAccountId = envAccountId;
    return cachedClaudeAccountId;
  }

  const fromLogs = resolveClaudeAccountIdFromLogs();
  if (fromLogs) {
    cachedClaudeAccountId = fromLogs;
    return cachedClaudeAccountId;
  }

  cachedClaudeAccountId = '0'.repeat(64);
  return cachedClaudeAccountId;
}

function buildClaudeSessionId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
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

function collectPreferredProbeModels(channel) {
  const candidates = [];
  if (!channel || typeof channel !== 'object') return candidates;

  candidates.push(channel.model);
  candidates.push(channel.speedTestModel);

  const modelConfig = channel.modelConfig;
  if (modelConfig && typeof modelConfig === 'object') {
    candidates.push(modelConfig.model);
    candidates.push(modelConfig.opusModel);
    candidates.push(modelConfig.sonnetModel);
    candidates.push(modelConfig.haikuModel);
  }

  if (Array.isArray(channel.modelRedirects)) {
    channel.modelRedirects.forEach((rule) => {
      candidates.push(rule?.from);
      candidates.push(rule?.to);
    });
  }

  const seen = new Set();
  const models = [];
  candidates.forEach((model) => {
    if (typeof model !== 'string') return;
    const trimmed = model.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    models.push(trimmed);
  });
  return models;
}

function isConverterPresetChannel(channel) {
  const presetId = String(channel?.presetId || '').trim().toLowerCase();
  return presetId === 'entry_claude' || presetId === 'entry_codex' || presetId === 'entry_gemini';
}


function generateToolCallId() {
  return `toolu_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}



function buildClaudeCodeUserId(sessionIdSeed = '') {
  const preferredUserId = resolveClaudePreferredUserId();
  if (preferredUserId && !normalizeSessionKeyValue(sessionIdSeed)) {
    return preferredUserId;
  }
  const sessionId = normalizeSessionKeyValue(sessionIdSeed) || buildClaudeSessionId();
  const accountId = resolveClaudeAccountId();
  return `user_${accountId}_account__session_${sessionId}`;
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

function buildClaudeCountTokensPayload(claudePayload = {}) {
  const payload = {
    model: claudePayload.model,
    messages: Array.isArray(claudePayload.messages) ? claudePayload.messages : []
  };

  if (Array.isArray(claudePayload.system) && claudePayload.system.length > 0) {
    payload.system = claudePayload.system;
  }
  if (Array.isArray(claudePayload.tools) && claudePayload.tools.length > 0) {
    payload.tools = claudePayload.tools;
  }
  if (claudePayload.tool_choice && typeof claudePayload.tool_choice === 'object') {
    payload.tool_choice = claudePayload.tool_choice;
  }
  if (claudePayload.metadata && typeof claudePayload.metadata === 'object') {
    payload.metadata = claudePayload.metadata;
  }

  return payload;
}

async function preflightClaudeCountTokens(baseUrl, apiKey, claudePayload, options = {}) {
  const countTokensPayload = buildClaudeCountTokensPayload(claudePayload);
  const countTokensHeaders = buildClaudeCountTokensHeaders(apiKey, {
    baseUrl,
    hasTools: !!options.hasTools,
    headers: options.headers,
    providerConfig: options.providerConfig
  });
  try {
    await postJson(buildClaudeCountTokensTargetUrl(baseUrl), countTokensHeaders, countTokensPayload, 30000);
  } catch {
    // best-effort preflight, ignore failures
  }
}

function extractClaudeResponseContent(claudeResponse = {}) {
  const textFragments = [];
  const functionCalls = [];
  const reasoningItems = [];

  if (!Array.isArray(claudeResponse.content)) {
    return { text: '', functionCalls: [], reasoningItems: [] };
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
  const inputTokens = Number(claudeResponse?.usage?.input_tokens || 0);
  const outputTokens = Number(claudeResponse?.usage?.output_tokens || 0);
  const totalTokens = Number(claudeResponse?.usage?.total_tokens || (inputTokens + outputTokens));
  const cacheCreationTokens = Number(claudeResponse?.usage?.cache_creation_input_tokens || 0);
  const cacheReadTokens = Number(claudeResponse?.usage?.cache_read_input_tokens || 0);
  const cachedTokens = cacheReadTokens;
  const parsedContent = extractClaudeResponseContent(claudeResponse);
  const text = parsedContent.text;
  const reasoningTokens = parsedContent.reasoningItems.reduce((acc, item) => acc + Math.floor((item.text || '').length / 4), 0);
  const model = claudeResponse.model || fallbackModel || '';
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
      total_tokens: totalTokens,
      ...(cachedTokens > 0 ? { input_tokens_details: { cached_tokens: cachedTokens } } : {}),
      ...(cacheCreationTokens > 0 ? { cache_creation_input_tokens: cacheCreationTokens } : {}),
      ...(reasoningTokens > 0 ? { output_tokens_details: { reasoning_tokens: reasoningTokens } } : {})
    }
  };
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
  const usage = extractGeminiUsage(geminiResponse);
  const parsedContent = extractGeminiResponseContent(geminiResponse);
  const text = parsedContent.text;
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
      total_tokens: usage.totalTokens
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

function reportOpenCodeGatewayFailure({
  req,
  res,
  channel,
  statusCode,
  message,
  type = 'invalid_request_error',
  error = null,
  stage = 'gateway',
  model = ''
}) {
  if (channel?.id && error) {
    recordFailure(channel.id, 'opencode', error);
  }

  publishFailureLog({
    source: 'opencode',
    metadata: (req && requestMetadata.get(req)) || {
      channel: channel?.name,
      channelId: channel?.id,
      model: model || req?.body?.model
    },
    channel: channel?.name,
    model: model || req?.body?.model || '',
    message,
    error,
    statusCode,
    stage,
    broadcastLog
  });

  if (!res.headersSent) {
    sendOpenAiStyleError(res, statusCode, message, type);
  }
  return true;
}

function publishOpenCodeUsageLog({ requestId, channel, model, usage, startTime }) {
  const parsedUsage = parseNonStreamingUsage({
    model: model || '',
    usage: usage && typeof usage === 'object' ? usage : {}
  });
  const parsedTokens = parsedUsage.tokens || {};

  return publishUsageLog({
    source: 'opencode',
    metadata: {
      id: requestId,
      channel: channel?.name,
      channelId: channel?.id,
      startTime
    },
    model: parsedUsage.model || model || '',
    tokens: {
      input: Number(parsedTokens.input || 0),
      output: Number(parsedTokens.output || 0),
      cacheCreation: Number(parsedTokens.cacheCreation || 0),
      cacheRead: Number(parsedTokens.cacheRead || 0),
      cached: Number(parsedTokens.cached || 0),
      reasoning: Number(parsedTokens.reasoning || 0),
      total: Number(parsedTokens.total || 0)
    },
    calculateCost,
    broadcastLog,
    recordRequest: recordOpenCodeRequest
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

function sendChatCompletionsSse(res, responseObject) {
  const message = responseObject?.choices?.[0]?.message || {};
  const text = message?.content || '';
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  const streamedToolCalls = toolCalls.map((toolCall, index) => {
    const numericIndex = Number(toolCall?.index);
    const normalizedIndex = Number.isFinite(numericIndex) ? numericIndex : index;

    if (toolCall && typeof toolCall === 'object' && !Array.isArray(toolCall)) {
      return { ...toolCall, index: normalizedIndex };
    }

    return { index: normalizedIndex };
  });
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
          ...(streamedToolCalls.length > 0 ? { tool_calls: streamedToolCalls } : {})
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

  if (state.usageSeen || totalTokens > 0 || reasoningTokens > 0) {
    response.usage = {
      input_tokens: Number(state.inputTokens || 0),
      output_tokens: Number(state.outputTokens || 0),
      total_tokens: totalTokens
    };
    if (reasoningTokens > 0) {
      response.usage.output_tokens_details = { reasoning_tokens: reasoningTokens };
    }
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
    if (Number.isFinite(Number(usage.input_tokens))) {
      state.inputTokens = Number(usage.input_tokens);
      state.usageSeen = true;
    }
    if (Number.isFinite(Number(usage.output_tokens))) {
      state.outputTokens = Number(usage.output_tokens);
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

async function handleClaudeGatewayRequest(req, res, channel, effectiveKey) {
  const pathname = getRequestPathname(req.url);
  if (!isResponsesPath(pathname) && !isChatCompletionsPath(pathname)) {
    return false;
  }

  if (!shouldParseJson(req)) {
    return reportOpenCodeGatewayFailure({
      req,
      res,
      channel,
      statusCode: 400,
      message: 'Claude gateway only supports JSON POST payload',
      stage: 'validate_request'
    });
  }

  const requestId = `opencode-${Date.now()}-${Math.random()}`;
  const startTime = Date.now();
  const originalPayload = (req.body && typeof req.body === 'object') ? req.body : {};
  const wantsStream = !!originalPayload.stream;
  const streamResponses = wantsStream && isResponsesPath(pathname);
  const sessionKey = extractSessionIdFromRequest(req, originalPayload);
  const sessionScope = normalizeSessionKeyValue(channel?.id || channel?.name || '');
  const scopedSessionKey = sessionKey && sessionScope
    ? `${sessionScope}::${sessionKey}`
    : sessionKey;
  const preferredUserId = normalizeSessionKeyValue(originalPayload?.metadata?.user_id);
  const sessionUserId = resolveClaudeUserIdBySession(scopedSessionKey, preferredUserId);
  const converted = createClaudeRequest(pathname, originalPayload, {
    apiKey: effectiveKey,
    baseUrl: channel.baseUrl,
    fallbackModel: channel.model,
    stream: streamResponses,
    sessionUserId,
    providerConfig: channel.providerConfig
  });
  const claudePayload = converted.body;
  const headers = converted.headers;
  const hasTools = Array.isArray(claudePayload.tools) && claudePayload.tools.length > 0;

  await preflightClaudeCountTokens(channel.baseUrl, effectiveKey, claudePayload, {
    hasTools,
    headers: channel.providerConfig?.headers,
    providerConfig: channel.providerConfig
  });

  if (streamResponses) {
    let streamUpstream;
    try {
      streamUpstream = await postJsonStream(buildClaudeTargetUrl(channel.baseUrl), headers, claudePayload, 120000);
    } catch (error) {
      return reportOpenCodeGatewayFailure({
        req,
        res,
        channel,
        statusCode: 502,
        message: `Claude gateway network error: ${error.message}`,
        type: 'proxy_error',
        error,
        stage: 'claude_gateway_network'
      });
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
      return reportOpenCodeGatewayFailure({
        req,
        res,
        channel,
        statusCode,
        message: String(upstreamMessage).slice(0, 1000),
        type: 'upstream_error',
        error: new Error(String(upstreamMessage).slice(0, 200)),
        stage: 'claude_gateway_upstream'
      });
    }

    try {
      const streamedResponseObject = await relayClaudeResponsesStream(streamUpstream.response, res, originalPayload.model || '');
      publishOpenCodeUsageLog({
        requestId,
        channel,
        model: streamedResponseObject?.model || originalPayload.model || '',
        usage: streamedResponseObject?.usage || {},
        startTime
      });
      recordSuccess(channel.id, 'opencode');
    } catch (error) {
      reportOpenCodeGatewayFailure({
        req,
        res,
        channel,
        statusCode: 502,
        message: `Claude stream relay error: ${error.message}`,
        type: 'proxy_error',
        error,
        stage: 'claude_stream_relay'
      });
    }
    return true;
  }

  let upstream;
  try {
    upstream = await postJson(buildClaudeTargetUrl(channel.baseUrl), headers, claudePayload, 120000);
  } catch (error) {
    return reportOpenCodeGatewayFailure({
      req,
      res,
      channel,
      statusCode: 502,
      message: `Claude gateway network error: ${error.message}`,
      type: 'proxy_error',
      error,
      stage: 'claude_gateway_network'
    });
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
    return reportOpenCodeGatewayFailure({
      req,
      res,
      channel,
      statusCode,
      message: String(upstreamMessage).slice(0, 1000),
      type: 'upstream_error',
      error: new Error(String(upstreamMessage).slice(0, 200)),
      stage: 'claude_gateway_upstream'
    });
  }

  if (!parsedBody || typeof parsedBody !== 'object') {
    return reportOpenCodeGatewayFailure({
      req,
      res,
      channel,
      statusCode: 502,
      message: 'Invalid Claude gateway response',
      type: 'proxy_error',
      error: new Error('Invalid Claude gateway response'),
      stage: 'claude_gateway_parse'
    });
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
  const loggingUsage = buildOpenAiResponsesObject(parsedBody, originalPayload.model).usage;
  if (wantsStream) {
    sendChatCompletionsSse(res, chatResponseObject);
  } else {
    res.json(chatResponseObject);
  }
  publishOpenCodeUsageLog({
    requestId,
    channel,
    model: chatResponseObject.model,
    usage: loggingUsage,
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
    return reportOpenCodeGatewayFailure({
      req,
      res,
      channel,
      statusCode: 400,
      message: 'Codex gateway only supports JSON POST payload',
      stage: 'validate_request'
    });
  }

  const requestId = `opencode-${Date.now()}-${Math.random()}`;
  const startTime = Date.now();
  const originalPayload = (req.body && typeof req.body === 'object') ? req.body : {};
  const wantsStream = !!originalPayload.stream;
  const sessionId = extractSessionIdFromRequest(req, originalPayload);
  const converted = createCodexRequest(originalPayload, {
    apiKey: effectiveKey,
    fallbackModel: channel.model,
    sessionId
  });
  const targetModel = converted.model;

  if (!targetModel) {
    return reportOpenCodeGatewayFailure({
      req,
      res,
      channel,
      statusCode: 400,
      message: 'Missing model in request and channel configuration',
      stage: 'resolve_model'
    });
  }

  const targetUrl = buildCodexTargetUrl(channel.baseUrl);
  if (!targetUrl) {
    return reportOpenCodeGatewayFailure({
      req,
      res,
      channel,
      statusCode: 400,
      message: 'Failed to build Codex target URL',
      stage: 'build_target_url'
    });
  }

  let streamUpstream;
  try {
    streamUpstream = await postJsonStream(targetUrl, converted.headers, converted.body, 120000);
  } catch (error) {
    return reportOpenCodeGatewayFailure({
      req,
      res,
      channel,
      statusCode: 502,
      message: `Codex gateway network error: ${error.message}`,
      type: 'proxy_error',
      error,
      stage: 'codex_gateway_network'
    });
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
    return reportOpenCodeGatewayFailure({
      req,
      res,
      channel,
      statusCode,
      message: String(upstreamMessage).slice(0, 1000),
      type: 'upstream_error',
      error: new Error(String(upstreamMessage).slice(0, 200)),
      stage: 'codex_gateway_upstream'
    });
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
      return reportOpenCodeGatewayFailure({
        req,
        res,
        channel,
        statusCode: 502,
        message: 'Invalid Codex gateway response',
        type: 'proxy_error',
        error: new Error('Invalid Codex gateway response'),
        stage: 'codex_gateway_parse'
      });
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
    reportOpenCodeGatewayFailure({
      req,
      res,
      channel,
      statusCode: 502,
      message: `Codex stream relay error: ${error.message}`,
      type: 'proxy_error',
      error,
      stage: 'codex_stream_relay'
    });
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
    return reportOpenCodeGatewayFailure({
      req,
      res,
      channel,
      statusCode: 400,
      message: 'Gemini gateway only supports JSON POST payload',
      stage: 'validate_request'
    });
  }

  const requestId = `opencode-${Date.now()}-${Math.random()}`;
  const startTime = Date.now();
  const originalPayload = (req.body && typeof req.body === 'object') ? req.body : {};
  const wantsStream = !!originalPayload.stream;
  const streamResponses = wantsStream && isResponsesPath(pathname);
  // Resolve useCli by canonical providerApi precedence:
  // explicit google-gemini-cli → true; google-generative-ai/google-vertex → false;
  // missing/non-canonical → URL-based detection
  const explicitApi = String(channel?.providerApi || '').trim().toLowerCase();
  const useGeminiCli = explicitApi === 'google-gemini-cli'
    ? true
    : (explicitApi === 'google-generative-ai' || explicitApi === 'google-vertex'
      ? false
      : shouldUseGeminiCliFormat(channel.baseUrl));

  const converted = createGeminiRequest(pathname, originalPayload, {
    apiKey: effectiveKey,
    fallbackModel: channel.model,
    stream: streamResponses,
    useCli: useGeminiCli,
    providerConfig: channel.providerConfig
  });
  const targetModel = converted.model;
  const geminiPayload = converted.body;
  const headers = converted.headers;

  if (!targetModel) {
    return reportOpenCodeGatewayFailure({
      req,
      res,
      channel,
      statusCode: 400,
      message: 'Missing model in request and channel configuration',
      stage: 'resolve_model'
    });
  }

  const targetUrl = buildGeminiTargetUrl(channel.baseUrl, targetModel, effectiveKey, {
    stream: streamResponses,
    useCli: useGeminiCli
  });
  if (!targetUrl) {
    return reportOpenCodeGatewayFailure({
      req,
      res,
      channel,
      statusCode: 400,
      message: 'Failed to build Gemini target URL',
      stage: 'build_target_url'
    });
  }

  if (streamResponses) {
    let streamUpstream;
    try {
      streamUpstream = await postJsonStream(targetUrl, headers, geminiPayload, 120000);
    } catch (error) {
      return reportOpenCodeGatewayFailure({
        req,
        res,
        channel,
        statusCode: 502,
        message: `Gemini gateway network error: ${error.message}`,
        type: 'proxy_error',
        error,
        stage: 'gemini_gateway_network'
      });
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
      return reportOpenCodeGatewayFailure({
        req,
        res,
        channel,
        statusCode,
        message: String(upstreamMessage).slice(0, 1000),
        type: 'upstream_error',
        error: new Error(String(upstreamMessage).slice(0, 200)),
        stage: 'gemini_gateway_upstream'
      });
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
      reportOpenCodeGatewayFailure({
        req,
        res,
        channel,
        statusCode: 502,
        message: `Gemini stream relay error: ${error.message}`,
        type: 'proxy_error',
        error,
        stage: 'gemini_stream_relay'
      });
    }
    return true;
  }

  let upstream;
  try {
    upstream = await postJson(targetUrl, headers, geminiPayload, 120000);
  } catch (error) {
    return reportOpenCodeGatewayFailure({
      req,
      res,
      channel,
      statusCode: 502,
      message: `Gemini gateway network error: ${error.message}`,
      type: 'proxy_error',
      error,
      stage: 'gemini_gateway_network'
    });
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
    return reportOpenCodeGatewayFailure({
      req,
      res,
      channel,
      statusCode,
      message: String(upstreamMessage).slice(0, 1000),
      type: 'upstream_error',
      error: new Error(String(upstreamMessage).slice(0, 200)),
      stage: 'gemini_gateway_upstream'
    });
  }

  if (!parsedBody || typeof parsedBody !== 'object') {
    return reportOpenCodeGatewayFailure({
      req,
      res,
      channel,
      statusCode: 502,
      message: 'Invalid Gemini gateway response',
      type: 'proxy_error',
      error: new Error('Invalid Gemini gateway response'),
      stage: 'gemini_gateway_parse'
    });
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
  const loggingUsage = buildOpenAiResponsesObjectFromGemini(parsedBody, targetModel).usage;
  if (wantsStream) {
    sendChatCompletionsSse(res, chatResponseObject);
  } else {
    res.json(chatResponseObject);
  }
  publishOpenCodeUsageLog({
    requestId,
    channel,
    model: chatResponseObject.model,
    usage: loggingUsage,
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
  // 模型列表聚合改为串行探测，避免并发触发上游会话窗口限流
  for (const channel of channels) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const listResult = await fetchModelsFromProvider(channel, 'openai_compatible', { forceRefresh });
      const listedModels = Array.isArray(listResult?.models) ? listResult.models : [];
      if (listedModels.length > 0) {
        listedModels.forEach(add);
        continue;
      }

      const shouldProbeByDefault = !!listResult?.disabledByConfig;

      // 默认仅入口转换器渠道执行模型探测；若已禁用 /v1/models 则对全部渠道启用默认探测
      if (!shouldProbeByDefault && !isConverterPresetChannel(channel)) {
        continue;
      }

      const channelType = normalizeGatewaySourceType(channel);
      // eslint-disable-next-line no-await-in-loop
      const probe = await probeModelAvailability(channel, channelType, {
        forceRefresh,
        stopOnFirstAvailable: false,
        preferredModels: collectPreferredProbeModels(channel)
      });
      const available = Array.isArray(probe?.availableModels) ? probe.availableModels : [];
      available.forEach(add);
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
        startTime: Date.now(),
        requestModel: req.body?.model || ''
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
          publishFailureLog({
            source: 'opencode',
            channel: channel.name,
            message: 'API key not configured or expired. Please update your channel key.',
            statusCode: 401,
            stage: 'preflight',
            broadcastLog
          });
          return res.status(401).json({
            error: {
              message: 'API key not configured or expired. Please update your channel key.',
              type: 'authentication_error'
            }
          });
        }

        // Store the effective key on the request for use in proxyReq handler
        req.effectiveApiKey = effectiveKey;

        // 记录请求快照到文件（由 CC_TOOL_LOG_REQUESTS 环境变量控制）
        persistProxyRequestSnapshot('opencode', {
          timestamp: Date.now(),
          source: 'opencode',
          channel: channel.name,
          request: {
            method: req.method,
            url: req.url,
            path: req.path,
            headers: req.headers,
            body: req.body || null
          }
        });

        let bodyMutated = false;

        // 应用模型重定向（当 proxy 开启时）
        if (req.body && typeof req.body === 'object' && !Array.isArray(req.body) && req.body.model) {
          const originalModel = req.body.model;
          const redirectedModel = redirectModel(originalModel, channel);

          if (redirectedModel !== originalModel) {
            req.body.model = redirectedModel;
            bodyMutated = true;

            // 将原始模型和重定向模型存入 metadata，用于日志记录
            const meta = requestMetadata.get(req);
            if (meta) {
              meta.originalModel = originalModel;
              meta.redirectedModel = redirectedModel;
              meta.requestModel = redirectedModel;
            }

            // 只在重定向规则变化时打印日志（避免每次请求都打印）
            const cachedRedirects = printedRedirectCache.get(channel.id) || {};
            if (cachedRedirects[originalModel] !== redirectedModel) {
              cachedRedirects[originalModel] = redirectedModel;
              printedRedirectCache.set(channel.id, cachedRedirects);
              console.log(`[OpenCode Model Redirect] ${originalModel} → ${redirectedModel} (channel: ${channel.name})`);
            }
          }
        }

        if (shouldParseJson(req) && isChatCompletionsPath(req.url) && ensureOpenAiStreamUsage(req.body)) {
          bodyMutated = true;
        }

        if (bodyMutated) {
          req.rawBody = Buffer.from(JSON.stringify(req.body));
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
            const metadata = requestMetadata.get(req) || {
              channel: channel.name,
              channelId: channel.id,
              startTime: Date.now()
            };
            publishFailureLog({
              source: 'opencode',
              metadata,
              message: err.message,
              error: err,
              statusCode: 502,
              stage: 'proxy_web',
              broadcastLog
            });
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
        publishFailureLog({
          source: 'opencode',
          message: error.message || 'No OpenCode channel available',
          statusCode: 503,
          stage: 'allocate_channel',
          broadcastLog
        });
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
      let tokenData = createTokenData();
      let usageRecorded = false;

      function recordUsageIfReady() {
        if (usageRecorded) {
          return false;
        }

        const result = publishUsageLog({
          source: 'opencode',
          metadata,
          model: tokenData.model,
          tokens: {
            input: tokenData.inputTokens,
            output: tokenData.outputTokens,
            cacheCreation: tokenData.cacheCreation,
            cacheRead: tokenData.cacheRead,
            cached: tokenData.cachedTokens,
            reasoning: tokenData.reasoningTokens,
            total: tokenData.totalTokens
          },
          calculateCost,
          broadcastLog,
          recordRequest: recordOpenCodeRequest,
          recordSuccess,
          allowBroadcast: true
        });

        if (!result) {
          return false;
        }

        usageRecorded = true;
        return true;
      }

      proxyRes.on('data', (chunk) => {
        if (isResponseClosed) {
          return;
        }

        buffer += chunk.toString();

        // 检查是否是 SSE 流
        if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';

          events.forEach((eventText) => {
            if (!eventText.trim()) return;

            try {
              const lines = eventText.split('\n');
              let eventType = '';
              let data = '';

              lines.forEach(line => {
                if (line.startsWith('event:')) {
                  eventType = line.substring(6).trim();
                } else if (line.startsWith('data:')) {
                  data = line.substring(5).trim();
                }
              });

              if (!data || data === '[DONE]') return;

              const parsed = JSON.parse(data);
              const usage = parseSSEUsage(parsed, eventType);
              mergeUsageIntoTokenData(tokenData, usage);

              if (usage.isDone) {
                recordUsageIfReady();
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
            const usage = parseNonStreamingUsage(parsed);
            mergeUsageIntoTokenData(tokenData, usage);
          } catch (err) {
            // 忽略解析错误
          }
        }

        recordUsageIfReady();

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
        publishFailureLog({
          source: 'opencode',
          metadata,
          message: err.message,
          error: err,
          statusCode: proxyRes.statusCode,
          stage: 'response_stream',
          broadcastLog
        });
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
      publishFailureLog({
        source: 'opencode',
        metadata: (req && requestMetadata.get(req)) || {
          channel: req?.selectedChannel?.name,
          channelId: req?.selectedChannel?.id,
          model: req?.body?.model
        },
        message: err.message,
        error: err,
        statusCode: 502,
        stage: 'proxy',
        broadcastLog
      });
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
    attachServerShutdownHandling(proxyServer);

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

  const shutdownTimer = expediteServerShutdown(proxyServer);

  return new Promise((resolve) => {
    proxyServer.close(() => {
      if (shutdownTimer) {
        clearTimeout(shutdownTimer);
      }
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
  const allowRecovery = !!proxyServer;
  const startTime = getProxyStartTime('opencode', { allowRecovery });
  const runtime = getProxyRuntime('opencode', { allowRecovery });

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
  collectProxyModelList,
  calculateCost
};
