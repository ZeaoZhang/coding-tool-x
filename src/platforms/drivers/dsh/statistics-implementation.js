'use strict';

const {
  recordRequest: recordSharedRequest,
  getStatistics: getSharedStatistics,
  getDailyStatistics: getSharedDailyStatistics,
  getTodayStatistics: getSharedTodayStatistics
} = require('../../../server/services/statistics-service');
const { normalizeUsageTokens, toNumber } = require('../../../server/services/usage-log-utils');
const { decodeArtifact, listArtifacts } = require('./sessions');
const { normalizeDshEvent } = require('./native-logs');

const TOOL_TYPE = 'dsh';
let configuredContext = {};

function configure(context = {}) {
  configuredContext = context;
}

function initAggregateEntry(name = '') {
  return {
    name,
    requests: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cached: 0, total: 0 },
    cost: 0,
    firstUsed: null,
    lastUsed: null
  };
}

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
    : Object.fromEntries(Object.entries(sharedStats.byChannel || {}).filter(([, value]) => value?.toolType === TOOL_TYPE));
  const byModel = toolScope.models && typeof toolScope.models === 'object'
    ? toolScope.models
    : Object.fromEntries(Object.entries(sharedStats.byModel || {}).filter(([, value]) => value?.toolType === TOOL_TYPE));
  return { toolScope, byChannel, byModel };
}

function buildSummaryStatistics(sharedStats = {}) {
  const { toolScope, byChannel, byModel } = pickToolScope(sharedStats);
  const normalized = toLegacyEntryShape(toolScope);
  return {
    version: '1.0',
    source: 'shared-stats',
    lastUpdated: sharedStats.lastUpdated || new Date().toISOString(),
    global: {
      totalRequests: normalized.requests,
      totalTokens: normalized.tokens.total,
      totalCost: normalized.cost
    },
    byChannel: Object.fromEntries(Object.entries(byChannel).map(([key, value]) => [key, toLegacyEntryShape(value, true)])),
    byModel: Object.fromEntries(Object.entries(byModel).map(([key, value]) => [key, toLegacyEntryShape(value)]))
  };
}

function buildDailyStatistics(sharedDaily = {}, fallbackDate) {
  const toolScope = sharedDaily.byToolType?.[TOOL_TYPE] || {};
  const normalized = toLegacyEntryShape(toolScope);
  return {
    date: sharedDaily.date || fallbackDate,
    source: 'shared-stats',
    summary: {
      requests: normalized.requests,
      tokens: normalized.tokens.total,
      cost: normalized.cost
    },
    byChannel: Object.fromEntries(Object.entries(toolScope.channels || {}).map(([key, value]) => [key, toLegacyEntryShape(value, true)])),
    byModel: Object.fromEntries(Object.entries(toolScope.models || {}).map(([key, value]) => [key, toLegacyEntryShape(value)]))
  };
}

function hasSummaryData(summary = {}) {
  return Boolean(
    summary.global?.totalRequests
    || summary.global?.totalTokens
    || summary.global?.totalCost
    || Object.keys(summary.byChannel || {}).length
    || Object.keys(summary.byModel || {}).length
  );
}

function hasDailyData(daily = {}) {
  return Boolean(
    daily.summary?.requests
    || daily.summary?.tokens
    || daily.summary?.cost
    || Object.keys(daily.byChannel || {}).length
    || Object.keys(daily.byModel || {}).length
  );
}

