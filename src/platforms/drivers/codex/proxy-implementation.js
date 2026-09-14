const express = require('express');
const httpProxy = require('http-proxy');
const http = require('http');
const chalk = require('chalk');
const { broadcastSchedulerState } = require('../../../server/websocket-server');
const { allocateChannel, releaseChannel, getSchedulerState } = require('../../../server/services/channel-scheduler');
const { recordSuccess, recordFailure } = require('../../../server/services/channel-health');
const { loadConfig } = require('../../../config/loader');
const { saveProxyStartTime, clearProxyStartTime, getProxyStartTime, getProxyRuntime } = require('../../../server/services/proxy-runtime');
const { getEffectiveApiKey, getCodexProxyExcludedChannelIds } = require('./channels-implementation');
const { persistProxyRequestSnapshot } = require('../../../server/services/request-logger');
const {
  redirectModel,
  resolveTargetUrl,
  isChatCompletionsPath,
  ensureOpenAiStreamUsage
} = require('../../../shared/proxy-utils');
const { attachServerShutdownHandling, expediteServerShutdown } = require('../../../server/services/server-shutdown');

let proxyServer = null;
let proxyApp = null;
let currentPort = null;

// 用于存储每个请求的元数据
const requestMetadata = new Map();

// 用于缓存已打印过的模型重定向规则，避免重复打印
// 格式: { channelId: { "originalModel": "redirectedModel", ... } }
const printedRedirectCache = new Map();


// detectModelTier, redirectModel, resolveTargetUrl imported from shared/proxy-utils

// resolveCodexTarget replaced by resolveTargetUrl from proxy-utils
const resolveCodexTarget = resolveTargetUrl;

const jsonBodyParser = express.json({
  limit: '100mb',
  verify: (req, res, buf) => {
    req.rawBody = Buffer.from(buf);
  }
});

function shouldParseJson(req) {
  const contentType = req.headers['content-type'] || '';
  return req.method === 'POST' && contentType.includes('application/json');
}

