const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { StringDecoder } = require('string_decoder');
const { PATHS } = require('../../config/paths');
const { normalizeUsageTokens, resolveActualModel } = require('./usage-log-utils');

// 北京时间辅助（UTC+8），统一所有时间计算
const CST_OFFSET_MS = 8 * 60 * 60 * 1000;

const pendingEntries = [];
const MAX_PENDING_ENTRIES = 1000;
const MAX_PENDING_BYTES = 8 * 1024 * 1024;
const MAX_FLUSH_BATCH = 500;
const MAX_DAILY_CACHE = 7;
let recentDailyDates = [];
let pendingBytes = 0;
let activeEntries = 0;
let retryTimer = null;
let retryDelay = 1000;
let queueBlocked = false;
let lastQueueError = null;
let rejectedEntries = 0;
let shuttingDown = false;
let spoolSequence = 0;
const spoolDir = path.join(path.dirname(PATHS.statistics.summary), 'statistics-pending');
const stagedDailyDir = path.join(spoolDir, 'daily');
const aggregateCheckpoint = path.join(spoolDir, 'aggregate.json');
let spooledEntries = 0;
try {
  if (fs.existsSync(spoolDir)) {
    const directory = fs.opendirSync(spoolDir);
    try {
      let item;
      while ((item = directory.readSync())) if (item.name.endsWith('.entry')) spooledEntries++;
    } finally { directory.closeSync(); }
  }
} catch (error) { queueBlocked = true; lastQueueError = error.message; }

function failQueue(error) {
  queueBlocked = true;
  lastQueueError = error.message;
  console.error('[Statistics] Persistence paused:', error.message);
}

function spoolEntry(entry, alreadyCounted = false) {
  fs.mkdirSync(spoolDir, { recursive: true });
  const name = `${Date.now()}-${process.pid}-${String(spoolSequence++).padStart(12, '0')}.entry`;
  const file = path.join(spoolDir, name);
  // The log and the aggregate recovery basis commit in one atomic rename.
  const globalStats = aggregateStatsCache || loadStatistics();
  const dailyStats = dailyStatsCache.get(entry.date) || loadDailyStats(entry.date);
  const recovery = alreadyCounted
    ? { aggregateAfter: globalStats, dailyAfter: dailyStats }
    : { aggregateBefore: globalStats, dailyBefore: dailyStats };
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ ...entry, recovery }), 'utf8');
  fs.renameSync(`${file}.tmp`, file);
  entry.spoolFile = file;
  spooledEntries++;
}

function enqueueEntry(entry) {
  entry.writeId = randomUUID();
  entry.logEntry._statisticsWriteId = entry.writeId;
  entry.bytes = Buffer.byteLength(JSON.stringify(entry));
  try {
    if (entry.bytes > MAX_PENDING_BYTES) throw new Error('Statistics entry exceeds the 8 MiB persistence budget');
    if (pendingEntries.length < MAX_PENDING_ENTRIES && pendingBytes + entry.bytes <= MAX_PENDING_BYTES) {
      pendingEntries.push(entry);
      pendingBytes += entry.bytes;
    } else { spoolEntry(entry); return 'spooled'; }
    return true;
  } catch (error) {
    rejectedEntries++;
    failQueue(error);
    scheduleStatisticsRetry();
    return false;
  }
}

let spoolRecoveryRequired = spooledEntries > 0;

