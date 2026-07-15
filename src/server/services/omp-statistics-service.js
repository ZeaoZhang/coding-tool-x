const {
  recordRequest: recordSharedRequest,
  getStatistics: getSharedStatistics,
  getDailyStatistics: getSharedDailyStatistics,
  getTodayStatistics: getSharedTodayStatistics
} = require('./statistics-service');
const { normalizeUsageTokens, toNumber } = require('./proxy-log-helper');

const TOOL_TYPE = 'omp';

function initAggregateEntry(name = '') {
  return {
    name,
    requests: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cached: 0,
      total: 0
    },
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
    source: 'shared-stats',
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
    source: 'shared-stats',
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

function getSessionTimestamp(session = {}) {
  const value = session.timestamp || session.mtime || session.mtimeMs || null;
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function getSessionDateKey(session = {}) {
  const date = getSessionTimestamp(session);
  return date ? date.toISOString().slice(0, 10) : null;
}

function getSessionUsage(session = {}) {
  return normalizeUsageTokens(TOOL_TYPE, session.usage || session.tokens || {});
}

function addSessionUsage(entry, session) {
  const tokens = getSessionUsage(session);
  if (!tokens.total && !tokens.input && !tokens.output && !tokens.reasoning && !tokens.cached) {
    return false;
  }

  entry.requests += 1;
  entry.tokens.input += tokens.input;
  entry.tokens.output += tokens.output;
  entry.tokens.reasoning += tokens.reasoning;
  entry.tokens.cached += tokens.cached;
  entry.tokens.total += tokens.total;
  entry.cost += toNumber(session.cost || session.usage?.cost || 0);

  const timestamp = getSessionTimestamp(session);
  if (timestamp) {
    const iso = timestamp.toISOString();
    if (!entry.firstUsed || iso < entry.firstUsed) entry.firstUsed = iso;
    if (!entry.lastUsed || iso > entry.lastUsed) entry.lastUsed = iso;
  }

  return true;
}

function readSessionUsage() {
  try {
    const { getAllSessions } = require('./omp-sessions');
    const sessions = getAllSessions();
    return Array.isArray(sessions) ? sessions : [];
  } catch {
    return [];
  }
}

function buildSessionDerivedStatistics(sessions = readSessionUsage()) {
  const globalEntry = initAggregateEntry('OMP Sessions');
  const byChannel = {};
  const byModel = {};

  sessions.forEach((session) => {
    const tokens = getSessionUsage(session);
    if (!tokens.total && !tokens.input && !tokens.output && !tokens.reasoning && !tokens.cached) {
      return;
    }

    addSessionUsage(globalEntry, session);

    const channelKey = session.provider || 'omp-session';
    if (!byChannel[channelKey]) {
      byChannel[channelKey] = initAggregateEntry(session.provider || 'OMP Session');
    }
    addSessionUsage(byChannel[channelKey], session);

    const modelKey = session.model || 'unknown';
    if (!byModel[modelKey]) {
      byModel[modelKey] = initAggregateEntry(modelKey);
    }
    addSessionUsage(byModel[modelKey], session);
  });

  return {
    version: '1.0',
    source: globalEntry.requests > 0 ? 'sessions' : 'empty',
    lastUpdated: globalEntry.lastUsed || new Date().toISOString(),
    global: {
      totalRequests: globalEntry.requests,
      totalTokens: globalEntry.tokens.total,
      totalCost: globalEntry.cost
    },
    byChannel: Object.fromEntries(
      Object.entries(byChannel).map(([key, value]) => [key, toLegacyEntryShape(value, true)])
    ),
    byModel: Object.fromEntries(
      Object.entries(byModel).map(([key, value]) => [key, toLegacyEntryShape(value)])
    )
  };
}

function buildSessionDerivedDailyStatistics(date, sessions = readSessionUsage()) {
  const globalEntry = initAggregateEntry('OMP Sessions');
  const byChannel = {};
  const byModel = {};

  sessions
    .filter(session => getSessionDateKey(session) === date)
    .forEach((session) => {
      const tokens = getSessionUsage(session);
      if (!tokens.total && !tokens.input && !tokens.output && !tokens.reasoning && !tokens.cached) {
        return;
      }

      addSessionUsage(globalEntry, session);

      const channelKey = session.provider || 'omp-session';
      if (!byChannel[channelKey]) {
        byChannel[channelKey] = initAggregateEntry(session.provider || 'OMP Session');
      }
      addSessionUsage(byChannel[channelKey], session);

      const modelKey = session.model || 'unknown';
      if (!byModel[modelKey]) {
        byModel[modelKey] = initAggregateEntry(modelKey);
      }
      addSessionUsage(byModel[modelKey], session);
    });

  return {
    date,
    source: globalEntry.requests > 0 ? 'sessions' : 'empty',
    summary: {
      requests: globalEntry.requests,
      tokens: globalEntry.tokens.total,
      cost: globalEntry.cost
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
  const shared = buildSummaryStatistics(getSharedStatistics());
  return hasSummaryData(shared) ? shared : buildSessionDerivedStatistics();
}

function getDailyStatistics(date) {
  const shared = buildDailyStatistics(getSharedDailyStatistics(date), date);
  return hasDailyData(shared) ? shared : buildSessionDerivedDailyStatistics(date);
}

function getTodayStatistics() {
  const shared = buildDailyStatistics(getSharedTodayStatistics());
  return hasDailyData(shared)
    ? shared
    : buildSessionDerivedDailyStatistics(shared.date || new Date().toISOString().slice(0, 10));
}

module.exports = {
  recordRequest,
  getStatistics,
  getDailyStatistics,
  getTodayStatistics,
  _test: {
    buildSessionDerivedStatistics,
    buildSessionDerivedDailyStatistics
  }
};
