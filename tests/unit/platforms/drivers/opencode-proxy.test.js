'use strict';

describe('opencode Proxy Driver', () => {
  test('exposes structured lifecycle operations', async () => {
    const { createDriver } = require('../../../../src/platforms/drivers/opencode/proxy');
    const driver = createDriver({
      requireImpl: () => ({
        getOpenCodeProxyStatus: () => ({ running: false }),
        startOpenCodeProxyServer: options => ({ running: true, options }),
        stopOpenCodeProxyServer: options => ({ running: false, options })
      })
    });
    expect(driver.status()).toMatchObject({ status: 'ok', platform: 'opencode', capability: 'proxy', operation: 'status', data: { running: false } });
    await expect(driver.start({ port: 1234 })).toMatchObject({ status: 'ok', operation: 'start', data: { running: true, options: { port: 1234 } } });
  });
});

const http = require('http');

const PROXY_PATH = require.resolve('../../../../src/platforms/drivers/opencode/proxy-implementation');
const HTTP_PROXY_PATH = require.resolve('http-proxy');
const CONFIG_LOADER_PATH = require.resolve('../../../../src/config/loader');
const PATHS_PATH = require.resolve('../../../../src/config/paths');
const OPENCODE_CHANNELS_PATH = require.resolve('../../../../src/platforms/drivers/opencode/channels-implementation');
const CHANNEL_SCHEDULER_PATH = require.resolve('../../../../src/server/services/channel-scheduler');
const CHANNEL_HEALTH_PATH = require.resolve('../../../../src/server/services/channel-health');
const PROXY_RUNTIME_PATH = require.resolve('../../../../src/server/services/proxy-runtime');
const WEBSOCKET_PATH = require.resolve('../../../../src/server/websocket-server');
const REQUEST_LOGGER_PATH = require.resolve('../../../../src/server/services/request-logger');
const MODEL_DETECTOR_PATH = require.resolve('../../../../src/server/services/model-detector');
const PROXY_UTILS_PATH = require.resolve('../../../../src/shared/proxy-utils');
const SERVER_SHUTDOWN_PATH = require.resolve('../../../../src/server/services/server-shutdown');
const CODEX_WIRE_PATH = require.resolve('../../../../src/platforms/drivers/codex/wire');
const CLAUDE_WIRE_PATH = require.resolve('../../../../src/platforms/drivers/claude/wire');
const GEMINI_WIRE_PATH = require.resolve('../../../../src/platforms/drivers/gemini/wire');

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
    req.end(JSON.stringify({ model: 'opencode-model' }));
  });
}

function getModels(port) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'GET',
      path: '/v1/models',
      headers: { authorization: 'Bearer client-key' }
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

