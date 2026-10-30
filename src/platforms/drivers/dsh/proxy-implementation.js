'use strict';

const express = require('express');
const httpProxy = require('http-proxy');
const http = require('http');
const chalk = require('chalk');
const { broadcastSchedulerState } = require('../../../server/websocket-server');
const { allocateChannel, releaseChannel, getSchedulerState } = require('../../../server/services/channel-scheduler');
const { recordSuccess, recordFailure } = require('../../../server/services/channel-health');
const { loadConfig } = require('../../../config/loader');
const {
  getEnabledChannels,
  getEffectiveApiKey,
  setDshProxyConfig,
  restoreDshNativeConfig,
  clearActiveMarker,
  isProxyModeEnabled,
  readActiveMarker
} = require('./channels-implementation');
const { persistProxyRequestSnapshot } = require('../../../server/services/request-logger');
const { redirectModel, resolveTargetUrl, isChatCompletionsPath, ensureOpenAiStreamUsage } = require('../../../shared/proxy-utils');
const { saveProxyStartTime, clearProxyStartTime, getProxyStartTime, getProxyRuntime } = require('../../../server/services/proxy-runtime');
const { bindProxyRequest, prepareProxyResponse } = require('../../../shared/proxy-transport');
const { attachServerShutdownHandling, expediteServerShutdown, PROXY_IDLE_TIMEOUT_MS } = require('../../../server/services/server-shutdown');

let proxyServer = null;
let currentPort = null;
let requestMetadata = new WeakMap();

const jsonBodyParser = express.json({
  limit: '100mb',
  verify: (req, _res, buffer) => {
    req.rawBody = buffer;
  }
});

function shouldParseJson(req) {
  return req.method === 'POST' && String(req.headers['content-type'] || '').includes('application/json');
}

function openAiChannels() {
  return getEnabledChannels().filter(channel => channel.providerApi === 'openai-completions');
}

function releaseOnce(channel) {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (channel?.id) {
      releaseChannel(channel.id, 'dsh');
      broadcastSchedulerState('dsh', getSchedulerState('dsh'));
    }
  };
}

