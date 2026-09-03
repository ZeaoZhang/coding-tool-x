const express = require('express');
const httpProxy = require('http-proxy');
const http = require('http');
const chalk = require('chalk');
const { broadcastLog, broadcastSchedulerState } = require('../../../server/websocket-server');
const { allocateChannel, releaseChannel, getSchedulerState } = require('../../../server/services/channel-scheduler');
const { recordSuccess, recordFailure } = require('../../../server/services/channel-health');
const { loadConfig } = require('../../../config/loader');
const DEFAULT_CONFIG = require('../../../config/default');
const { resolveModelPricing, calculateTokenCost } = require('../../../server/utils/pricing');
const { recordRequest: recordCodexRequest } = require('./statistics-implementation');
const { saveProxyStartTime, clearProxyStartTime, getProxyStartTime, getProxyRuntime } = require('../../../server/services/proxy-runtime');
const { createDecodedStream } = require('../../../server/services/response-decoder');
const { getEffectiveApiKey } = require('./channels-implementation');
const { persistProxyRequestSnapshot } = require('../../../server/services/request-logger');
const { publishUsageLog, publishFailureLog } = require('../../../server/services/proxy-log-helper');
const {
  redirectModel,
  resolveTargetUrl,
  isChatCompletionsPath,
  ensureOpenAiStreamUsage
} = require('../../../shared/proxy-utils');
const { parseSSEUsage, parseNonStreamingUsage, mergeUsageIntoTokenData, createTokenData } = require('../../../shared/response-usage-parser');
const { attachServerShutdownHandling, expediteServerShutdown } = require('../../../server/services/server-shutdown');

let proxyServer = null;
let proxyApp = null;
let currentPort = null;

// 用于存储每个请求的元数据
const requestMetadata = new Map();

// 用于缓存已打印过的模型重定向规则，避免重复打印
// 格式: { channelId: { "originalModel": "redirectedModel", ... } }
const printedRedirectCache = new Map();

// OpenAI 模型定价（每百万 tokens 的价格，单位：美元）
// 作为 model-metadata 未覆盖时的兜底值
const PRICING = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-2024-11-20': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-4': { input: 30, output: 60 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'o1': { input: 15, output: 60 },
  'o1-mini': { input: 3, output: 12 },
  'o1-pro': { input: 150, output: 600 },
  'o3': { input: 10, output: 40 },
  'o3-mini': { input: 1.1, output: 4.4 },
  'o4-mini': { input: 1.1, output: 4.4 }
};

const CODEX_BASE_PRICING = DEFAULT_CONFIG.pricing.codex;

// detectModelTier, redirectModel, resolveTargetUrl imported from shared/proxy-utils

// resolveCodexTarget replaced by resolveTargetUrl from proxy-utils
const resolveCodexTarget = resolveTargetUrl;

/**
 * 计算请求成本
 */
