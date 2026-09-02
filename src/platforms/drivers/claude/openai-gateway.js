const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { broadcastLog } = require('../../../server/websocket-server');
const { recordRequest } = require('../../../server/services/statistics-service');
const { recordSuccess, recordFailure } = require('../../../server/services/channel-health');
const { publishUsageLog, publishFailureLog } = require('../../../server/services/proxy-log-helper');
const { createDecodedStream } = require('../../../server/services/response-decoder');
const { parseNonStreamingUsage } = require('../../../server/services/base/response-usage-parser');
const { convertClaudeToOpenCodePayload } = require('../opencode/gateway-converter');

const REQUEST_TIMEOUT_MS = 120000;

function getRequestPathname(urlPath = '') {
  try {
    const parsed = new URL(urlPath, 'http://localhost');
    return parsed.pathname || '/';
  } catch {
    return String(urlPath || '').split('?')[0] || '/';
  }
}

function isClaudeMessagesPath(pathname) {
  return pathname === '/v1/messages' || pathname === '/messages';
}

function normalizeClaudeTargetApi(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'chat' || normalized === 'chat/completions' || normalized === 'chat.completions') {
    return 'chat.completions';
  }
  return 'responses';
}

function isOfficialOpenAiBaseUrl(baseUrl = '') {
  try {
    const parsed = new URL(String(baseUrl || '').trim());
    return String(parsed.hostname || '').trim().toLowerCase() === 'api.openai.com';
  } catch {
    return false;
  }
}

function resolveClaudeGatewayTargetApi(channel = {}) {
  const configured = normalizeClaudeTargetApi(channel?.targetApi);
  if (configured === 'responses' && !isOfficialOpenAiBaseUrl(channel?.baseUrl)) {
    return 'chat.completions';
  }
  return configured;
}

function buildOpenAiTargetUrl(baseUrl = '', endpoint = '/v1/responses') {
  const trimmedBaseUrl = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!trimmedBaseUrl) {
    throw new Error('Invalid baseUrl');
  }

  const normalizedEndpoint = String(endpoint || '/v1/responses').startsWith('/')
    ? String(endpoint || '/v1/responses')
    : `/${endpoint}`;

  if (trimmedBaseUrl.endsWith(normalizedEndpoint)) {
    return trimmedBaseUrl;
  }

  const endpointWithoutV1 = normalizedEndpoint.startsWith('/v1/')
    ? normalizedEndpoint.slice(3)
    : normalizedEndpoint;

  if (trimmedBaseUrl.endsWith(endpointWithoutV1)) {
    return trimmedBaseUrl;
  }

  if (trimmedBaseUrl.endsWith('/v1') && normalizedEndpoint.startsWith('/v1/')) {
    return `${trimmedBaseUrl}${normalizedEndpoint.slice(3)}`;
  }

  return `${trimmedBaseUrl}${normalizedEndpoint}`;
}

function buildOpenAiHeaders(apiKey, options = {}) {
  const wantsStream = options.wantsStream === true;
  const targetApi = String(options.targetApi || 'responses').trim().toLowerCase();
  const headers = {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
    accept: wantsStream ? 'text/event-stream' : 'application/json',
    'accept-encoding': 'gzip, deflate, br',
    connection: 'keep-alive',
    'user-agent': 'Coding-Tool-ClaudeGateway/1.0'
  };

  if (targetApi === 'responses') {
    headers['openai-beta'] = 'responses=experimental';
  }

  return headers;
}

function buildProxyAgent(proxyUrl = '') {
  if (typeof proxyUrl !== 'string' || !proxyUrl.trim()) {
    return undefined;
  }
  return new HttpsProxyAgent(proxyUrl.trim());
}

function collectHttpResponseBody(response) {
  return new Promise((resolve, reject) => {
    const stream = createDecodedStream(response);
    const chunks = [];
    stream.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    stream.on('error', reject);
    response.on('error', reject);
  });
}

function postJson(url, headers, payload, timeoutMs = REQUEST_TIMEOUT_MS, agent) {
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
      agent,
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(body)
      }
    }, (response) => {
      collectHttpResponseBody(response)
        .then((rawBody) => {
          resolve({
            statusCode: Number(response.statusCode) || 500,
            headers: response.headers || {},
            rawBody
          });
        })
        .catch(reject);
    });

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy(new Error('OpenAI gateway request timeout'));
    });
    request.write(body);
    request.end();
  });
}

