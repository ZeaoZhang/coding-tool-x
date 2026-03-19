const express = require('express');
const httpProxy = require('http-proxy');
const http = require('http');
const chalk = require('chalk');
const { broadcastLog, broadcastSchedulerState } = require('./websocket-server');
const { allocateChannel, releaseChannel, getSchedulerState } = require('./services/channel-scheduler');
const { recordSuccess, recordFailure } = require('./services/channel-health');
const { loadConfig } = require('../config/loader');
const DEFAULT_CONFIG = require('../config/default');
const { resolveModelPricing } = require('./utils/pricing');
const { recordRequest: recordGeminiRequest } = require('./services/gemini-statistics-service');
const { saveProxyStartTime, clearProxyStartTime, getProxyStartTime, getProxyRuntime } = require('./services/proxy-runtime');
const { createDecodedStream } = require('./services/response-decoder');
const { getEffectiveApiKey } = require('./services/gemini-channels');
const { persistProxyRequestSnapshot } = require('./services/request-logger');
const { publishUsageLog, publishFailureLog } = require('./services/proxy-log-helper');
const { redirectModel: redirectModelBase, resolveTargetUrl } = require('./services/base/proxy-utils');
const { attachServerShutdownHandling, expediteServerShutdown } = require('./services/server-shutdown');

let proxyServer = null;
let proxyApp = null;
let currentPort = null;

// 用于存储每个请求的元数据
const requestMetadata = new Map();

// 用于缓存已打印过的模型重定向规则，避免重复打印
// 格式: { channelId: { "originalModel": "redirectedModel", ... } }
const printedGeminiRedirectCache = new Map();