function recoverSpoolStatistics() {
  if (!spoolRecoveryRequired || !fs.existsSync(spoolDir)) return;
  const directory = fs.opendirSync(spoolDir);
  let globalStats = aggregateStatsCache || loadStatistics();
  try {
    let item;
    while ((item = directory.readSync())) {
      if (!item.name.endsWith('.entry')) continue;
      const entry = JSON.parse(fs.readFileSync(path.join(spoolDir, item.name), 'utf8'));
      if (!entry.recovery) continue; // Earlier spool versions use aggregate checkpoints.
      const recovery = entry.recovery;
      const aggregate = recovery.aggregateAfter || recovery.aggregateBefore;
      const daily = recovery.dailyAfter || recovery.dailyBefore;
      if (!recovery.aggregateAfter) applyAggregateRequest(aggregate, entry.logEntry);
      if (!recovery.dailyAfter) applyDailyRequest(daily, entry.logEntry);
      if (aggregate.global.totalRequests > globalStats.global.totalRequests) globalStats = aggregate;
      const currentDaily = dailyStatsCache.get(entry.date) || loadDailyStats(entry.date);
      if (daily.summary.requests > currentDaily.summary.requests) stageDailyStats(entry.date, daily);
    }
    aggregateStatsCache = globalStats;
    fs.writeFileSync(`${aggregateCheckpoint}.tmp`, JSON.stringify(globalStats), 'utf8');
    fs.renameSync(`${aggregateCheckpoint}.tmp`, aggregateCheckpoint);
    spoolRecoveryRequired = false;
  } finally {
    aggregateStatsCache = globalStats;
    directory.closeSync();
  }
}

function promoteSpoolEntries() {
  if (!spooledEntries || !fs.existsSync(spoolDir)) return;
  const directory = fs.opendirSync(spoolDir);
  try {
    let item;
    while ((item = directory.readSync()) && pendingEntries.length < MAX_PENDING_ENTRIES) {
      if (!item.name.endsWith('.entry')) continue;
      const file = path.join(spoolDir, item.name);
      if (pendingEntries.some(entry => entry.spoolFile === file)) continue;
      const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
      delete entry.recovery;
      entry.verifyPersisted = true;
      entry.bytes = Buffer.byteLength(JSON.stringify(entry));
      if (entry.bytes > MAX_PENDING_BYTES) throw new Error('Statistics entry exceeds the 8 MiB persistence budget');
      if (pendingBytes + entry.bytes > MAX_PENDING_BYTES) break;
      entry.spoolFile = file;
      pendingEntries.push(entry);
      pendingBytes += entry.bytes;
    }
  } finally { directory.closeSync(); }
}

function* getUnpersistedEntries() {
  for (const entry of pendingEntries) if (!entry.logPersisted) yield entry;
  if (!spooledEntries || !fs.existsSync(spoolDir)) return;
  const directory = fs.opendirSync(spoolDir);
  try {
    let item;
    while ((item = directory.readSync())) {
      if (!item.name.endsWith('.entry')) continue;
      const file = path.join(spoolDir, item.name);
      if (pendingEntries.some(entry => entry.spoolFile === file)) continue;
      const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!entry.logPersisted) yield entry;
    }
  } finally { directory.closeSync(); }
}

function getOutstandingCount() {
  return pendingEntries.length + Math.max(0, spooledEntries - pendingEntries.filter(entry => entry.spoolFile).length);
}

function getStatisticsQueueDiagnostics() {
  return { blocked: queueBlocked, pending: pendingEntries.length, bytes: pendingBytes,
    spooled: spooledEntries, active: activeEntries, lastError: lastQueueError, dropped: 0, rejected: rejectedEntries,
    dailyCacheEntries: dailyStatsCache.size, trendCacheEntries: trendCache.size, trendCacheBytes };
}

function stageDailyStats(date, stats) {
  fs.mkdirSync(stagedDailyDir, { recursive: true });
  const file = path.join(stagedDailyDir, `${date}.json`);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(stats), 'utf8');
  fs.renameSync(`${file}.tmp`, file);
}

function retainDailyStats(date, stats) {
  dailyStatsCache.set(date, stats);
  while (dailyStatsCache.size > MAX_DAILY_CACHE) {
    const oldest = [...dailyStatsCache.keys()].sort()[0];
    stageDailyStats(oldest, dailyStatsCache.get(oldest));
    dailyStatsCache.delete(oldest);
  }
}

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
  const filePath = fs.existsSync(aggregateCheckpoint) ? aggregateCheckpoint : getStatisticsFilePath();
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
  const stagedPath = path.join(stagedDailyDir, `${date}.json`);
  const filePath = fs.existsSync(stagedPath) ? stagedPath : getDailyStatsFilePath(date);
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

