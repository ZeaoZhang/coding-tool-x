const express = require('express');
const httpProxy = require('http-proxy');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const chalk = require('chalk');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { allocateChannel, releaseChannel, getSchedulerState } = require('./services/channel-scheduler');
const { recordSuccess, recordFailure } = require('./services/channel-health');
const { broadcastLog, broadcastSchedulerState } = require('./websocket-server');
const { loadConfig } = require('../config/loader');
const DEFAULT_CONFIG = require('../config/default');
const { resolveModelPricing } = require('./utils/pricing');
const { recordRequest } = require('./services/statistics-service');
const { saveProxyStartTime, clearProxyStartTime, getProxyStartTime, getProxyRuntime } = require('./services/proxy-runtime');
const { createDecodedStream } = require('./services/response-decoder');
const eventBus = require('../plugins/event-bus');
const { getEffectiveApiKey } = require('./services/channels');
const { persistProxyRequestSnapshot, persistClaudeRequestTemplate } = require('./services/request-logger');
const { publishUsageLog, publishFailureLog } = require('./services/proxy-log-helper');
const { redirectModel } = require('./services/base/proxy-utils');

let proxyServer = null;
let proxyApp = null;
let currentPort = null;

// 用于存储每个请求的元数据（用于 WebSocket 日志）
const requestMetadata = new Map();

// 用于缓存已打印过的模型重定向规则，避免重复打印
// 格式: { channelId: { "originalModel": "redirectedModel", ... } }
const printedRedirectCache = new Map();

const CLAUDE_BASE_PRICING = DEFAULT_CONFIG.pricing.claude;
const ONE_MILLION = 1000000;

// detectModelTier and redirectModel imported from services/base/proxy-utils

/**
 * 计算请求成本
 * @param {string} model - 模型名称
 * @param {object} tokens - token 使用情况
 * @returns {number} 成本（美元）
 */
