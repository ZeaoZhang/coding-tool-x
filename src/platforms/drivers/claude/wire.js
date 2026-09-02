'use strict';

const crypto = require('crypto');

const {
  normalizeOpenCodeMessages,
  normalizeStopSequences
} = require('../opencode/normalization');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CLAUDE_CODE_USER_AGENT = 'claude-cli/2.1.59 (external, cli)';
const CLAUDE_MESSAGES_BETA_FLAGS = Object.freeze([
  'claude-code-20250219',
  'interleaved-thinking-2025-05-14',
  'prompt-caching-scope-2026-01-05',
  'effort-2025-11-24'
]);
const CLAUDE_ADVANCED_TOOL_USE_BETA = 'advanced-tool-use-2025-11-20';
const CLAUDE_COUNT_TOKENS_BETA_FLAGS = Object.freeze([
  'claude-code-20250219',
  'token-counting-2024-11-01'
]);
const DEFAULT_CLAUDE_CODE_SYSTEM_PROMPT =
  "You are Claude Code, Anthropic's official CLI for Claude.";
// ---------------------------------------------------------------------------
// Header override helper
// ---------------------------------------------------------------------------
function normalizeHeaderName(name) {
  return String(name || '').toLowerCase().trim();
}

/**
 * Merge explicit header overrides from options.headers and
 * options.providerConfig?.headers into a base headers map.
 * - Merges case-insensitively; explicit value wins.
 * - If either credential header (authorization or x-api-key) is explicit,
 *   the generated opposite credential header is removed.
 */
function applyHeaderOverrides(baseHeaders, options = {}) {
  const merged = { ...baseHeaders };

  // Collect explicit overrides from both sources, normalizing keys
  const overrideEntries = [];

  const headersSource = options.headers;
  if (headersSource && typeof headersSource === 'object' && !Array.isArray(headersSource)) {
    for (const [key, value] of Object.entries(headersSource)) {
      overrideEntries.push([normalizeHeaderName(key), String(value)]);
    }
  }

  const providerConfig = options.providerConfig;
  const providerHeaders =
    providerConfig &&
    typeof providerConfig === 'object' &&
    !Array.isArray(providerConfig)
      ? providerConfig.headers
      : undefined;
  if (providerHeaders && typeof providerHeaders === 'object' && !Array.isArray(providerHeaders)) {
    for (const [key, value] of Object.entries(providerHeaders)) {
      overrideEntries.push([normalizeHeaderName(key), String(value)]);
    }
  }

  // Apply overrides to merged (case-insensitive)
  for (const [lcKey, value] of overrideEntries) {
    merged[lcKey] = value;
  }

  // If either credential header is explicitly overridden, remove the
  // generated opposite credential.
  const hasExplicitAuth = overrideEntries.some(
    ([lcKey]) => lcKey === 'authorization'
  );
  const hasExplicitApiKey = overrideEntries.some(
    ([lcKey]) => lcKey === 'x-api-key'
  );

  if (hasExplicitAuth && merged['x-api-key'] !== undefined) {
    delete merged['x-api-key'];
  }
  if (hasExplicitApiKey && merged['authorization'] !== undefined) {
    delete merged['authorization'];
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Claude-specific helpers
// ---------------------------------------------------------------------------
function ensureClaudeToolNamePrefix(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) return '';
  return trimmed.startsWith('mcp_') ? trimmed : `mcp_${trimmed}`;
}

function stripClaudeToolNamePrefix(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) return '';
  if (!trimmed.startsWith('mcp_')) return trimmed;
  const stripped = trimmed.slice(4).trim();
  return stripped || trimmed;
}

