const WebSocket = require('ws');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadConfig } = require('../config/loader');
const { ptyManager } = require('./services/pty-manager');
const {
  normalizeAddress,
  isLoopbackAddress,
  isLoopbackRequest
} = require('./services/network-access');

const MAX_PERSISTED_LOGS = 500;

function getMaxLogsLimit() {
  try {
    const config = loadConfig();
    const limit = parseInt(config.maxLogs, 10);
    if (!Number.isFinite(limit)) {
      return 100;
    }
    return Math.min(Math.max(limit, 50), MAX_PERSISTED_LOGS);
  } catch (err) {
    console.error('Failed to load log limit from config:', err);
    return 100;
  }
}

let wss = null;
let wsClients = new Set();
let websocketOptions = {
  host: '127.0.0.1',
  allowRemoteTerminal: false
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
  const ccToolDir = path.join(os.homedir(), '.cc-tool');
  if (!fs.existsSync(ccToolDir)) {
    fs.mkdirSync(ccToolDir, { recursive: true });
  }
  return path.join(ccToolDir, 'proxy-logs.json');
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
  }
  if (typeof log.model === 'string') {
    const model = log.model.toLowerCase();
    if (model.includes('gemini')) return 'gemini';
    if (model.includes('gpt') || model.includes('o1') || model.includes('o3')) return 'codex';
    if (model.includes('claude')) return 'claude';
  }
  if (typeof log.action === 'string') {
    if (log.action.includes('codex')) return 'codex';
    if (log.action.includes('gemini')) return 'gemini';
  }
  if (log.channelType === 'codex' || log.channelType === 'gemini') {
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

function enforcePerSourceLimit(logs) {
  const limit = getMaxLogsLimit();
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

// 保存日志到文件
function saveLogsToFile(logs) {
  try {
    const logsFile = getLogsFilePath();
    // 只保留最新的 MAX_PERSISTED_LOGS 条，且仅保存今日日志
    const todayLogs = enforcePerSourceLimit(filterTodayLogs(logs));
    const logsToSave = todayLogs.slice(-MAX_PERSISTED_LOGS);
    fs.writeFileSync(logsFile, JSON.stringify(logsToSave, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save logs to file:', err);
  }
}

// 内存中的日志缓存
let logsCache = [];

// 启动 WebSocket 服务器（附加到现有的 HTTP 服务器）
function startWebSocketServer(httpServer, options = {}) {
  if (wss) {
    console.log('WebSocket server already running');
    return;
  }

  websocketOptions = {
    host: options.host || '127.0.0.1',
    allowRemoteTerminal: options.allowRemoteTerminal === true
  };

  // 加载持久化的日志到缓存
  logsCache = loadPersistedLogs();
  const counts = logsCache.reduce((acc, log) => {
    const source = log.source || 'unknown';
    acc[source] = (acc[source] || 0) + 1;
    return acc;
  }, {});
  console.log(`📝 Loaded ${logsCache.length} persisted logs today ->`, counts);

  try {
    // 如果传入的是 HTTP server，则附加到该服务器；否则创建独立的 WebSocket 服务器
    if (httpServer) {
      wss = new WebSocket.Server({
        server: httpServer,
        path: '/ws'  // 指定 WebSocket 路径
      });
      installOriginGuard(wss);
      console.log(`✅ WebSocket server attached to HTTP server at /ws`);
    } else {
      // 创建独立的 WebSocket 服务器，使用配置的 webUI 端口
      const config = loadConfig();
      const port = config.ports?.webUI || 19999;
      wss = new WebSocket.Server({
        port,
        path: '/ws'
      });
      installOriginGuard(wss);
      console.log(`✅ WebSocket server started on ws://127.0.0.1:${port}/ws`);
    }

    wss.on('connection', (ws, req) => {
      const clientIp = req.socket.remoteAddress;
      console.log(`[WebSocket] New connection from ${clientIp}`);

      wsClients.add(ws);

      // 标记客户端存活
      ws.isAlive = true;
      // 终端绑定信息
      ws.terminalId = null;
      const isLoopback = isLoopbackRequest(req);
      const lanMode = websocketOptions.host === '0.0.0.0';
      ws.terminalAllowed = !(lanMode && !isLoopback && !websocketOptions.allowRemoteTerminal);

      // 发送历史日志给新连接的客户端
      if (logsCache.length > 0) {
        sendPersistedLogsInChunks(ws, logsCache);
      }

      // 处理客户端消息
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          handleTerminalMessage(ws, message);
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err.message);
        }
      });

      // 响应 pong 消息
      ws.on('pong', () => {
        ws.isAlive = true;
      });

      // 响应客户端的心跳 ping
      ws.on('ping', () => {
        ws.pong();
      });

      ws.on('close', () => {
        // 解绑终端
        if (ws.terminalId) {
          ptyManager.detachWebSocket(ws.terminalId);
        }
        wsClients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        if (ws.terminalId) {
          ptyManager.detachWebSocket(ws.terminalId);
        }
        wsClients.delete(ws);
      });
    });

    // 心跳检测：每 30 秒 ping 一次所有客户端
    const heartbeatInterval = setInterval(() => {
      wsClients.forEach(ws => {
        if (ws.isAlive === false) {
          // 客户端没有响应 pong，断开连接
          console.log('❌ WebSocket client timeout, terminating');
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
        console.error(chalk.red('\n❌ WebSocket 端口已被占用'));
        console.error(chalk.yellow('\n💡 请检查端口配置\n'));
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
    return;
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
    console.log('✅ WebSocket server stopped');
  });

  wss = null;
}

// 广播日志消息
function broadcastLog(logData) {
  const timestamp = typeof logData.timestamp === 'number' ? logData.timestamp : Date.now();
  const payload = {
    ...logData,
    timestamp
  };

  payload.source = payload.source || inferSource(payload);

  // 添加到缓存
  logsCache.push(payload);
  logsCache = enforcePerSourceLimit(filterTodayLogs(logsCache));

  if (logsCache.length > MAX_PERSISTED_LOGS) {
    logsCache = logsCache.slice(-MAX_PERSISTED_LOGS);
  }

  // 保存到文件
  saveLogsToFile(logsCache);

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
  saveLogsToFile([]);
  console.log('✅ All logs cleared');
}

// 去掉敏感字段
function sanitizeChannel(channel) {
  if (!channel || typeof channel !== 'object') {
    return null;
  }
  const { apiKey, ...rest } = channel;
  return rest;
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

// ============ 终端 WebSocket 消息处理 ============

const { getCommandForChannel } = require('./services/terminal-commands');
const { getWebTerminalShellConfig } = require('./services/terminal-config');

/**
 * 处理终端相关的 WebSocket 消息
 */
function handleTerminalMessage(ws, message) {
  const { type } = message;

  if (String(type || '').startsWith('terminal:') && ws.terminalAllowed === false) {
    ws.send(JSON.stringify({
      type: 'terminal:error',
      error: '出于安全考虑，LAN 模式下仅允许本机使用 Web 终端。可设置 CC_TOOL_ALLOW_REMOTE_TERMINAL=true 覆盖。'
    }));
    return;
  }

  switch (type) {
    case 'terminal:create':
      handleTerminalCreate(ws, message);
      break;

    case 'terminal:attach':
      handleTerminalAttach(ws, message);
      break;

    case 'terminal:input':
      handleTerminalInput(ws, message);
      break;

    case 'terminal:resize':
      handleTerminalResize(ws, message);
      break;

    case 'terminal:destroy':
      handleTerminalDestroy(ws, message);
      break;

    default:
      // 非终端消息，忽略
      break;
  }
}

/**
 * 创建新终端
 */
function handleTerminalCreate(ws, message) {
  const {
    channel = 'claude',
    sessionId = null,
    projectName = null,
    cwd = null
  } = message;

  try {
    // 确定工作目录
    let workDir = cwd || os.homedir();

    // 获取启动命令
    const startCommand = getCommandForChannel(channel, sessionId, workDir);

    const shellConfig = getWebTerminalShellConfig();

    // 创建终端
    const terminal = ptyManager.create({
      cwd: workDir,
      channel,
      sessionId,
      projectName,
      startCommand,
      ...shellConfig
    });

    // 绑定 WebSocket
    ws.terminalId = terminal.id;
    ptyManager.attachWebSocket(terminal.id, ws);

    // 发送创建成功消息
    ws.send(JSON.stringify({
      type: 'terminal:created',
      terminalId: terminal.id,
      metadata: terminal.metadata
    }));
  } catch (err) {
    console.error('Failed to create terminal:', err);
    ws.send(JSON.stringify({
      type: 'terminal:error',
      error: err.message
    }));
  }
}

/**
 * 绑定到已有终端
 */
function handleTerminalAttach(ws, message) {
  const { terminalId, includeHistory, cols, rows } = message;

  if (!terminalId) {
    ws.send(JSON.stringify({
      type: 'terminal:error',
      error: 'Missing terminalId'
    }));
    return;
  }

  const terminal = ptyManager.get(terminalId);
  if (!terminal) {
    ws.send(JSON.stringify({
      type: 'terminal:error',
      error: 'Terminal not found',
      terminalId
    }));
    return;
  }

  // 绑定 WebSocket
  ws.terminalId = terminalId;
  const shouldIncludeHistory = typeof includeHistory === 'boolean' ? includeHistory : true;
  if (Number.isFinite(cols) && Number.isFinite(rows) && cols > 0 && rows > 0) {
    ptyManager.resize(terminalId, cols, rows);
  }
  ptyManager.attachWebSocket(terminalId, ws, {
    includeHistory: shouldIncludeHistory,
    trimLastLine: true
  });

  ws.send(JSON.stringify({
    type: 'terminal:attached',
    terminalId,
    metadata: terminal.metadata
  }));
}

/**
 * 终端输入
 */
function handleTerminalInput(ws, message) {
  const { terminalId, data } = message;

  if (!terminalId || !data) {
    return;
  }

  ptyManager.write(terminalId, data);
}

/**
 * 调整终端大小
 */
function handleTerminalResize(ws, message) {
  const { terminalId, cols, rows } = message;

  if (!terminalId || !cols || !rows) {
    return;
  }

  ptyManager.resize(terminalId, cols, rows);
}

/**
 * 销毁终端
 */
function handleTerminalDestroy(ws, message) {
  const { terminalId } = message;

  if (!terminalId) {
    return;
  }

  ptyManager.destroy(terminalId);

  if (ws.terminalId === terminalId) {
    ws.terminalId = null;
  }
}

module.exports = {
  startWebSocketServer,
  stopWebSocketServer,
  broadcastLog,
  clearAllLogs,
  broadcastProxyState,
  broadcastSchedulerState
};
