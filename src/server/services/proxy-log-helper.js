function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeToolSource(source = '') {
  const normalized = String(source || '').trim().toLowerCase();
  if (normalized === 'claude' || normalized === 'claude-code') return 'claude';
  if (normalized === 'codex') return 'codex';
  if (normalized === 'gemini') return 'gemini';
  if (normalized === 'opencode') return 'opencode';
  return 'claude';
}

function normalizeUsageTokens(source, tokens = {}) {
  const normalizedSource = normalizeToolSource(source);
  const input = toNumber(tokens.input);
  const output = toNumber(tokens.output);
  const cacheCreation = toNumber(tokens.cacheCreation);
  const cacheRead = toNumber(tokens.cacheRead);
  const cached = toNumber(tokens.cached);
  const reasoning = toNumber(tokens.reasoning);
  let total = toNumber(tokens.total);

  if (total <= 0) {
    if (normalizedSource === 'claude') {
      total = input + output + cacheCreation + cacheRead;
    } else {
      total = input + output;
    }
  }

  return {
    input,
    output,
    cacheCreation,
    cacheRead,
    cached,
    reasoning,
    total
  };
}

function hasMeaningfulUsage(source, tokens = {}) {
  const normalized = normalizeUsageTokens(source, tokens);
  if (normalized.total > 0) return true;
  if (normalized.input > 0 || normalized.output > 0) return true;
  if (normalized.cacheCreation > 0 || normalized.cacheRead > 0) return true;
  if (normalized.cached > 0 || normalized.reasoning > 0) return true;
  return false;
}

function formatRealtimeTime(timestamp = Date.now()) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function buildSuccessLogPayload({
  source,
  requestId,
  channel,
  model,
  originalModel,
  redirectedModel,
  tokens,
  cost = 0,
  timestamp = Date.now()
}) {
  const normalized = normalizeUsageTokens(source, tokens);
  const payload = {
    type: 'log',
    status: 'success',
    id: requestId,
    time: formatRealtimeTime(timestamp),
    channel,
    model: model || '',
    inputTokens: normalized.input,
    outputTokens: normalized.output,
    cacheCreation: normalized.cacheCreation,
    cacheRead: normalized.cacheRead,
    cachedTokens: normalized.cached,
    reasoningTokens: normalized.reasoning,
    totalTokens: normalized.total,
    cost,
    source: normalizeToolSource(source),
    timestamp
  };
  if (originalModel) {
    payload.originalModel = originalModel;
  }
  if (redirectedModel) {
    payload.redirectedModel = redirectedModel;
  }
  return payload;
}

function buildFailureLogPayload({
  source,
  requestId,
  channel,
  model,
  message,
  error,
  statusCode,
  stage,
  timestamp = Date.now()
}) {
  const errorMessage = String(
    error?.message
    || message
    || error
    || 'Request failed'
  );

  return {
    type: 'log',
    status: 'error',
    id: requestId || `${normalizeToolSource(source)}-error-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    time: formatRealtimeTime(timestamp),
    channel: channel || 'Unknown',
    model: model || '',
    message: errorMessage,
    error: errorMessage,
    statusCode: Number.isFinite(Number(statusCode)) ? Number(statusCode) : null,
    stage: stage || 'proxy',
    inputTokens: 0,
    outputTokens: 0,
    cacheCreation: 0,
    cacheRead: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    cost: 0,
    source: normalizeToolSource(source),
    timestamp
  };
}

function publishUsageLog({
  source,
  metadata = {},
  model,
  tokens,
  calculateCost,
  broadcastLog,
  recordRequest,
  recordSuccess,
  allowBroadcast = true
}) {
  if (!hasMeaningfulUsage(source, tokens)) {
    return null;
  }

  const normalizedSource = normalizeToolSource(source);
  const normalizedTokens = normalizeUsageTokens(normalizedSource, tokens);
  const requestId = metadata.id || `${normalizedSource}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const timestamp = Date.now();
  const cost = typeof calculateCost === 'function'
    ? calculateCost(model || '', normalizedTokens)
    : 0;

  if (allowBroadcast && typeof broadcastLog === 'function') {
    broadcastLog(buildSuccessLogPayload({
      source: normalizedSource,
      requestId,
      channel: metadata.channel,
      model,
      originalModel: metadata.originalModel,
      redirectedModel: metadata.redirectedModel,
      tokens: normalizedTokens,
      cost,
      timestamp
    }));
  }

  if (typeof recordRequest === 'function') {
    const entry = {
      id: requestId,
      timestamp: new Date(metadata.startTime || timestamp).toISOString(),
      toolType: normalizedSource === 'claude' ? 'claude-code' : normalizedSource,
      channel: metadata.channel,
      channelId: metadata.channelId,
      model: model || '',
      tokens: {
        input: normalizedTokens.input,
        output: normalizedTokens.output,
        reasoning: normalizedTokens.reasoning,
        cached: normalizedTokens.cached,
        cacheCreation: normalizedTokens.cacheCreation,
        cacheRead: normalizedTokens.cacheRead,
        total: normalizedTokens.total
      },
      duration: Math.max(0, timestamp - toNumber(metadata.startTime || timestamp)),
      success: true,
      cost
    };
    if (metadata.originalModel) {
      entry.originalModel = metadata.originalModel;
    }
    if (metadata.redirectedModel) {
      entry.redirectedModel = metadata.redirectedModel;
    }
    recordRequest(entry);
  }

  if (typeof recordSuccess === 'function' && metadata.channelId) {
    recordSuccess(metadata.channelId, normalizedSource);
  }

  return {
    cost,
    tokens: normalizedTokens,
    timestamp
  };
}

function publishFailureLog({
  source,
  metadata = {},
  channel,
  model,
  message,
  error,
  statusCode,
  stage,
  broadcastLog
}) {
  if (typeof broadcastLog !== 'function') {
    return null;
  }

  const payload = buildFailureLogPayload({
    source,
    requestId: metadata.id,
    channel: channel || metadata.channel,
    model: model || metadata.model,
    message,
    error,
    statusCode,
    stage
  });
  broadcastLog(payload);
  return payload;
}

module.exports = {
  toNumber,
  normalizeToolSource,
  normalizeUsageTokens,
  hasMeaningfulUsage,
  formatRealtimeTime,
  buildSuccessLogPayload,
  buildFailureLogPayload,
  publishUsageLog,
  publishFailureLog
};
