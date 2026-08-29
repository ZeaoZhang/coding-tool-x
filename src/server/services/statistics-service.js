const fs = require('fs');
const path = require('path');
const { PATHS } = require('../../config/paths');
const { normalizeUsageTokens, resolveActualModel } = require('./proxy-log-helper');

// 北京时间辅助（UTC+8），统一所有时间计算
const CST_OFFSET_MS = 8 * 60 * 60 * 1000;

const pendingEntries = [];
let flushPromise = null;
let flushScheduled = false;
let aggregateStatsCache = null;
const dailyStatsCache = new Map();

function toCSTDate(ts) {
  // 返回以北京时间解释的 Date 对象各字段（通过偏移 UTC）
  return new Date(new Date(ts).getTime() + CST_OFFSET_MS);
}

function getCSTDateStr(ts) {
  // 返回北京时间日期字符串 YYYY-MM-DD
  const d = toCSTDate(ts);
  return d.toISOString().split('T')[0];
}

function getCSTHour(ts) {
  // 返回北京时间小时 (0-23)
  return toCSTDate(ts).getUTCHours();
}

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
  const dir = path.dirname(PATHS.statistics.summary);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// 获取每日统计目录
function getDailyStatsDir() {
  const dir = PATHS.statistics.dailyStats;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// 获取请求日志目录
function getRequestLogsDir(year, month) {
  const baseDir = path.join(PATHS.statistics.requestLogs, `${year}-${month.toString().padStart(2, '0')}`);
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  return baseDir;
}

// 获取统计文件路径
function getStatisticsFilePath() {
  return PATHS.statistics.summary;
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

function getProxyLogsFilePath() {
  return PATHS.statistics.proxyLogs;
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
  const cst = toCSTDate(logEntry.timestamp);
  const year = cst.getUTCFullYear();
  const month = cst.getUTCMonth() + 1;
  const day = cst.getUTCDate();

  const filePath = getRequestLogFilePath(year, month, day);

  try {
    // JSONL 格式：每行一个 JSON 对象
    const line = JSON.stringify(logEntry) + '\n';
    fs.appendFileSync(filePath, line, 'utf8');
  } catch (err) {
    console.error('Failed to append request log:', err);
  }
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function getRequestLogPath(timestamp) {
  const cst = toCSTDate(timestamp);
  const year = cst.getUTCFullYear();
  const month = String(cst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(cst.getUTCDate()).padStart(2, '0');
  return path.join(PATHS.statistics.requestLogs, `${year}-${month}`, `${day}.jsonl`);
}

async function appendRequestLogsAsync(entries) {
  const byPath = new Map();
  for (const entry of entries) {
    const filePath = getRequestLogPath(entry.logEntry.timestamp);
    const group = byPath.get(filePath) || [];
    group.push(entry);
    byPath.set(filePath, group);
  }

  const persisted = [];
  for (const [filePath, group] of byPath) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.appendFile(
      filePath,
      group.map(entry => `${JSON.stringify(entry.logEntry)}\n`).join(''),
      'utf8'
    );
    persisted.push(...group);
  }
  return persisted;
}

async function writeJsonAsync(filePath, value) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function scheduleStatisticsFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
    void flushStatistics();
  });
}

async function flushStatistics() {
  if (flushPromise) return flushPromise;
  if (pendingEntries.length === 0) {
    return { flushed: 0, pending: 0 };
  }

  const batch = pendingEntries.splice(0, pendingEntries.length);
  const globalSnapshot = aggregateStatsCache ? cloneJson(aggregateStatsCache) : null;
  const dates = [...new Set(batch.map(entry => entry.date))];
  const dailySnapshots = new Map(
    dates.map(date => [date, cloneJson(dailyStatsCache.get(date))])
  );

  const writer = (async () => {
    try {
      const pendingLogEntries = batch.filter(entry => !entry.logPersisted);
      const persisted = await appendRequestLogsAsync(pendingLogEntries);
      persisted.forEach(entry => { entry.logPersisted = true; });
      if (globalSnapshot) {
        globalSnapshot.lastUpdated = new Date().toISOString();
        await writeJsonAsync(getStatisticsFilePath(), globalSnapshot);
      }
      for (const [date, stats] of dailySnapshots) {
        if (stats) await writeJsonAsync(getDailyStatsFilePathWithoutCreate(date), stats);
      }
      return { flushed: batch.length, pending: pendingEntries.length };
    } catch (error) {
      pendingEntries.unshift(...batch);
      console.error('[Statistics] Failed to flush queued entries:', error.message);
      return {
        flushed: 0,
        pending: pendingEntries.length,
        error: error.message
      };
    }
  })();

  flushPromise = writer.finally(() => {
    flushPromise = null;
    if (pendingEntries.length > 0) scheduleStatisticsFlush();
  });
  return flushPromise;
}

