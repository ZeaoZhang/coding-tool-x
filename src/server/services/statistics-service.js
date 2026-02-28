const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * 统计服务 - 数据采集和存储
 *
 * 文件结构：
 * ~/.cc-tool/
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
  const dir = path.join(os.homedir(), '.cc-tool');
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

/**
 * 从统计对象中提取指定指标值
 */
function extractMetric(stats, metric) {
  if (!stats) return 0;
  if (metric === 'tokens') return stats.tokens?.total || stats.tokens || 0;
  if (metric === 'cost') return stats.cost || 0;
  if (metric === 'requests') return stats.requests || 0;
  return 0;
}

/**
 * 从 JSONL 日志文件读取指定日期+小时的数据（按 model 或 channel 聚合）
 */
function readJsonlForHour(year, month, day, hour, groupBy) {
  const filePath = getRequestLogFilePath(year, month, day);
  const result = {};

  try {
    if (!fs.existsSync(filePath)) return result;
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }

      const ts = new Date(entry.timestamp);
      if (ts.getHours() !== hour) continue;

      let key;
      if (groupBy === 'model') key = entry.model || 'unknown';
      else if (groupBy === 'channel') key = entry.channel || entry.channelId || 'unknown';
      else continue;

      if (!result[key]) result[key] = { tokens: { total: 0 }, cost: 0, requests: 0 };
      result[key].tokens.total += entry.tokens?.total || 0;
      result[key].cost += entry.cost || 0;
      result[key].requests += 1;
    }
  } catch (err) {
    console.error('Failed to read JSONL for hour:', err);
  }

  return result;
}

/**
 * 获取趋势统计数据
 * @param {Object} options
 * @param {string} options.startDate - YYYY-MM-DD
 * @param {string} options.endDate - YYYY-MM-DD
 * @param {string} options.granularity - 'day' | 'hour'
 * @param {string} options.groupBy - 'model' | 'channel' | 'toolType'
 * @param {string} options.metric - 'tokens' | 'cost' | 'requests'
 */

// 工具类型到 daily-stats 目录前缀的映射
const TOOL_PREFIXES = {
  'claude-code': '',
  'codex': 'codex-',
  'gemini': 'gemini-',
  'opencode': 'opencode-'
};

// 加载指定工具的某天统计（toolPrefix 为 '' | 'codex-' | 'gemini-' | 'opencode-'）
function loadDailyStatsByTool(dateStr, toolPrefix) {
  const dir = path.join(os.homedir(), '.cc-tool', `${toolPrefix}daily-stats`);
  const filePath = path.join(dir, `${dateStr}.json`);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {}
  return null;
}

// 合并所有工具的某天 daily-stats，groupBy 决定合并维度
// 对于 toolType 分组：key 就是工具名（claude-code/codex/gemini/opencode）
// 对于 model/channel 分组：合并各工具的 byModel/byChannel，key 可能重名（不同工具用同名模型）则加前缀
function mergeAllToolsDailyStats(dateStr, groupBy) {
  const merged = {};

  for (const [toolType, prefix] of Object.entries(TOOL_PREFIXES)) {
    const stats = loadDailyStatsByTool(dateStr, prefix);
    if (!stats) continue;

    if (groupBy === 'toolType') {
      // key = toolType，汇总整天 summary
      if (!merged[toolType]) merged[toolType] = { requests: 0, tokens: { total: 0 }, cost: 0 };
      const s = stats.summary || {};
      merged[toolType].requests += s.requests || 0;
      merged[toolType].tokens.total += (s.tokens && typeof s.tokens === 'object' ? s.tokens.total : s.tokens) || 0;
      merged[toolType].cost += s.cost || 0;
    } else if (groupBy === 'model') {
      const byModel = stats.byModel || {};
      for (const [model, mStats] of Object.entries(byModel)) {
        if (!merged[model]) merged[model] = { requests: 0, tokens: { total: 0 }, cost: 0 };
        merged[model].requests += mStats.requests || 0;
        const t = mStats.tokens || {};
        merged[model].tokens.total += (typeof t === 'object' ? t.total : t) || 0;
        merged[model].cost += mStats.cost || 0;
      }
    } else if (groupBy === 'channel') {
      const byChannel = stats.byChannel || {};
      for (const [chId, chStats] of Object.entries(byChannel)) {
        const key = chStats.name || chId;
        if (!merged[key]) merged[key] = { requests: 0, tokens: { total: 0 }, cost: 0 };
        merged[key].requests += chStats.requests || 0;
        const t = chStats.tokens || {};
        merged[key].tokens.total += (typeof t === 'object' ? t.total : t) || 0;
        merged[key].cost += chStats.cost || 0;
      }
    }
  }
  return merged;
}