function postJsonStream(url, headers, payload, timeoutMs = REQUEST_TIMEOUT_MS, agent) {
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
      agent,
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(body)
      }
    }, (response) => {
      resolve({
        statusCode: Number(response.statusCode) || 500,
        headers: response.headers || {},
        response
      });
    });

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy(new Error('OpenAI gateway request timeout'));
    });
    request.write(body);
    request.end();
  });
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function mapStatusCodeToAnthropicErrorType(statusCode) {
  if (statusCode === 401 || statusCode === 403) return 'authentication_error';
  if (statusCode === 429) return 'rate_limit_error';
  if (statusCode >= 500) return 'api_error';
  return 'invalid_request_error';
}

function sendAnthropicError(res, statusCode, message) {
  if (res.headersSent) return;
  res.status(statusCode).json({
    type: 'error',
    error: {
      type: mapStatusCodeToAnthropicErrorType(statusCode),
      message
    }
  });
}

function collectTextFragments(value, fragments) {
  if (value === null || value === undefined) return;

  if (typeof value === 'string') {
    if (value) {
      fragments.push(value);
    }
    return;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    fragments.push(String(value));
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectTextFragments(item, fragments));
    return;
  }

  if (typeof value !== 'object') {
    return;
  }

  if (typeof value.text === 'string') {
    collectTextFragments(value.text, fragments);
    return;
  }
  if (typeof value.input_text === 'string') {
    collectTextFragments(value.input_text, fragments);
    return;
  }
  if (typeof value.output_text === 'string') {
    collectTextFragments(value.output_text, fragments);
    return;
  }
  if (value.content !== undefined) {
    collectTextFragments(value.content, fragments);
    return;
  }
  if (Array.isArray(value.parts)) {
    collectTextFragments(value.parts, fragments);
  }
}

function extractText(value) {
  const fragments = [];
  collectTextFragments(value, fragments);
  return fragments.join('\n').trim();
}