function getDailyStatsFilePathWithoutCreate(date) {
  return path.join(PATHS.statistics.dailyStats, `${date}.json`);
}

async function shutdownStatistics() {
  let result = await flushStatistics();
  while (result.pending > 0 && !result.error) {
    result = await flushStatistics();
  }
  return result;
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
      cached: 0,
      reasoning: 0,
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
  stats.tokens.cached += tokens.cached || 0;
  stats.tokens.reasoning += tokens.reasoning || 0;
  stats.tokens.total += getTokenTotal(tokens);
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
    const resolvedModel = resolveActualModel(model, requestData);
    const modelKey = resolvedModel || 'unknown';
    const totalTokens = getTokenTotal(tokens);

    // 1. 写入详细日志
    const logEntry = {
      id,
      timestamp,
      toolType,
      channel,
      channelId,
      model: resolvedModel,
      tokens,
      duration,
      success,
      cost,
      session,
      project
    };
    // 如果有模型重定向信息，记录到日志中
    if (requestData.originalModel) {
      logEntry.originalModel = requestData.originalModel;
    }
    if (requestData.redirectedModel) {
      logEntry.redirectedModel = requestData.redirectedModel;
    }

    // 2. 更新总体统计
    const globalStats = aggregateStatsCache || loadStatistics();
    aggregateStatsCache = globalStats;
    // 更新全局统计
    globalStats.global.totalRequests += 1;
    globalStats.global.totalTokens += totalTokens;
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
    if (!globalStats.byToolType[toolType].models[modelKey]) {
      globalStats.byToolType[toolType].models[modelKey] = initStatsObject();
    }
    updateStats(globalStats.byToolType[toolType].models[modelKey], tokens, cost);

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
    if (!globalStats.byModel[modelKey]) {
      globalStats.byModel[modelKey] = {
        toolType,
        ...initStatsObject()
      };
    }
    updateStats(globalStats.byModel[modelKey], tokens, cost);


    // 3. 更新每日统计（使用北京时间）
    const date = getCSTDateStr(timestamp); // YYYY-MM-DD (CST)
    const hour = getCSTHour(timestamp).toString().padStart(2, '0'); // HH (CST)

    const dailyStats = dailyStatsCache.get(date) || loadDailyStats(date);
    dailyStatsCache.set(date, dailyStats);

    // 更新每日汇总
    dailyStats.summary.requests += 1;
    dailyStats.summary.tokens += totalTokens;
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

    // 按工具类型 -> 模型
    if (!dailyStats.byToolType[toolType].models) {
      dailyStats.byToolType[toolType].models = {};
    }
    if (!dailyStats.byToolType[toolType].models[modelKey]) {
      dailyStats.byToolType[toolType].models[modelKey] = initStatsObject();
    }
    updateStats(dailyStats.byToolType[toolType].models[modelKey], tokens, cost);

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
    if (!dailyStats.byModel[modelKey]) {
      dailyStats.byModel[modelKey] = {
        toolType,
        ...initStatsObject()
      };
    }
    updateStats(dailyStats.byModel[modelKey], tokens, cost);


    // Invalidate cached trend results that cover this date
    invalidateTrendCacheForDate(date);
    pendingEntries.push({ logEntry, date });
    if (pendingEntries.length >= 1000) {
      console.error('[Statistics] Write queue reached its limit; flushing immediately');
      void flushStatistics();
    } else {
      scheduleStatisticsFlush();
    }
  } catch (err) {
    console.error('[Statistics] Failed to record request:', err);
  }
}

/**
 * 获取统计数据
 */
