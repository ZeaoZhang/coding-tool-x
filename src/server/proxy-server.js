const express = require('express');
const httpProxy = require('http-proxy');
const http = require('http');
const net = require('net');
const chalk = require('chalk');
const { getActiveChannel } = require('./services/channels');
const { broadcastLog } = require('./websocket-server');
const { loadConfig } = require('../config/loader');
const DEFAULT_CONFIG = require('../config/default');
const { resolvePricing } = require('./utils/pricing');
const { recordRequest } = require('./services/statistics-service');
const { saveProxyStartTime, clearProxyStartTime, getProxyStartTime, getProxyRuntime } = require('./services/proxy-runtime');

let proxyServer = null;
let proxyApp = null;
let currentPort = null;

// 用于存储每个请求的元数据（用于 WebSocket 日志）
const requestMetadata = new Map();

// Claude API 定价（每百万 tokens 的价格，单位：美元）
const PRICING = {
  'claude-sonnet-4-5-20250929': { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.30 },
  'claude-sonnet-4-20250514': { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.30 },
  'claude-sonnet-3-5-20241022': { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.30 },
  'claude-sonnet-3-5-20240620': { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.30 },
  'claude-opus-4-20250514': { input: 15, output: 75, cacheCreation: 18.75, cacheRead: 1.50 },
  'claude-opus-3-20240229': { input: 15, output: 75, cacheCreation: 18.75, cacheRead: 1.50 },
  'claude-haiku-3-5-20241022': { input: 0.8, output: 4, cacheCreation: 1, cacheRead: 0.08 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4, cacheCreation: 1, cacheRead: 0.08 }
};

const CLAUDE_BASE_PRICING = DEFAULT_CONFIG.pricing.claude;
const ONE_MILLION = 1000000;

/**
 * 计算请求成本
 * @param {string} model - 模型名称
 * @param {object} tokens - token 使用情况
 * @returns {number} 成本（美元）
 */
function calculateCost(model, tokens) {
  const basePricing = PRICING[model] || {};
  const pricing = resolvePricing('claude', basePricing, CLAUDE_BASE_PRICING);

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

async function startProxyServer(options = {}) {
  const preserveStartTime = options.preserveStartTime || false;

  if (proxyServer) {
    console.log('Proxy server already running on port', currentPort);
    return { success: true, port: currentPort };
  }

  try {
    const config = loadConfig();
    const port = config.ports?.proxy || 10088;
    currentPort = port;

    proxyApp = express();
    const proxy = httpProxy.createProxyServer({});

    proxy.on('proxyReq', (proxyReq, req, res) => {
      const activeChannel = getActiveChannel();
      if (activeChannel) {
        const requestId = `${Date.now()}-${Math.random()}`;
        requestMetadata.set(req, {
          id: requestId,
          channel: activeChannel.name,
          channelId: activeChannel.id,
          startTime: Date.now()
        });

        proxyReq.removeHeader('x-api-key');
        proxyReq.setHeader('x-api-key', activeChannel.apiKey);
        proxyReq.removeHeader('authorization');
        proxyReq.setHeader('authorization', `Bearer ${activeChannel.apiKey}`);

        if (!proxyReq.getHeader('anthropic-version')) {
          proxyReq.setHeader('anthropic-version', '2023-06-01');
        }
        if (!proxyReq.getHeader('content-type')) {
          proxyReq.setHeader('content-type', 'application/json');
        }
      }
    });

    proxyApp.use((req, res) => {
      const activeChannel = getActiveChannel();

      if (!activeChannel) {
        res.status(500).json({
          error: 'No active channel configured',
          type: 'channel_error'
        });
        return;
      }

      const target = activeChannel.baseUrl;

      proxy.web(req, res, {
        target,
        changeOrigin: true
      }, (err) => {
        if (err) {
          console.error('Proxy error:', err);
          if (res && !res.headersSent) {
            res.status(502).json({
              error: 'Proxy error: ' + err.message,
              type: 'proxy_error'
            });
          }
        }
      });
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

      proxyRes.on('data', (chunk) => {
        if (isResponseClosed) return;

        buffer += chunk.toString();

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

            if (eventType === 'message_delta' && parsed.usage) {
              const now = new Date();
              const time = now.toLocaleTimeString('zh-CN', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              });

              const tokens = {
                input: tokenData.inputTokens,
                output: tokenData.outputTokens,
                cacheCreation: tokenData.cacheCreation,
                cacheRead: tokenData.cacheRead,
                total: tokenData.inputTokens + tokenData.outputTokens + tokenData.cacheCreation + tokenData.cacheRead
              };
              const cost = calculateCost(tokenData.model, tokens);

              if (!isResponseClosed) {
                broadcastLog({
                  type: 'log',
                  id: metadata.id,
                  time: time,
                  channel: metadata.channel,
                  model: tokenData.model,
                  inputTokens: tokenData.inputTokens,
                  outputTokens: tokenData.outputTokens,
                  cacheCreation: tokenData.cacheCreation,
                  cacheRead: tokenData.cacheRead,
                  cost: cost,
                  source: 'claude'
                });
              }

              const duration = Date.now() - metadata.startTime;

              recordRequest({
                id: metadata.id,
                timestamp: new Date(metadata.startTime).toISOString(),
                toolType: 'claude-code',
                channel: metadata.channel,
                channelId: metadata.channelId,
                model: tokenData.model,
                tokens: tokens,
                duration: duration,
                success: true,
                cost: cost
              });
            }
          } catch (err) {
          }
        });
      });

      proxyRes.on('end', () => {
        if (!isResponseClosed) {
          requestMetadata.delete(req);
        }
      });

      proxyRes.on('error', (err) => {
        if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
          console.error('Proxy response error:', err);
        }
        isResponseClosed = true;
        requestMetadata.delete(req);
      });
    });

    proxy.on('error', (err, req, res) => {
      console.error('Proxy error:', err);
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
        console.log(`✅ Proxy server started on http://127.0.0.1:${port}`);
        saveProxyStartTime('claude', preserveStartTime);
        resolve({ success: true, port });
      });

      proxyServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.error(chalk.red(`\n❌ 代理服务端口 ${port} 已被占用`));
          console.error(chalk.yellow('\n💡 解决方案:'));
          console.error(chalk.gray('   1. 运行 ct 命令，选择"配置端口"修改端口'));
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
      console.log('✅ Proxy server stopped');
      if (clearStartTime) {
        clearProxyStartTime('claude');
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
function getProxyStatus() {
  const config = loadConfig();
  const startTime = getProxyStartTime('claude');
  const runtime = getProxyRuntime('claude');

  return {
    running: !!proxyServer,
    port: currentPort,
    defaultPort: config.ports?.proxy || 10088,
    startTime,
    runtime
  };
}

module.exports = {
  startProxyServer,
  stopProxyServer,
  getProxyStatus
};