function validateFinalLogRecord(fd, scratch, start, end) {
  const { createSelectiveJsonLineParser } = require('../../platforms/drivers/native-log-utils');
  const parser = createSelectiveJsonLineParser(['_statisticsWriteId'], { maxSelectedStringBytes: 256 });
  const decoder = new StringDecoder('utf8');
  const invalidCodes = new Set(['ERR_JSON_STRUCTURE', 'ERR_JSON_VALUE', 'ERR_JSON_ESCAPE',
    'ERR_JSON_STRING', 'ERR_JSON_NUMBER', 'ERR_JSON_LITERAL', 'ERR_JSON_TRAILING',
    'ERR_JSON_OBJECT_KEY', 'ERR_JSON_INCOMPLETE']);
  try {
    for (let offset = start; offset < end;) {
      const read = fs.readSync(fd, scratch, 0, Math.min(scratch.length, end - offset), offset);
      if (!read) throw new Error('Statistics log tail changed during validation');
      offset += read;
      parser.write(decoder.write(scratch.subarray(0, read)));
    }
    parser.write(decoder.end());
    return { valid: true, value: parser.finish() };
  } catch (error) {
    // Resource limits and I/O errors do not prove that the old record is invalid.
    if (!invalidCodes.has(error.code)) throw error;
    return { valid: false };
  }
}

function findPersistedWriteIds(filePath, entries) {
  const wanted = new Set(entries.map(entry => entry.writeId).filter(Boolean));
  const found = new Set();
  if (!wanted.size || !fs.existsSync(filePath)) return found;
  const fd = fs.openSync(filePath, 'r+');
  const scratch = Buffer.allocUnsafe(64 * 1024);
  try {
    let size = fs.fstatSync(fd).size;
    if (size) {
      fs.readSync(fd, scratch, 0, 1, size - 1);
      if (scratch[0] !== 10) {
        // Preserve complete legacy JSON; a kill may occur before its newline.
        let position = size;
        let completeSize = 0;
        while (position > 0) {
          const length = Math.min(scratch.length, position);
          position -= length;
          const read = fs.readSync(fd, scratch, 0, length, position);
          const newline = scratch.subarray(0, read).lastIndexOf(10);
          if (newline >= 0) { completeSize = position + newline + 1; break; }
        }
        const finalRecord = validateFinalLogRecord(fd, scratch, completeSize, size);
        if (finalRecord.valid) {
          const writeId = finalRecord.value?._statisticsWriteId;
          if (wanted.has(writeId)) found.add(writeId);
          fs.writeSync(fd, Buffer.from('\n'), 0, 1, size);
          size++;
        } else {
          fs.ftruncateSync(fd, completeSize);
          size = completeSize;
        }
      }
    }
    let position = 0;
    let tail = '';
    while (position < size && found.size < wanted.size) {
      const read = fs.readSync(fd, scratch, 0, Math.min(scratch.length, size - position), position);
      if (!read) break;
      position += read;
      const text = tail + scratch.toString('utf8', 0, read);
      // The app-owned write id is the final field; require a complete line.
      const marker = /"_statisticsWriteId":"([a-f0-9-]{36})"}\r?\n/g;
      let match;
      while ((match = marker.exec(text))) if (wanted.has(match[1])) found.add(match[1]);
      tail = text.slice(-128);
    }
  } finally { fs.closeSync(fd); }
  return found;
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
    const recovered = group.some(entry => entry.verifyPersisted)
      ? findPersistedWriteIds(filePath, group) : new Set();
    const missing = group.filter(entry => !recovered.has(entry.writeId));
    if (missing.length) {
      for (const entry of missing) entry.verifyPersisted = true;
      await fs.promises.appendFile(
        filePath,
        missing.map(entry => `${JSON.stringify(entry.logEntry)}\n`).join(''),
        'utf8'
      );
    }
    // Commit each successful path immediately; a later path may fail.
    for (const entry of group) entry.logPersisted = true;
    for (const entry of group) {
      if (entry.spoolFile) {
        const { spoolFile, ...state } = entry;
        const recovery = JSON.parse(fs.readFileSync(spoolFile, 'utf8')).recovery;
        fs.writeFileSync(`${spoolFile}.tmp`, JSON.stringify({ ...state, recovery }), 'utf8');
        fs.renameSync(`${spoolFile}.tmp`, spoolFile);
      }
    }
    persisted.push(...group);
  }
  return persisted;
}