function getStatistics() {
  return aggregateStatsCache ? cloneJson(aggregateStatsCache) : loadStatistics();
}

/**
 * 获取每日统计
 */
function getDailyStatistics(date) {
  return aggregateDailyStatistics(date, dailyStatsCache.get(date) || null);
}

/**
 * 获取今日统计
 */
function getTodayStatistics() {
  const today = getCSTDateStr(Date.now());
  return getDailyStatistics(today);
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
 * @param {number} year
 * @param {number} month
 * @param {number} day
 * @param {number} hour
 * @param {string} groupBy
 * @param {Object} [filters] - optional { toolType, channel, model }
 */
function addLogEntryToResult(result, entry, groupBy, filters = null) {
  const actualModel = resolveActualModel(entry.model, entry);
  if (filters) {
    if (filters.toolType && entry.toolType !== filters.toolType) return;
    if (filters.channel && entry.channel !== filters.channel) return;
    if (filters.model && actualModel !== filters.model) return;
  }

  let key;
  if (groupBy === 'model') key = actualModel || 'unknown';
  else if (groupBy === 'channel') key = entry.channel || entry.channelId || 'unknown';
  else if (groupBy === 'toolType') key = entry.toolType || 'claude-code';
  else return;

  if (!result[key]) result[key] = { tokens: { total: 0 }, cost: 0, requests: 0 };
  result[key].tokens.total += getTokenTotal(entry.tokens);
  result[key].cost += entry.cost || 0;
  result[key].requests += 1;
}

function mergePendingLogEntries(result, dateStr, hour, groupBy, filters = null) {
  for (const { logEntry } of pendingEntries) {
    const timestamp = new Date(logEntry.timestamp);
    if (getCSTDateStr(timestamp) !== dateStr) continue;
    if (hour !== undefined && getCSTHour(timestamp) !== hour) continue;
    addLogEntryToResult(result, logEntry, groupBy, filters);
  }
}

function readJsonlForHour(year, month, day, hour, groupBy, filters) {
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
      if (getCSTHour(ts) !== hour) continue;

      const actualModel = resolveActualModel(entry.model, entry);

      // Apply filters
      if (filters) {
        if (filters.toolType && entry.toolType !== filters.toolType) continue;
        if (filters.channel && entry.channel !== filters.channel) continue;
        if (filters.model && actualModel !== filters.model) continue;
      }

      let key;
      if (groupBy === 'model') key = actualModel || 'unknown';
      else if (groupBy === 'channel') key = entry.channel || entry.channelId || 'unknown';
      else if (groupBy === 'toolType') key = entry.toolType || 'claude-code';
      else continue;

      if (!result[key]) result[key] = { tokens: { total: 0 }, cost: 0, requests: 0 };
      result[key].tokens.total += getTokenTotal(entry.tokens);
      result[key].cost += entry.cost || 0;
      result[key].requests += 1;
    }
  } catch (err) {
    console.error('Failed to read JSONL for hour:', err);
  }

  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  mergePendingLogEntries(result, dateStr, hour, groupBy, filters);
  return result;
}

/**
 * 从 JSONL 日志文件读取整天的数据（应用过滤器后按维度聚合）
 * @param {number} year
 * @param {number} month
 * @param {number} day
 * @param {string} groupBy
 * @param {Object} [filters] - optional { toolType, channel, model }
 */
function readJsonlForDay(year, month, day, groupBy, filters) {
  const filePath = getRequestLogFilePath(year, month, day);
  const result = {};

  try {
    if (!fs.existsSync(filePath)) return result;
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }

      const actualModel = resolveActualModel(entry.model, entry);

      // Apply filters
      if (filters) {
        if (filters.toolType && entry.toolType !== filters.toolType) continue;
        if (filters.channel && entry.channel !== filters.channel) continue;
        if (filters.model && actualModel !== filters.model) continue;
      }

      let key;
      if (groupBy === 'model') key = actualModel || 'unknown';
      else if (groupBy === 'channel') key = entry.channel || entry.channelId || 'unknown';
      else if (groupBy === 'toolType') key = entry.toolType || 'claude-code';
      else continue;

      if (!result[key]) result[key] = { tokens: { total: 0 }, cost: 0, requests: 0 };
      result[key].tokens.total += getTokenTotal(entry.tokens);
      result[key].cost += entry.cost || 0;
      result[key].requests += 1;
    }
  } catch (err) {
    console.error('Failed to read JSONL for day:', err);
  }

  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  mergePendingLogEntries(result, dateStr, undefined, groupBy, filters);
  return result;
}

