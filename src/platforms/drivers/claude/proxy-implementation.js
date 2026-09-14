const express = require('express');
const httpProxy = require('http-proxy');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const chalk = require('chalk');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { allocateChannel, releaseChannel, getSchedulerState } = require('../../../server/services/channel-scheduler');
const { recordSuccess, recordFailure } = require('../../../server/services/channel-health');
const { broadcastSchedulerState } = require('../../../server/websocket-server');
const { loadConfig } = require('../../../config/loader');
const { saveProxyStartTime, clearProxyStartTime, getProxyStartTime, getProxyRuntime } = require('../../../server/services/proxy-runtime');
const eventBus = require('../../../plugins/event-bus');
const {
  getEffectiveApiKey,
  getClaudeProxyExcludedChannelIds = () => []
} = require('./channels-implementation');
const { persistProxyRequestSnapshot, persistClaudeRequestTemplate } = require('../../../server/services/request-logger');
const { redirectModel, normalizeGatewaySourceType } = require('../../../shared/proxy-utils');
const { handleClaudeOpenAiGatewayRequest } = require('./openai-gateway');
const { attachServerShutdownHandling, expediteServerShutdown } = require('../../../server/services/server-shutdown');

let proxyServer = null;
let proxyApp = null;
let currentPort = null;

// 用于存储每个请求的元数据（用于 WebSocket 日志）
const requestMetadata = new Map();

// 用于缓存已打印过的模型重定向规则，避免重复打印
// 格式: { channelId: { "originalModel": "redirectedModel", ... } }
const printedRedirectCache = new Map();

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

function extractSessionIdFromBody(body = {}) {
  if (!body || typeof body !== 'object') return null;
  return (
    body.session_id ||
    body.sessionId ||
    body.conversation_id ||
    body.conversationId ||
    body.metadata?.session_id ||
    body.metadata?.sessionId ||
    body.metadata?.conversation_id ||
    body.workspace?.workspace_id ||
    body.project_id ||
    null
  );
}

function extractSessionId(req) {
  const headerSession =
    req.headers['x-session-id'] ||
    req.headers['x-claude-session'] ||
    req.headers['x-cc-session'];
  if (headerSession) return String(headerSession);
  if (req.body) {
    return extractSessionIdFromBody(req.body);
  }
  return null;
}

function pickClaudeRequestHeaders(headers = {}) {
  return { ...headers };
}

function toSerializable(value) {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return String(value);
  }
}

function extractClaudeRequestBody(req) {
  if (req?.body !== undefined) {
    return req.body;
  }
  if (req?.rawBody) {
    const bodyBuffer = Buffer.isBuffer(req.rawBody)
      ? req.rawBody
      : Buffer.from(req.rawBody);
    return bodyBuffer.toString('utf8');
  }
  return null;
}

function serializeFullClaudeRequest(req) {
  const rawBodyBuffer = req?.rawBody
    ? (Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(req.rawBody))
    : null;

  return {
    method: req?.method || null,
    url: req?.url || null,
    originalUrl: req?.originalUrl || null,
    path: req?.path || null,
    httpVersion: req?.httpVersion || null,
    headers: pickClaudeRequestHeaders(req?.headers || {}),
    rawHeaders: Array.isArray(req?.rawHeaders) ? [...req.rawHeaders] : null,
    query: toSerializable(req?.query),
    params: toSerializable(req?.params),
    body: toSerializable(extractClaudeRequestBody(req)),
    rawBody: rawBodyBuffer ? rawBodyBuffer.toString('utf8') : null
  };
}

function persistClaudeRequestSnapshot(payload) {
  persistProxyRequestSnapshot('claude', payload);
}

function buildClaudeRequestSummary(req, sessionId = null) {
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const contentLengthHeader = req?.headers?.['content-length'];
  const contentLength = contentLengthHeader !== undefined && contentLengthHeader !== null
    ? Number(contentLengthHeader)
    : (req?.rawBody ? req.rawBody.length : null);

  return {
    method: req?.method || null,
    path: req?.originalUrl || req?.url || null,
    model: body.model || null,
    stream: body.stream === true,
    maxTokens: body.max_tokens ?? body.maxTokens ?? null,
    messageCount: messages.length,
    hasSystem: body.system !== undefined && body.system !== null,
    sessionId: sessionId || null,
    contentLength: Number.isFinite(contentLength) ? contentLength : null
  };
}

