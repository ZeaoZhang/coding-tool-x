const {
  recordRequest: recordSharedRequest,
  getStatistics: getSharedStatistics,
  getDailyStatistics: getSharedDailyStatistics,
  getTodayStatistics: getSharedTodayStatistics
} = require('./statistics-service');
const { normalizeUsageTokens, toNumber } = require('./proxy-log-helper');

const TOOL_TYPE = 'pi';

function toLegacyEntryShape(entry = {}, includeName = false) {
  const normalized = normalizeUsageTokens(TOOL_TYPE, entry.tokens || {});
  const result = {
    requests: toNumber(entry.requests),
    tokens: {
      input: normalized.input,
      output: normalized.output,
      reasoning: normalized.reasoning,
      cached: normalized.cached,
      total: normalized.total
    },
    cost: toNumber(entry.cost)
  };

  if (includeName) {
    result.name = entry.name || '';
    if (entry.firstUsed) result.firstUsed = entry.firstUsed;
    if (entry.lastUsed) result.lastUsed = entry.lastUsed;
  }

  return result;
}

function pickToolScope(sharedStats = {}) {
  const byToolType = sharedStats.byToolType || {};
  const toolScope = byToolType[TOOL_TYPE] || {};

  const byChannel = toolScope.channels && typeof toolScope.channels === 'object'
    ? toolScope.channels
    : Object.fromEntries(
      Object.entries(sharedStats.byChannel || {}).filter(([, value]) => value?.toolType === TOOL_TYPE)
    );

  const byModel = toolScope.models && typeof toolScope.models === 'object'
    ? toolScope.models
    : Object.fromEntries(
      Object.entries(sharedStats.byModel || {}).filter(([, value]) => value?.toolType === TOOL_TYPE)
    );

  return { toolScope, byChannel, byModel };
}

function buildSummaryStatistics(sharedStats = {}) {
  const { toolScope, byChannel, byModel } = pickToolScope(sharedStats);
  const normalized = toLegacyEntryShape(toolScope);

  return {
    version: '1.0',
    lastUpdated: sharedStats.lastUpdated || new Date().toISOString(),
    global: {
      totalRequests: normalized.requests,
      totalTokens: normalized.tokens.total,
      totalCost: normalized.cost
    },
    byChannel: Object.fromEntries(
      Object.entries(byChannel).map(([key, value]) => [key, toLegacyEntryShape(value, true)])
    ),
    byModel: Object.fromEntries(
      Object.entries(byModel).map(([key, value]) => [key, toLegacyEntryShape(value)])
    )
  };
}

function buildDailyStatistics(sharedDaily = {}, fallbackDate) {
  const { byToolType = {} } = sharedDaily;
  const toolScope = byToolType[TOOL_TYPE] || {};
  const normalized = toLegacyEntryShape(toolScope);
  const byChannel = toolScope.channels || {};
  const byModel = toolScope.models || {};

  return {
    date: sharedDaily.date || fallbackDate,
    summary: {
      requests: normalized.requests,
      tokens: normalized.tokens.total,
      cost: normalized.cost
    },
    byChannel: Object.fromEntries(
      Object.entries(byChannel).map(([key, value]) => [key, toLegacyEntryShape(value, true)])
    ),
    byModel: Object.fromEntries(
      Object.entries(byModel).map(([key, value]) => [key, toLegacyEntryShape(value)])
    )
  };
}

function recordRequest(requestData = {}) {
  const normalizedTokens = normalizeUsageTokens(TOOL_TYPE, requestData.tokens || {});
  return recordSharedRequest({
    ...requestData,
    toolType: TOOL_TYPE,
    tokens: {
      input: normalizedTokens.input,
      output: normalizedTokens.output,
      reasoning: normalizedTokens.reasoning,
      cached: normalizedTokens.cached,
      cacheCreation: normalizedTokens.cacheCreation,
      cacheRead: normalizedTokens.cacheRead,
      total: normalizedTokens.total
    }
  });
}

function getStatistics() {
  return buildSummaryStatistics(getSharedStatistics());
}

function getDailyStatistics(date) {
  return buildDailyStatistics(getSharedDailyStatistics(date), date);
}

function getTodayStatistics() {
  return buildDailyStatistics(getSharedTodayStatistics());
}

module.exports = {
  recordRequest,
  getStatistics,
  getDailyStatistics,
  getTodayStatistics
};