function transformIdentityTextToClaudeCode(text) {
  if (typeof text !== 'string' || !text) return text;
  return text.replace(/open\s*code/gi, 'Claude Code');
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

function normalizeToolChoiceToClaude(toolChoice) {
  if (!toolChoice) return undefined;

  if (typeof toolChoice === 'string') {
    if (toolChoice === 'auto') return { type: 'auto' };
    if (toolChoice === 'required') return { type: 'any' };
    return undefined;
  }

  if (typeof toolChoice === 'object') {
    if (toolChoice.type === 'function' && toolChoice.function?.name) {
      return {
        type: 'tool',
        name: ensureClaudeToolNamePrefix(toolChoice.function.name)
      };
    }
    if (toolChoice.type === 'function' && toolChoice.name) {
      return {
        type: 'tool',
        name: ensureClaudeToolNamePrefix(toolChoice.name)
      };
    }
    if (toolChoice.type === 'auto') return { type: 'auto' };
    if (toolChoice.type === 'required') return { type: 'any' };
  }

  return undefined;
}

function normalizeOpenAiToolsToClaude(tools = []) {
  if (!Array.isArray(tools)) return [];

  const normalized = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue;

    if (
      tool.type === 'function' &&
      tool.function &&
      typeof tool.function === 'object'
    ) {
      const fn = tool.function;
      if (!fn.name) continue;
      normalized.push({
        name: ensureClaudeToolNamePrefix(fn.name),
        description: transformIdentityTextToClaudeCode(fn.description || ''),
        input_schema: fn.parameters || { type: 'object', properties: {} }
      });
      continue;
    }

    if (tool.type === 'function' && tool.name) {
      normalized.push({
        name: ensureClaudeToolNamePrefix(tool.name),
        description: transformIdentityTextToClaudeCode(
          tool.description || ''
        ),
        input_schema: tool.parameters || { type: 'object', properties: {} }
      });
    }
  }

  return normalized;
}

// ---------------------------------------------------------------------------
// Deep clone helper
// ---------------------------------------------------------------------------
function deepClone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(deepClone);
  const cloned = {};
  for (const key of Object.keys(value)) {
    cloned[key] = deepClone(value[key]);
  }
  return cloned;
}

// ---------------------------------------------------------------------------
// Prompt caching (mutates a cloned payload)
// ---------------------------------------------------------------------------
function applyPromptCachingToClaudePayload(converted) {
  const EPHEMERAL = { type: 'ephemeral' };

  let messageBreakpoints = 0;
  if (Array.isArray(converted.messages)) {
    converted.messages.forEach(msg => {
      if (Array.isArray(msg.content)) {
        msg.content.forEach(block => {
          if (block.cache_control) messageBreakpoints++;
          if (
            block.type === 'tool_result' &&
            Array.isArray(block.content)
          ) {
            block.content.forEach(inner => {
              if (inner.cache_control) messageBreakpoints++;
            });
          }
        });
      }
    });
  }

  let systemBreakpoints = 0;
  if (Array.isArray(converted.system)) {
    converted.system.forEach(block => {
      if (block.cache_control) systemBreakpoints++;
    });
  }

  if (
    systemBreakpoints === 0 &&
    Array.isArray(converted.system) &&
    converted.system.length > 0
  ) {
    const last = converted.system[converted.system.length - 1];
    if (!last.cache_control) last.cache_control = EPHEMERAL;
  }

  if (messageBreakpoints === 0 && systemBreakpoints === 0) {
    if (
      Array.isArray(converted.messages) &&
      converted.messages.length > 0
    ) {
      for (const msg of converted.messages.slice(-2)) {
        if (Array.isArray(msg.content) && msg.content.length > 0) {
          const last = msg.content[msg.content.length - 1];
          if (!last.cache_control) last.cache_control = EPHEMERAL;
        }
      }
    }
  }
}

function applyClaudeToolNamePrefixToMessages(messages = []) {
  if (!Array.isArray(messages)) return [];
  return messages.map(message => {
    if (
      !message ||
      typeof message !== 'object' ||
      !Array.isArray(message.content)
    ) {
      return deepClone(message);
    }

    const content = message.content.map(block => {
      if (!block || typeof block !== 'object') return deepClone(block);
      if (block.type !== 'tool_use' || !block.name) return deepClone(block);
      return {
        ...block,
        name: ensureClaudeToolNamePrefix(block.name)
      };
    });

    return {
      ...message,
      content
    };
  });
}

function buildClaudeCodeUserId(seed = '') {
  const normalizedSeed = normalizeClaudeSessionSeed(seed);
  const sessionId =
    normalizedSeed ||
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `user_${'0'.repeat(64)}_account__session_${sessionId}`;
}