function normalizeToolArguments(value) {
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

function buildClaudeUsageFromTokens(tokens = {}) {
  return {
    input_tokens: Number(tokens.input || 0),
    output_tokens: Number(tokens.output || 0),
    cache_creation_input_tokens: Number(tokens.cacheCreation || 0),
    cache_read_input_tokens: Number(tokens.cacheRead || tokens.cached || 0)
  };
}

function buildPublishTokensFromClaudeUsage(usage = {}) {
  return {
    input: Number(usage.input_tokens || 0),
    output: Number(usage.output_tokens || 0),
    cacheCreation: Number(usage.cache_creation_input_tokens || 0),
    cacheRead: Number(usage.cache_read_input_tokens || 0),
    cached: Number(usage.cache_read_input_tokens || 0),
    reasoning: 0,
    total: 0
  };
}

function mapResponsesStopReason(response, hasToolUse) {
  if (hasToolUse) return 'tool_use';

  const incompleteReason = String(
    response?.incomplete_details?.reason
    || response?.incompleteDetails?.reason
    || ''
  ).trim().toLowerCase();

  if (incompleteReason === 'max_output_tokens' || incompleteReason === 'max_tokens') {
    return 'max_tokens';
  }

  return 'end_turn';
}

function mapChatFinishReason(finishReason, hasToolUse) {
  if (hasToolUse || finishReason === 'tool_calls') {
    return 'tool_use';
  }
  if (finishReason === 'length') {
    return 'max_tokens';
  }
  return 'end_turn';
}

function buildClaudeContentFromResponses(response = {}) {
  const content = [];
  let hasToolUse = false;
  const output = Array.isArray(response.output) ? response.output : [];

  output.forEach((item) => {
    if (!item || typeof item !== 'object') return;

    if (item.type === 'message') {
      const parts = Array.isArray(item.content) ? item.content : [];
      parts.forEach((part) => {
        const text = extractText(part);
        if (text) {
          content.push({
            type: 'text',
            text
          });
        }
      });
      return;
    }

    if (item.type === 'function_call' && item.name) {
      hasToolUse = true;
      content.push({
        type: 'tool_use',
        id: String(item.call_id || item.id || `toolu_${Date.now()}`),
        name: item.name,
        input: normalizeToolArguments(item.arguments)
      });
    }
  });

  return { content, hasToolUse };
}

function buildClaudeContentFromChat(chat = {}) {
  const content = [];
  const choice = Array.isArray(chat.choices) ? chat.choices[0] : null;
  const message = choice?.message && typeof choice.message === 'object' ? choice.message : {};
  const text = extractText(message.content);
  let hasToolUse = false;

  if (text) {
    content.push({
      type: 'text',
      text
    });
  }

  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  toolCalls.forEach((toolCall) => {
    const functionPayload = (toolCall?.function && typeof toolCall.function === 'object')
      ? toolCall.function
      : toolCall;
    const name = String(functionPayload?.name || '').trim();
    if (!name) return;
    hasToolUse = true;
    content.push({
      type: 'tool_use',
      id: String(toolCall?.id || toolCall?.call_id || `toolu_${Date.now()}`),
      name,
      input: normalizeToolArguments(functionPayload.arguments)
    });
  });

  return {
    content,
    hasToolUse,
    finishReason: choice?.finish_reason || 'stop'
  };
}

function buildClaudeMessageFromResponses(response = {}, fallbackModel = '') {
  const parsedUsage = parseNonStreamingUsage(response);
  const { content, hasToolUse } = buildClaudeContentFromResponses(response);

  return {
    id: String(response.id || `msg_${Date.now()}`),
    type: 'message',
    role: 'assistant',
    model: parsedUsage.model || response.model || fallbackModel || '',
    content,
    stop_reason: mapResponsesStopReason(response, hasToolUse),
    stop_sequence: null,
    usage: buildClaudeUsageFromTokens(parsedUsage.tokens || {})
  };
}

function buildClaudeMessageFromChat(chat = {}, fallbackModel = '') {
  const parsedUsage = parseNonStreamingUsage(chat);
  const { content, hasToolUse, finishReason } = buildClaudeContentFromChat(chat);

  return {
    id: String(chat.id || `msg_${Date.now()}`),
    type: 'message',
    role: 'assistant',
    model: parsedUsage.model || chat.model || fallbackModel || '',
    content,
    stop_reason: mapChatFinishReason(finishReason, hasToolUse),
    stop_sequence: null,
    usage: buildClaudeUsageFromTokens(parsedUsage.tokens || {})
  };
}

function createClaudeSseState(fallbackModel = '') {
  return {
    started: false,
    finalized: false,
    model: fallbackModel || '',
    messageId: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    nextBlockIndex: 0,
    textBlocks: new Map(),
    toolBlocks: new Map(),
    usageTokens: null,
    stopReason: 'end_turn',
    completedMessage: null
  };
}

function ensureSseHeaders(res) {
  if (res.headersSent) return;
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
}

function writeClaudeEvent(res, eventName, payload) {
  ensureSseHeaders(res);
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function ensureClaudeMessageStart(res, state) {
  if (state.started) return;
  state.started = true;
  writeClaudeEvent(res, 'message_start', {
    type: 'message_start',
    message: {
      id: state.messageId,
      type: 'message',
      role: 'assistant',
      model: state.model || '',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: buildClaudeUsageFromTokens(state.usageTokens || {})
    }
  });
}

function startClaudeTextBlock(res, state, key) {
  const normalizedKey = String(key);
  let entry = state.textBlocks.get(normalizedKey);
  if (entry && entry.open) {
    return entry;
  }

  ensureClaudeMessageStart(res, state);
  entry = entry || {
    blockIndex: state.nextBlockIndex,
    sentText: ''
  };
  if (!Number.isFinite(entry.blockIndex)) {
    entry.blockIndex = state.nextBlockIndex;
  }
  state.nextBlockIndex = Math.max(state.nextBlockIndex, entry.blockIndex + 1);
  entry.open = true;
  state.textBlocks.set(normalizedKey, entry);

  writeClaudeEvent(res, 'content_block_start', {
    type: 'content_block_start',
    index: entry.blockIndex,
    content_block: {
      type: 'text',
      text: ''
    }
  });

  return entry;
}

function emitClaudeTextDelta(res, state, key, value) {
  const text = typeof value === 'string' ? value : '';
  if (!text) return;

  const entry = startClaudeTextBlock(res, state, key);
  entry.sentText = `${entry.sentText || ''}${text}`;

  writeClaudeEvent(res, 'content_block_delta', {
    type: 'content_block_delta',
    index: entry.blockIndex,
    delta: {
      type: 'text_delta',
      text
    }
  });
}

function closeClaudeTextBlock(res, state, key) {
  const entry = state.textBlocks.get(String(key));
  if (!entry || !entry.open) return;
  entry.open = false;
  writeClaudeEvent(res, 'content_block_stop', {
    type: 'content_block_stop',
    index: entry.blockIndex
  });
}

function ensureClaudeToolBlock(res, state, key, toolState) {
  if (!toolState) return null;
  if (toolState.open) return toolState;
  if (!toolState.name) return null;

  ensureClaudeMessageStart(res, state);
  if (!Number.isFinite(toolState.blockIndex)) {
    toolState.blockIndex = state.nextBlockIndex;
    state.nextBlockIndex += 1;
  }

  toolState.open = true;
  state.toolBlocks.set(String(key), toolState);

  writeClaudeEvent(res, 'content_block_start', {
    type: 'content_block_start',
    index: toolState.blockIndex,
    content_block: {
      type: 'tool_use',
      id: toolState.id,
      name: toolState.name,
      input: {}
    }
  });

  if (toolState.pendingArgs) {
    const delta = toolState.pendingArgs;
    toolState.pendingArgs = '';
    toolState.sentArgs = `${toolState.sentArgs || ''}${delta}`;
    writeClaudeEvent(res, 'content_block_delta', {
      type: 'content_block_delta',
      index: toolState.blockIndex,
      delta: {
        type: 'input_json_delta',
        partial_json: delta
      }
    });
  }

  return toolState;
}

function emitClaudeToolDelta(res, state, key, toolState, value) {
  const delta = typeof value === 'string' ? value : '';
  if (!delta) return;

  toolState.pendingArgs = `${toolState.pendingArgs || ''}${delta}`;
  const activeToolState = ensureClaudeToolBlock(res, state, key, toolState);
  if (!activeToolState || !activeToolState.open) return;

  if (activeToolState.pendingArgs) {
    const flushValue = activeToolState.pendingArgs;
    activeToolState.pendingArgs = '';
    activeToolState.sentArgs = `${activeToolState.sentArgs || ''}${flushValue}`;
    writeClaudeEvent(res, 'content_block_delta', {
      type: 'content_block_delta',
      index: activeToolState.blockIndex,
      delta: {
        type: 'input_json_delta',
        partial_json: flushValue
      }
    });
  }
}

function closeClaudeToolBlock(res, state, key) {
  const toolState = state.toolBlocks.get(String(key));
  if (!toolState || !toolState.open) return;
  toolState.open = false;
  writeClaudeEvent(res, 'content_block_stop', {
    type: 'content_block_stop',
    index: toolState.blockIndex
  });
}

function closeAllOpenBlocks(res, state) {
  for (const key of state.textBlocks.keys()) {
    closeClaudeTextBlock(res, state, key);
  }
  for (const key of state.toolBlocks.keys()) {
    closeClaudeToolBlock(res, state, key);
  }
}

function sortedStreamEntries(map) {
  return Array.from(map.values())
    .filter((entry) => entry && Number.isFinite(Number(entry.blockIndex)))
    .sort((a, b) => Number(a.blockIndex) - Number(b.blockIndex));
}

function buildClaudeMessageFromStreamState(state) {
  const content = [];
  const orderedEntries = [
    ...sortedStreamEntries(state.textBlocks).map((entry) => ({ kind: 'text', entry })),
    ...sortedStreamEntries(state.toolBlocks).map((entry) => ({ kind: 'tool', entry }))
  ].sort((a, b) => Number(a.entry.blockIndex) - Number(b.entry.blockIndex));

  orderedEntries.forEach(({ kind, entry }) => {
    if (kind === 'text') {
      const text = typeof entry.sentText === 'string' ? entry.sentText : '';
      if (!text) return;
      content.push({
        type: 'text',
        text
      });
      return;
    }

    if (!entry || !entry.name) return;
    const argumentsText = `${entry.sentArgs || ''}${entry.pendingArgs || ''}`;
    content.push({
      type: 'tool_use',
      id: String(entry.id || `toolu_${Date.now()}`),
      name: entry.name,
      input: normalizeToolArguments(argumentsText)
    });
  });

  return {
    id: state.messageId,
    type: 'message',
    role: 'assistant',
    model: state.model || '',
    content,
    stop_reason: state.stopReason || 'end_turn',
    stop_sequence: null,
    usage: buildClaudeUsageFromTokens(state.usageTokens || {})
  };
}

function finalizeClaudeSse(res, state, message) {
  if (state.finalized) {
    return;
  }

  if (message?.model) {
    state.model = message.model;
  }
  if (message?.id) {
    state.messageId = message.id;
  }

  ensureClaudeMessageStart(res, state);
  closeAllOpenBlocks(res, state);

  writeClaudeEvent(res, 'message_delta', {
    type: 'message_delta',
    delta: {
      stop_reason: message?.stop_reason || state.stopReason || 'end_turn',
      stop_sequence: null
    },
    usage: message?.usage || buildClaudeUsageFromTokens(state.usageTokens || {})
  });

  writeClaudeEvent(res, 'message_stop', {
    type: 'message_stop'
  });

  state.finalized = true;
  res.end();
}

function emitFullClaudeMessageAsSse(res, state, message) {
  if (!message || state.finalized) {
    return;
  }

  state.model = message.model || state.model;
  state.messageId = message.id || state.messageId;
  ensureClaudeMessageStart(res, state);

  (Array.isArray(message.content) ? message.content : []).forEach((block) => {
    if (!block || typeof block !== 'object') return;

    if (block.type === 'text') {
      const key = `full-text-${state.nextBlockIndex}`;
      startClaudeTextBlock(res, state, key);
      if (typeof block.text === 'string' && block.text) {
        emitClaudeTextDelta(res, state, key, block.text);
      }
      closeClaudeTextBlock(res, state, key);
      return;
    }

    if (block.type === 'tool_use' && block.name) {
      const key = `full-tool-${state.nextBlockIndex}`;
      const inputJson = JSON.stringify(block.input && typeof block.input === 'object' ? block.input : {});
      const toolState = {
        blockIndex: state.nextBlockIndex,
        id: String(block.id || `toolu_${Date.now()}`),
        name: block.name,
        sentArgs: '',
        pendingArgs: inputJson && inputJson !== '{}' ? inputJson : ''
      };
      state.nextBlockIndex += 1;
      state.toolBlocks.set(key, toolState);
      ensureClaudeToolBlock(res, state, key, toolState);
      closeClaudeToolBlock(res, state, key);
    }
  });

  finalizeClaudeSse(res, state, message);
}

function appendMissingTextDelta(res, state, key, fullText) {
  const entry = state.textBlocks.get(String(key));
  const normalizedFullText = typeof fullText === 'string' ? fullText : '';
  if (!normalizedFullText) return;
  if (!entry) {
    emitClaudeTextDelta(res, state, key, normalizedFullText);
    return;
  }
  const previous = entry.sentText || '';
  if (!normalizedFullText.startsWith(previous)) {
    return;
  }
  const suffix = normalizedFullText.slice(previous.length);
  if (suffix) {
    emitClaudeTextDelta(res, state, key, suffix);
  }
}

function appendMissingToolArgs(res, state, key, toolState, fullArgs) {
  const normalizedArgs = typeof fullArgs === 'string' ? fullArgs : '';
  if (!normalizedArgs) return;
  if (!toolState) {
    return;
  }
  const previous = toolState.sentArgs || '';
  if (!normalizedArgs.startsWith(previous)) {
    return;
  }
  const suffix = normalizedArgs.slice(previous.length);
  if (suffix) {
    emitClaudeToolDelta(res, state, key, toolState, suffix);
  }
}

function processResponsesStreamEvent(parsed, state, res) {
  if (!parsed || typeof parsed !== 'object' || state.finalized) {
    return;
  }

  const parsedUsage = parseNonStreamingUsage(parsed);
  if (parsedUsage.model) {
    state.model = parsedUsage.model;
  }
  if (parsedUsage.tokens) {
    state.usageTokens = parsedUsage.tokens;
  }

  if (parsed.response && typeof parsed.response === 'object') {
    if (typeof parsed.response.model === 'string' && parsed.response.model.trim()) {
      state.model = parsed.response.model.trim();
    }
    if (parsed.response.id) {
      state.messageId = String(parsed.response.id);
    }
  }

  if (parsed.type === 'response.created' || parsed.type === 'response.in_progress') {
    ensureClaudeMessageStart(res, state);
    return;
  }

  if (parsed.type === 'response.output_item.added' || parsed.type === 'response.output_item.done') {
    const item = parsed.item && typeof parsed.item === 'object' ? parsed.item : {};
    const outputIndex = Number.isFinite(Number(parsed.output_index)) ? Number(parsed.output_index) : 0;

    if (item.type === 'message') {
      const key = `response-text-${outputIndex}`;
      const messageText = Array.isArray(item.content)
        ? item.content.map((part) => extractText(part)).filter(Boolean).join('\n').trim()
        : '';
      if (messageText) {
        appendMissingTextDelta(res, state, key, messageText);
      }
      if (parsed.type === 'response.output_item.done') {
        closeClaudeTextBlock(res, state, key);
      }
      return;
    }

    if (item.type === 'function_call') {
      const key = `response-tool-${outputIndex}`;
      const existing = state.toolBlocks.get(key) || {
        blockIndex: state.nextBlockIndex,
        id: String(item.call_id || item.id || `toolu_${Date.now()}`),
        name: typeof item.name === 'string' ? item.name : '',
        sentArgs: '',
        pendingArgs: ''
      };
      if (!state.toolBlocks.has(key)) {
        state.nextBlockIndex += 1;
      }
      if (item.call_id || item.id) {
        existing.id = String(item.call_id || item.id);
      }
      if (typeof item.name === 'string' && item.name.trim()) {
        existing.name = item.name.trim();
      }
      state.toolBlocks.set(key, existing);
      ensureClaudeToolBlock(res, state, key, existing);
      appendMissingToolArgs(res, state, key, existing, item.arguments);
      if (parsed.type === 'response.output_item.done') {
        closeClaudeToolBlock(res, state, key);
      }
    }
    return;
  }

  if (parsed.type === 'response.content_part.added') {
    const outputIndex = Number.isFinite(Number(parsed.output_index)) ? Number(parsed.output_index) : 0;
    const text = extractText(parsed.part);
    if (text) {
      appendMissingTextDelta(res, state, `response-text-${outputIndex}`, text);
    }
    return;
  }

  if (parsed.type === 'response.output_text.delta') {
    const outputIndex = Number.isFinite(Number(parsed.output_index)) ? Number(parsed.output_index) : 0;
    if (typeof parsed.delta === 'string' && parsed.delta) {
      emitClaudeTextDelta(res, state, `response-text-${outputIndex}`, parsed.delta);
    }
    return;
  }

  if (parsed.type === 'response.function_call_arguments.delta') {
    const outputIndex = Number.isFinite(Number(parsed.output_index)) ? Number(parsed.output_index) : 0;
    const key = `response-tool-${outputIndex}`;
    const toolState = state.toolBlocks.get(key) || {
      blockIndex: state.nextBlockIndex,
      id: String(parsed.item_id || `toolu_${Date.now()}`),
      name: '',
      sentArgs: '',
      pendingArgs: ''
    };
    if (!state.toolBlocks.has(key)) {
      state.nextBlockIndex += 1;
    }
    state.toolBlocks.set(key, toolState);
    if (typeof parsed.delta === 'string' && parsed.delta) {
      emitClaudeToolDelta(res, state, key, toolState, parsed.delta);
    }
    return;
  }

  if (parsed.type === 'response.completed' || parsed.type === 'response.incomplete') {
    const completedMessage = buildClaudeMessageFromResponses(parsed.response || {}, state.model);
    state.completedMessage = completedMessage;
    state.stopReason = completedMessage.stop_reason;

    if (!state.started) {
      emitFullClaudeMessageAsSse(res, state, completedMessage);
      return;
    }

    finalizeClaudeSse(res, state, completedMessage);
  }
}

function processChatStreamChunk(parsed, state, res) {
  if (!parsed || typeof parsed !== 'object' || state.finalized) {
    return;
  }

  const parsedUsage = parseNonStreamingUsage(parsed);
  if (parsedUsage.model) {
    state.model = parsedUsage.model;
  }
  if (parsedUsage.tokens) {
    state.usageTokens = parsedUsage.tokens;
  }

  if (typeof parsed.id === 'string' && parsed.id.trim()) {
    state.messageId = parsed.id.trim();
  }

  const choice = Array.isArray(parsed.choices) ? parsed.choices[0] : null;
  if (!choice || typeof choice !== 'object') {
    return;
  }

  const delta = choice.delta && typeof choice.delta === 'object' ? choice.delta : {};

  if (typeof delta.content === 'string' && delta.content) {
    emitClaudeTextDelta(res, state, 'chat-text-0', delta.content);
  }

  const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
  toolCalls.forEach((toolCall, index) => {
    const toolIndex = Number.isFinite(Number(toolCall?.index)) ? Number(toolCall.index) : index;
    const key = `chat-tool-${toolIndex}`;
    const existing = state.toolBlocks.get(key) || {
      blockIndex: state.nextBlockIndex,
      id: String(toolCall?.id || `toolu_${Date.now()}_${toolIndex}`),
      name: '',
      sentArgs: '',
      pendingArgs: ''
    };
    if (!state.toolBlocks.has(key)) {
      state.nextBlockIndex += 1;
    }

    const functionPayload = (toolCall?.function && typeof toolCall.function === 'object')
      ? toolCall.function
      : {};
    if (toolCall?.id) {
      existing.id = String(toolCall.id);
    }
    if (typeof functionPayload.name === 'string' && functionPayload.name.trim()) {
      existing.name = functionPayload.name.trim();
    }

    state.toolBlocks.set(key, existing);
    ensureClaudeToolBlock(res, state, key, existing);

    if (typeof functionPayload.arguments === 'string' && functionPayload.arguments) {
      emitClaudeToolDelta(res, state, key, existing, functionPayload.arguments);
    }
  });

  if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
    state.stopReason = mapChatFinishReason(choice.finish_reason, toolCalls.length > 0);
  }
}

async function relayResponsesStreamAsClaude(upstreamResponse, res, fallbackModel = '') {
  const state = createClaudeSseState(fallbackModel);
  const stream = createDecodedStream(upstreamResponse);
  let buffer = '';

  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';

      blocks.forEach((block) => {
        const lines = block.split(/\r?\n/);
        const dataLines = lines
          .map((line) => line.trim())
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .filter(Boolean);

        if (dataLines.length === 0) return;
        const data = dataLines.join('\n');
        if (data === '[DONE]') return;
        const parsed = safeJsonParse(data);
        processResponsesStreamEvent(parsed, state, res);
      });
    });

    stream.on('end', () => {
      if (!state.finalized) {
        const parsed = safeJsonParse(buffer.trim());
        if (parsed?.output) {
          state.completedMessage = buildClaudeMessageFromResponses(parsed, state.model);
        }

        if (state.completedMessage) {
          if (!state.started) {
            emitFullClaudeMessageAsSse(res, state, state.completedMessage);
          } else {
            finalizeClaudeSse(res, state, state.completedMessage);
          }
        } else if (state.started) {
          finalizeClaudeSse(res, state, {
            model: state.model,
            stop_reason: state.stopReason,
            usage: buildClaudeUsageFromTokens(state.usageTokens || {})
          });
        }
      }

      resolve(state.completedMessage);
    });

    stream.on('error', reject);
    upstreamResponse.on('error', reject);
  });
}