async function getTrendStatistics({ startDate, endDate, granularity = 'day', step = 1, groupBy = 'model', metric = 'tokens' }) {
  step = parseInt(step) || 1;
  const labels = [];
  const seriesMap = {}; // { dimensionName: number[] }
  const totals = {};

  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');

  // Iterate each day
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const dateStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;

    if (granularity === 'day') {
      labels.push(dateStr);
      const byDimension = mergeAllToolsDailyStats(dateStr, groupBy);

      // Accumulate dimensions seen so far with 0 for this label position
      const labelIdx = labels.length - 1;

      // Fill existing series with 0 for this position first
      for (const key of Object.keys(seriesMap)) {
        seriesMap[key].push(0);
      }

      for (const [key, stats] of Object.entries(byDimension)) {
        const val = extractMetric(stats, metric);
        if (!seriesMap[key]) {
          // New dimension: backfill with zeros for previous labels
          seriesMap[key] = new Array(labelIdx).fill(0);
          seriesMap[key].push(val);
        } else {
          // Already pushed 0 above, replace last element
          seriesMap[key][labelIdx] = val;
        }
        totals[key] = (totals[key] || 0) + val;
      }
    } else {
      // granularity === 'hour'
      for (let h = 0; h < 24; h += step) {
        const hourEnd = Math.min(h + step, 24);
        const hourStr = h.toString().padStart(2, '0');
        const label = step === 1
          ? `${dateStr} ${hourStr}:00`
          : `${dateStr} ${hourStr}:00-${String(hourEnd).padStart(2, '0')}:00`;
        labels.push(label);
        const labelIdx = labels.length - 1;

        // Fill existing series with 0 for this label
        for (const key of Object.keys(seriesMap)) {
          seriesMap[key].push(0);
        }

        // Accumulate all hours in this step bucket
        for (let hh = h; hh < hourEnd; hh++) {
          const hhStr = hh.toString().padStart(2, '0');
          let byDimension = {};

          if (groupBy === 'toolType') {
            // 合并所有工具的该小时数据
            for (const [toolType, prefix] of Object.entries(TOOL_PREFIXES)) {
              const ds = loadDailyStatsByTool(dateStr, prefix);
              const hourData = ds?.hourly?.[hhStr];
              const val = hourData ? extractMetric(hourData, metric) : 0;
              if (val > 0) {
                if (!byDimension[toolType]) byDimension[toolType] = { requests: 0, tokens: { total: 0 }, cost: 0 };
                byDimension[toolType].requests += hourData.requests || 0;
                byDimension[toolType].tokens.total += (hourData.tokens?.total || 0);
                byDimension[toolType].cost += hourData.cost || 0;
              }
            }
          } else {
            byDimension = readJsonlForHour(year, month, day, hh, groupBy);
          }

          for (const [key, stats] of Object.entries(byDimension)) {
            const val = extractMetric(stats, metric);
            if (!seriesMap[key]) {
              seriesMap[key] = new Array(labelIdx).fill(0);
              seriesMap[key].push(val);
            } else {
              if (seriesMap[key].length <= labelIdx) seriesMap[key].push(0);
              seriesMap[key][labelIdx] = (seriesMap[key][labelIdx] || 0) + val;
            }
            totals[key] = (totals[key] || 0) + val;
          }
        } // end hh loop
      } // end h loop
    } // end else (hour granularity)
  } // end for day loop

  // Sort series by total desc, keep top 10, merge rest into 'Other'
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const top10 = sorted.slice(0, 10);
  const rest = sorted.slice(10);

  const series = top10.map(([name]) => ({
    name,
    data: seriesMap[name] || []
  }));

  if (rest.length > 0) {
    const otherData = labels.map((_, i) =>
      rest.reduce((sum, [name]) => sum + (seriesMap[name]?.[i] || 0), 0)
    );
    const otherTotal = rest.reduce((sum, [, total]) => sum + total, 0);
    series.push({ name: 'Other', data: otherData });
    totals['Other'] = otherTotal;
    // Remove merged keys from totals
    for (const [name] of rest) delete totals[name];
  }

  return { labels, series, totals };
}

module.exports = {
  recordRequest,
  getStatistics,
  getDailyStatistics,
  getTodayStatistics,
  getTrendStatistics
};