function normalizeSessionKeyValue(value) {
  const source = Array.isArray(value) ? value[0] : value;
  if (typeof source !== 'string') return '';
  const normalized = source.trim();
  if (!normalized) return '';
  const lowered = normalized.toLowerCase();
  if (
    lowered === 'undefined' ||
    lowered === '[undefined]' ||
    lowered === 'null' ||
    lowered === '[null]' ||
    lowered === 'nan' ||
    lowered === '[nan]'
  ) {
    return '';
  }
  return normalized;
}

function normalizeClaudeSessionSeed(value) {
  const normalized = normalizeSessionKeyValue(value);
  if (!normalized) return '';
  return normalized
    .replace(/^user_[0-9a-f]{64}_account__session_/i, '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64);
}

function extractClaudeSessionSeedFromUserId(value = '') {
  const normalized = normalizeSessionKeyValue(value);
  if (!normalized) return '';
  const matched = normalized.match(
    /^user_[0-9a-f]{64}_account__session_(.+)$/i
  );
  if (!matched) return '';
  return normalizeClaudeSessionSeed(matched[1] || '');
}

function getClaudeSessionSeedAllowList() {
  const envSeeds = String(
    process.env.OPENCODE_CLAUDE_FALLBACK_SESSION_SEEDS ||
      'session_test,session,sessiontest,session_'
  )
    .split(',')
    .map(seed => normalizeClaudeSessionSeed(seed))
    .filter(Boolean);
  const fallbackSeed = normalizeClaudeSessionSeed(
    process.env.OPENCODE_CLAUDE_FALLBACK_SESSION_SEED || 'session_test'
  );
  return Array.from(
    new Set(
      [
        ...envSeeds,
        fallbackSeed,
        'session_test',
        'session',
        'sessiontest',
        'session_'
      ].filter(Boolean)
    )
  );
}

function isValidClaudeCodeUserId(value = '', options = {}) {
  const normalized = normalizeSessionKeyValue(value);
  if (!normalized) return false;
  const matched = normalized.match(
    /^user_[0-9a-f]{64}_account__session_([a-zA-Z0-9_-]{1,64})$/i
  );
  if (!matched) return false;
  if (!options.enforceAllowedSeed) return true;
  const allowedSeeds =
    Array.isArray(options.allowedSeeds) && options.allowedSeeds.length > 0
      ? options.allowedSeeds
      : getClaudeSessionSeedAllowList();
  const seed = normalizeClaudeSessionSeed(matched[1] || '');
  return !!seed && allowedSeeds.includes(seed);
}

function normalizeClaudeMetadata(metadata, fallbackUserId = '') {
  const normalized =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { ...metadata }
      : {};
  const allowedSeeds = getClaudeSessionSeedAllowList();
  const userId = normalizeSessionKeyValue(normalized.user_id);
  const fallbackValue = normalizeSessionKeyValue(fallbackUserId);
  if (
    isValidClaudeCodeUserId(userId, {
      enforceAllowedSeed: true,
      allowedSeeds
    })
  ) {
    normalized.user_id = userId;
    return normalized;
  }
  if (
    isValidClaudeCodeUserId(fallbackValue, {
      enforceAllowedSeed: true,
      allowedSeeds
    })
  ) {
    normalized.user_id = fallbackValue;
    return normalized;
  }
  const fallbackSeedRaw =
    extractClaudeSessionSeedFromUserId(fallbackValue) ||
    normalizeClaudeSessionSeed(fallbackValue);
  const fallbackSeed = allowedSeeds.includes(fallbackSeedRaw)
    ? fallbackSeedRaw
    : allowedSeeds[0] || 'session_test';
  normalized.user_id = buildClaudeCodeUserId(fallbackSeed);
  return normalized;
}

// ---------------------------------------------------------------------------
// Header & URL construction
// ---------------------------------------------------------------------------
function isOfficialAnthropicEndpoint(baseUrl = '') {
  try {
    const hostname = new URL(String(baseUrl || '').trim()).hostname;
    return hostname === 'api.anthropic.com';
  } catch {
    return false;
  }
}

function buildClaudeBetaHeader(options = {}) {
  const requestType = options.requestType === 'count_tokens' ? 'count_tokens' : 'messages';
  const betaFlags = requestType === 'count_tokens'
    ? [...CLAUDE_COUNT_TOKENS_BETA_FLAGS]
    : [...CLAUDE_MESSAGES_BETA_FLAGS];
  if (requestType === 'messages' && options.hasTools) {
    betaFlags.push(CLAUDE_ADVANCED_TOOL_USE_BETA);
  }
  return betaFlags.join(',');
}

function generateClientRequestId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  }
}