async function relayChatStreamAsClaude(upstreamResponse, res, fallbackModel = '') {
  const state = createClaudeSseState(fallbackModel);
  const stream = createDecodedStream(upstreamResponse);
  let buffer = '';

  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';

      blocks.forEach((block) => {
        const lines = block.split(/\r?\n/);
        const dataLines = lines
          .map((line) => line.trim())
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .filter(Boolean);

        if (dataLines.length === 0) return;
        const data = dataLines.join('\n');
        if (data === '[DONE]') return;
        const parsed = safeJsonParse(data);
        processChatStreamChunk(parsed, state, res);
      });
    });

    stream.on('end', () => {
      if (!state.finalized) {
        const parsed = safeJsonParse(buffer.trim());
        if (parsed?.choices) {
          state.completedMessage = buildClaudeMessageFromChat(parsed, state.model);
        }

        if (state.completedMessage) {
          if (!state.started) {
            emitFullClaudeMessageAsSse(res, state, state.completedMessage);
          } else {
            finalizeClaudeSse(res, state, state.completedMessage);
          }
        } else if (state.started) {
          state.completedMessage = buildClaudeMessageFromStreamState(state);
          finalizeClaudeSse(res, state, state.completedMessage);
        }
      }

      resolve(state.completedMessage);
    });

    stream.on('error', reject);
    upstreamResponse.on('error', reject);
  });
}