async function startProxyServer(options = {}) {
  const preserveStartTime = options.preserveStartTime || false;

  if (proxyServer) {
    console.log('Proxy server already running on port', currentPort);
    return { success: true, port: currentPort };
  }
  const excludedChannelIds = getClaudeProxyExcludedChannelIds();
  if (excludedChannelIds.length > 0) {
    const error = new Error('Claude dynamic proxy supports API-key channels only; disable OAuth channels first');
    error.code = 'claude_oauth_proxy_unsupported';
    error.statusCode = 409;
    throw error;
  }

  try {
    const config = loadConfig();
    const port = config.ports?.proxy || 20088;
    currentPort = port;

    proxyApp = express();

    proxyApp.use((req, res, next) => {
      if (shouldParseJson(req)) {
        return jsonBodyParser(req, res, next);
      }
      return next();
    });
    const proxy = httpProxy.createProxyServer({});

    proxy.on('proxyReq', (proxyReq, req, res) => {
      const selectedChannel = req.selectedChannel;
      if (selectedChannel) {
        const requestId = `${Date.now()}-${Math.random()}`;
        requestMetadata.set(req, {
          id: requestId,
          channel: selectedChannel.name,
          channelId: selectedChannel.id,
          startTime: Date.now(),
          sessionId: req.sessionId || null,
          requestModel: req.body?.model || ''
        });

        proxyReq.removeHeader('x-api-key');
        const effectiveKey = req.effectiveApiKey;
        proxyReq.setHeader('x-api-key', effectiveKey);
        proxyReq.removeHeader('authorization');
        proxyReq.setHeader('authorization', `Bearer ${effectiveKey}`);

        if (!proxyReq.getHeader('anthropic-version')) {
          proxyReq.setHeader('anthropic-version', '2023-06-01');
        }
        if (!proxyReq.getHeader('content-type')) {
          proxyReq.setHeader('content-type', 'application/json');
        }
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
        const sessionId = extractSessionId(req);
        const config = loadConfig();
        const enableSessionBinding = config.enableSessionBinding !== false; // 默认开启
        const channel = await allocateChannel({
          source: 'claude',
          sessionId,
          enableSessionBinding,
          excludeChannelIds: getClaudeProxyExcludedChannelIds()
        });

        // 广播调度状态（请求开始）
        broadcastSchedulerState('claude', getSchedulerState('claude'));

        req.selectedChannel = channel;
        req.sessionId = sessionId || null;
        let released = false;

        const release = () => {
          if (released) return;
          released = true;
          releaseChannel(channel.id, 'claude');
          // 广播调度状态（请求结束）
          broadcastSchedulerState('claude', getSchedulerState('claude'));
        };

        req.__releaseChannel = release;

        res.on('close', release);
        res.on('error', release);

        const effectiveKey = getEffectiveApiKey(channel);
        if (!effectiveKey) {
          release();
          return res.status(401).json({
            error: 'API key not configured or expired. Please update your channel key.',
            type: 'authentication_error'
          });
        }
        req.effectiveApiKey = effectiveKey;
        const requestSnapshot = serializeFullClaudeRequest(req);
        persistClaudeRequestSnapshot({
          timestamp: Date.now(),
          source: 'claude',
          channel: channel.name,
          sessionId: sessionId || null,
          request: requestSnapshot
        });
        persistClaudeRequestTemplate(req.body);

        // 应用模型重定向（当 proxy 开启时）
        if (req.body && req.body.model) {
          const originalModel = req.body.model;
          const redirectedModel = redirectModel(originalModel, channel);

          if (redirectedModel !== originalModel) {
            req.body.model = redirectedModel;
            // 更新 rawBody 以匹配修改后的 body
            req.rawBody = Buffer.from(JSON.stringify(req.body));

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
              console.log(`[Model Redirect] ${originalModel} → ${redirectedModel} (channel: ${channel.name})`);
            }
          }
        }

        const gatewaySourceType = normalizeGatewaySourceType(channel.gatewaySourceType, 'claude');
        if (gatewaySourceType === 'openai_compatible') {
          const handled = await handleClaudeOpenAiGatewayRequest({
            req,
            res,
            channel,
            effectiveKey,
            onDone: release
          });
          if (handled) {
            return;
          }
        }

        const proxyOptions = {
          target: channel.baseUrl,
          changeOrigin: true,
          proxyTimeout: 120000,  // 代理连接超时 2 分钟
          timeout: 120000        // 请求超时 2 分钟
        };

        if (channel.proxyUrl) {
          proxyOptions.agent = new HttpsProxyAgent(channel.proxyUrl);
        }

        proxy.web(req, res, proxyOptions, (err) => {
          release();
          if (err) {
            // 记录请求失败
            recordFailure(channel.id, 'claude', err);
            console.error('Proxy error:', err);
            if (res && !res.headersSent) {
              res.status(502).json({
                error: 'Proxy error: ' + err.message,
                type: 'proxy_error'
              });
            }
          }
        });
      } catch (error) {
        console.error('Channel allocation error:', error);
        if (!res.headersSent) {
          res.status(503).json({
            error: error.message || '所有渠道暂时不可用',
            type: 'channel_pool_exhausted'
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

      res.on('close', () => requestMetadata.delete(req));
      res.on('error', (err) => {
        if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') console.error('Response error:', err);
        recordFailure(metadata.channelId, 'claude', err);
        requestMetadata.delete(req);
      });

      const statusCode = Number(proxyRes.statusCode) || 200;
      proxyRes.on('end', () => {
        if (statusCode >= 400) {
          recordFailure(metadata.channelId, 'claude', new Error(`Claude upstream HTTP ${statusCode}`));
        } else {
          recordSuccess(metadata.channelId, 'claude');
        }
        requestMetadata.delete(req);
      });
      proxyRes.on('error', (err) => {
        if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') console.error('Proxy response error:', err);
        recordFailure(metadata.channelId, 'claude', err);
        requestMetadata.delete(req);
      });
    });

    proxy.on('error', (err, req, res) => {
      console.error('Proxy error:', err);
      // 记录请求失败（用于健康检查）
      if (req && req.selectedChannel && req.selectedChannel.id) {
        recordFailure(req.selectedChannel.id, 'claude', err);
      }
      if (res && !res.headersSent) {
        res.status(502).json({
          error: 'Proxy error: ' + err.message,
          type: 'proxy_error'
        });
      }
    });

    proxyServer = http.createServer(proxyApp);
    attachServerShutdownHandling(proxyServer);

    return new Promise((resolve, reject) => {
      proxyServer.listen(port, '127.0.0.1', () => {
        console.log(`[OK] Proxy server started on http://127.0.0.1:${port}`);
        saveProxyStartTime('claude', preserveStartTime);
        eventBus.emitSync('proxy:start', { channel: 'claude', port });
        resolve({ success: true, port });
      });

      proxyServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.error(chalk.red(`\n[ERROR] 代理服务端口 ${port} 已被占用`));
          console.error(chalk.yellow('\n[TIP] 解决方案:'));
          console.error(chalk.gray('   1. 运行 ctx 命令，选择"配置端口"修改端口'));
          console.error(chalk.gray(`   2. 或关闭占用端口 ${port} 的程序\n`));
        } else {
          console.error('Failed to start proxy server:', err);
        }
        proxyServer = null;
        proxyApp = null;
        currentPort = null;
        reject(err);
      });
    });
  } catch (err) {
    console.error('Error starting proxy server:', err);
    throw err;
  }
}

