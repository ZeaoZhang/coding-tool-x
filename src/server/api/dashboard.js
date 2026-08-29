const express = require('express');
const router = express.Router();
const { loadConfig } = require('../../config/loader');

// Services
const { loadUIConfig } = require('../services/ui-config');
const { loadFavorites } = require('../services/favorites');
const { getProxyStatus } = require('../proxy-server');
const { getCodexProxyStatus } = require('../codex-proxy-server');
const { getGeminiProxyStatus } = require('../gemini-proxy-server');
const { getOpenCodeProxyStatus } = require('../opencode-proxy-server');
const { getOmpProxyStatus } = require('../omp-proxy-server');
const { getSnapshot } = require('../services/snapshot-cache');
const { runDashboardSourceWorker } = require('../services/dashboard-snapshot-worker');
const SNAPSHOT_TTL_MS = 60 * 1000;
const DASHBOARD_SNAPSHOT_DEFER_MS = 0;
const EMPTY_COUNTS = { projectCount: 0, sessionCount: 0 };
const EMPTY_STATS = { requests: 0, tokens: 0, cost: 0, byModel: {}, byChannel: {} };

function safeRead(label, reader, fallback) {
  try {
    return reader();
  } catch (error) {
    console.warn(`[Dashboard] ${label} failed:`, error.message);
    return fallback;
  }
}

function sourceSnapshotKey(source) {
  return `dashboard:source:${source}`;
}

function normalizeChannelTokens(tokens) {
  if (tokens && typeof tokens === 'object') {
    return Number(tokens.total ?? tokens.input ?? 0) || 0;
  }
  return Number(tokens) || 0;
}

function normalizeByChannel(byChannel = {}) {
  if (!byChannel || typeof byChannel !== 'object') {
    return {};
  }

  return Object.fromEntries(Object.entries(byChannel).map(([channelId, item = {}]) => [
    channelId,
    {
      ...item,
      requests: Number(item.requests) || 0,
      tokens: normalizeChannelTokens(item.tokens),
      cost: Number(item.cost) || 0
    }
  ]));
}

// 格式化统计数据：取 summary、byModel 和 byChannel 中的数据
function formatStats(stats) {
  if (stats && stats.summary) {
    return {
      requests: stats.summary.requests || 0,
      tokens: normalizeChannelTokens(stats.summary.tokens),
      cost: stats.summary.cost || 0,
      byModel: stats.byModel || {},
      byChannel: normalizeByChannel(stats.byChannel || {})
    };
  }
  return { ...EMPTY_STATS };
}

async function readDashboardSnapshot(source, fallbackValue, config = {}, options = {}) {
  const force = options.force === true;
  const key = sourceSnapshotKey(source);
  const makeReadOptions = (effectiveForce) => ({
    ttlMs: SNAPSHOT_TTL_MS,
    fallbackValue,
    force: effectiveForce,
    staleWhileForce: effectiveForce,
    deferMs: DASHBOARD_SNAPSHOT_DEFER_MS,
    refresh: () => runDashboardSourceWorker(source, config, { force: effectiveForce })
  });
  const snapshot = await getSnapshot(key, makeReadOptions(force));
  const generatedAtMs = Date.parse(snapshot.meta?.generatedAt || '');
  const errorAgeMs = Number.isFinite(generatedAtMs) ? Date.now() - generatedAtMs : SNAPSHOT_TTL_MS;
  if (!force
    && errorAgeMs >= SNAPSHOT_TTL_MS
    && Array.isArray(snapshot.value?.__errors)
    && snapshot.value.__errors.length > 0) {
    return getSnapshot(key, makeReadOptions(true));
  }
  return snapshot;
}

function sourceFallback(source) {
  return {
    channels: source === 'claude' ? [] : { channels: [] },
    todayStats: null,
    counts: EMPTY_COUNTS
  };
}


function summarizePart(partSnapshots = {}) {
  const items = {};
  let stale = false;
  let refreshing = false;
  let generatedAt = null;

  Object.entries(partSnapshots).forEach(([source, snapshot]) => {
    const meta = snapshot.meta || {};
    items[source] = meta;
    stale = stale || Boolean(meta.stale);
    refreshing = refreshing || Boolean(meta.refreshing);
    if (meta.generatedAt && (!generatedAt || meta.generatedAt > generatedAt)) {
      generatedAt = meta.generatedAt;
    }
  });

  return {
    generatedAt,
    stale,
    refreshing,
    items
  };
}