function mapSourceToToolType(source) {
  if (source === 'codex') return 'codex';
  if (source === 'gemini') return 'gemini';
  if (source === 'opencode') return 'opencode';
  return 'claude-code';
}

function loadProxyLogs() {
  const filePath = getProxyLogsFilePath();
  try {
    if (!fs.existsSync(filePath)) return [];
    const logs = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(logs) ? logs : [];
  } catch (err) {
    console.error('Failed to load proxy logs:', err);
    return [];
  }
}

function filterProxyLogsForHour(logs, dateStr, hour, groupBy) {
  const result = {};

  for (const entry of logs) {
    if (!entry || entry.type === 'action' || entry.status === 'error') continue;

    const ts = new Date(entry.timestamp || Date.now());
    if (Number.isNaN(ts.getTime())) continue;

    const entryDate = getCSTDateStr(ts);
    if (entryDate !== dateStr || getCSTHour(ts) !== hour) continue;

    const actualModel = resolveActualModel(entry.model, entry);
    const normalizedTokens = normalizeUsageTokens(entry.source || mapSourceToToolType(entry.source), {
      input: entry.inputTokens ?? entry.tokens?.input,
      output: entry.outputTokens ?? entry.tokens?.output,
      cacheCreation: entry.cacheCreation ?? entry.tokens?.cacheCreation,
      cacheRead: entry.cacheRead ?? entry.tokens?.cacheRead,
      cached: entry.cachedTokens ?? entry.tokens?.cached,
      reasoning: entry.reasoningTokens ?? entry.tokens?.reasoning,
      total: entry.totalTokens ?? entry.tokens?.total
    });

    let key;
    if (groupBy === 'toolType') {
      key = mapSourceToToolType(entry.source);
    } else if (groupBy === 'model') {
      key = actualModel || 'unknown';
    } else if (groupBy === 'channel') {
      key = entry.channel || 'unknown';
    } else {
      continue;
    }

    if (!result[key]) {
      result[key] = { tokens: { total: 0 }, cost: 0, requests: 0 };
    }

    result[key].tokens.total += normalizedTokens.total || 0;
    result[key].cost += entry.cost || 0;
    result[key].requests += 1;
  }

  return result;
}