function buildClaudeRequestHeaders(apiKey, options = {}) {
  const {
    stream = false,
    hasTools = false,
    officialEndpoint = false,
    networkHeaders = true,
    requestType = 'messages'
  } = options;

  if (!networkHeaders) {
    return applyHeaderOverrides({}, options);
  }

  const baseHeaders = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
    'anthropic-beta': buildClaudeBetaHeader({ hasTools, requestType }),
    'anthropic-dangerous-direct-browser-access': 'true',
    'x-app': 'cli',
    'x-client-request-id': generateClientRequestId(),
    'user-agent': CLAUDE_CODE_USER_AGENT,
    accept: stream ? 'text/event-stream' : 'application/json'
  };

  if (officialEndpoint && apiKey) {
    baseHeaders['x-api-key'] = apiKey;
  } else if (!officialEndpoint && apiKey) {
    baseHeaders['authorization'] = `Bearer ${apiKey}`;
  }

  return applyHeaderOverrides(baseHeaders, options);
}

/**
 * Build request headers for the /v1/messages/count_tokens preflight.
 * Follows the shared auth semantics (official X-Api-Key vs custom Bearer)
 * and honors explicit header overrides from options.headers /
 * options.providerConfig?.headers.
 */
function buildClaudeCountTokensHeaders(apiKey, options = {}) {
  const { baseUrl = '', hasTools = false, headers, providerConfig } = options;
  return buildClaudeRequestHeaders(apiKey, {
    stream: false,
    hasTools,
    officialEndpoint: isOfficialAnthropicEndpoint(baseUrl),
    requestType: 'count_tokens',
    headers,
    providerConfig
  });
}

function buildClaudeTargetUrl(baseUrl = '', _options = {}) {
  const trimmed = String(baseUrl || '').trim();
  if (!trimmed) {
    const defaultUrl = new URL('https://api.anthropic.com');
    defaultUrl.pathname = '/v1/messages';
    defaultUrl.searchParams.set('beta', 'true');
    return defaultUrl.toString();
  }

  let targetUrl;
  try {
    targetUrl = new URL(trimmed);
  } catch {
    return '';
  }

  if (!targetUrl.hostname) return '';

  let pathname = targetUrl.pathname.replace(/\/+$/, '');
  if (!pathname || pathname === '/') {
    pathname = '/v1/messages';
  } else if (pathname.endsWith('/messages')) {
    // preserve existing /messages path
  } else if (pathname.endsWith('/v1')) {
    pathname = `${pathname}/messages`;
  } else {
    pathname = `${pathname}/v1/messages`;
  }

  targetUrl.pathname = pathname;
  targetUrl.searchParams.set('beta', 'true');
  return targetUrl.toString();
}

