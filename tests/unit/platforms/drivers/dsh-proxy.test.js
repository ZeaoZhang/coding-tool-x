'use strict';

const http = require('http');

const PROXY_PATH = require.resolve('../../../../src/platforms/drivers/dsh/proxy-implementation');
const HTTP_PROXY_PATH = require.resolve('http-proxy');
const CONFIG_LOADER_PATH = require.resolve('../../../../src/config/loader');
const DSH_CHANNELS_PATH = require.resolve('../../../../src/platforms/drivers/dsh/channels-implementation');
const CHANNEL_SCHEDULER_PATH = require.resolve('../../../../src/server/services/channel-scheduler');
const CHANNEL_HEALTH_PATH = require.resolve('../../../../src/server/services/channel-health');
const PROXY_RUNTIME_PATH = require.resolve('../../../../src/server/services/proxy-runtime');
const WEBSOCKET_PATH = require.resolve('../../../../src/server/websocket-server');
const REQUEST_LOGGER_PATH = require.resolve('../../../../src/server/services/request-logger');
const PROXY_UTILS_PATH = require.resolve('../../../../src/shared/proxy-utils');
const SERVER_SHUTDOWN_PATH = require.resolve('../../../../src/server/services/server-shutdown');

let proxyImplementation;
let proxyEvents;
let allocationOptions;
let channels;
let originalModules;

function stub(modulePath, exports) {
  if (!originalModules.has(modulePath)) {
    originalModules.set(modulePath, require.cache[modulePath]);
  }
  require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports };
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function request(port) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: '/v1/chat/completions',
      headers: {
        authorization: 'Bearer client-key',
        'content-type': 'application/json'
      }
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    req.end(JSON.stringify({ model: 'dsh-model' }));
  });
}

beforeEach(async () => {
  originalModules = new Map();
  proxyEvents = {};
  allocationOptions = null;
  channels = [
    { id: 'channel-a', name: 'Channel A', baseUrl: 'https://a.example.com', apiKey: 'key-a', authMode: 'api_key', providerApi: 'openai-completions' },
    { id: 'channel-b', name: 'Channel B', baseUrl: 'https://b.example.com', apiKey: 'key-b', authMode: 'api_key', providerApi: 'openai-completions' }
  ];

  stub(CONFIG_LOADER_PATH, {
    loadConfig: vi.fn(() => ({ ports: { dshProxy: 0 } }))
  });
  stub(DSH_CHANNELS_PATH, {
    getEnabledChannels: vi.fn(() => channels),
    getEffectiveApiKey: vi.fn(channel => channel.apiKey),
    setDshProxyConfig: vi.fn(),
    restoreDshNativeConfig: vi.fn(),
    clearActiveMarker: vi.fn(),
    isProxyModeEnabled: vi.fn(() => true),
    readActiveMarker: vi.fn(() => ({ activeChannelId: 'channel-a' }))
  });
  stub(CHANNEL_SCHEDULER_PATH, {
    allocateChannel: vi.fn(async (options) => {
      allocationOptions = options;
      return channels.find(item => !(options.excludeChannelIds || []).includes(item.id)) || null;
    }),
    releaseChannel: vi.fn(),
    getSchedulerState: vi.fn(() => ({}))
  });
  stub(CHANNEL_HEALTH_PATH, {
    recordSuccess: vi.fn(),
    recordFailure: vi.fn()
  });
  stub(PROXY_RUNTIME_PATH, {
    saveProxyStartTime: vi.fn(),
    clearProxyStartTime: vi.fn(),
    getProxyStartTime: vi.fn(() => null),
    getProxyRuntime: vi.fn(() => null)
  });
  stub(WEBSOCKET_PATH, { broadcastLog: vi.fn(), broadcastSchedulerState: vi.fn() });
  stub(REQUEST_LOGGER_PATH, { persistProxyRequestSnapshot: vi.fn() });
  stub(PROXY_UTILS_PATH, {
    redirectModel: model => model,
    resolveTargetUrl: (baseUrl, requestPath) => `${baseUrl}${requestPath}`,
    isChatCompletionsPath: vi.fn(() => false),
    ensureOpenAiStreamUsage: vi.fn(() => false)
  });
  stub(SERVER_SHUTDOWN_PATH, {
    attachServerShutdownHandling: vi.fn(),
    expediteServerShutdown: vi.fn(() => null)
  });
  stub(HTTP_PROXY_PATH, {
    createProxyServer: vi.fn(() => ({ on: vi.fn(), web: vi.fn() }))
  });

  delete require.cache[PROXY_PATH];
  proxyImplementation = require('../../../../src/platforms/drivers/dsh/proxy-implementation');
});