function readProxyLogsForHour(dateStr, hour, groupBy) {
  return filterProxyLogsForHour(loadProxyLogs(), dateStr, hour, groupBy);
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

function getTokenTotal(tokens) {
  if (typeof tokens === 'number') return tokens;
  if (tokens && typeof tokens === 'object') {
    if (typeof tokens.total === 'number') return tokens.total;
    return Object.entries(tokens).reduce((sum, [key, value]) => {
      if (key === 'total') return sum;
      return typeof value === 'number' ? sum + value : sum;
    }, 0);
  }
  return 0;
}

function normalizeTokens(tokens) {
  if (typeof tokens === 'number') {
    return { total: tokens };
  }

  const normalized = { total: 0 };
  if (tokens && typeof tokens === 'object') {
    for (const [key, value] of Object.entries(tokens)) {
      if (typeof value === 'number') {
        normalized[key] = value;
      }
    }
  }

  normalized.total = getTokenTotal(tokens);
  return normalized;
}

function mergeStatsEntry(target, source) {
  if (!source) return;

  target.requests += source.requests || 0;
  target.cost += source.cost || 0;

  const sourceTokens = normalizeTokens(source.tokens);
  for (const [key, value] of Object.entries(sourceTokens)) {
    target.tokens[key] = (target.tokens[key] || 0) + value;
  }
}

function createEmptyEntry(toolType, name) {
  const entry = {
    requests: 0,
    tokens: { total: 0 },
    cost: 0
  };

  if (toolType) entry.toolType = toolType;
  if (name) entry.name = name;
  return entry;
}

function getScopedKey(container, baseKey, toolType) {
  if (!container[baseKey] || container[baseKey].toolType === toolType) {
    return baseKey;
  }

  let index = 1;
  let scopedKey = `${toolType}:${baseKey}`;
  while (container[scopedKey] && container[scopedKey].toolType !== toolType) {
    scopedKey = `${toolType}:${baseKey}:${index}`;
    index += 1;
  }
  return scopedKey;
}

function mergeHourlyStats(targetHourly, sourceHourly = {}) {
  for (const [hour, hourStats] of Object.entries(sourceHourly)) {
    if (!targetHourly[hour]) {
      targetHourly[hour] = {
        requests: 0,
        tokens: { total: 0 },
        cost: 0,
        byToolType: {}
      };
    }

    mergeStatsEntry(targetHourly[hour], hourStats);

    if (hourStats.byToolType && typeof hourStats.byToolType === 'object') {
      for (const [toolType, toolStats] of Object.entries(hourStats.byToolType)) {
        if (!targetHourly[hour].byToolType[toolType]) {
          targetHourly[hour].byToolType[toolType] = createEmptyEntry();
        }
        mergeStatsEntry(targetHourly[hour].byToolType[toolType], toolStats);
      }
    }
  }
}

function hasStatsData(stats = {}) {
  const requests = Number(stats.requests || 0);
  const cost = Number(stats.cost || 0);
  const totalTokens = getTokenTotal(stats.tokens);
  return requests > 0 || cost > 0 || totalTokens > 0;
}

function aggregateDailyStatistics(dateStr, sharedStatsOverride = null) {
  const aggregated = {
    date: dateStr,
    summary: {
      requests: 0,
      tokens: 0,
      cost: 0
    },
    hourly: {},
    byToolType: {},
    byChannel: {},
    byModel: {}
  };

  const sharedStats = sharedStatsOverride || loadDailyStats(dateStr);
  const sharedSummaryEntry = createEmptyEntry();
  mergeStatsEntry(sharedSummaryEntry, {
    requests: sharedStats.summary?.requests || 0,
    tokens: sharedStats.summary?.tokens || 0,
    cost: sharedStats.summary?.cost || 0
  });
  aggregated.summary.requests += sharedSummaryEntry.requests;
  aggregated.summary.tokens += sharedSummaryEntry.tokens.total || 0;
  aggregated.summary.cost += sharedSummaryEntry.cost;
  mergeHourlyStats(aggregated.hourly, sharedStats.hourly);

  for (const toolType of Object.keys(TOOL_PREFIXES)) {
    const toolStats = sharedStats.byToolType?.[toolType];
    if (!aggregated.byToolType[toolType]) {
      aggregated.byToolType[toolType] = createEmptyEntry();
    }
    if (!toolStats) continue;

    mergeStatsEntry(aggregated.byToolType[toolType], toolStats);

    for (const [channelId, channelStats] of Object.entries(toolStats.channels || {})) {
      const key = getScopedKey(aggregated.byChannel, channelId, toolType);
      if (!aggregated.byChannel[key]) {
        aggregated.byChannel[key] = createEmptyEntry(toolType, channelStats.name || channelId);
      }
      mergeStatsEntry(aggregated.byChannel[key], channelStats);
    }

    for (const [modelName, modelStats] of Object.entries(toolStats.models || {})) {
      const key = modelName || 'unknown';
      if (!aggregated.byModel[key]) {
        aggregated.byModel[key] = createEmptyEntry(toolType);
      }
      mergeStatsEntry(aggregated.byModel[key], modelStats);
    }
  }

  // Fallback: if byModel is still empty (older daily-stats files store model data
  // directly in byModel rather than byToolType[toolType].models), merge it directly.
  if (Object.keys(aggregated.byModel).length === 0 && sharedStats.byModel) {
    for (const [modelName, modelStats] of Object.entries(sharedStats.byModel)) {
      const toolType = modelStats.toolType || 'claude-code';
      if (!aggregated.byModel[modelName]) {
        aggregated.byModel[modelName] = createEmptyEntry(toolType);
      }
      mergeStatsEntry(aggregated.byModel[modelName], modelStats);
    }
  }

  // Fallback: if byChannel is still empty, merge from sharedStats.byChannel directly.
  if (Object.keys(aggregated.byChannel).length === 0 && sharedStats.byChannel) {
    for (const [channelId, channelStats] of Object.entries(sharedStats.byChannel)) {
      const toolType = channelStats.toolType || 'claude-code';
      if (!aggregated.byChannel[channelId]) {
        aggregated.byChannel[channelId] = createEmptyEntry(toolType, channelStats.name || channelId);
      }
      mergeStatsEntry(aggregated.byChannel[channelId], channelStats);
    }
  }

  // 保证前端可用的工具键始终存在
  for (const toolType of Object.keys(TOOL_PREFIXES)) {
    if (!aggregated.byToolType[toolType]) {
      aggregated.byToolType[toolType] = createEmptyEntry();
    }
  }

  return aggregated;
}

// 合并某天共享 daily-stats，groupBy 决定合并维度
function mergeAllToolsDailyStats(dateStr, groupBy) {
  const merged = {};

  const aggregated = aggregateDailyStatistics(dateStr, dailyStatsCache.get(dateStr) || null);
  if (!aggregated) return merged;

  if (groupBy === 'toolType') {
    for (const toolType of Object.keys(TOOL_PREFIXES)) {
      const toolStats = aggregated.byToolType?.[toolType];
      if (!toolStats || !hasStatsData(toolStats)) continue;
      merged[toolType] = {
        requests: toolStats.requests || 0,
        tokens: { total: getTokenTotal(toolStats.tokens) },
        cost: toolStats.cost || 0
      };
    }
    return merged;
  }

  if (groupBy === 'model') {
    for (const [modelName, modelStats] of Object.entries(aggregated.byModel || {})) {
      if (!merged[modelName]) merged[modelName] = { requests: 0, tokens: { total: 0 }, cost: 0 };
      merged[modelName].requests += modelStats.requests || 0;
      merged[modelName].tokens.total += getTokenTotal(modelStats.tokens);
      merged[modelName].cost += modelStats.cost || 0;
    }
    return merged;
  }

  if (groupBy === 'channel') {
    for (const [channelId, channelStats] of Object.entries(aggregated.byChannel || {})) {
      const key = channelStats.name || channelId;
      if (!merged[key]) merged[key] = { requests: 0, tokens: { total: 0 }, cost: 0 };
      merged[key].requests += channelStats.requests || 0;
      merged[key].tokens.total += getTokenTotal(channelStats.tokens);
      merged[key].cost += channelStats.cost || 0;
    }
  }

  return merged;
}

/**
 * 扫描日期范围内的 JSONL 文件，返回可用的过滤器选项
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {{ toolTypes: string[], channels: string[], models: string[] }}
 */
function getAvailableFilters(startDate, endDate) {
  const toolTypes = new Set();
  const channels = new Set();
  const models = new Set();
  const includeProxyLogs = startDate <= getCSTDateStr(Date.now()) && getCSTDateStr(Date.now()) <= endDate;

  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const filePath = getRequestLogFilePath(year, month, day);

    try {
      if (!fs.existsSync(filePath)) continue;
      const lines = fs.readFileSync(filePath, 'utf8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }
        const actualModel = resolveActualModel(entry.model, entry);
        if (entry.toolType) toolTypes.add(entry.toolType);
        if (entry.channel) channels.add(entry.channel);
        if (actualModel) models.add(actualModel);
      }
    } catch (err) {
      console.error('Failed to scan JSONL for filters:', err);
    }
  }

for (const { logEntry, date } of pendingEntries) {
  if (date < startDate || date > endDate) continue;
  if (logEntry.toolType) toolTypes.add(logEntry.toolType);
  if (logEntry.channel) channels.add(logEntry.channel);
  const actualModel = resolveActualModel(logEntry.model, logEntry);
  if (actualModel) models.add(actualModel);
}
  if (includeProxyLogs) {
    for (const entry of loadProxyLogs()) {
      if (!entry || entry.type === 'action' || entry.status === 'error') continue;
      const ts = new Date(entry.timestamp || Date.now());
      if (Number.isNaN(ts.getTime())) continue;
      const entryDate = getCSTDateStr(ts);
      if (entryDate < startDate || entryDate > endDate) continue;

      toolTypes.add(mapSourceToToolType(entry.source));
      if (entry.channel) channels.add(entry.channel);
      const actualModel = resolveActualModel(entry.model, entry);
      if (actualModel) models.add(actualModel);
    }
  }

  return {
    toolTypes: Array.from(toolTypes).sort(),
    channels: Array.from(channels).sort(),
    models: Array.from(models).sort()
  };
}

