const express = require('express');
const httpProxy = require('http-proxy');
const http = require('http');
const chalk = require('chalk');
const { getActiveGeminiChannel } = require('./services/gemini-channels');
const { broadcastLog } = require('./websocket-server');
const { loadConfig } = require('../config/loader');
const { recordRequest } = require('./services/statistics-service');
const { saveProxyStartTime, clearProxyStartTime, getProxyStartTime, getProxyRuntime } = require('./services/proxy-runtime');

let proxyServer = null;
let proxyApp = null;
let currentPort = null;

// 用于存储每个请求的元数据
const requestMetadata = new Map();

// Gemini 模型定价（每百万 tokens 的价格，单位：美元）
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

/**
 * 计算请求成本
 */
function calculateCost(model, tokens) {
  // 尝试精确匹配
  let pricing = PRICING[model];

  // 如果没有精确匹配，尝试模糊匹配
  if (!pricing) {
    const modelLower = model.toLowerCase();
    if (modelLower.includes('gemini-2.5-pro')) {
      pricing = PRICING['gemini-2.5-pro'];
    } else if (modelLower.includes('gemini-2.5-flash')) {
      pricing = PRICING['gemini-2.5-flash'];
    } else if (modelLower.includes('gemini-2.0-flash-thinking')) {
      pricing = PRICING['gemini-2.0-flash-thinking-exp-1219'];
    } else if (modelLower.includes('gemini-2.0-flash')) {
      pricing = PRICING['gemini-2.0-flash-exp'];
    } else if (modelLower.includes('gemini-1.5-pro')) {
      pricing = PRICING['gemini-1.5-pro'];
    } else if (modelLower.includes('gemini-1.5-flash-8b')) {
      pricing = PRICING['gemini-1.5-flash-8b'];
    } else if (modelLower.includes('gemini-1.5-flash')) {
      pricing = PRICING['gemini-1.5-flash'];
    } else if (modelLower.includes('gemini-1.0-pro')) {
      pricing = PRICING['gemini-1.0-pro'];
    } else if (modelLower.includes('gemini-pro')) {
      pricing = PRICING['gemini-pro'];
    }
  }

  // 默认使用 Gemini 2.5 Pro 的定价
  if (!pricing) {
    pricing = { input: 1.25, output: 5 };
  }

  return (
    (tokens.input || 0) * pricing.input / 1000000 +
    (tokens.output || 0) * pricing.output / 1000000
  );
}