async function stopProxyServer(options = {}) {
  const clearStartTime = options.clearStartTime !== false;

  if (!proxyServer) {
    return { success: true, message: 'Proxy server not running' };
  }

  requestMetadata.clear();

  const shutdownTimer = expediteServerShutdown(proxyServer);

  return new Promise((resolve) => {
    proxyServer.close(() => {
      if (shutdownTimer) {
        clearTimeout(shutdownTimer);
      }
      console.log('[OK] Proxy server stopped');
      if (clearStartTime) {
        clearProxyStartTime('claude');
      }
      eventBus.emitSync('proxy:stop', { channel: 'claude' });
      proxyServer = null;
      proxyApp = null;
      const stoppedPort = currentPort;
      currentPort = null;
      resolve({ success: true, port: stoppedPort });
    });
  });
}

// 获取代理服务器状态
function getProxyStatus() {
  const config = loadConfig();
  const allowRecovery = !!proxyServer;
  const startTime = getProxyStartTime('claude', { allowRecovery });
  const runtime = getProxyRuntime('claude', { allowRecovery });

  return {
    running: !!proxyServer,
    port: currentPort,
    defaultPort: config.ports?.proxy || 20088,
    startTime,
    runtime
  };
}

/**
 * 清除指定渠道的模型重定向日志缓存
 * 用于在渠道配置更新后触发重新打印日志
 * @param {string} channelId - 渠道 ID
 */
function clearRedirectCache(channelId) {
  if (channelId) {
    printedRedirectCache.delete(channelId);
  } else {
    printedRedirectCache.clear();
  }
}

module.exports = {
  startProxyServer,
  stopProxyServer,
  getProxyStatus,
  clearRedirectCache
};