// Gemini 模型定价（每百万 tokens 的价格，单位：美元）
// 作为 model-metadata 未覆盖时的兜底值
const PRICING = {
  'gemini-2.5-pro': { input: 1.25, output: 5 },
  'gemini-2.5-flash': { input: 0.075, output: 0.3 },
  'gemini-2.0-flash-exp': { input: 0, output: 0 }, // 实验性免费
  'gemini-2.0-flash-thinking-exp-1219': { input: 0, output: 0 }, // 实验性免费
  'gemini-1.5-pro': { input: 1.25, output: 5 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'gemini-1.5-flash-8b': { input: 0.0375, output: 0.15 },
  'gemini-1.0-pro': { input: 0.5, output: 1.5 },
  // 旧版本别名
  'gemini-pro': { input: 0.5, output: 1.5 },
  'gemini-pro-vision': { input: 0.5, output: 1.5 }
};

const GEMINI_BASE_PRICING = DEFAULT_CONFIG.pricing.gemini;
const ONE_MILLION = 1000000;

// resolveGeminiTarget replaced by resolveTargetUrl from proxy-utils
const resolveGeminiTarget = resolveTargetUrl;

// Gemini uses exact-match only redirect (no tier fallback)
function redirectModel(originalModel, channel) {
  return redirectModelBase(originalModel, channel, { useTierFallback: false });
}

/**
 * 计算请求成本
 */
function calculateCost(model, tokens) {
  // 尝试精确匹配
  let fallbackPricing = PRICING[model];

  // 如果没有精确匹配，尝试模糊匹配
  if (!fallbackPricing) {
    const modelLower = String(model || '').toLowerCase();
    if (modelLower.includes('gemini-2.5-pro')) {
      fallbackPricing = PRICING['gemini-2.5-pro'];
    } else if (modelLower.includes('gemini-2.5-flash')) {
      fallbackPricing = PRICING['gemini-2.5-flash'];
    } else if (modelLower.includes('gemini-2.0-flash-thinking')) {
      fallbackPricing = PRICING['gemini-2.0-flash-thinking-exp-1219'];
    } else if (modelLower.includes('gemini-2.0-flash')) {
      fallbackPricing = PRICING['gemini-2.0-flash-exp'];
    } else if (modelLower.includes('gemini-1.5-pro')) {
      fallbackPricing = PRICING['gemini-1.5-pro'];
    } else if (modelLower.includes('gemini-1.5-flash-8b')) {
      fallbackPricing = PRICING['gemini-1.5-flash-8b'];
    } else if (modelLower.includes('gemini-1.5-flash')) {
      fallbackPricing = PRICING['gemini-1.5-flash'];
    } else if (modelLower.includes('gemini-1.0-pro')) {
      fallbackPricing = PRICING['gemini-1.0-pro'];
    } else if (modelLower.includes('gemini-pro')) {
      fallbackPricing = PRICING['gemini-pro'];
    }
  }

  const pricing = resolveModelPricing('gemini', model, fallbackPricing, GEMINI_BASE_PRICING);
  const inputRate = typeof pricing.input === 'number' ? pricing.input : GEMINI_BASE_PRICING.input;
  const outputRate = typeof pricing.output === 'number' ? pricing.output : GEMINI_BASE_PRICING.output;

  return (
    (tokens.input || 0) * inputRate / ONE_MILLION +
    (tokens.output || 0) * outputRate / ONE_MILLION
  );
}

// 启动 Gemini 代理服务器
async function startGeminiProxyServer(options = {}) {
  // options.preserveStartTime - 是否保留现有的启动时间（用于切换渠道时）
  const preserveStartTime = options.preserveStartTime || false;

  if (proxyServer) {
    console.log('Gemini proxy server already running on port', currentPort);
    return { success: true, port: currentPort };
  }

  try {
    const config = loadConfig();
    const port = config.ports?.geminiProxy || 20090;
    currentPort = port;

    proxyApp = express();
    const proxy = httpProxy.createProxyServer({});

    proxy.on('proxyReq', (proxyReq, req) => {
      const activeChannel = req.selectedChannel;
      if (!activeChannel) return;

      const requestId = `gemini-${Date.now()}-${Math.random()}`;
      let modelFromUrl = '';
      const urlMatch = req.url.match(/\/models\/([\w.-]+):/);
      if (urlMatch) {
        modelFromUrl = urlMatch[1];
      }

      requestMetadata.set(req, {
        id: requestId,
        channel: activeChannel.name,
        channelId: activeChannel.id,
        startTime: Date.now(),
        modelFromUrl
      });

      proxyReq.removeHeader('authorization');
      proxyReq.removeHeader('x-goog-api-key');
      const effectiveKey = req.effectiveApiKey;
      proxyReq.setHeader('authorization', `Bearer ${effectiveKey}`);
      if (!proxyReq.getHeader('content-type')) {
        proxyReq.setHeader('content-type', 'application/json');
      }
    });

    proxyApp.use(async (req, res) => {
      try {
        const channel = await allocateChannel({ source: 'gemini', enableSessionBinding: false });
        req.selectedChannel = channel;

        const release = (() => {
          let released = false;
          return () => {
            if (released) return;
            released = true;
            releaseChannel(channel.id, 'gemini');
            broadcastSchedulerState('gemini', getSchedulerState('gemini'));
          };
        })();

        res.on('close', release);
        res.on('error', release);

        broadcastSchedulerState('gemini', getSchedulerState('gemini'));

        const effectiveKey = getEffectiveApiKey(channel);
        if (!effectiveKey) {
          release();
          publishFailureLog({
            source: 'gemini',
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
        persistProxyRequestSnapshot('gemini', {
          timestamp: Date.now(),
          source: 'gemini',
          channel: channel.name,
          request: {
            method: req.method,
            url: req.url,
            path: req.path,
            headers: req.headers,
            body: req.body || null
          }
        });

        // 从 URL 中提取模型名称并应用重定向
        // URL 格式: /models/gemini-2.5-pro:generateContent 或 /v1/models/gemini-2.5-pro:generateContent
        const urlMatch = req.url.match(/\/models\/([\w.-]+)(:[^?]*)?/);
        if (urlMatch) {
          const originalModel = urlMatch[1];
          const redirectedModel = redirectModel(originalModel, channel);

          if (redirectedModel !== originalModel) {
            // 替换 URL 中的模型名称
            req.url = req.url.replace(`/models/${originalModel}`, `/models/${redirectedModel}`);

            // 只在重定向规则变化时打印日志（避免每次请求都打印）
            const cachedRedirects = printedGeminiRedirectCache.get(channel.id) || {};
            if (cachedRedirects[originalModel] !== redirectedModel) {
              cachedRedirects[originalModel] = redirectedModel;
              printedGeminiRedirectCache.set(channel.id, cachedRedirects);
              console.log(`[Gemini Model Redirect] ${originalModel} → ${redirectedModel} (channel: ${channel.name})`);
            }
          }
        }

        const target = resolveGeminiTarget(channel.baseUrl, req.url);

        proxy.web(req, res, {
          target,
          changeOrigin: true,
          proxyTimeout: 120000,  // 代理连接超时 2 分钟
          timeout: 120000        // 请求超时 2 分钟
        }, (err) => {
          release();
          if (err) {
            recordFailure(channel.id, 'gemini', err);
            const metadata = requestMetadata.get(req) || {
              channel: channel.name,
              channelId: channel.id,
              startTime: Date.now()
            };
            publishFailureLog({
              source: 'gemini',
              metadata,
              message: err.message,
              error: err,
              statusCode: 502,
              stage: 'proxy_web',
              broadcastLog
            });
            console.error('Gemini proxy error:', err);
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
        console.error('Gemini channel allocation error:', error);
        publishFailureLog({
          source: 'gemini',
          message: error.message || 'No Gemini channel available',
          statusCode: 503,
          stage: 'allocate_channel',
          broadcastLog
        });
        if (!res.headersSent) {
          res.status(503).json({
            error: {
              message: error.message || 'No Gemini channel available',
              type: 'channel_pool_exhausted'
            }
          });
        }
      }
    });

    // 监听代理响应 (OpenAI 兼容格式)
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
      let tokenData = {
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        model: ''
      };
      let usageRecorded = false;
      const parsedStream = createDecodedStream(proxyRes);

      function recordUsageIfReady() {
        if (usageRecorded) {
          return false;
        }

        if (!tokenData.model && metadata.modelFromUrl) {
          tokenData.model = metadata.modelFromUrl;
        }

        const result = publishUsageLog({
          source: 'gemini',
          metadata,
          model: tokenData.model,
          tokens: {
            input: tokenData.inputTokens,
            output: tokenData.outputTokens,
            cached: tokenData.cachedTokens,
            reasoning: tokenData.reasoningTokens,
            total: tokenData.totalTokens
          },
          calculateCost,
          broadcastLog,
          recordRequest: recordGeminiRequest,
          recordSuccess,
          allowBroadcast: !isResponseClosed
        });

        if (!result) {
          return false;
        }

        usageRecorded = true;
        return true;
      }

      parsedStream.on('data', (chunk) => {
        // 如果响应已关闭，停止处理
        if (isResponseClosed) {
          return;
        }

        buffer += chunk.toString('utf8');

        // 检查是否是 SSE 流
        if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
          // 处理 SSE 事件
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';

          events.forEach((eventText, index) => {
            if (!eventText.trim()) return;

            try {
              const lines = eventText.split('\n');
              let data = '';

              lines.forEach(line => {
                if (line.startsWith('data:')) {
                  data = line.substring(5).trim();
                }
              });

              if (!data) return;

              if (data === '[DONE]') return;

              const parsed = JSON.parse(data);

              // 提取模型信息
              if (parsed.model && !tokenData.model) {
                tokenData.model = parsed.model;
              }

              // 提取 usage 信息 (支持 OpenAI 和 Gemini 原生格式)
              if (parsed.usage) {
                tokenData.inputTokens = parsed.usage.prompt_tokens || parsed.usage.input_tokens || 0;
                tokenData.outputTokens = parsed.usage.completion_tokens || parsed.usage.output_tokens || 0;
                tokenData.totalTokens = parsed.usage.total_tokens || 0;

                // Gemini 可能包含缓存信息
                if (parsed.usage.prompt_tokens_details) {
                  tokenData.cachedTokens = parsed.usage.prompt_tokens_details.cached_tokens || 0;
                }
              } else if (parsed.usageMetadata) {
                tokenData.inputTokens = parsed.usageMetadata.promptTokenCount || 0;
                tokenData.outputTokens = parsed.usageMetadata.candidatesTokenCount || 0;
                tokenData.totalTokens = parsed.usageMetadata.totalTokenCount || 0;

                // Gemini 缓存信息
                if (parsed.usageMetadata.cachedContentTokenCount) {
                  tokenData.cachedTokens = parsed.usageMetadata.cachedContentTokenCount;
                }
              }

              recordUsageIfReady();
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
            if (parsed.model) {
              tokenData.model = parsed.model;
            }

            // OpenAI 格式
            if (parsed.usage) {
              tokenData.inputTokens = parsed.usage.prompt_tokens || parsed.usage.input_tokens || 0;
              tokenData.outputTokens = parsed.usage.completion_tokens || parsed.usage.output_tokens || 0;
              tokenData.totalTokens = parsed.usage.total_tokens || 0;

              if (parsed.usage.prompt_tokens_details) {
                tokenData.cachedTokens = parsed.usage.prompt_tokens_details.cached_tokens || 0;
              }
            }
            // Gemini 原生格式
            else if (parsed.usageMetadata) {
              tokenData.inputTokens = parsed.usageMetadata.promptTokenCount || 0;
              tokenData.outputTokens = parsed.usageMetadata.candidatesTokenCount || 0;
              tokenData.totalTokens = parsed.usageMetadata.totalTokenCount || 0;

              if (parsed.usageMetadata.cachedContentTokenCount) {
                tokenData.cachedTokens = parsed.usageMetadata.cachedContentTokenCount;
              }
            }
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
        recordFailure(metadata.channelId, 'gemini', err);
        publishFailureLog({
          source: 'gemini',
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
      console.error('Gemini proxy error:', err);
      if (req && req.selectedChannel) {
        recordFailure(req.selectedChannel.id, 'gemini', err);
        releaseChannel(req.selectedChannel.id, 'gemini');
        broadcastSchedulerState('gemini', getSchedulerState('gemini'));
      }
      publishFailureLog({
        source: 'gemini',
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
        console.log(`Gemini proxy server started on http://127.0.0.1:${port}`);

        // 保存代理启动时间（如果是切换渠道，保留原有启动时间）
        saveProxyStartTime('gemini', preserveStartTime);

        resolve({ success: true, port });
      });

      proxyServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.error(chalk.red(`\nGemini proxy port ${port} is already in use`));
        } else {
          console.error('Failed to start Gemini proxy server:', err);
        }
        proxyServer = null;
        proxyApp = null;
        currentPort = null;
        reject(err);
      });
    });
  } catch (err) {
    console.error('Error starting Gemini proxy server:', err);
    throw err;
  }
}

// 停止 Gemini 代理服务器
async function stopGeminiProxyServer(options = {}) {
  // options.clearStartTime - 是否清除启动时间（默认 true）
  const clearStartTime = options.clearStartTime !== false;

  if (!proxyServer) {
    return { success: true, message: 'Gemini proxy server not running' };
  }

  requestMetadata.clear();

  const shutdownTimer = expediteServerShutdown(proxyServer);

  return new Promise((resolve) => {
    proxyServer.close(() => {
      if (shutdownTimer) {
        clearTimeout(shutdownTimer);
      }
      console.log('Gemini proxy server stopped');

      // 清除代理启动时间（仅当明确要求时）
      if (clearStartTime) {
        clearProxyStartTime('gemini');
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
function getGeminiProxyStatus() {
  const config = loadConfig();
  const allowRecovery = !!proxyServer;
  const startTime = getProxyStartTime('gemini', { allowRecovery });
  const runtime = getProxyRuntime('gemini', { allowRecovery });

  return {
    running: !!proxyServer,
    port: currentPort,
    defaultPort: config.ports?.geminiProxy || 20090,
    startTime,
    runtime
  };
}

/**
 * 清除指定渠道的模型重定向日志缓存
 * 用于在渠道配置更新后触发重新打印日志
 * @param {string} channelId - 渠道 ID
 */
function clearGeminiRedirectCache(channelId) {
  if (channelId) {
    printedGeminiRedirectCache.delete(channelId);
  } else {
    printedGeminiRedirectCache.clear();
  }
}

module.exports = {
  startGeminiProxyServer,
  stopGeminiProxyServer,
  getGeminiProxyStatus,
  clearGeminiRedirectCache
};