// 启动 Gemini 代理服务器
async function startGeminiProxyServer() {
  if (proxyServer) {
    console.log('Gemini proxy server already running on port', currentPort);
    return { success: true, port: currentPort };
  }

  try {
    const config = loadConfig();
    const port = config.ports?.geminiProxy || 10090;
    currentPort = port;

    proxyApp = express();
    const proxy = httpProxy.createProxyServer({});

    // 监听 proxyReq 事件，修改发往真实API的请求头
    proxy.on('proxyReq', (proxyReq, req, res) => {
      const activeChannel = getActiveGeminiChannel();
      if (activeChannel) {
        // 记录请求元数据
        const requestId = `gemini-${Date.now()}-${Math.random()}`;

        // 尝试从 URL 中提取模型名称
        // Gemini 原生 API: /v1beta/models/gemini-2.5-pro:streamGenerateContent
        // OpenAI 兼容: /v1/chat/completions (模型在请求体中)
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
          modelFromUrl: modelFromUrl
        });

        // 设置真实的 API Key
        // Gemini 通过 OpenAI 兼容格式访问时使用 x-goog-api-key header
        // 但如果是第三方代理（如 PackyCode），则使用标准的 Authorization Bearer
        proxyReq.removeHeader('authorization');
        proxyReq.removeHeader('x-goog-api-key');

        // PackyCode 等第三方使用 Bearer token
        proxyReq.setHeader('authorization', `Bearer ${activeChannel.apiKey}`);

        // 确保 content-type 正确
        if (!proxyReq.getHeader('content-type')) {
          proxyReq.setHeader('content-type', 'application/json');
        }
      }
    });

    // 代理所有请求
    proxyApp.use((req, res) => {
      const activeChannel = getActiveGeminiChannel();

      if (!activeChannel) {
        res.status(500).json({
          error: {
            message: 'No active Gemini channel configured',
            type: 'channel_error'
          }
        });
        return;
      }

      // 设置代理目标 (去掉 /v1 后缀，因为请求路径已经包含)
      let target = activeChannel.baseUrl;
      // 确保 target 不以 / 结尾
      if (target.endsWith('/')) {
        target = target.slice(0, -1);
      }
      // 如果 target 以 /v1 结尾，且请求路径以 /v1 开头，去掉 target 的 /v1
      if (target.endsWith('/v1') && req.url.startsWith('/v1')) {
        target = target.slice(0, -3);
      }

      proxy.web(req, res, {
        target,
        changeOrigin: true
      }, (err) => {
        if (err) {
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
    });

    // 监听代理响应 (OpenAI 兼容格式)
    proxy.on('proxyRes', (proxyRes, req, res) => {
      const metadata = requestMetadata.get(req);
      if (!metadata) {
        return;
      }

      let buffer = '';
      let tokenData = {
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        model: ''
      };

      proxyRes.on('data', (chunk) => {
        buffer += chunk.toString();

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
              if (tokenData.inputTokens === 0) {
                // OpenAI 格式
                if (parsed.usage) {
                  tokenData.inputTokens = parsed.usage.prompt_tokens || parsed.usage.input_tokens || 0;
                  tokenData.outputTokens = parsed.usage.completion_tokens || parsed.usage.output_tokens || 0;
                  tokenData.totalTokens = parsed.usage.total_tokens || 0;

                  // Gemini 可能包含缓存信息
                  if (parsed.usage.prompt_tokens_details) {
                    tokenData.cachedTokens = parsed.usage.prompt_tokens_details.cached_tokens || 0;
                  }
                }
                // Gemini 原生格式
                else if (parsed.usageMetadata) {
                  tokenData.inputTokens = parsed.usageMetadata.promptTokenCount || 0;
                  tokenData.outputTokens = parsed.usageMetadata.candidatesTokenCount || 0;
                  tokenData.totalTokens = parsed.usageMetadata.totalTokenCount || 0;

                  // Gemini 缓存信息
                  if (parsed.usageMetadata.cachedContentTokenCount) {
                    tokenData.cachedTokens = parsed.usageMetadata.cachedContentTokenCount;
                  }
                }
              }
            } catch (err) {
              // 忽略解析错误
            }
          });
        }
      });

      proxyRes.on('end', () => {
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

        // 如果没有从响应中提取到模型，使用 URL 中的模型
        if (!tokenData.model && metadata.modelFromUrl) {
          tokenData.model = metadata.modelFromUrl;
        }

        // 记录日志和统计
        const now = new Date();
        const time = now.toLocaleTimeString('zh-CN', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });

        if (tokenData.inputTokens > 0 || tokenData.outputTokens > 0) {
          // 广播日志
          broadcastLog({
            id: metadata.id,
            time: time,
            channel: metadata.channel,
            model: tokenData.model,
            inputTokens: tokenData.inputTokens,
            outputTokens: tokenData.outputTokens,
            cachedTokens: tokenData.cachedTokens,
            reasoningTokens: tokenData.reasoningTokens,
            totalTokens: tokenData.totalTokens,
            source: 'gemini'
          });

          // 记录统计数据
          const tokens = {
            input: tokenData.inputTokens,
            output: tokenData.outputTokens,
            total: tokenData.inputTokens + tokenData.outputTokens
          };
          const cost = calculateCost(tokenData.model, tokens);
          const duration = Date.now() - metadata.startTime;

          recordRequest({
            id: metadata.id,
            timestamp: new Date(metadata.startTime).toISOString(),
            toolType: 'gemini',
            channel: metadata.channel,
            channelId: metadata.channelId,
            model: tokenData.model,
            tokens: tokens,
            duration: duration,
            success: true,
            cost: cost
          });
        } else {
          console.warn(`[Gemini Proxy] Request ${metadata.id}: No token data found. Model: ${tokenData.model || 'unknown'}`);
          console.warn(`[Gemini Proxy] Response content-type: ${proxyRes.headers['content-type']}`);
        }

        requestMetadata.delete(req);
      });
    });

    // 处理代理错误
    proxy.on('error', (err, req, res) => {
      console.error('Gemini proxy error:', err);
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

    return new Promise((resolve, reject) => {
      proxyServer.listen(port, '127.0.0.1', () => {
        console.log(`Gemini proxy server started on http://127.0.0.1:${port}`);

        // 保存代理启动时间
        saveProxyStartTime('gemini');

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
async function stopGeminiProxyServer() {
  if (!proxyServer) {
    return { success: true, message: 'Gemini proxy server not running' };
  }

  requestMetadata.clear();

  return new Promise((resolve) => {
    proxyServer.close(() => {
      console.log('Gemini proxy server stopped');

      // 清除代理启动时间
      clearProxyStartTime('gemini');

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
  const startTime = getProxyStartTime('gemini');
  const runtime = getProxyRuntime('gemini');

  return {
    running: !!proxyServer,
    port: currentPort,
    defaultPort: config.ports?.geminiProxy || 10090,
    startTime,
    runtime
  };
}

module.exports = {
  startGeminiProxyServer,
  stopGeminiProxyServer,
  getGeminiProxyStatus
};
