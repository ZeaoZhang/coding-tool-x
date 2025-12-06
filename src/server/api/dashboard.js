const express = require('express');
const router = express.Router();
const { loadConfig } = require('../../config/loader');

// Services
const { loadUIConfig } = require('../services/ui-config');
const { loadFavorites } = require('../services/favorites');
const { getAllChannels } = require('../services/channels');
const { getProxyStatus } = require('../proxy-server');
const { getCodexProxyStatus } = require('../codex-proxy-server');
const { getGeminiProxyStatus } = require('../gemini-proxy-server');
const { getProjectAndSessionCounts: getClaudeCounts } = require('../services/sessions');
const { getProjectAndSessionCounts: getCodexCounts } = require('../services/codex-sessions');
const { getProjectAndSessionCounts: getGeminiCounts } = require('../services/gemini-sessions');

// Channel-specific services
const { getChannels: getCodexChannels } = require('../services/codex-channels');
const { getChannels: getGeminiChannels } = require('../services/gemini-channels');

// Statistics
const { getTodayStatistics } = require('../services/statistics-service');
const { getTodayStatistics: getCodexTodayStatistics } = require('../services/codex-statistics-service');
const { getTodayStatistics: getGeminiTodayStatistics } = require('../services/gemini-statistics-service');

/**
 * GET /api/dashboard/init
 * 聚合首页所需的所有数据，一次请求返回
 */
router.get('/init', async (req, res) => {
  try {
    const config = loadConfig();

    // 并行获取所有数据
    const [
      uiConfig,
      favorites,
      claudeChannels,
      codexChannels,
      geminiChannels,
      claudeProxyStatus,
      codexProxyStatus,
      geminiProxyStatus,
      claudeTodayStats,
      codexTodayStats,
      geminiTodayStats,
      claudeCounts,
      codexCounts,
      geminiCounts
    ] = await Promise.all([
      // UI Config
      Promise.resolve(loadUIConfig()),

      // Favorites
      Promise.resolve(loadFavorites()),

      // Channels
      Promise.resolve(getAllChannels()),
      Promise.resolve(getCodexChannels()),
      Promise.resolve(getGeminiChannels()),

      // Proxy Status
      Promise.resolve(getProxyStatus()),
      Promise.resolve(getCodexProxyStatus()),
      Promise.resolve(getGeminiProxyStatus()),

      // Today Stats (所有平台)
      Promise.resolve(getTodayStatistics()),
      Promise.resolve(getCodexTodayStatistics()),
      Promise.resolve(getGeminiTodayStatistics()),

      // 轻量级统计
      Promise.resolve(getClaudeCounts(config)),
      Promise.resolve(getCodexCounts()),
      Promise.resolve(getGeminiCounts())
    ]);

    // 格式化统计数据：取 summary 中的数据
    const formatStats = (stats) => {
      if (stats && stats.summary) {
        return {
          requests: stats.summary.requests || 0,
          tokens: stats.summary.tokens || 0,
          cost: stats.summary.cost || 0
        };
      }
      return { requests: 0, tokens: 0, cost: 0 };
    };

    res.json({
      success: true,
      data: {
        uiConfig,
        favorites,
        channels: {
          claude: claudeChannels,
          codex: codexChannels,
          gemini: geminiChannels
        },
        proxyStatus: {
          claude: claudeProxyStatus,
          codex: codexProxyStatus,
          gemini: geminiProxyStatus
        },
        counts: {
          claude: claudeCounts || { projectCount: 0, sessionCount: 0 },
          codex: codexCounts || { projectCount: 0, sessionCount: 0 },
          gemini: geminiCounts || { projectCount: 0, sessionCount: 0 }
        },
        todayStats: {
          claude: formatStats(claudeTodayStats),
          codex: formatStats(codexTodayStats),
          gemini: formatStats(geminiTodayStats)
        }
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