// ─── Trend statistics in-memory cache ───────────────────────────────────────
// Key: JSON-serialized params, Value: { result, expiresAt }
const trendCache = new Map();
const TREND_CACHE_TTL_MS = 30 * 1000; // 30 seconds

function getTrendCacheKey(params) {
  return JSON.stringify(params);
}

function invalidateTrendCache() {
  trendCache.clear();
}

// Called by recordRequest so fresh data is visible immediately after a new request
function invalidateTrendCacheForDate(dateStr) {
  for (const key of trendCache.keys()) {
    try {
      const p = JSON.parse(key);
      if (p.startDate <= dateStr && dateStr <= p.endDate) {
        trendCache.delete(key);
      }
    } catch { trendCache.delete(key); }
  }
}
// ─────────────────────────────────────────────────────────────────────────────

async function getTrendStatistics({ startDate, endDate, granularity = 'day', step = 1, groupBy = 'model', metric = 'tokens', filters }) {
  step = parseInt(step) || 1;

  // Normalize filters: treat empty string as no filter
  const activeFilters = filters && (filters.toolType || filters.channel || filters.model) ? filters : null;

  // Check cache first
  const cacheKey = getTrendCacheKey({ startDate, endDate, granularity, step: String(step), groupBy, metric, filters: activeFilters || null });
  const cached = trendCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.result;
  }

  const labels = [];
  const seriesMap = {}; // { dimensionName: number[] }
  const totals = {};

  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');

  // Load proxy-logs once upfront (only needed for hour granularity) to avoid
  // re-reading the large file on every iteration of the inner loop.
  const cachedProxyLogs = granularity === 'hour' ? loadProxyLogs() : [];

  // Iterate each day
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const dateStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;

    if (granularity === 'day') {
      labels.push(dateStr);
      let byDimension = activeFilters
        ? readJsonlForDay(year, month, day, groupBy, activeFilters)
        : mergeAllToolsDailyStats(dateStr, groupBy);
      if (!activeFilters && Object.keys(byDimension).length === 0) {
        // Fallback: if daily stats are missing, derive from JSONL logs
        byDimension = readJsonlForDay(year, month, day, groupBy);
      }

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

          // 小时粒度优先使用 proxy-logs（含 codex/gemini/opencode 实时数据），
          // 若该小时没有 proxy-logs 再回退到历史统计文件/JSONL。
          byDimension = filterProxyLogsForHour(cachedProxyLogs, dateStr, hh, groupBy);

          if (Object.keys(byDimension).length === 0 || activeFilters) {
            if (activeFilters) {
              byDimension = readJsonlForHour(year, month, day, hh, groupBy, activeFilters);
            } else if (groupBy === 'toolType') {
              const dailyStats = aggregateDailyStatistics(dateStr, dailyStatsCache.get(dateStr) || null);
              const hourData = dailyStats?.hourly?.[hhStr];
              for (const [toolType, toolStats] of Object.entries(hourData?.byToolType || {})) {
                if (!hasStatsData(toolStats)) continue;
                byDimension[toolType] = {
                  requests: toolStats.requests || 0,
                  tokens: { total: getTokenTotal(toolStats.tokens) },
                  cost: toolStats.cost || 0
                };
              }
            } else {
              byDimension = readJsonlForHour(year, month, day, hh, groupBy);
            }
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

  const result = { labels, series, totals };

  // Store in cache
  trendCache.set(cacheKey, { result, expiresAt: Date.now() + TREND_CACHE_TTL_MS });

  return result;
}

module.exports = {
  recordRequest,
  getStatistics,
  getDailyStatistics,
  getTodayStatistics,
  getTrendStatistics,
  getAvailableFilters,
  flushStatistics,
  shutdownStatistics
};
