const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * 统计服务 - 数据采集和存储
 *
 * 文件结构：
 * ~/.claude/cc-tool/
 *   ├── statistics.json              # 总体统计（实时更新）
 *   ├── daily-stats/
 *   │   ├── 2025-11-22.json         # 每日汇总统计
 *   │   └── 2025-11-23.json
 *   └── request-logs/
 *       ├── 2025-11/
 *       │   ├── 22.jsonl            # 每日详细日志（JSONL格式）
 *       │   └── 23.jsonl
 *       └── 2025-12/
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
  const dir = path.join(getBaseDir(), 'daily-stats');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// 获取请求日志目录
function getRequestLogsDir(year, month) {
  const baseDir = path.join(getBaseDir(), 'request-logs', `${year}-${month.toString().padStart(2, '0')}`);
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  return baseDir;
}

// 获取统计文件路径
function getStatisticsFilePath() {
  return path.join(getBaseDir(), 'statistics.json');
}

// 获取每日统计文件路径
function getDailyStatsFilePath(date) {
  // date 格式: YYYY-MM-DD
  return path.join(getDailyStatsDir(), `${date}.json`);
}

// 获取请求日志文件路径
function getRequestLogFilePath(year, month, day) {
  const dir = getRequestLogsDir(year, month);
  return path.join(dir, `${day.toString().padStart(2, '0')}.jsonl`);
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
    console.error('Failed to load statistics:', err);
  }

  // 返回默认结构
  return {
    version: '2.0',
    lastUpdated: new Date().toISOString(),
    global: {
      totalRequests: 0,
      totalTokens: 0,
      totalCost: 0
    },
    byToolType: {},
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
    console.error('Failed to save statistics:', err);
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
    console.error('Failed to load daily stats:', err);
  }

  // 返回默认结构
  return {
    date: date,
    summary: {
      requests: 0,
      tokens: 0,
      cost: 0
    },
    hourly: {},  // 按小时统计
    byToolType: {},
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
    console.error('Failed to save daily stats:', err);
  }
}

// 追加请求日志（JSONL格式）
function appendRequestLog(logEntry) {
  const timestamp = new Date(logEntry.timestamp);
  const year = timestamp.getFullYear();
  const month = timestamp.getMonth() + 1;
  const day = timestamp.getDate();

  const filePath = getRequestLogFilePath(year, month, day);

  try {
    // JSONL 格式：每行一个 JSON 对象
    const line = JSON.stringify(logEntry) + '\n';
    fs.appendFileSync(filePath, line, 'utf8');
  } catch (err) {
    console.error('Failed to append request log:', err);
  }
}

// 初始化统计对象
function initStatsObject() {
  return {
    requests: 0,
    tokens: {
      input: 0,
      output: 0,
      cacheCreation: 0,
      cacheRead: 0,
      total: 0
    },
    cost: 0
  };
}

// 更新统计数据
function updateStats(stats, tokens, cost) {
  stats.requests += 1;
  stats.tokens.input += tokens.input || 0;
  stats.tokens.output += tokens.output || 0;
  stats.tokens.cacheCreation += tokens.cacheCreation || 0;
  stats.tokens.cacheRead += tokens.cacheRead || 0;
  stats.tokens.total += tokens.total || 0;
  stats.cost += cost || 0;
}

/**
 * 记录一次请求
 * @param {Object} requestData - 请求数据
 */