async function writeJsonAsync(filePath, value) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function scheduleStatisticsRetry() {
  if (retryTimer || shuttingDown) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushStatistics();
  }, retryDelay);
  retryTimer.unref?.();
  retryDelay = Math.min(retryDelay * 2, 30000);
}

function scheduleStatisticsFlush() {
  if (flushScheduled || retryTimer || shuttingDown) return;
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
    if (!shuttingDown) void flushStatistics();
  });
}

async function flushStagedDailyStats() {
  if (!fs.existsSync(stagedDailyDir)) return;
  const directory = fs.opendirSync(stagedDailyDir);
  try {
    let item;
    while ((item = directory.readSync())) {
      if (!item.name.endsWith('.json')) continue;
      const file = path.join(stagedDailyDir, item.name);
      const content = fs.readFileSync(file, 'utf8');
      const date = item.name.slice(0, -5);
      const stats = cloneJson(dailyStatsCache.get(date) || JSON.parse(content));
      await writeJsonAsync(path.join(PATHS.statistics.dailyStats, item.name), stats);
      // recordRequest may have replaced this staged snapshot while awaiting I/O.
      if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) fs.unlinkSync(file);
    }
  } finally { directory.closeSync(); }
}

async function flushStatistics() {
  if (flushPromise) return flushPromise;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  try { recoverSpoolStatistics(); promoteSpoolEntries(); } catch (error) {
    failQueue(error);
    scheduleStatisticsRetry();
    return { flushed: 0, pending: getOutstandingCount(), error: error.message };
  }
  // Probe writes even with no admitted entries, to recover from a failed overflow.
  if (pendingEntries.length === 0 && !queueBlocked && !fs.existsSync(stagedDailyDir) && !fs.existsSync(aggregateCheckpoint)) return { flushed: 0, pending: 0 };
  let batch, checkpointContent, globalSnapshot, dailySnapshots;
  try {
    batch = pendingEntries.slice(0, MAX_FLUSH_BATCH);
    activeEntries = batch.length;
    checkpointContent = fs.existsSync(aggregateCheckpoint) ? fs.readFileSync(aggregateCheckpoint, 'utf8') : null;
    globalSnapshot = aggregateStatsCache ? cloneJson(aggregateStatsCache) : (checkpointContent ? JSON.parse(checkpointContent) : null);
    const dates = [...new Set(batch.map(entry => entry.date))];
    dailySnapshots = new Map(dates.map(date => [date, cloneJson(dailyStatsCache.get(date) || loadDailyStats(date))]));

  } catch (error) {
    activeEntries = 0;
    failQueue(error);
    scheduleStatisticsRetry();
    return { flushed: 0, pending: getOutstandingCount(), error: error.message };
  }

  flushPromise = (async () => {
    try {
      if (queueBlocked) {
        await fs.promises.mkdir(spoolDir, { recursive: true });
        const probe = path.join(spoolDir, 'write-probe.tmp');
        await fs.promises.writeFile(probe, '', 'utf8');
        if (fs.existsSync(probe)) fs.unlinkSync(probe);
      }
      await appendRequestLogsAsync(batch.filter(entry => !entry.logPersisted));
      if (globalSnapshot) {
        globalSnapshot.lastUpdated = new Date().toISOString();
        await writeJsonAsync(getStatisticsFilePath(), globalSnapshot);
        if (checkpointContent && fs.existsSync(aggregateCheckpoint) && fs.readFileSync(aggregateCheckpoint, 'utf8') === checkpointContent) fs.unlinkSync(aggregateCheckpoint);
      }
      for (const [date, stats] of dailySnapshots) {
        if (stats) await writeJsonAsync(getDailyStatsFilePathWithoutCreate(date), stats);
      }
      await flushStagedDailyStats();
      for (const entry of batch) {
        if (entry.spoolFile) { fs.unlinkSync(entry.spoolFile); spooledEntries--; }
        pendingEntries.splice(pendingEntries.indexOf(entry), 1);
        pendingBytes -= entry.bytes;
      }
      for (const date of dailyStatsCache.keys()) {
        if (!recentDailyDates.includes(date) && !pendingEntries.some(entry => entry.date === date)) dailyStatsCache.delete(date);
      }
      queueBlocked = false;
      lastQueueError = null;
      retryDelay = 1000;
      return { flushed: batch.length, pending: getOutstandingCount() };
    } catch (error) {
      failQueue(error);
      return { flushed: 0, pending: getOutstandingCount(), error: error.message };
    } finally {
      activeEntries = 0;
    }
  })().finally(() => {
    flushPromise = null;
    if (queueBlocked) scheduleStatisticsRetry();
    else if (pendingEntries.length || spooledEntries) scheduleStatisticsFlush();
  });
  return flushPromise;
}