function publishClaudeGatewayUsage(metadata, message, calculateCost) {
  return publishUsageLog({
    source: 'claude',
    metadata,
    model: message?.model || '',
    tokens: buildPublishTokensFromClaudeUsage(message?.usage || {}),
    calculateCost,
    broadcastLog,
    recordRequest,
    recordSuccess,
    allowBroadcast: true
  });
}

function reportGatewayFailure({ channel, metadata, res, statusCode, message, error, stage, onDone }) {
  recordFailure(channel.id, 'claude', error || new Error(message));
  publishFailureLog({
    source: 'claude',
    metadata,
    message,
    error,
    statusCode,
    stage,
    broadcastLog
  });
  sendAnthropicError(res, statusCode, message);
  if (typeof onDone === 'function') {
    onDone();
  }
  return true;
}

async function handleClaudeOpenAiGatewayRequest({ req, res, channel, effectiveKey, calculateCost, onDone }) {
  const pathname = getRequestPathname(req?.url || '');
  if (!isClaudeMessagesPath(pathname)) {
    return false;
  }

  if (req?.method !== 'POST' || !req?.body || typeof req.body !== 'object') {
    sendAnthropicError(res, 400, 'OpenAI gateway only supports JSON POST payload');
    if (typeof onDone === 'function') {
      onDone();
    }
    return true;
  }

  const requestId = `claude-openai-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const startTime = Date.now();
  const targetApi = resolveClaudeGatewayTargetApi(channel);
  const converted = convertClaudeToOpenCodePayload({
    payload: req.body,
    options: { targetApi }
  });
  const upstreamModel = converted?.requestBody?.model || req.body.model || '';
  const metadata = {
    id: requestId,
    channel: channel?.name,
    channelId: channel?.id,
    startTime,
    requestModel: upstreamModel
  };
  const wantsStream = req.body.stream === true;
  const targetUrl = buildOpenAiTargetUrl(channel?.baseUrl || '', converted.endpoint || '/v1/responses');
  const headers = buildOpenAiHeaders(effectiveKey, {
    targetApi: converted.targetApi,
    wantsStream
  });
  const agent = buildProxyAgent(channel?.proxyUrl || '');

  try {
    if (wantsStream) {
      const upstream = await postJsonStream(
        targetUrl,
        headers,
        converted.requestBody,
        REQUEST_TIMEOUT_MS,
        agent
      );

      if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
        const rawBody = await collectHttpResponseBody(upstream.response);
        const parsedError = safeJsonParse(rawBody);
        const upstreamMessage = parsedError?.error?.message || parsedError?.message || rawBody || `HTTP ${upstream.statusCode}`;
        return reportGatewayFailure({
          channel,
          metadata,
          res,
          statusCode: upstream.statusCode,
          message: String(upstreamMessage).slice(0, 1000),
          error: new Error(String(upstreamMessage).slice(0, 200)),
          stage: 'openai_gateway_upstream',
          onDone
        });
      }

      const message = converted.targetApi === 'chat.completions'
        ? await relayChatStreamAsClaude(upstream.response, res, upstreamModel)
        : await relayResponsesStreamAsClaude(upstream.response, res, upstreamModel);

      if (message) {
        publishClaudeGatewayUsage(metadata, message, calculateCost);
      }
      if (typeof onDone === 'function') {
        onDone();
      }
      return true;
    }

    const upstream = await postJson(
      targetUrl,
      headers,
      converted.requestBody,
      REQUEST_TIMEOUT_MS,
      agent
    );
    const parsedBody = safeJsonParse(upstream.rawBody);

    if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
      const upstreamMessage = parsedBody?.error?.message || parsedBody?.message || upstream.rawBody || `HTTP ${upstream.statusCode}`;
      return reportGatewayFailure({
        channel,
        metadata,
        res,
        statusCode: upstream.statusCode,
        message: String(upstreamMessage).slice(0, 1000),
        error: new Error(String(upstreamMessage).slice(0, 200)),
        stage: 'openai_gateway_upstream',
        onDone
      });
    }

    if (!parsedBody || typeof parsedBody !== 'object') {
      return reportGatewayFailure({
        channel,
        metadata,
        res,
        statusCode: 502,
        message: 'Invalid OpenAI gateway response',
        error: new Error('Invalid OpenAI gateway response'),
        stage: 'openai_gateway_parse',
        onDone
      });
    }

    const message = converted.targetApi === 'chat.completions'
      ? buildClaudeMessageFromChat(parsedBody, upstreamModel)
      : buildClaudeMessageFromResponses(parsedBody, upstreamModel);

    res.json(message);
    publishClaudeGatewayUsage(metadata, message, calculateCost);
    if (typeof onDone === 'function') {
      onDone();
    }
    return true;
  } catch (error) {
    return reportGatewayFailure({
      channel,
      metadata,
      res,
      statusCode: 502,
      message: `OpenAI gateway network error: ${error.message}`,
      error,
      stage: 'openai_gateway_network',
      onDone
    });
  }
}

module.exports = {
  handleClaudeOpenAiGatewayRequest
};