function recordRequest(requestData) {
  try {
    const {
      id,
      timestamp,
      toolType = 'claude-code',
      channel,
      channelId,
      model,
      tokens,
      duration,
      success,
      cost = 0,
      session,
      project
    } = requestData;

    // 1. 写入详细日志
    const logEntry = {
      id,
      timestamp,
      toolType,
      channel,
      channelId,
      model,
      tokens,
      duration,
      success,
      cost,
      session,
      project
    };
    appendRequestLog(logEntry);

    // 2. 更新总体统计
    const globalStats = loadStatistics();

    // 更新全局统计
    globalStats.global.totalRequests += 1;
    globalStats.global.totalTokens += tokens.total || 0;
    globalStats.global.totalCost += cost || 0;

    // 按工具类型统计
    if (!globalStats.byToolType[toolType]) {
      globalStats.byToolType[toolType] = {
        ...initStatsObject(),
        channels: {},
        models: {}
      };
    }
    updateStats(globalStats.byToolType[toolType], tokens, cost);

    // 按工具类型 -> 渠道统计
    if (!globalStats.byToolType[toolType].channels[channelId]) {
      globalStats.byToolType[toolType].channels[channelId] = {
        name: channel,
        ...initStatsObject(),
        firstUsed: timestamp,
        lastUsed: timestamp
      };
    } else {
      globalStats.byToolType[toolType].channels[channelId].lastUsed = timestamp;
    }
    updateStats(globalStats.byToolType[toolType].channels[channelId], tokens, cost);

    // 按工具类型 -> 模型统计
    if (!globalStats.byToolType[toolType].models[model]) {
      globalStats.byToolType[toolType].models[model] = initStatsObject();
    }
    updateStats(globalStats.byToolType[toolType].models[model], tokens, cost);

    // 按渠道统计（跨工具）
    if (!globalStats.byChannel[channelId]) {
      globalStats.byChannel[channelId] = {
        toolType,
        name: channel,
        ...initStatsObject(),
        firstUsed: timestamp,
        lastUsed: timestamp
      };
    } else {
      globalStats.byChannel[channelId].lastUsed = timestamp;
    }
    updateStats(globalStats.byChannel[channelId], tokens, cost);

    // 按模型统计（跨工具）
    if (!globalStats.byModel[model]) {
      globalStats.byModel[model] = {
        toolType,
        ...initStatsObject()
      };
    }
    updateStats(globalStats.byModel[model], tokens, cost);

    saveStatistics(globalStats);

    // 3. 更新每日统计
    const date = new Date(timestamp).toISOString().split('T')[0]; // YYYY-MM-DD
    const hour = new Date(timestamp).getHours().toString().padStart(2, '0'); // HH

    const dailyStats = loadDailyStats(date);

    // 更新每日汇总
    dailyStats.summary.requests += 1;
    dailyStats.summary.tokens += tokens.total || 0;
    dailyStats.summary.cost += cost || 0;

    // 按小时统计
    if (!dailyStats.hourly[hour]) {
      dailyStats.hourly[hour] = {
        ...initStatsObject(),
        byToolType: {}
      };
    }
    updateStats(dailyStats.hourly[hour], tokens, cost);

    // 按小时 -> 工具类型
    if (!dailyStats.hourly[hour].byToolType[toolType]) {
      dailyStats.hourly[hour].byToolType[toolType] = initStatsObject();
    }
    updateStats(dailyStats.hourly[hour].byToolType[toolType], tokens, cost);

    // 按工具类型统计
    if (!dailyStats.byToolType[toolType]) {
      dailyStats.byToolType[toolType] = {
        ...initStatsObject(),
        channels: {},
        models: {}
      };
    }
    updateStats(dailyStats.byToolType[toolType], tokens, cost);

    // 按工具类型 -> 渠道
    if (!dailyStats.byToolType[toolType].channels) {
      dailyStats.byToolType[toolType].channels = {};
    }
    if (!dailyStats.byToolType[toolType].channels[channelId]) {
      dailyStats.byToolType[toolType].channels[channelId] = {
        name: channel,
        ...initStatsObject()
      };
    }
    updateStats(dailyStats.byToolType[toolType].channels[channelId], tokens, cost);

    // 按渠道统计
    if (!dailyStats.byChannel[channelId]) {
      dailyStats.byChannel[channelId] = {
        toolType,
        name: channel,
        ...initStatsObject()
      };
    }
    updateStats(dailyStats.byChannel[channelId], tokens, cost);

    // 按模型统计
    if (!dailyStats.byModel[model]) {
      dailyStats.byModel[model] = {
        toolType,
        ...initStatsObject()
      };
    }
    updateStats(dailyStats.byModel[model], tokens, cost);

    saveDailyStats(date, dailyStats);

    console.log(`[Statistics] Recorded request ${id} - ${toolType} - ${channel} - ${model}`);
  } catch (err) {
    console.error('[Statistics] Failed to record request:', err);
  }
}

/**
 * 获取统计数据
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