beforeEach(async () => {
  originalModules = new Map();
  proxyEvents = {};
  allocationOptions = null;
  channels = [
    { id: 'channel-a', name: 'Channel A', baseUrl: 'https://a.example.com', apiKey: 'key-a', authMode: 'api_key', modelRedirects: [] },
    { id: 'channel-b', name: 'Channel B', baseUrl: 'https://b.example.com', apiKey: 'key-b', authMode: 'api_key', modelRedirects: [] }
  ];

  stub(CONFIG_LOADER_PATH, { loadConfig: vi.fn(() => ({ ports: { opencodeProxy: 0 } })) });
  stub(PATHS_PATH, { PATHS: {}, ensureStorageDirMigrated: vi.fn() });
  stub(OPENCODE_CHANNELS_PATH, {
    getEnabledChannels: vi.fn(() => channels),
    getEffectiveApiKey: vi.fn(async channel => channel.apiKey)
  });
  stub(CHANNEL_SCHEDULER_PATH, {
    allocateChannel: vi.fn(async (options) => {
      allocationOptions = options;
      return channels.find(item => !(options.excludeChannelIds || []).includes(item.id)) || null;
    }),
    releaseChannel: vi.fn(),
    getSchedulerState: vi.fn(() => ({}))
  });
  stub(CHANNEL_HEALTH_PATH, { recordSuccess: vi.fn(), recordFailure: vi.fn() });
  stub(PROXY_RUNTIME_PATH, {
    saveProxyStartTime: vi.fn(),
    clearProxyStartTime: vi.fn(),
    getProxyStartTime: vi.fn(() => null),
    getProxyRuntime: vi.fn(() => null)
  });
  stub(WEBSOCKET_PATH, { broadcastLog: vi.fn(), broadcastSchedulerState: vi.fn() });
  stub(REQUEST_LOGGER_PATH, {
    persistProxyRequestSnapshot: vi.fn(),
    loadClaudeRequestTemplate: vi.fn(() => null)
  });
  stub(MODEL_DETECTOR_PATH, {
    probeModelAvailability: vi.fn(async () => ({ available: false })),
    fetchModelsFromProvider: vi.fn(async () => ({ models: [] }))
  });
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
  stub(CODEX_WIRE_PATH, { buildCodexTargetUrl: vi.fn(() => null), createCodexRequest: vi.fn(() => ({})) });
  stub(CLAUDE_WIRE_PATH, {
    createClaudeRequest: vi.fn(() => ({})),
    buildClaudeTargetUrl: vi.fn(() => null),
    buildClaudeCountTokensTargetUrl: vi.fn(() => null),
    buildClaudeCountTokensHeaders: vi.fn(() => ({}))
  });
  stub(GEMINI_WIRE_PATH, {
    createGeminiRequest: vi.fn(() => ({})),
    buildGeminiTargetUrl: vi.fn(() => null),
    shouldUseGeminiCliFormat: vi.fn(() => false)
  });
  stub(HTTP_PROXY_PATH, { createProxyServer: vi.fn(() => ({ on: vi.fn(), web: vi.fn() })) });

  delete require.cache[PROXY_PATH];
  proxyImplementation = require('../../../../src/platforms/drivers/opencode/proxy-implementation');
});

afterEach(async () => {
  await proxyImplementation?.stopOpenCodeProxyServer?.();
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

  const port = await getFreePort();
  const started = await proxyImplementation.startOpenCodeProxyServer({ port });
  const response = await request(started.port);

  expect(response.statusCode).toBe(200);
  expect(response.body).toBe('{"ok":true}');
  expect(channelIds).toEqual(['channel-a', 'channel-b']);
  expect(allocationOptions).toMatchObject({
    source: 'opencode',
    enableSessionBinding: false,
    excludeChannelIds: ['channel-a']
  });
  expect(scheduler.releaseChannel.mock.calls.map(call => call[0])).toEqual(['channel-a', 'channel-b']);
  expect(health.recordFailure).toHaveBeenCalledWith('channel-a', 'opencode', expect.any(Error));
  expect(health.recordSuccess).toHaveBeenCalledWith('channel-b', 'opencode');
  expect(written).toEqual([JSON.stringify({ model: 'opencode-model' }), JSON.stringify({ model: 'opencode-model' })]);
});

test('does not fail over on a non-retryable status', async () => {
  const { channelIds } = installProxyStub([400]);
  const scheduler = require(CHANNEL_SCHEDULER_PATH);

  const port = await getFreePort();
  const started = await proxyImplementation.startOpenCodeProxyServer({ port });
  const response = await request(started.port);

  expect(response.statusCode).toBe(400);
  expect(channelIds).toEqual(['channel-a']);
  expect(scheduler.releaseChannel.mock.calls.map(call => call[0])).toEqual(['channel-a']);
});

test('serves the aggregated model list locally instead of proxying it', async () => {
  const scheduler = require(CHANNEL_SCHEDULER_PATH);
  const httpProxy = require(HTTP_PROXY_PATH);
  const web = vi.fn();
  httpProxy.createProxyServer.mockImplementation(() => ({ on: vi.fn(), web }));

  const port = await getFreePort();
  const started = await proxyImplementation.startOpenCodeProxyServer({ port });
  const response = await getModels(started.port);

  expect(response.statusCode).toBe(200);
  expect(JSON.parse(response.body)).toEqual({ object: 'list', data: [] });
  expect(scheduler.allocateChannel).not.toHaveBeenCalled();
  expect(web).not.toHaveBeenCalled();
});
