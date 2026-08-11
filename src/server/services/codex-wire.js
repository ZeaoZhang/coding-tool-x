'use strict';

const crypto = require('crypto');
const os = require('os');

const CODEX_CLIENT_VERSION = '0.144.1';
const CODEX_ORIGINATOR = 'codex_exec';
const CODEX_RESERVED_METADATA_KEYS = new Set([
  'x-codex-installation-id',
  'x-codex-window-id',
  'x-codex-turn-metadata',
  'session_id',
  'thread_id',
  'turn_id'
]);
const CODEX_UNSUPPORTED_BODY_FIELDS = [
  'max_output_tokens',
  'max_completion_tokens',
  'temperature',
  'top_p',
  'top_k',
  'min_p',
  'presence_penalty',
  'frequency_penalty',
  'repetition_penalty',
  'stop',
  'service_tier',
  'user',
  'previous_response_id',
  'prompt_cache_retention',
  'safety_identifier'
];

let installationId = '';

function cloneJsonCompatible(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function createId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function getInstallationId() {
  if (!installationId) installationId = createId();
  return installationId;
}

function normalizeId(value, fallbackFactory = createId) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallbackFactory();
}

function normalizeCodexResponsesInput(inputValue) {
  if (typeof inputValue === 'string') {
    return [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: inputValue }]
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

function normalizeInclude(value) {
  const include = Array.isArray(value)
    ? value.filter(item => typeof item === 'string' && item.trim())
    : [];
  if (!include.includes('reasoning.encrypted_content')) {
    include.push('reasoning.encrypted_content');
  }
  return [...new Set(include)];
}

function normalizeClientMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) => !CODEX_RESERVED_METADATA_KEYS.has(key) && typeof item === 'string')
      .map(([key, item]) => [key, item])
  );
}

function resolveUserAgent(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  const terminal = String(process.env.TERM_PROGRAM || process.env.TERM || 'Terminal').trim() || 'Terminal';
  const platformName = process.platform === 'darwin' ? 'Mac OS' : process.platform;
  return `${CODEX_ORIGINATOR}/${CODEX_CLIENT_VERSION} (${platformName} ${os.release()}; ${process.arch}) ${terminal} (${CODEX_ORIGINATOR}; ${CODEX_CLIENT_VERSION})`;
}

function buildTurnMetadata({ installationId: currentInstallationId, sessionId, threadId, turnId, windowId }) {
  return JSON.stringify({
    installation_id: currentInstallationId,
    session_id: sessionId,
    thread_id: threadId,
    turn_id: turnId,
    window_id: windowId,
    request_kind: 'turn'
  });
}

function createCodexRequest(payload = {}, options = {}) {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload
    : {};
  const body = cloneJsonCompatible(source);
  const fallbackModel = typeof options.fallbackModel === 'string' ? options.fallbackModel.trim() : '';
  const requestedSessionId = options.sessionId || body.prompt_cache_key;
  if (body.model === undefined && fallbackModel) body.model = fallbackModel;

  const sessionId = normalizeId(requestedSessionId, createId);
  const threadId = normalizeId(options.threadId, () => sessionId);
  const windowId = normalizeId(options.windowId, () => `${sessionId}:0`);
  const turnId = normalizeId(options.turnId, createId);
  const currentInstallationId = normalizeId(options.installationId, getInstallationId);
  const normalizedInput = normalizeCodexResponsesInput(body.input);
  if (normalizedInput !== undefined) body.input = normalizedInput;
  body.stream = true;
  if (body.parallel_tool_calls === undefined) body.parallel_tool_calls = true;
  if (typeof body.instructions !== 'string') body.instructions = '';
  body.store = false;
  body.include = normalizeInclude(body.include);
  const reasoningEffort = typeof body.reasoning_effort === 'string'
    ? body.reasoning_effort.trim().toLowerCase()
    : '';
  if (reasoningEffort && body.reasoning === undefined && ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'none'].includes(reasoningEffort)) {
    body.reasoning = { effort: reasoningEffort };
  }
  delete body.reasoning_effort;
  body.prompt_cache_key = normalizeId(body.prompt_cache_key, () => sessionId);

  const callerMetadata = normalizeClientMetadata(body.client_metadata);
  const turnMetadata = buildTurnMetadata({
    installationId: currentInstallationId,
    sessionId,
    threadId,
    turnId,
    windowId
  });
  body.client_metadata = {
    ...callerMetadata,
    'x-codex-installation-id': currentInstallationId,
    session_id: sessionId,
    thread_id: threadId,
    'x-codex-window-id': windowId,
    turn_id: turnId,
    'x-codex-turn-metadata': turnMetadata
  };

  CODEX_UNSUPPORTED_BODY_FIELDS.forEach(field => delete body[field]);

  const headers = {
    authorization: `Bearer ${String(options.apiKey || '')}`,
    accept: 'text/event-stream',
    'content-type': 'application/json',
    originator: typeof options.originator === 'string' && options.originator.trim()
      ? options.originator.trim()
      : CODEX_ORIGINATOR,
    'user-agent': resolveUserAgent(options.userAgent),
    'session-id': sessionId,
    'thread-id': threadId,
    'x-client-request-id': sessionId,
    'x-codex-window-id': windowId,
    'x-codex-turn-metadata': turnMetadata,
    'x-codex-beta-features': 'remote_compaction_v2'
  };

  return {
    body,
    headers,
    model: String(body.model || fallbackModel || '').trim()
  };
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
    // Already an endpoint.
  } else {
    pathname = `${pathname}/responses`;
  }

  targetUrl.pathname = pathname;
  return targetUrl.toString();
}

module.exports = {
  CODEX_CLIENT_VERSION,
  CODEX_ORIGINATOR,
  buildCodexTargetUrl,
  createCodexRequest,
  normalizeCodexResponsesInput
};