function eventDateKey(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function resolveDate(value) {
  if (value && typeof value === 'object') {
    return value.params?.date || value.query?.date || eventDateKey(Date.now());
  }
  return value || eventDateKey(Date.now());
}

function dateStartTimestamp(dateKey) {
  const parsed = Date.parse(`${dateKey}T00:00:00+08:00`);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function addUsage(entry, event) {
  const tokens = normalizeUsageTokens(TOOL_TYPE, event.tokens || {});
  if (!tokens.total && !tokens.input && !tokens.output && !tokens.reasoning && !tokens.cached) return false;
  entry.requests += 1;
  entry.tokens.input += tokens.input;
  entry.tokens.output += tokens.output;
  entry.tokens.reasoning += tokens.reasoning;
  entry.tokens.cached += tokens.cached;
  entry.tokens.total += tokens.total;
  entry.cost += toNumber(event.cost);
  const iso = new Date(event.timestamp).toISOString();
  if (!entry.firstUsed || iso < entry.firstUsed) entry.firstUsed = iso;
  if (!entry.lastUsed || iso > entry.lastUsed) entry.lastUsed = iso;
  return true;
}

function aggregateArtifactUsage(artifact, date, global, byChannel, byModel) {
  let parsed;
  try {
    parsed = decodeArtifact(artifact.filePath);
  } catch (_) {
    return;
  }
  const sessionId = parsed.header?.id || artifact.header?.id;
  for (let index = 0; index < parsed.events.length; index += 1) {
    const normalized = normalizeDshEvent(parsed.events[index], artifact.filePath, index);
    if (!normalized) continue;
    if (date && eventDateKey(normalized.timestamp) !== date) continue;
    const event = sessionId ? { ...normalized, sessionId } : normalized;
    if (!addUsage(global, event)) continue;
    const channel = event.channel || event.provider || 'dsh-session';
    const model = event.model || 'unknown';
    byChannel[channel] ||= initAggregateEntry(channel || 'DSH Session');
    byModel[model] ||= initAggregateEntry(model);
    addUsage(byChannel[channel], event);
    addUsage(byModel[model], event);
  }
}

function aggregateSessionUsage({ date = null } = {}) {
  const global = initAggregateEntry('DSH Sessions');
  const byChannel = {};
  const byModel = {};
  let artifacts = [];
  try {
    artifacts = listArtifacts(configuredContext, {
      includeEvents: false,
      includeFirstMessage: false,
      minMtimeMs: date ? dateStartTimestamp(date) : 0
    });
  } catch (_) {
    return { global, byChannel, byModel };
  }
  for (const artifact of artifacts) {
    if (artifact.projectName === '__invalid__') continue;
    aggregateArtifactUsage(artifact, date, global, byChannel, byModel);
  }
  return { global, byChannel, byModel };
}

function buildSummaryFromAggregate({ global, byChannel, byModel }) {
  return {
    version: '1.0',
    source: global.requests ? 'sessions' : 'empty',
    lastUpdated: global.lastUsed || new Date().toISOString(),
    global: { totalRequests: global.requests, totalTokens: global.tokens.total, totalCost: global.cost },
    byChannel: Object.fromEntries(Object.entries(byChannel).map(([key, value]) => [key, toLegacyEntryShape(value, true)])),
    byModel: Object.fromEntries(Object.entries(byModel).map(([key, value]) => [key, toLegacyEntryShape(value)]))
  };
}

function buildDailyFromAggregate(date, aggregate) {
  const daily = buildSummaryFromAggregate(aggregate);
  return {
    date,
    source: daily.source,
    summary: {
      requests: daily.global.totalRequests,
      tokens: daily.global.totalTokens,
      cost: daily.global.totalCost
    },
    byChannel: daily.byChannel,
    byModel: daily.byModel
  };
}

function buildSessionDerivedStatistics() {
  return buildSummaryFromAggregate(aggregateSessionUsage());
}

function buildSessionDerivedDailyStatistics(date) {
  return buildDailyFromAggregate(date, aggregateSessionUsage({ date }));
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
  const shared = buildSummaryStatistics(getSharedStatistics());
  return hasSummaryData(shared) ? shared : buildSessionDerivedStatistics();
}

function getDailyStatistics(date) {
  const requestedDate = resolveDate(date);
  const shared = buildDailyStatistics(getSharedDailyStatistics(requestedDate), requestedDate);
  return hasDailyData(shared) ? shared : buildSessionDerivedDailyStatistics(requestedDate);
}

function getTodayStatistics() {
  const shared = buildDailyStatistics(getSharedTodayStatistics());
  const date = shared.date || eventDateKey(Date.now());
  return hasDailyData(shared) ? shared : buildSessionDerivedDailyStatistics(date);
}

module.exports = {
  configure,
  recordRequest,
  getStatistics,
  getDailyStatistics,
  getTodayStatistics,
  _test: { buildSessionDerivedStatistics, buildSessionDerivedDailyStatistics }
};
