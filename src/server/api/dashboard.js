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
const { projectCountKey } = require('../services/project-snapshots');
const { runDashboardSnapshotWorker } = require('../services/dashboard-snapshot-worker');

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

function channelSnapshotKey(source) {
  return `dashboard:channels:${source}`;
}

function todayStatsSnapshotKey(source) {
  return `dashboard:today-stats:${source}`;
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

async function readDashboardSnapshot(kind, source, key, fallbackValue, config = {}, options = {}) {
  const force = options.force === true;
  return getSnapshot(key, {
    ttlMs: SNAPSHOT_TTL_MS,
    fallbackValue,
    force,
    staleWhileForce: force,
    deferMs: DASHBOARD_SNAPSHOT_DEFER_MS,
    refresh: () => runDashboardSnapshotWorker(kind, source, config, { force })
  });
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

    const [
      claudeChannels,
      codexChannels,
      geminiChannels,
      opencodeChannels,
      ompChannels,
      claudeTodayStats,
      codexTodayStats,
      geminiTodayStats,
      opencodeTodayStats,
      ompTodayStats,
      claudeCounts,
      codexCounts,
      geminiCounts,
      opencodeCounts,
      ompCounts
    ] = await Promise.all([
      readDashboardSnapshot('channels', 'claude', channelSnapshotKey('claude'), [], config, { force }),
      readDashboardSnapshot('channels', 'codex', channelSnapshotKey('codex'), { channels: [] }, config, { force }),
      readDashboardSnapshot('channels', 'gemini', channelSnapshotKey('gemini'), { channels: [] }, config, { force }),
      readDashboardSnapshot('channels', 'opencode', channelSnapshotKey('opencode'), { channels: [] }, config, { force }),
      readDashboardSnapshot('channels', 'omp', channelSnapshotKey('omp'), { channels: [] }, config, { force }),
      readDashboardSnapshot('todayStats', 'claude', todayStatsSnapshotKey('claude'), null, config, { force }),
      readDashboardSnapshot('todayStats', 'codex', todayStatsSnapshotKey('codex'), null, config, { force }),
      readDashboardSnapshot('todayStats', 'gemini', todayStatsSnapshotKey('gemini'), null, config, { force }),
      readDashboardSnapshot('todayStats', 'opencode', todayStatsSnapshotKey('opencode'), null, config, { force }),
      readDashboardSnapshot('todayStats', 'omp', todayStatsSnapshotKey('omp'), null, config, { force }),
      readDashboardSnapshot('counts', 'claude', projectCountKey('claude'), EMPTY_COUNTS, config, { force }),
      readDashboardSnapshot('counts', 'codex', projectCountKey('codex'), EMPTY_COUNTS, config, { force }),
      readDashboardSnapshot('counts', 'gemini', projectCountKey('gemini'), EMPTY_COUNTS, config, { force }),
      readDashboardSnapshot('counts', 'opencode', projectCountKey('opencode'), EMPTY_COUNTS, config, { force }),
      readDashboardSnapshot('counts', 'omp', projectCountKey('omp'), EMPTY_COUNTS, config, { force })
    ]);

    const parts = {
      counts: summarizePart({
        claude: claudeCounts,
        codex: codexCounts,
        gemini: geminiCounts,
        opencode: opencodeCounts,
        omp: ompCounts
      }),
      todayStats: summarizePart({
        claude: claudeTodayStats,
        codex: codexTodayStats,
        gemini: geminiTodayStats,
        opencode: opencodeTodayStats,
        omp: ompTodayStats
      }),
      channels: summarizePart({
        claude: claudeChannels,
        codex: codexChannels,
        gemini: geminiChannels,
        opencode: opencodeChannels,
        omp: ompChannels
      })
    };

    res.json({
      success: true,
      data: {
        uiConfig,
        favorites,
        channels: {
          claude: claudeChannels.value,
          codex: codexChannels.value,
          gemini: geminiChannels.value,
          opencode: opencodeChannels.value.channels || [],
          omp: ompChannels.value.channels || []
        },
        proxyStatus,
        counts: {
          claude: claudeCounts.value || EMPTY_COUNTS,
          codex: codexCounts.value || EMPTY_COUNTS,
          gemini: geminiCounts.value || EMPTY_COUNTS,
          opencode: opencodeCounts.value || EMPTY_COUNTS,
          omp: ompCounts.value || EMPTY_COUNTS
        },
        todayStats: {
          claude: formatStats(claudeTodayStats.value),
          codex: formatStats(codexTodayStats.value),
          gemini: formatStats(geminiTodayStats.value),
          opencode: formatStats(opencodeTodayStats.value),
          omp: formatStats(ompTodayStats.value)
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
