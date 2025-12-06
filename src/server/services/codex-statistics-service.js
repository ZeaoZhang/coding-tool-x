const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Codex 统计服务 - 数据采集和存储
 *
 * 文件结构：
 * ~/.claude/cc-tool/
 *   ├── codex-statistics.json         # Codex 总体统计
 *   └── codex-daily-stats/
 *       ├── 2025-12-05.json           # 每日汇总统计
 *       └── ...
 */

// 获取基础目录
function getBaseDir() {
  const dir = path.join(os.homedir(), '.claude', 'cc-tool');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// 获取每日统计目录
function getDailyStatsDir() {
  const dir = path.join(getBaseDir(), 'codex-daily-stats');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// 获取统计文件路径
function getStatisticsFilePath() {
  return path.join(getBaseDir(), 'codex-statistics.json');
}

// 获取每日统计文件路径
function getDailyStatsFilePath(date) {
  return path.join(getDailyStatsDir(), `${date}.json`);
}

// 初始化统计对象
function initStatsObject() {
  return {
    requests: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cached: 0,
      total: 0
    },
    cost: 0
  };
}

// 加载总体统计
function loadStatistics() {
  const filePath = getStatisticsFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('[Codex Statistics] Failed to load statistics:', err);
  }

  return {
    version: '1.0',
    lastUpdated: new Date().toISOString(),
    global: {
      totalRequests: 0,
      totalTokens: 0,
      totalCost: 0
    },
    byChannel: {},
    byModel: {}
  };
}

// 保存总体统计
function saveStatistics(stats) {
  const filePath = getStatisticsFilePath();
  stats.lastUpdated = new Date().toISOString();

  try {
    fs.writeFileSync(filePath, JSON.stringify(stats, null, 2), 'utf8');
  } catch (err) {
    console.error('[Codex Statistics] Failed to save statistics:', err);
  }
}

// 加载每日统计
function loadDailyStats(date) {
  const filePath = getDailyStatsFilePath(date);
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('[Codex Statistics] Failed to load daily stats:', err);
  }

  return {
    date: date,
    summary: {
      requests: 0,
      tokens: 0,
      cost: 0
    },
    byChannel: {},
    byModel: {}
  };
}

// 保存每日统计
function saveDailyStats(date, stats) {
  const filePath = getDailyStatsFilePath(date);

  try {
    fs.writeFileSync(filePath, JSON.stringify(stats, null, 2), 'utf8');
  } catch (err) {
    console.error('[Codex Statistics] Failed to save daily stats:', err);
  }
}

// 更新统计数据
function updateStats(stats, tokens, cost) {
  stats.requests += 1;
  if (stats.tokens) {
    stats.tokens.input += tokens.input || 0;
    stats.tokens.output += tokens.output || 0;
    stats.tokens.reasoning += tokens.reasoning || 0;
    stats.tokens.cached += tokens.cached || 0;
    stats.tokens.total += tokens.total || 0;
  }
  stats.cost += cost || 0;
}

/**
 * 记录一次请求
 * @param {Object} requestData - 请求数据
 */
function recordRequest(requestData) {
  try {
    const {
      timestamp = new Date().toISOString(),
      channel,
      channelId,
      model,
      tokens = {},
      cost = 0
    } = requestData;

    // 计算 total tokens
    const totalTokens = (tokens.input || 0) + (tokens.output || 0) + (tokens.reasoning || 0);
    tokens.total = totalTokens;

    // 1. 更新总体统计
    const globalStats = loadStatistics();

    globalStats.global.totalRequests += 1;
    globalStats.global.totalTokens += totalTokens;
    globalStats.global.totalCost += cost || 0;

    // 按渠道统计
    if (channelId) {
      if (!globalStats.byChannel[channelId]) {
        globalStats.byChannel[channelId] = {
          name: channel || channelId,
          ...initStatsObject(),
          firstUsed: timestamp,
          lastUsed: timestamp
        };
      }
      updateStats(globalStats.byChannel[channelId], tokens, cost);
      globalStats.byChannel[channelId].lastUsed = timestamp;
    }

    // 按模型统计
    if (model) {
      if (!globalStats.byModel[model]) {
        globalStats.byModel[model] = initStatsObject();
      }
      updateStats(globalStats.byModel[model], tokens, cost);
    }

    saveStatistics(globalStats);

    // 2. 更新每日统计
    const date = new Date(timestamp).toISOString().split('T')[0];
    const dailyStats = loadDailyStats(date);

    dailyStats.summary.requests += 1;
    dailyStats.summary.tokens += totalTokens;
    dailyStats.summary.cost += cost || 0;

    // 每日 - 按渠道统计
    if (channelId) {
      if (!dailyStats.byChannel[channelId]) {
        dailyStats.byChannel[channelId] = {
          name: channel || channelId,
          ...initStatsObject()
        };
      }
      updateStats(dailyStats.byChannel[channelId], tokens, cost);
    }

    // 每日 - 按模型统计
    if (model) {
      if (!dailyStats.byModel[model]) {
        dailyStats.byModel[model] = initStatsObject();
      }
      updateStats(dailyStats.byModel[model], tokens, cost);
    }

    saveDailyStats(date, dailyStats);

    console.log(`[Codex Statistics] Recorded request: channel=${channel}, model=${model}, tokens=${totalTokens}, cost=${cost}`);

  } catch (err) {
    console.error('[Codex Statistics] Failed to record request:', err);
  }
}

/**
 * 获取总体统计
 */
function getStatistics() {
  return loadStatistics();
}

/**
 * 获取每日统计
 */
function getDailyStatistics(date) {
  return loadDailyStats(date);
}

/**
 * 获取今日统计
 */
function getTodayStatistics() {
  const today = new Date().toISOString().split('T')[0];
  return loadDailyStats(today);
}

module.exports = {
  recordRequest,
  getStatistics,
  getDailyStatistics,
  getTodayStatistics
};
