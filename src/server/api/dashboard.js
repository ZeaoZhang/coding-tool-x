const express = require('express');
const router = express.Router();
const { loadConfig } = require('../../config/loader');
const { DEFAULT_ENABLED_CLI_PLATFORMS } = require('../../shared/platforms');
const { getPlatformContext } = require('../platform-context');

// Services
const { loadUIConfig } = require('../services/ui-config');
const { loadFavorites } = require('../services/favorites');
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

function safeText(value, fallback = '') {
  const text = typeof value === 'string'
    ? value
    : typeof value === 'number'
      ? String(value)
      : fallback;
  return text.length > 1024 ? text.slice(0, 1024) : text;
}

function safeRetryAfter(value) {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
    ? value
    : undefined;
}
function safeCode(value) {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
    ? value
    : undefined;
}


function resolveEnabledSources(uiConfig = {}, registry = getPlatformContext().registry) {
  const definitions = registry?.list?.() || [];
  const knownKeys = new Set(
    definitions
      .map(platform => String(platform?.key || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const requested = Array.isArray(uiConfig.enabledCliPlatforms)
    ? uiConfig.enabledCliPlatforms
    : DEFAULT_ENABLED_CLI_PLATFORMS;
  const seen = new Set();

  return requested
    .map(platform => String(platform || '').trim().toLowerCase())
    .filter(platform => {
      if (!knownKeys.has(platform) || seen.has(platform)) return false;
      seen.add(platform);
      return true;
    });
}

async function readProxyStatus(source, runtime) {
  try {
    const driver = runtime?.getDriver?.(source, 'proxy');
    if (!driver || typeof driver.status !== 'function') {
      return { status: 'unsupported', platform: source, capability: 'proxy', operation: 'status' };
    }
    return await driver.status();
  } catch (error) {
    const failure = {
      status: typeof error?.status === 'string' ? safeText(error.status, 'failed') : 'failed',
      platform: source,
      capability: 'proxy',
      operation: 'status',
      error: safeText(error && error.message ? error.message : error, 'proxy status failed')
    };
    if (typeof error?.retryable === 'boolean') failure.retryable = error.retryable;
    const retryAfter = safeRetryAfter(error?.retryAfter);
    if (retryAfter !== undefined) {
      failure.retryAfter = retryAfter;
    }
    const code = safeCode(error?.code);
    if (code !== undefined) {
      failure.code = code;
    }
    return failure;
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
    refresh: () => runDashboardSourceWorker(source, config, {
      force: effectiveForce,
      runtime: options.runtime
    })
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

function sourceFallback(source, runtime) {
  const channelsDriver = runtime?.getDriver?.(source, 'channels');
  const channels = typeof channelsDriver?.normalizeDashboardChannels === 'function'
    ? channelsDriver.normalizeDashboardChannels(null)
    : { channels: [] };
  return {
    channels,
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
    const config = safeRead('config', () => loadConfig(), {});
    const force = req.query?.fresh === '1' || req.query?.force === '1';
    const uiConfig = safeRead('uiConfig', () => loadUIConfig(), {});
    const favorites = safeRead('favorites', () => loadFavorites(), {});
    const { registry, runtime } = getPlatformContext();
    const sources = resolveEnabledSources(uiConfig, registry);
    const sourceFallbackPayload = source => sourceFallback(source, runtime);
    const proxyStatusEntries = await Promise.all(sources.map(async source => [
      source,
      await readProxyStatus(source, runtime)
    ]));
    const proxyStatus = Object.fromEntries(proxyStatusEntries);
    const sourceSnapshots = await Promise.all(sources.map(async (source) => {
      const snapshot = await readDashboardSnapshot(
        source,
        sourceFallbackPayload(source),
        config,
        { force, runtime }
      );
      return [source, snapshot];
    }));
    const snapshotsBySource = Object.fromEntries(sourceSnapshots);

    const capabilitySnapshot = (source, capability) => {
      const snapshot = snapshotsBySource[source];
      const value = snapshot?.value || sourceFallbackPayload(source);
      const failure = Array.isArray(value.__errors)
        ? value.__errors.find(error => error.capability === capability
          || (capability === 'todayStats' && error.capability === 'statistics'))
        : null;
      const meta = { ...(snapshot?.meta || {}) };
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
    const channels = Object.fromEntries(sources.map(source => {
      const value = capabilityValueFor(source, 'channels');
      const driver = runtime?.getDriver?.(source, 'channels');
      return [
        source,
        typeof driver?.normalizeDashboardChannels === 'function'
          ? driver.normalizeDashboardChannels(value)
          : value
      ];
    }));
    const counts = Object.fromEntries(sources.map(source => [
      source,
      capabilityValueFor(source, 'counts') || EMPTY_COUNTS
    ]));
    const todayStats = Object.fromEntries(sources.map(source => [
      source,
      formatStats(capabilityValueFor(source, 'todayStats'))
    ]));

    res.json({
      success: true,
      data: {
        uiConfig,
        favorites,
        channels,
        proxyStatus,
        counts,
        todayStats,
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
