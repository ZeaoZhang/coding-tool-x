const WebSocket = require('ws');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../config/loader');
const { PATHS } = require('../config/paths');
const eventBus = require('../plugins/event-bus');
const {
  normalizeAddress,
  isLoopbackAddress,
  isLoopbackRequest
} = require('./services/network-access');

const MAX_PERSISTED_LOGS = 500;
const LOG_PERSIST_DEBOUNCE_MS = 250;

let maxLogsLimit = 100;

function getMaxLogsLimit() {
  return maxLogsLimit;
}

function refreshMaxLogsLimit(config = null) {
  try {
    const limit = parseInt((config || loadConfig()).maxLogs, 10);
    if (!Number.isFinite(limit)) {
      maxLogsLimit = 100;
    } else {
      maxLogsLimit = Math.min(Math.max(limit, 50), MAX_PERSISTED_LOGS);
    }
  } catch (err) {
    console.error('Failed to load log limit from config:', err);
    maxLogsLimit = 100;
  }
  trimLogCache();
  return maxLogsLimit;
}

let wss = null;
let wsClients = new Set();
let websocketOptions = {
  host: '127.0.0.1'
};
const HISTORY_CHUNK_SIZE = 50;

function sendPersistedLogsInChunks(ws, logs) {
  let index = 0;

  const sendChunk = () => {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const end = Math.min(index + HISTORY_CHUNK_SIZE, logs.length);
    for (let i = index; i < end; i++) {
      ws.send(JSON.stringify(logs[i]));
    }
    index = end;

    if (index < logs.length) {
      setImmediate(sendChunk);
    }
  };

  setImmediate(sendChunk);
}

function parseHostHeader(hostHeader) {
  const value = String(hostHeader || '').trim();
  if (!value) {
    return { hostname: '', port: '' };
  }

  if (value.startsWith('[')) {
    const closingBracket = value.indexOf(']');
    if (closingBracket > 0) {
      const hostname = value.slice(1, closingBracket);
      const rest = value.slice(closingBracket + 1);
      const port = rest.startsWith(':') ? rest.slice(1) : '';
      return { hostname, port };
    }
  }

  const separator = value.lastIndexOf(':');
  if (separator > -1 && value.indexOf(':') === separator) {
    return {
      hostname: value.slice(0, separator),
      port: value.slice(separator + 1)
    };
  }

  return { hostname: value, port: '' };
}

function defaultPortForProtocol(protocol) {
  if (protocol === 'https:') {
    return '443';
  }
  return '80';
}

function isAllowedWebSocketOrigin(req) {
  if (!req || !req.headers) {
    return false;
  }

  const originHeader = req.headers.origin;
  if (!originHeader) {
    // 非浏览器客户端通常不会携带 Origin，仅允许本机来源
    return isLoopbackRequest(req);
  }

  let originUrl;
  try {
    originUrl = new URL(originHeader);
  } catch (error) {
    return false;
  }

  if (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') {
    return false;
  }

  const requestHost = parseHostHeader(req.headers.host);
  const requestProtocol = req.socket && req.socket.encrypted ? 'https:' : 'http:';
  const requestHostname = normalizeAddress(requestHost.hostname).toLowerCase();
  const requestPort = requestHost.port || defaultPortForProtocol(requestProtocol);

  const originHostname = normalizeAddress(originUrl.hostname).toLowerCase();
  const originPort = originUrl.port || defaultPortForProtocol(originUrl.protocol);

  if (!requestHostname || !originHostname) {
    return false;
  }

  // 同源直接放行
  if (originHostname === requestHostname && originPort === requestPort) {
    return true;
  }

  // 允许本机开发代理（例如 Vite 5000 -> 19999）
  if (isLoopbackRequest(req) && isLoopbackAddress(originHostname) && isLoopbackAddress(requestHostname)) {
    return true;
  }

  return false;
}

function installOriginGuard(server) {
  if (!server || typeof server.shouldHandle !== 'function') {
    return;
  }

  const originalShouldHandle = server.shouldHandle.bind(server);
  server.shouldHandle = (req) => {
    if (!originalShouldHandle(req)) {
      return false;
    }

    const allowed = isAllowedWebSocketOrigin(req);
    if (!allowed) {
      const origin = req.headers.origin || 'unknown';
      const clientIp = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
      console.warn(`[WebSocket] Rejected connection from ${clientIp}, origin: ${origin}`);
    }
    return allowed;
  };
}

// 日志持久化文件路径
function getLogsFilePath() {
  const filePath = PATHS.statistics.proxyLogs;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return filePath;
}

function getTodayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const startMs = start.getTime();
  const endMs = startMs + 24 * 60 * 60 * 1000;
  return { startMs, endMs };
}

function inferSource(log) {
  if (log.source) {
    return log.source;
  }
  if (log.toolType) {
    if (log.toolType.includes('codex')) return 'codex';
    if (log.toolType.includes('gemini')) return 'gemini';
    if (log.toolType.includes('opencode')) return 'opencode';
    if (log.toolType.includes('omp')) return 'omp';
  }
  if (typeof log.model === 'string') {
    const model = log.model.toLowerCase();
    if (model.includes('gemini')) return 'gemini';
    if (model.includes('opencode')) return 'opencode';
    if (model.includes('omp')) return 'omp';
    if (model.includes('gpt') || model.includes('o1') || model.includes('o3')) return 'codex';
    if (model.includes('claude')) return 'claude';
  }
  if (typeof log.action === 'string') {
    if (log.action.includes('codex')) return 'codex';
    if (log.action.includes('gemini')) return 'gemini';
    if (log.action.includes('opencode')) return 'opencode';
    if (log.action.includes('omp')) return 'omp';
  }
  if (log.channelType === 'codex' || log.channelType === 'gemini' || log.channelType === 'opencode' || log.channelType === 'omp') {
    return log.channelType;
  }
  return 'claude';
}

function filterTodayLogs(logs) {
  const { startMs, endMs } = getTodayRange();
  return logs.filter(log => {
    let ts = log.timestamp;
    if (typeof ts !== 'number' || !Number.isFinite(ts)) {
      if (typeof log.timestamp === 'string') {
        const parsed = Date.parse(log.timestamp);
        if (Number.isFinite(parsed)) {
          ts = parsed;
        }
      }
    }
    if (typeof ts !== 'number' || !Number.isFinite(ts)) {
      // 无法解析时间戳，默认为当前时间（视作今日日志）
      ts = Date.now();
    }
    log.timestamp = ts;
    log.source = inferSource(log);
    return ts >= startMs && ts < endMs;
  });
}

function enforcePerSourceLimit(logs, limit = getMaxLogsLimit()) {
  if (!limit || limit <= 0) {
    return logs;
  }

  const counts = {};
  const retained = [];

  for (let i = logs.length - 1; i >= 0; i--) {
    const log = logs[i];
    const src = log.source || 'claude';
    counts[src] = (counts[src] || 0) + 1;
    if (counts[src] <= limit) {
      retained.push(log);
    }
  }

  return retained.reverse();
}

// 加载持久化的日志
function loadPersistedLogs() {
  try {
    const logsFile = getLogsFilePath();
    if (fs.existsSync(logsFile)) {
      const data = fs.readFileSync(logsFile, 'utf8');
      const logs = enforcePerSourceLimit(filterTodayLogs(JSON.parse(data)));
      return Array.isArray(logs) ? logs : [];
    }
  } catch (err) {
    console.error('Failed to load persisted logs:', err);
  }
  return [];
}

function serializeLogs(logs) {
  try {
    const todayLogs = enforcePerSourceLimit(filterTodayLogs(logs));
    const logsToSave = todayLogs.slice(-MAX_PERSISTED_LOGS);
    return JSON.stringify(logsToSave, null, 2);
  } catch (err) {
    console.error('Failed to serialize logs:', err);
    return '[]';
  }
}

// 内存中的日志缓存
let logsCache = [];
let logSourceCounts = new Map();
let cacheDayStartMs = null;
let persistTimer = null;
let persistGeneration = 0;
let persistedGeneration = 0;
let enqueuedGeneration = 0;
let persistChain = Promise.resolve();
let configSavedListener = null;

function rebuildLogSourceCounts() {
  logSourceCounts = new Map();
  logsCache.forEach(log => {
    const source = log.source || 'claude';
    logSourceCounts.set(source, (logSourceCounts.get(source) || 0) + 1);
  });
}

function removeLogAt(index) {
  if (index < 0 || index >= logsCache.length) return;
  const [removed] = logsCache.splice(index, 1);
  const source = removed?.source || 'claude';
  const count = (logSourceCounts.get(source) || 1) - 1;
  if (count > 0) logSourceCounts.set(source, count);
  else logSourceCounts.delete(source);
}