function buildClaudeCountTokensTargetUrl(baseUrl = '') {
  const trimmed = String(baseUrl || '').trim();
  if (!trimmed) {
    const defaultUrl = new URL('https://api.anthropic.com');
    defaultUrl.pathname = '/v1/messages/count_tokens';
    defaultUrl.searchParams.set('beta', 'true');
    return defaultUrl.toString();
  }

  let targetUrl;
  try {
    targetUrl = new URL(trimmed);
  } catch {
    return '';
  }

  if (!targetUrl.hostname) return '';

  let pathname = targetUrl.pathname.replace(/\/+$/, '');
  if (!pathname || pathname === '/') {
    pathname = '/v1/messages/count_tokens';
  } else if (pathname.endsWith('/messages/count_tokens')) {
    // preserve existing path
  } else if (pathname.endsWith('/messages')) {
    pathname = `${pathname}/count_tokens`;
  } else if (pathname.endsWith('/v1')) {
    pathname = `${pathname}/messages/count_tokens`;
  } else {
    pathname = `${pathname}/v1/messages/count_tokens`;
  }

  targetUrl.pathname = pathname;
  targetUrl.searchParams.set('beta', 'true');
  return targetUrl.toString();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a Claude API request from an OpenCode-compatible payload.
 *
 * @param {string} pathname - request path (e.g. /v1/chat/completions, /v1/responses, /v1/messages)
 * @param {object} [payload={}] - OpenCode request body
 * @param {object} [options={}] -
 *   apiKey, baseUrl, fallbackModel, stream, sessionUserId, networkHeaders,
 *   headers, providerConfig
 * @returns {{ body: object, headers: object, model: string }}
 */
function createClaudeRequest(pathname, payload = {}, options = {}) {
  const {
    apiKey = '',
    baseUrl = '',
    fallbackModel = '',
    stream = false,
    sessionUserId = '',
    networkHeaders = true
  } = options;

  const normalized = normalizeOpenCodeMessages(pathname, payload);
  const maxTokens = Number(payload.max_output_tokens ?? payload.max_tokens);
  const stopSequencesVal = normalizeStopSequences(payload.stop);
  const thinking = normalizeReasoningEffortToClaude(
    payload.reasoning_effort
  );

  // Deep clone messages to prevent mutating the input
  const clonedMessages = deepClone(
    applyClaudeToolNamePrefixToMessages(normalized.messages)
  );

  const body = {
    model:
      payload.model || fallbackModel || 'claude-sonnet-4-20250514',
    max_tokens:
      Number.isFinite(maxTokens) && maxTokens > 0
        ? Math.round(maxTokens)
        : 4096,
    stream,
    messages: clonedMessages
  };

  if (
    normalized.systemBlocks &&
    normalized.systemBlocks.length > 0
  ) {
    body.system = deepClone(normalized.systemBlocks)
      .map(block => {
        if (!block || typeof block !== 'object') return null;
        if (block.type !== 'text') return block;
        return {
          ...block,
          text: transformIdentityTextToClaudeCode(block.text || '')
        };
      })
      .filter(Boolean);
  }

  if (!Array.isArray(body.system) || body.system.length === 0) {
    body.system = [
      { type: 'text', text: DEFAULT_CLAUDE_CODE_SYSTEM_PROMPT }
    ];
  }

  const tools = normalizeOpenAiToolsToClaude(payload.tools || []);
  if (tools.length > 0) {
    body.tools = tools;
  }

  const toolChoice = normalizeToolChoiceToClaude(payload.tool_choice);
  if (toolChoice) {
    body.tool_choice = toolChoice;
  }
  if (stopSequencesVal) {
    body.stop_sequences = stopSequencesVal;
  }
  if (thinking) {
    body.thinking = thinking;
  }

  if (Number.isFinite(Number(payload.temperature))) {
    body.temperature = Number(payload.temperature);
  }
  if (Number.isFinite(Number(payload.top_p))) {
    body.top_p = Number(payload.top_p);
  }
  if (Number.isFinite(Number(payload.top_k))) {
    body.top_k = Number(payload.top_k);
  }

  body.metadata = normalizeClaudeMetadata(
    payload.metadata,
    sessionUserId
  );

  applyPromptCachingToClaudePayload(body);

  const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
  const officialEndpoint = isOfficialAnthropicEndpoint(baseUrl);

  const headers = buildClaudeRequestHeaders(apiKey, {
    stream,
    hasTools,
    officialEndpoint,
    networkHeaders,
    headers: options.headers,
    providerConfig: options.providerConfig
  });

  return {
    body,
    headers,
    model: body.model
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  createClaudeRequest,
  buildClaudeTargetUrl,
  buildClaudeCountTokensTargetUrl,
  buildClaudeCountTokensHeaders,

  // Public adapter-required export
  stripClaudeToolNamePrefix
};