afterEach(async () => {
  await proxyImplementation?.stopDshProxyServer?.();
  delete require.cache[PROXY_PATH];
  for (const [modulePath, previous] of originalModules) {
    if (previous) {
      require.cache[modulePath] = previous;
    } else {
      delete require.cache[modulePath];
    }
  }
});

function installProxyStub(statuses) {
  const { Readable } = require('stream');
  const targets = [];
  const channelIds = [];
  const written = [];
  const httpProxy = require(HTTP_PROXY_PATH);
  httpProxy.createProxyServer.mockImplementation(() => ({
    on: (event, listener) => { proxyEvents[event] = listener; },
    web: (req, res, options) => {
      const index = targets.length;
      targets.push(options.target);
      channelIds.push(req.selectedChannel && req.selectedChannel.id);
      const upstreamHeaders = {};
      const chunks = [];
      const proxyReq = {
        removeHeader: name => { delete upstreamHeaders[name]; },
        setHeader: (name, value) => { upstreamHeaders[String(name).toLowerCase()] = value; },
        getHeader: name => upstreamHeaders[String(name).toLowerCase()],
        once: () => {},
        write: chunk => { chunks.push(Buffer.from(chunk)); },
        end: () => { written.push(Buffer.concat(chunks).toString('utf8')); }
      };
      proxyEvents.proxyReq(proxyReq, req, res);
      const statusCode = statuses[index];
      const proxyRes = Readable.from([
        Buffer.from(statusCode === 200 ? '{"ok":true}' : '{"error":"upstream"}')
      ]);
      proxyRes.statusCode = statusCode;
      proxyRes.headers = { 'content-type': 'application/json' };
      proxyEvents.proxyRes(proxyRes, req, res);
    }
  }));
  return { targets, channelIds, written };
}

test('fails over to the next channel when the upstream returns a retryable status', async () => {
  const { channelIds, written } = installProxyStub([429, 200]);
  const scheduler = require(CHANNEL_SCHEDULER_PATH);
  const health = require(CHANNEL_HEALTH_PATH);

  proxyEvents = {};
  const port = await getFreePort();
  const started = await proxyImplementation.startDshProxyServer({ port });
  const response = await request(started.port);

  expect(response.statusCode).toBe(200);
  expect(response.body).toBe('{"ok":true}');
  expect(channelIds).toEqual(['channel-a', 'channel-b']);
  expect(allocationOptions).toMatchObject({
    source: 'dsh',
    providerApi: 'openai-completions',
    enableSessionBinding: false,
    excludeChannelIds: ['channel-a']
  });
  expect(scheduler.releaseChannel.mock.calls.map(call => call[0])).toEqual(['channel-a', 'channel-b']);
  expect(health.recordFailure).toHaveBeenCalledWith('channel-a', 'dsh', expect.any(Error));
  expect(health.recordSuccess).toHaveBeenCalledWith('channel-b', 'dsh');
  expect(written).toEqual([JSON.stringify({ model: 'dsh-model' }), JSON.stringify({ model: 'dsh-model' })]);
});

test('does not fail over on a non-retryable status', async () => {
  const { channelIds } = installProxyStub([400]);
  const scheduler = require(CHANNEL_SCHEDULER_PATH);

  const port = await getFreePort();
  const started = await proxyImplementation.startDshProxyServer({ port });
  const response = await request(started.port);

  expect(response.statusCode).toBe(400);
  expect(channelIds).toEqual(['channel-a']);
  expect(scheduler.releaseChannel.mock.calls.map(call => call[0])).toEqual(['channel-a']);
});