function trimLogCache() {
  const { startMs, endMs } = getTodayRange();
  if (cacheDayStartMs !== startMs) {
    logsCache = logsCache.filter(log => {
      let timestamp = typeof log.timestamp === 'number' ? log.timestamp : Date.parse(log.timestamp);
      if (!Number.isFinite(timestamp)) timestamp = Date.now();
      log.timestamp = timestamp;
      log.source = inferSource(log);
      return timestamp >= startMs && timestamp < endMs;
    });
    cacheDayStartMs = startMs;
    rebuildLogSourceCounts();
  }

  const limit = getMaxLogsLimit();
  if (limit > 0) {
    for (const [source, count] of [...logSourceCounts]) {
      let remaining = count - limit;
      if (remaining <= 0) continue;
      for (let index = 0; index < logsCache.length && remaining > 0; index += 1) {
        if (logsCache[index].source === source) {
          removeLogAt(index);
          index -= 1;
          remaining -= 1;
        }
      }
    }
  }
  while (logsCache.length > MAX_PERSISTED_LOGS) removeLogAt(0);
}

function appendLogToCache(payload) {
  trimLogCache();
  logsCache.push(payload);
  const source = payload.source || 'claude';
  logSourceCounts.set(source, (logSourceCounts.get(source) || 0) + 1);
  trimLogCache();
}

function enqueueLogPersistence(data, generation) {
  enqueuedGeneration = Math.max(enqueuedGeneration, generation);
  persistChain = persistChain
    .catch(() => {})
    .then(async () => {
      await fs.promises.writeFile(getLogsFilePath(), data, 'utf8');
      persistedGeneration = Math.max(persistedGeneration, generation);
    })
    .catch((error) => {
      console.error('Failed to save logs to file:', error);
    });
  return persistChain;
}

function scheduleLogPersistence({ markDirty = true } = {}) {
  if (markDirty) persistGeneration += 1;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    flushPendingLogs();
  }, LOG_PERSIST_DEBOUNCE_MS);
  if (typeof persistTimer.unref === 'function') persistTimer.unref();
}

function flushPendingLogs() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (persistGeneration <= persistedGeneration || persistGeneration <= enqueuedGeneration) {
    return persistChain;
  }
  const generation = persistGeneration;
  const data = serializeLogs(logsCache.slice());
  return enqueueLogPersistence(data, generation).then(() => {
    if (persistGeneration > generation && persistGeneration > enqueuedGeneration) {
      scheduleLogPersistence({ markDirty: false });
    }
  });
}

function ensureConfigListener() {
  if (configSavedListener) return;
  configSavedListener = ({ config } = {}) => refreshMaxLogsLimit(config);
  eventBus.on('config:saved', configSavedListener);
}