// 启动 Codex 代理服务器
async function startCodexProxyServer(options = {}) {
  // options.preserveStartTime - 是否保留现有的启动时间（用于切换渠道时）
  const preserveStartTime = options.preserveStartTime || false;

  if (proxyServer) {
    console.log('Codex proxy server already running on port', currentPort);
    return { success: true, port: currentPort };
  }

  const excludedChannelIds = getCodexProxyExcludedChannelIds();
  if (excludedChannelIds.length > 0) {
    throw new Error('Codex dynamic proxy supports API-key channels only; disable OAuth channels first');
  }

  try {
    const config = loadConfig();
    const port = config.ports?.codexProxy || 20089;
    currentPort = port;

    proxyApp = express();

    proxyApp.use((req, res, next) => {
      if (shouldParseJson(req)) {
        return jsonBodyParser(req, res, next);
      }
      return next();
    });

    const proxy = httpProxy.createProxyServer({});

    proxy.on('proxyReq', (proxyReq, req) => {
      const activeChannel = req.selectedChannel;
      if (!activeChannel) return;

      const requestId = `codex-${Date.now()}-${Math.random()}`;
      requestMetadata.set(req, {
        id: requestId,
        channel: activeChannel.name,
        channelId: activeChannel.id,
        startTime: Date.now(),
        requestModel: req.body?.model || ''
      });

      proxyReq.removeHeader('authorization');
      const effectiveKey = req.effectiveApiKey;
      proxyReq.setHeader('authorization', `Bearer ${effectiveKey}`);
      proxyReq.setHeader('openai-beta', 'responses=experimental');
      if (!proxyReq.getHeader('content-type')) {
        proxyReq.setHeader('content-type', 'application/json');
      }

      if (shouldParseJson(req) && (req.rawBody || req.body)) {
        const bodyBuffer = req.rawBody
          ? Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(req.rawBody)
          : Buffer.from(JSON.stringify(req.body));
        proxyReq.setHeader('Content-Length', bodyBuffer.length);
        proxyReq.write(bodyBuffer);
        proxyReq.end();
      }
    });

    proxyApp.use(async (req, res) => {
      try {
        const channel = await allocateChannel({
          source: 'codex',
          enableSessionBinding: false,
          excludeChannelIds: getCodexProxyExcludedChannelIds()
        });
        req.selectedChannel = channel;

        const release = (() => {
          let released = false;
          return () => {
            if (released) return;
            released = true;
            releaseChannel(channel.id, 'codex');
            broadcastSchedulerState('codex', getSchedulerState('codex'));
          };
        })();

        res.on('close', release);
        res.on('error', release);

        broadcastSchedulerState('codex', getSchedulerState('codex'));

        const effectiveKey = getEffectiveApiKey(channel);
        if (!effectiveKey) {
          release();
          return res.status(401).json({
            error: {
              message: 'API key not configured or expired. Please update your channel key.',
              type: 'authentication_error'
            }
          });
        }
        req.effectiveApiKey = effectiveKey;

        // 记录请求快照到文件（由 CC_TOOL_LOG_REQUESTS 环境变量控制）
        persistProxyRequestSnapshot('codex', {
          timestamp: Date.now(),
          source: 'codex',
          channel: channel.name,
          request: {
            method: req.method,
            url: req.url,
            path: req.path,
            headers: req.headers,
            body: req.body || null
          }
        });

        let bodyMutated = false;

        // 应用模型重定向（当 proxy 开启时）
        if (req.body && req.body.model) {
          const originalModel = req.body.model;
          const redirectedModel = redirectModel(originalModel, channel);

          if (redirectedModel !== originalModel) {
            req.body.model = redirectedModel;
            bodyMutated = true;

            // 将原始模型和重定向模型存入 metadata，用于日志记录
            const meta = requestMetadata.get(req);
            if (meta) {
              meta.originalModel = originalModel;
              meta.redirectedModel = redirectedModel;
              meta.requestModel = redirectedModel;
            }

            // 只在重定向规则变化时打印日志（避免每次请求都打印）
            const cachedRedirects = printedRedirectCache.get(channel.id) || {};
            if (cachedRedirects[originalModel] !== redirectedModel) {
              cachedRedirects[originalModel] = redirectedModel;
              printedRedirectCache.set(channel.id, cachedRedirects);
              console.log(`[Codex Model Redirect] ${originalModel} → ${redirectedModel} (channel: ${channel.name})`);
            }
          }
        }

        if (shouldParseJson(req) && isChatCompletionsPath(req.url) && ensureOpenAiStreamUsage(req.body)) {
          bodyMutated = true;
        }

        if (bodyMutated) {
          req.rawBody = Buffer.from(JSON.stringify(req.body));
        }

        const target = resolveCodexTarget(channel.baseUrl, req.url);

        proxy.web(req, res, {
          target,
          changeOrigin: true,
          proxyTimeout: 120000,  // 代理连接超时 2 分钟
          timeout: 120000        // 请求超时 2 分钟
        }, (err) => {
          release();
          if (err) {
            recordFailure(channel.id, 'codex', err);
            console.error('Codex proxy error:', err);
            if (res && !res.headersSent) {
              res.status(502).json({
                error: {
                  message: 'Proxy error: ' + err.message,
                  type: 'proxy_error'
                }
              });
            }
          }
        });
      } catch (error) {
        console.error('Codex channel allocation error:', error);
        if (!res.headersSent) {
          res.status(503).json({
            error: {
              message: error.message || 'No Codex channel available',
              type: 'channel_pool_exhausted'
            }
          });
        }
      }
    });

    // 代理响应只负责维护传输健康状态；实时日志和 usage 来自 CLI 原生日志。
    proxy.on('proxyRes', (proxyRes, req, res) => {
      const metadata = requestMetadata.get(req);
      if (!metadata) return;

      if (res.writableEnded || res.destroyed) {
        requestMetadata.delete(req);
        return;
      }

      // 监听响应关闭事件
      res.on('close', () => {
        requestMetadata.delete(req);
      });

      // 监听响应错误事件
      res.on('error', (err) => {
        if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
          console.error('Response error:', err);
        }
        recordFailure(metadata.channelId, 'codex', err);
        requestMetadata.delete(req);
      });

      proxyRes.on('end', () => {
        if (Number(proxyRes.statusCode) >= 400) {
          recordFailure(metadata.channelId, 'codex', new Error(`Codex upstream HTTP ${proxyRes.statusCode}`));
        } else {
          recordSuccess(metadata.channelId, 'codex');
        }
        requestMetadata.delete(req);
      });

      proxyRes.on('error', (err) => {
        if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
          console.error('Proxy response error:', err);
        }
        recordFailure(metadata.channelId, 'codex', err);
        requestMetadata.delete(req);
      });
    });

    // 处理代理错误
    proxy.on('error', (err, req, res) => {
      console.error('Codex proxy error:', err);
      if (req && req.selectedChannel) {
        recordFailure(req.selectedChannel.id, 'codex', err);
        releaseChannel(req.selectedChannel.id, 'codex');
        broadcastSchedulerState('codex', getSchedulerState('codex'));
      }
      if (res && !res.headersSent) {
        res.status(502).json({
          error: {
            message: 'Proxy error: ' + err.message,
            type: 'proxy_error'
          }
        });
      }
    });

    // 启动服务器
    proxyServer = http.createServer(proxyApp);
    attachServerShutdownHandling(proxyServer);

    return new Promise((resolve, reject) => {
      proxyServer.listen(port, '127.0.0.1', () => {
        console.log(`Codex proxy server started on http://127.0.0.1:${port}`);

        // 保存代理启动时间（如果是切换渠道，保留原有启动时间）
        saveProxyStartTime('codex', preserveStartTime);

        resolve({ success: true, port });
      });

      proxyServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.error(chalk.red(`\nCodex proxy port ${port} is already in use`));
        } else {
          console.error('Failed to start Codex proxy server:', err);
        }
        proxyServer = null;
        proxyApp = null;
        currentPort = null;
        reject(err);
      });
    });
  } catch (err) {
    console.error('Error starting Codex proxy server:', err);
    throw err;
  }
}