function calculateCost(model, tokens) {
  let fallbackPricing = PRICING[model];
  if (!fallbackPricing) {
    const modelLower = String(model || '').toLowerCase();
    if (modelLower.includes('gpt-4o-mini')) {
      fallbackPricing = PRICING['gpt-4o-mini'];
    } else if (modelLower.includes('gpt-4o')) {
      fallbackPricing = PRICING['gpt-4o'];
    } else if (modelLower.includes('gpt-4')) {
      fallbackPricing = PRICING['gpt-4'];
    } else if (modelLower.includes('gpt-3.5')) {
      fallbackPricing = PRICING['gpt-3.5-turbo'];
    } else if (modelLower.includes('o1-mini')) {
      fallbackPricing = PRICING['o1-mini'];
    } else if (modelLower.includes('o1-pro')) {
      fallbackPricing = PRICING['o1-pro'];
    } else if (modelLower.includes('o1')) {
      fallbackPricing = PRICING['o1'];
    } else if (modelLower.includes('o3-mini')) {
      fallbackPricing = PRICING['o3-mini'];
    } else if (modelLower.includes('o3')) {
      fallbackPricing = PRICING['o3'];
    } else if (modelLower.includes('o4-mini')) {
      fallbackPricing = PRICING['o4-mini'];
    }
  }

  const pricing = resolveModelPricing('codex', model, fallbackPricing, CODEX_BASE_PRICING);
  return calculateTokenCost(pricing, tokens, CODEX_BASE_PRICING);
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

// 启动 Codex 代理服务器
async function startCodexProxyServer(options = {}) {
  // options.preserveStartTime - 是否保留现有的启动时间（用于切换渠道时）
  const preserveStartTime = options.preserveStartTime || false;

  if (proxyServer) {
    console.log('Codex proxy server already running on port', currentPort);
    return { success: true, port: currentPort };
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
        const channel = await allocateChannel({ source: 'codex', enableSessionBinding: false });
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
          publishFailureLog({
            source: 'codex',
            channel: channel.name,
            message: 'API key not configured or expired. Please update your channel key.',
            statusCode: 401,
            stage: 'preflight',
            broadcastLog
          });
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
            const metadata = requestMetadata.get(req) || {
              channel: channel.name,
              channelId: channel.id,
              startTime: Date.now()
            };
            publishFailureLog({
              source: 'codex',
              metadata,
              message: err.message,
              error: err,
              statusCode: 502,
              stage: 'proxy_web',
              broadcastLog
            });
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
        publishFailureLog({
          source: 'codex',
          message: error.message || 'No Codex channel available',
          statusCode: 503,
          stage: 'allocate_channel',
          broadcastLog
        });
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

    // 监听代理响应 (OpenAI 格式)
    proxy.on('proxyRes', (proxyRes, req, res) => {
      const metadata = requestMetadata.get(req);
      if (!metadata) {
        return;
      }

      // 检查响应是否已关闭
      if (res.writableEnded || res.destroyed) {
        requestMetadata.delete(req);
        return;
      }

      // 标记响应是否已关闭
      let isResponseClosed = false;

      // 监听响应关闭事件
      res.on('close', () => {
        isResponseClosed = true;
        requestMetadata.delete(req);
      });

      // 监听响应错误事件
      res.on('error', (err) => {
        isResponseClosed = true;
        // 忽略客户端断开连接的常见错误
        if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
          console.error('Response error:', err);
        }
        requestMetadata.delete(req);
      });

      let buffer = '';
      let tokenData = createTokenData();
      let usageRecorded = false;
      const parsedStream = createDecodedStream(proxyRes);

      function recordUsageIfReady() {
        if (usageRecorded) {
          return false;
        }

        const result = publishUsageLog({
          source: 'codex',
          metadata,
          model: tokenData.model,
          tokens: {
            input: tokenData.inputTokens,
            output: tokenData.outputTokens,
            cacheCreation: tokenData.cacheCreation,
            cacheRead: tokenData.cacheRead,
            cached: tokenData.cachedTokens,
            reasoning: tokenData.reasoningTokens,
            total: tokenData.totalTokens
          },
          calculateCost,
          broadcastLog,
          recordRequest: recordCodexRequest,
          recordSuccess,
          allowBroadcast: true
        });

        if (!result) {
          return false;
        }

        usageRecorded = true;
        return true;
      }

      parsedStream.on('data', (chunk) => {
        if (isResponseClosed) {
          return;
        }

        buffer += chunk.toString('utf8');

        // 检查是否是 SSE 流
        if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';

          events.forEach((eventText) => {
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

              if (!data || data === '[DONE]') return;

              const parsed = JSON.parse(data);
              const usage = parseSSEUsage(parsed, eventType);
              mergeUsageIntoTokenData(tokenData, usage);

              if (usage.isDone) {
                recordUsageIfReady();
              }
            } catch (err) {
              // 忽略解析错误
            }
          });
        }
      });

      parsedStream.on('end', () => {
        // 如果不是流式响应，尝试从完整响应中解析
        if (!proxyRes.headers['content-type']?.includes('text/event-stream')) {
          try {
            const parsed = JSON.parse(buffer);
            const usage = parseNonStreamingUsage(parsed);
            mergeUsageIntoTokenData(tokenData, usage);
          } catch (err) {
            // 忽略解析错误
          }
        }

        recordUsageIfReady();

        if (!isResponseClosed) {
          requestMetadata.delete(req);
        }
      });

      parsedStream.on('error', (err) => {
        // 忽略代理响应错误（可能是网络问题）
        if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
          console.error('Proxy response error:', err);
        }
        isResponseClosed = true;
        recordFailure(metadata.channelId, 'codex', err);
        publishFailureLog({
          source: 'codex',
          metadata,
          message: err.message,
          error: err,
          statusCode: proxyRes.statusCode,
          stage: 'response_stream',
          broadcastLog
        });
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
      publishFailureLog({
        source: 'codex',
        metadata: (req && requestMetadata.get(req)) || {
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
  calculateCost
};