async function startDshProxyServer(options = {}) {
  if (proxyServer) {
    const activeChannelId = readActiveMarker()?.activeChannelId;
    const activeChannel = activeChannelId
      ? getEnabledChannels().find(channel => channel.id === activeChannelId) || null
      : null;
    return { success: true, port: currentPort, provider: 'ctx-dsh-proxy', activeChannel };
  }

  const enabledChannels = getEnabledChannels();
  const incompatibleChannels = enabledChannels.filter(channel => channel.providerApi !== 'openai-completions');
  if (incompatibleChannels.length > 0) {
    const names = incompatibleChannels.map(channel => channel.name || channel.providerKey).join(', ');
    throw new Error(`DSH 动态代理仅支持 OpenAI Chat Completions；请先禁用不兼容渠道：${names}`);
  }
  if (enabledChannels.length === 0) {
    throw new Error('DSH 动态代理当前只支持 openai-completions；请先添加并启用至少一个兼容渠道');
  }

  const preserveStartTime = options.preserveStartTime === true;
  const config = loadConfig();
  const requestedPort = Number(options.port ?? config.ports?.dshProxy ?? 20093);
  const app = express();
  const proxy = httpProxy.createProxyServer({});

  app.use((req, res, next) => shouldParseJson(req) ? jsonBodyParser(req, res, next) : next());
  app.use(async (req, res) => {
    let channel;
    let release;
    try {
      channel = await allocateChannel({
        source: 'dsh',
        providerApi: 'openai-completions',
        enableSessionBinding: false
      });
      req.selectedChannel = channel;
      release = releaseOnce(channel);
      req.__releaseChannel = release;
      res.on('finish', release);
      res.on('close', release);
      res.on('error', release);
      if (res.destroyed || res.writableEnded) { release(); return; }
      broadcastSchedulerState('dsh', getSchedulerState('dsh'));

      const apiKey = getEffectiveApiKey(channel);
      if (channel.authMode !== 'none' && !apiKey) {
        release();
        return res.status(401).json({
          error: { message: 'DSH channel API key is not configured', type: 'authentication_error' }
        });
      }
      req.effectiveApiKey = apiKey;

      if (req.body?.model) {
        const originalModel = req.body.model;
        const redirectedModel = redirectModel(originalModel, channel, { useTierFallback: false });
        if (redirectedModel !== originalModel) req.body.model = redirectedModel;
      }
      if (shouldParseJson(req) && isChatCompletionsPath(req.url)) {
        ensureOpenAiStreamUsage(req.body);
      }
      if (shouldParseJson(req) && req.body) {
        req.rawBody = Buffer.from(JSON.stringify(req.body));
      }

      persistProxyRequestSnapshot('dsh', {
        timestamp: Date.now(),
        source: 'dsh',
        channel: channel.name,
        request: { method: req.method, url: req.url, headers: req.headers, body: req.body || null }
      });

      proxy.web(req, res, {
        target: resolveTargetUrl(channel.baseUrl, req.url),
        changeOrigin: true,
        proxyTimeout: PROXY_IDLE_TIMEOUT_MS,
        timeout: 0
      }, error => {
        release?.();
        if (!error) return;
        recordFailure(channel.id, 'dsh', error);
        if (!res.headersSent) {
          res.status(502).json({ error: { message: `Proxy error: ${error.message}`, type: 'proxy_error' } });
        }
      });
    } catch (error) {
      release?.();
      if (!res.headersSent) {
        res.status(503).json({ error: { message: error.message || 'No DSH channel available', type: 'channel_pool_exhausted' } });
      }
    }
  });

  proxy.on('proxyReq', (proxyReq, req, res) => {
    bindProxyRequest(proxyReq, res);
    const channel = req.selectedChannel;
    if (!channel) return;
    const metadata = {
      channelId: channel.id,
      channel: channel.name,
      startTime: Date.now(),
      requestModel: req.body?.model || ''
    };
    requestMetadata.set(req, metadata);
    proxyReq.removeHeader('authorization');
    if (req.effectiveApiKey) proxyReq.setHeader('authorization', `Bearer ${req.effectiveApiKey}`);
    proxyReq.setHeader('content-type', 'application/json');
    if (shouldParseJson(req) && (req.rawBody || req.body)) {
      const body = req.rawBody
        ? (Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(req.rawBody))
        : Buffer.from(JSON.stringify(req.body));
      proxyReq.setHeader('Content-Length', body.length);
      proxyReq.write(body);
      proxyReq.end();
    }
  });

  proxy.on('proxyRes', (proxyRes, req, res) => {
    prepareProxyResponse(proxyRes, res);
    const metadata = requestMetadata.get(req);
    if (!metadata) return;
    let completed = false;
    const finish = error => {
      if (completed) return;
      completed = true;
      requestMetadata.delete(req);
      if (error || Number(proxyRes.statusCode) >= 400) {
        recordFailure(metadata.channelId, 'dsh', error || new Error(`DSH upstream HTTP ${proxyRes.statusCode}`));
      } else {
        recordSuccess(metadata.channelId, 'dsh');
      }
    };
    proxyRes.once('end', () => finish());
    proxyRes.once('error', finish);
    proxyRes.once('close', () => {
      if (!completed) finish(new Error('DSH upstream response closed early'));
    });
    res?.once('close', () => requestMetadata.delete(req));
  });

  proxy.on('error', (error, req, res) => {
    if (req?.selectedChannel) {
      recordFailure(req.selectedChannel.id, 'dsh', error);
      req.__releaseChannel?.();
    }
    if (res && !res.headersSent) res.status(502).json({ error: { message: `Proxy error: ${error.message}`, type: 'proxy_error' } });
  });

  const server = http.createServer(app);
  attachServerShutdownHandling(server);
  proxyServer = server;
  currentPort = requestedPort;

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(requestedPort, '127.0.0.1', resolve);
    });
    const port = server.address()?.port || requestedPort;
    currentPort = port;
    const active = openAiChannels()[0];
    setDshProxyConfig(port, { activeChannelId: active?.id });
    saveProxyStartTime('dsh', preserveStartTime);
    console.log(`DSH proxy server started on http://127.0.0.1:${port}`);
    return { success: true, port, provider: 'ctx-dsh-proxy', activeChannel: active };
  } catch (error) {
    proxyServer = null;
    currentPort = null;
    clearActiveMarker();
    try { await new Promise(resolve => server.close(() => resolve())); } catch (_) {}
    if (error.code === 'EADDRINUSE') {
      console.error(chalk.red(`DSH proxy port ${requestedPort} is already in use`));
    }
    throw error;
  }
}

async function stopDshProxyServer(options = {}) {
  const clearStartTime = options.clearStartTime !== false;
  const stoppedPort = currentPort;
  requestMetadata = new WeakMap();

  if (proxyServer) {
    const shutdownTimer = expediteServerShutdown(proxyServer, { forceAfterMs: options.forceAfterMs });
    await new Promise(resolve => proxyServer.close(resolve));
    if (shutdownTimer) clearTimeout(shutdownTimer);
    proxyServer = null;
    currentPort = null;
  }

  if (!isProxyModeEnabled()) {
    if (clearStartTime) clearProxyStartTime('dsh');
    return { success: true, port: stoppedPort, restored: null };
  }

  const restored = restoreDshNativeConfig();
  if (clearStartTime) clearProxyStartTime('dsh');
  return { success: true, port: stoppedPort, restored: restored ? restored.id || restored.name : null };
}

function getDshProxyStatus() {
  const config = loadConfig();
  const running = Boolean(proxyServer);
  const activeChannelId = readActiveMarker()?.activeChannelId;
  const activeChannel = activeChannelId
    ? getEnabledChannels().find(channel => channel.id === activeChannelId) || null
    : null;
  return {
    running,
    port: currentPort,
    defaultPort: config.ports?.dshProxy || 20093,
    startTime: getProxyStartTime('dsh', { allowRecovery: running }),
    runtime: getProxyRuntime('dsh', { allowRecovery: running }),
    mode: 'managed-provider',
    activeChannel,
    enabledChannelsCount: getEnabledChannels().length,
    supportedChannelsCount: openAiChannels().length
  };
}

module.exports = {
  startDshProxyServer,
  stopDshProxyServer,
  getDshProxyStatus
};