function dashboardMeta(parts) {
  const partValues = Object.values(parts);
  return {
    generatedAt: new Date().toISOString(),
    stale: partValues.some(part => part.stale),
    refreshing: partValues.some(part => part.refreshing),
    parts
  };
}

/**
 * GET /api/dashboard/init
 * 聚合首页所需的所有数据，一次请求返回
 */
router.get('/init', async (req, res) => {
  try {
    const config = loadConfig();
    const force = req.query?.fresh === '1' || req.query?.force === '1';
    const uiConfig = safeRead('uiConfig', () => loadUIConfig(), {});
    const favorites = safeRead('favorites', () => loadFavorites(), {});
    const proxyStatus = {
      claude: safeRead('claude proxy status', () => getProxyStatus(), {}),
      codex: safeRead('codex proxy status', () => getCodexProxyStatus(), {}),
      gemini: safeRead('gemini proxy status', () => getGeminiProxyStatus(), {}),
      opencode: safeRead('opencode proxy status', () => getOpenCodeProxyStatus(), {}),
      omp: safeRead('omp proxy status', () => getOmpProxyStatus(), {})
    };

    const sources = ['claude', 'codex', 'gemini', 'opencode', 'omp'];
    const sourceFallbackPayload = (source) => ({
      channels: source === 'claude' ? [] : { channels: [] },
      todayStats: null,
      counts: EMPTY_COUNTS
    });
    const sourceSnapshots = await Promise.all(sources.map(async (source) => {
      const snapshot = await readDashboardSnapshot(source, sourceFallbackPayload(source), config, { force });
      return [source, snapshot];
    }));
    const snapshotsBySource = Object.fromEntries(sourceSnapshots);

    const capabilitySnapshot = (source, capability) => {
      const snapshot = snapshotsBySource[source];
      const value = snapshot.value || sourceFallbackPayload(source);
      const failure = Array.isArray(value.__errors)
        ? value.__errors.find(error => error.capability === capability
          || (capability === 'todayStats' && error.capability === 'statistics'))
        : null;
      const meta = { ...(snapshot.meta || {}) };
      if (failure) {
        meta.stale = true;
        meta.error = failure.error || 'dashboard capability failed';
        if (failure.retryable !== undefined) meta.retryable = failure.retryable;
        if (failure.retryAfter !== undefined) meta.retryAfter = failure.retryAfter;
        if (failure.code !== undefined) meta.code = failure.code;
      }
      return { value: value[capability], meta };
    };
    const parts = {
      counts: summarizePart(Object.fromEntries(sources.map(source => [source, capabilitySnapshot(source, 'counts')]))),
      todayStats: summarizePart(Object.fromEntries(sources.map(source => [source, capabilitySnapshot(source, 'todayStats')]))),
      channels: summarizePart(Object.fromEntries(sources.map(source => [source, capabilitySnapshot(source, 'channels')]))),
    };
    const capabilityValueFor = (source, capability) => capabilitySnapshot(source, capability).value;

    res.json({
      success: true,
      data: {
        uiConfig,
        favorites,
        channels: {
          claude: capabilityValueFor('claude', 'channels'),
          codex: capabilityValueFor('codex', 'channels'),
          gemini: capabilityValueFor('gemini', 'channels'),
          opencode: capabilityValueFor('opencode', 'channels')?.channels || [],
          omp: capabilityValueFor('omp', 'channels')?.channels || []
        },
        proxyStatus,
        counts: {
          claude: capabilityValueFor('claude', 'counts') || EMPTY_COUNTS,
          codex: capabilityValueFor('codex', 'counts') || EMPTY_COUNTS,
          gemini: capabilityValueFor('gemini', 'counts') || EMPTY_COUNTS,
          opencode: capabilityValueFor('opencode', 'counts') || EMPTY_COUNTS,
          omp: capabilityValueFor('omp', 'counts') || EMPTY_COUNTS
        },
        todayStats: {
          claude: formatStats(capabilityValueFor('claude', 'todayStats')),
          codex: formatStats(capabilityValueFor('codex', 'todayStats')),
          gemini: formatStats(capabilityValueFor('gemini', 'todayStats')),
          opencode: formatStats(capabilityValueFor('opencode', 'todayStats')),
          omp: formatStats(capabilityValueFor('omp', 'todayStats'))
        },
        meta: dashboardMeta(parts)
      }
    });
  } catch (error) {
    console.error('Dashboard init error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
