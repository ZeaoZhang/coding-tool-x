const WebSocket = require('ws');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadConfig } = require('../config/loader');

let wss = null;
let wsClients = new Set();

// 日志持久化文件路径
function getLogsFilePath() {
  const ccToolDir = path.join(os.homedir(), '.claude', 'cc-tool');
  if (!fs.existsSync(ccToolDir)) {
    fs.mkdirSync(ccToolDir, { recursive: true });
  }
  return path.join(ccToolDir, 'proxy-logs.json');
}

// 加载持久化的日志
function loadPersistedLogs() {
  try {
    const logsFile = getLogsFilePath();
    if (fs.existsSync(logsFile)) {
      const data = fs.readFileSync(logsFile, 'utf8');
      const logs = JSON.parse(data);
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
    // 只保留最新的 100 条
    const logsToSave = logs.slice(-100);
    fs.writeFileSync(logsFile, JSON.stringify(logsToSave, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save logs to file:', err);
  }
}

// 内存中的日志缓存
let logsCache = [];

// 启动 WebSocket 服务器（附加到现有的 HTTP 服务器）
function startWebSocketServer(httpServer) {
  if (wss) {
    console.log('WebSocket server already running');
    return;
  }

  // 加载持久化的日志到缓存
  logsCache = loadPersistedLogs();
  console.log(`📝 Loaded ${logsCache.length} persisted logs`);

  try {
    // 如果传入的是 HTTP server，则附加到该服务器；否则创建独立的 WebSocket 服务器
    if (httpServer) {
      wss = new WebSocket.Server({
        server: httpServer,
        path: '/ws'  // 指定 WebSocket 路径
      });
      console.log(`✅ WebSocket server attached to HTTP server at /ws`);
    } else {
      // 创建独立的 WebSocket 服务器，使用配置的 webUI 端口
      const config = loadConfig();
      const port = config.ports?.webUI || 10099;
      wss = new WebSocket.Server({
        port,
        path: '/ws'
      });
      console.log(`✅ WebSocket server started on ws://127.0.0.1:${port}/ws`);
    }

    wss.on('connection', (ws) => {
      wsClients.add(ws);
      console.log(`✅ WebSocket client connected (total: ${wsClients.size})`);

      // 发送历史日志给新连接的客户端
      if (logsCache.length > 0) {
        logsCache.forEach(log => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(log));
          }
        });
        console.log(`📤 Sent ${logsCache.length} historical logs to new client`);
      }

      ws.on('close', () => {
        wsClients.delete(ws);
        console.log(`WebSocket client disconnected (total: ${wsClients.size})`);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        wsClients.delete(ws);
      });
    });

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
  // 添加到缓存
  logsCache.push(logData);

  // 只保留最新的 100 条
  if (logsCache.length > 100) {
    logsCache = logsCache.slice(-100);
  }

  // 保存到文件
  saveLogsToFile(logsCache);

  // 广播给所有连接的客户端
  if (wss && wsClients.size > 0) {
    const message = JSON.stringify(logData);

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

module.exports = {
  startWebSocketServer,
  stopWebSocketServer,
  broadcastLog,
  clearAllLogs
};