function getDailyStatsFilePathWithoutCreate(date) {
  return path.join(PATHS.statistics.dailyStats, `${date}.json`);
}

async function shutdownStatistics() {
  shuttingDown = true;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  let result = await flushStatistics();
  while (result.pending > 0 && !result.error) result = await flushStatistics();
  let durable = !result.error;
  // If destination persistence fails, retain pending records in the restart spool.
  if (result.error) {
    durable = true;
    try {
      for (const [date, stats] of dailyStatsCache) stageDailyStats(date, stats);
      if (aggregateStatsCache) {
        fs.mkdirSync(spoolDir, { recursive: true });
        fs.writeFileSync(`${aggregateCheckpoint}.tmp`, JSON.stringify(aggregateStatsCache), 'utf8');
        fs.renameSync(`${aggregateCheckpoint}.tmp`, aggregateCheckpoint);
      }
    } catch (error) { durable = false; failQueue(error); }
    for (const entry of pendingEntries) {
      if (entry.spoolFile) continue;
      try { spoolEntry(entry, true); } catch (error) { durable = false; failQueue(error); break; }
    }
  }
  if (durable) clearInterval(trendCacheSweepTimer);
  else { shuttingDown = false; scheduleStatisticsRetry(); }
  return { ...result, durable };
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

function applyAggregateRequest(globalStats, entry) {
  const { timestamp, toolType = 'claude-code', channel, channelId, model, tokens = {}, cost = 0 } = entry;
  const modelKey = model || 'unknown';
  const totalTokens = getTokenTotal(tokens);
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

    // Native CLI logs do not always contain a reliable configured-channel id.
    // Keep aggregate totals in that case instead of creating an "undefined"
    // channel bucket.
    if (channelId) {
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
    }

    // 按工具类型 -> 模型统计
    if (!globalStats.byToolType[toolType].models[modelKey]) {
      globalStats.byToolType[toolType].models[modelKey] = initStatsObject();
    }
    updateStats(globalStats.byToolType[toolType].models[modelKey], tokens, cost);

    // Cross-tool channel totals follow the same rule.
    if (channelId) {
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
    }

    // 按模型统计（跨工具）
    if (!globalStats.byModel[modelKey]) {
      globalStats.byModel[modelKey] = {
        toolType,
        ...initStatsObject()
      };
    }
    updateStats(globalStats.byModel[modelKey], tokens, cost);


}

function applyDailyRequest(dailyStats, entry) {
  const { timestamp, toolType = 'claude-code', channel, channelId, model, tokens = {}, cost = 0 } = entry;
  const modelKey = model || 'unknown';
  const totalTokens = getTokenTotal(tokens);
    const hour = getCSTHour(timestamp).toString().padStart(2, '0'); // HH (CST)


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

    // 按工具类型 -> 渠道；原生日志没有可靠渠道时只保留平台级统计。
    if (channelId) {
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
    }

    // 按工具类型 -> 模型
    if (!dailyStats.byToolType[toolType].models) {
      dailyStats.byToolType[toolType].models = {};
    }
    if (!dailyStats.byToolType[toolType].models[modelKey]) {
      dailyStats.byToolType[toolType].models[modelKey] = initStatsObject();
    }
    updateStats(dailyStats.byToolType[toolType].models[modelKey], tokens, cost);

    // 按渠道统计；不创建 undefined 渠道桶。
    if (channelId) {
      if (!dailyStats.byChannel[channelId]) {
        dailyStats.byChannel[channelId] = {
          toolType,
          name: channel,
          ...initStatsObject()
        };
      }
      updateStats(dailyStats.byChannel[channelId], tokens, cost);
    }

    // 按模型统计
    if (!dailyStats.byModel[modelKey]) {
      dailyStats.byModel[modelKey] = {
        toolType,
        ...initStatsObject()
      };
    }
    updateStats(dailyStats.byModel[modelKey], tokens, cost);


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
      tokens = {},
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

    if (Buffer.byteLength(JSON.stringify(logEntry)) > MAX_PENDING_BYTES / 2) for (const key of ['id', 'toolType', 'channel', 'channelId', 'model', 'originalModel', 'redirectedModel', 'session', 'project']) {
      const value = logEntry[key];
      if (typeof value === 'string' && Buffer.byteLength(value) > 16384) logEntry[key] = value.slice(0, 4096);
      else if (value && typeof value === 'object') logEntry[key] = '[metadata omitted]';
    }
    logEntry.tokens = Object.fromEntries(['input', 'output', 'cacheCreation', 'cacheRead', 'cached', 'reasoning', 'total'].filter(key => typeof tokens[key] === 'number').map(key => [key, tokens[key]]));
    const date = getCSTDateStr(timestamp);
    let dailyStats = dailyStatsCache.get(date) || loadDailyStats(date);
    // Persist an evicted dirty date before admitting another date.
    if (!dailyStatsCache.has(date) && dailyStatsCache.size >= MAX_DAILY_CACHE) {
      const oldest = [...dailyStatsCache.keys()].sort()[0];
      stageDailyStats(oldest, dailyStatsCache.get(oldest));
      dailyStatsCache.delete(oldest);
    }
    const admission = enqueueEntry({ logEntry, date });
    if (!admission) return false;
    recentDailyDates = [...new Set([...recentDailyDates, date])].sort().slice(-MAX_DAILY_CACHE);
    retainDailyStats(date, dailyStats);

    // 2. 更新总体统计
    const globalStats = aggregateStatsCache || loadStatistics();
    aggregateStatsCache = globalStats;
    applyAggregateRequest(globalStats, logEntry);

    // 3. 更新每日统计（使用北京时间）
    applyDailyRequest(dailyStats, logEntry);

    // Invalidate cached trend results that cover this date
    invalidateTrendCacheForDate(date);
    if (admission === 'spooled') {
      // Overflow records survive a restart together with their aggregate state.
      try {
        stageDailyStats(date, dailyStats);
        fs.writeFileSync(`${aggregateCheckpoint}.tmp`, JSON.stringify(globalStats), 'utf8');
        fs.renameSync(`${aggregateCheckpoint}.tmp`, aggregateCheckpoint);
      } catch (error) { failQueue(error); scheduleStatisticsRetry(); }
    }
    scheduleStatisticsFlush();
    return true;
  } catch (err) {
    failQueue(err);
    scheduleStatisticsRetry();
    return false;
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
  for (const { logEntry } of getUnpersistedEntries()) {
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
    if (!fs.existsSync(filePath)) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      mergePendingLogEntries(result, dateStr, hour, groupBy, filters);
      return result;
    }
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
    if (!fs.existsSync(filePath)) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      mergePendingLogEntries(result, dateStr, undefined, groupBy, filters);
      return result;
    }
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
    if (typeof tokens.total === 'number' && tokens.total > 0) return tokens.total;

    // Token detail fields overlap: cached/reasoning tokens are usually
    // sub-counts of input/output. The canonical shape stores cached input
    // separately, so include it once and never add reasoning independently.
    const usageKeys = ['input', 'output', 'cacheCreation', 'cacheRead', 'cached'];
    if (usageKeys.some(key => typeof tokens[key] === 'number')) {
      const input = typeof tokens.input === 'number' ? tokens.input : 0;
      const output = typeof tokens.output === 'number' ? tokens.output : 0;
      const cacheCreation = typeof tokens.cacheCreation === 'number' ? tokens.cacheCreation : 0;
      const cacheRead = typeof tokens.cacheRead === 'number'
        ? tokens.cacheRead
        : (typeof tokens.cached === 'number' ? tokens.cached : 0);
      return input + output + cacheCreation + cacheRead;
    }

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

for (const { logEntry, date } of getUnpersistedEntries()) {
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
let trendCacheBytes = 0;
const MAX_TREND_CACHE_BYTES = 8 * 1024 * 1024;
function deleteTrendCacheEntry(key) {
  const cached = trendCache.get(key);
  if (cached) trendCacheBytes -= cached.bytes;
  trendCache.delete(key);
}
function sweepTrendCache() {
  for (const [key, value] of trendCache) if (value.expiresAt <= Date.now()) deleteTrendCacheEntry(key);
}
const trendCacheSweepTimer = setInterval(sweepTrendCache, 30000);
trendCacheSweepTimer.unref?.();
const TREND_CACHE_TTL_MS = 30 * 1000; // 30 seconds

function getTrendCacheKey(params) {
  return JSON.stringify(params);
}

function invalidateTrendCache() {
  trendCache.clear();
  trendCacheBytes = 0;
}

// Called by recordRequest so fresh data is visible immediately after a new request
function invalidateTrendCacheForDate(dateStr) {
  for (const key of trendCache.keys()) {
    try {
      const p = JSON.parse(key);
      if (p.startDate <= dateStr && dateStr <= p.endDate) {
        deleteTrendCacheEntry(key);
      }
    } catch { deleteTrendCacheEntry(key); }
  }
}
// ─────────────────────────────────────────────────────────────────────────────

async function getTrendStatistics({ startDate, endDate, granularity = 'day', step = 1, groupBy = 'model', metric = 'tokens', filters }) {
  step = parseInt(step) || 1;

  // Normalize filters: treat empty string as no filter
  const activeFilters = filters && (filters.toolType || filters.channel || filters.model) ? filters : null;

  // Check cache first
  const cacheKey = getTrendCacheKey({ startDate, endDate, granularity, step: String(step), groupBy, metric, filters: activeFilters || null });
  sweepTrendCache();
  const cached = trendCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    trendCache.delete(cacheKey);
    trendCache.set(cacheKey, cached);
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
  const bytes = Buffer.byteLength(cacheKey) + Buffer.byteLength(JSON.stringify(result));
  if (bytes <= MAX_TREND_CACHE_BYTES) {
    deleteTrendCacheEntry(cacheKey);
    while (trendCache.size >= 32 || trendCacheBytes + bytes > MAX_TREND_CACHE_BYTES) {
      deleteTrendCacheEntry(trendCache.keys().next().value);
    }
    trendCache.set(cacheKey, { result, bytes, expiresAt: Date.now() + TREND_CACHE_TTL_MS });
    trendCacheBytes += bytes;
  }

  return result;
}

try { recoverSpoolStatistics(); } catch (error) { failQueue(error); }

if (spooledEntries || fs.existsSync(stagedDailyDir) || fs.existsSync(aggregateCheckpoint)) scheduleStatisticsFlush();

module.exports = {
  recordRequest,
  getStatisticsQueueDiagnostics,
  getStatistics,
  getDailyStatistics,
  getTodayStatistics,
  getTrendStatistics,
  getAvailableFilters,
  flushStatistics,
  shutdownStatistics
};