function calculateCost(model, tokens) {
  const pricing = resolveModelPricing('claude', model, {}, CLAUDE_BASE_PRICING);

  const inputRate = typeof pricing.input === 'number' ? pricing.input : CLAUDE_BASE_PRICING.input;
  const outputRate = typeof pricing.output === 'number' ? pricing.output : CLAUDE_BASE_PRICING.output;
  const cacheCreationRate = typeof pricing.cacheCreation === 'number' ? pricing.cacheCreation : CLAUDE_BASE_PRICING.cacheCreation;
  const cacheReadRate = typeof pricing.cacheRead === 'number' ? pricing.cacheRead : CLAUDE_BASE_PRICING.cacheRead;

  return (
    (tokens.input || 0) * inputRate / ONE_MILLION +
    (tokens.output || 0) * outputRate / ONE_MILLION +
    (tokens.cacheCreation || 0) * cacheCreationRate / ONE_MILLION +
    (tokens.cacheRead || 0) * cacheReadRate / ONE_MILLION
  );
}

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
          sessionId: req.sessionId || null
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
        const channel = await allocateChannel({ source: 'claude', sessionId, enableSessionBinding });

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
          publishFailureLog({
            source: 'claude',
            channel: channel.name,
            message: 'API key not configured or expired. Please update your channel key.',
            statusCode: 401,
            stage: 'preflight',
            broadcastLog
          });
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

            // 只在重定向规则变化时打印日志（避免每次请求都打印）
            const cachedRedirects = printedRedirectCache.get(channel.id) || {};
            if (cachedRedirects[originalModel] !== redirectedModel) {
              cachedRedirects[originalModel] = redirectedModel;
              printedRedirectCache.set(channel.id, cachedRedirects);
              console.log(`[Model Redirect] ${originalModel} → ${redirectedModel} (channel: ${channel.name})`);
            }
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
            const metadata = requestMetadata.get(req) || {
              id: null,
              channel: channel.name,
              channelId: channel.id,
              startTime: Date.now()
            };
            publishFailureLog({
              source: 'claude',
              metadata,
              message: err.message,
              error: err,
              statusCode: 502,
              stage: 'proxy_web',
              broadcastLog
            });
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
        publishFailureLog({
          source: 'claude',
          message: error.message || '所有渠道暂时不可用',
          statusCode: 503,
          stage: 'allocate_channel',
          broadcastLog
        });
        if (!res.headersSent) {
          res.status(503).json({
            error: error.message || '所有渠道暂时不可用',
            type: 'channel_pool_exhausted'
          });
        }
      }
    });

    proxy.on('proxyRes', (proxyRes, req, res) => {
      const metadata = requestMetadata.get(req);
      if (!metadata) return;

      if (res.writableEnded || res.destroyed) {
        requestMetadata.delete(req);
        return;
      }

      let isResponseClosed = false;

      res.on('close', () => {
        isResponseClosed = true;
        requestMetadata.delete(req);
      });

      res.on('error', (err) => {
        isResponseClosed = true;
        if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
          console.error('Response error:', err);
        }
        requestMetadata.delete(req);
      });

      let buffer = '';
      let tokenData = {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreation: 0,
        cacheRead: 0,
        model: ''
      };
      let usageRecorded = false;
      const parsedStream = createDecodedStream(proxyRes);

      function recordUsageIfReady() {
        if (usageRecorded) return false;

        const result = publishUsageLog({
          source: 'claude',
          metadata,
          model: tokenData.model,
          tokens: {
            input: tokenData.inputTokens,
            output: tokenData.outputTokens,
            cacheCreation: tokenData.cacheCreation,
            cacheRead: tokenData.cacheRead
          },
          calculateCost,
          broadcastLog,
          recordRequest,
          recordSuccess,
          allowBroadcast: !isResponseClosed
        });

        if (!result) return false;
        usageRecorded = true;
        return true;
      }

      parsedStream.on('data', (chunk) => {
        if (isResponseClosed) return;

        buffer += chunk.toString('utf8');

        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        events.forEach(eventText => {
          if (!eventText.trim()) return;

          try {
            const lines = eventText.split('\n');
            let eventType = '';
            let data = '';

            lines.forEach(line => {
              if (line.startsWith('event:')) {
                eventType = line.substring(6).trim();
              } else if (line.startsWith('data:')) {
                data = line.substring(5).trim();
              }
            });

            if (!data) return;

            const parsed = JSON.parse(data);

            if (eventType === 'message_start' && parsed.message && parsed.message.model) {
              tokenData.model = parsed.message.model;
            }

            if (parsed.usage) {
              if (parsed.usage.input_tokens !== undefined) {
                tokenData.inputTokens = parsed.usage.input_tokens;
              }
              if (parsed.usage.output_tokens !== undefined) {
                tokenData.outputTokens = parsed.usage.output_tokens;
              }
              if (parsed.usage.cache_creation_input_tokens !== undefined) {
                tokenData.cacheCreation = parsed.usage.cache_creation_input_tokens;
              }
              if (parsed.usage.cache_read_input_tokens !== undefined) {
                tokenData.cacheRead = parsed.usage.cache_read_input_tokens;
              }
            }

            if (eventType === 'message_stop') {
              recordUsageIfReady();
            }
          } catch (err) {
          }
        });
      });

      const finalize = () => {
        if (!isResponseClosed) {
          requestMetadata.delete(req);
        }
        if (typeof req.__releaseChannel === 'function') {
          req.__releaseChannel();
        }
      };

      parsedStream.on('end', () => {
        recordUsageIfReady();
        finalize();
      });

      parsedStream.on('error', (err) => {
        if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
          console.error('Proxy response error:', err);
        }
        // 记录响应错误
        if (metadata && metadata.channelId) {
          recordFailure(metadata.channelId, 'claude', err);
        }
        publishFailureLog({
          source: 'claude',
          metadata,
          message: err.message,
          error: err,
          statusCode: proxyRes.statusCode,
          stage: 'response_stream',
          broadcastLog
        });
        isResponseClosed = true;
        finalize();
      });
    });

    proxy.on('error', (err, req, res) => {
      console.error('Proxy error:', err);
      // 记录请求失败（用于健康检查）
      if (req && req.selectedChannel && req.selectedChannel.id) {
        recordFailure(req.selectedChannel.id, 'claude', err);
      }
      const metadata = req ? requestMetadata.get(req) : null;
      publishFailureLog({
        source: 'claude',
        metadata: metadata || {
          channel: req?.selectedChannel?.name,
          channelId: req?.selectedChannel?.id,
          model: req?.body?.model
        },
        message: err.message,
        error: err,
        statusCode: 502,
        stage: 'proxy',
        broadcastLog
      });
      if (res && !res.headersSent) {
        res.status(502).json({
          error: 'Proxy error: ' + err.message,
          type: 'proxy_error'
        });
      }
    });

    proxyServer = http.createServer(proxyApp);

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

  return new Promise((resolve) => {
    proxyServer.close(() => {
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
  const startTime = getProxyStartTime('claude');
  const runtime = getProxyRuntime('claude');

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