// 启动 WebSocket 服务器（附加到现有的 HTTP 服务器）
function startWebSocketServer(httpServer, options = {}) {
  if (wss) {
    console.log('WebSocket server already running');
    return;
  }

  websocketOptions = {
    host: options.host || '127.0.0.1'
  };

  ensureConfigListener();
  refreshMaxLogsLimit();
  // 加载持久化的日志到缓存
  logsCache = loadPersistedLogs();
  cacheDayStartMs = getTodayRange().startMs;
  rebuildLogSourceCounts();
  const counts = logsCache.reduce((acc, log) => {
    const source = log.source || 'unknown';
    acc[source] = (acc[source] || 0) + 1;
    return acc;
  }, {});
  console.log(`[NOTE] Loaded ${logsCache.length} persisted logs today ->`, counts);

  try {
    // 如果传入的是 HTTP server，则附加到该服务器；否则创建独立的 WebSocket 服务器
    if (httpServer) {
      wss = new WebSocket.Server({
        server: httpServer,
        path: '/ws'  // 指定 WebSocket 路径
      });
      installOriginGuard(wss);
      console.log(`[OK] WebSocket server attached to HTTP server at /ws`);
    } else {
      // 创建独立的 WebSocket 服务器，使用配置的 webUI 端口
      const config = loadConfig();
      const port = config.ports?.webUI || 19999;
      wss = new WebSocket.Server({
        port,
        path: '/ws'
      });
      installOriginGuard(wss);
      console.log(`[OK] WebSocket server started on ws://127.0.0.1:${port}/ws`);
    }

    wss.on('connection', (ws, req) => {
      const clientIp = req.socket.remoteAddress;
      console.log(`[WebSocket] New connection from ${clientIp}`);

      wsClients.add(ws);

      // 标记客户端存活
      ws.isAlive = true;
      // 发送历史日志给新连接的客户端
      if (logsCache.length > 0) {
        sendPersistedLogsInChunks(ws, logsCache);
      }

      // 响应 pong 消息
      ws.on('pong', () => {
        ws.isAlive = true;
      });

      // 响应客户端的心跳 ping
      ws.on('ping', () => {
        ws.pong();
      });

      ws.on('close', () => {
        wsClients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        wsClients.delete(ws);
      });
    });

    // 心跳检测：每 30 秒 ping 一次所有客户端
    const heartbeatInterval = setInterval(() => {
      wsClients.forEach(ws => {
        if (ws.isAlive === false) {
          // 客户端没有响应 pong，断开连接
          console.log('[ERROR] WebSocket client timeout, terminating');
          wsClients.delete(ws);
          return ws.terminate();
        }

        // 标记为未响应，等待 pong
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);

    // 保存 interval 以便停止时清除
    wss.heartbeatInterval = heartbeatInterval;

    wss.on('error', (error) => {
      console.error('WebSocket server error:', error);
      if (error.code === 'EADDRINUSE') {
        console.error(chalk.red('\n[ERROR] WebSocket 端口已被占用'));
        console.error(chalk.yellow('\n[TIP] 请检查端口配置\n'));
        wss = null;
      }
    });
  } catch (error) {
    console.error('Failed to start WebSocket server:', error);
    wss = null;
  }
}

// 停止 WebSocket 服务器
function stopWebSocketServer() {
  if (!wss) {
    return flushPendingLogs();
  }

  // 清除心跳定时器
  if (wss.heartbeatInterval) {
    clearInterval(wss.heartbeatInterval);
    wss.heartbeatInterval = null;
  }

  // 关闭所有客户端连接
  wsClients.forEach(client => {
    client.close();
  });
  wsClients.clear();

  // 关闭服务器
  wss.close(() => {
    console.log('[OK] WebSocket server stopped');
  });

  wss = null;
  return flushPendingLogs();
}

// 广播日志消息
function broadcastLog(logData) {
  const timestamp = typeof logData.timestamp === 'number' ? logData.timestamp : Date.now();
  const payload = {
    ...logData,
    timestamp
  };

  payload.source = payload.source || inferSource(payload);

  // 添加到有界内存缓存，持久化由防抖队列合并处理。
  appendLogToCache(payload);
  scheduleLogPersistence();

  // 广播给所有连接的客户端
  if (wss && wsClients.size > 0) {
    const message = JSON.stringify(payload);

    wsClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
}

// 清空所有日志
function clearAllLogs() {
  logsCache = [];
  logSourceCounts = new Map();
  cacheDayStartMs = getTodayRange().startMs;
  persistGeneration += 1;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  const generation = persistGeneration;
  enqueueLogPersistence('[]', generation);
  console.log('[OK] All logs cleared');
  return persistChain;
}

// 复制渠道状态，保留 API key 供前端展示
function sanitizeChannel(channel) {
  if (!channel || typeof channel !== 'object') {
    return null;
  }
  return { ...channel };
}

function sanitizeChannels(channels) {
  if (!Array.isArray(channels)) {
    return [];
  }
  return channels.map(channel => sanitizeChannel(channel)).filter(Boolean);
}

// 广播代理状态更新
function broadcastProxyState(source, proxyStatus = {}, activeChannel = null, channels = []) {
  const stateUpdate = {
    type: 'proxy-state',
    source, // 'claude', 'codex', or 'gemini'
    proxy: proxyStatus,
    activeChannel: sanitizeChannel(activeChannel),
    channels: sanitizeChannels(channels),
    timestamp: Date.now()
  };

  if (wss && wsClients.size > 0) {
    const message = JSON.stringify(stateUpdate);

    wsClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
}

// 广播调度状态更新（实时并发信息）
function broadcastSchedulerState(source, schedulerState) {
  const stateUpdate = {
    type: 'scheduler-state',
    source, // 'claude', 'codex', or 'gemini'
    scheduler: schedulerState,
    timestamp: Date.now()
  };

  if (wss && wsClients.size > 0) {
    const message = JSON.stringify(stateUpdate);

    wsClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
}

function broadcastBrowserNotification(notification = {}) {
  if (wss && wsClients.size > 0) {
    const message = JSON.stringify({
      type: 'browser-notification',
      ...notification,
      timestamp: notification.timestamp || Date.now()
    });

    wsClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
}

module.exports = {
  startWebSocketServer,
  stopWebSocketServer,
  broadcastLog,
  clearAllLogs,
  flushPendingLogs,
  broadcastProxyState,
  broadcastSchedulerState,
  broadcastBrowserNotification
};