// 停止 Codex 代理服务器
async function stopCodexProxyServer(options = {}) {
  // options.clearStartTime - 是否清除启动时间（默认 true）
  const clearStartTime = options.clearStartTime !== false;

  if (!proxyServer) {
    return { success: true, message: 'Codex proxy server not running' };
  }

  requestMetadata.clear();

  const shutdownTimer = expediteServerShutdown(proxyServer);

  return new Promise((resolve) => {
    proxyServer.close(() => {
      if (shutdownTimer) {
        clearTimeout(shutdownTimer);
      }
      console.log('Codex proxy server stopped');

      // 清除代理启动时间（仅当明确要求时）
      if (clearStartTime) {
        clearProxyStartTime('codex');
      }

      proxyServer = null;
      proxyApp = null;
      const stoppedPort = currentPort;
      currentPort = null;
      resolve({ success: true, port: stoppedPort });
    });
  });
}

// 获取代理服务器状态
function getCodexProxyStatus() {
  const config = loadConfig();
  const allowRecovery = !!proxyServer;
  const startTime = getProxyStartTime('codex', { allowRecovery });
  const runtime = getProxyRuntime('codex', { allowRecovery });

  return {
    running: !!proxyServer,
    port: currentPort,
    defaultPort: config.ports?.codexProxy || 20089,
    startTime,
    runtime
  };
}

/**
 * 清除指定渠道的模型重定向日志缓存
 * 用于在渠道配置更新后触发重新打印日志
 * @param {string} channelId - 渠道 ID
 */
function clearCodexRedirectCache(channelId) {
  if (channelId) {
    printedRedirectCache.delete(channelId);
  } else {
    printedRedirectCache.clear();
  }
}

module.exports = {
  startCodexProxyServer,
  stopCodexProxyServer,
  getCodexProxyStatus,
  clearCodexRedirectCache,
};
