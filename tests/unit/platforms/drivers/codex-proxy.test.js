'use strict';
const http = require('http');

const PROXY_PATH = require.resolve('../../../../src/platforms/drivers/codex/proxy-implementation');
const HTTP_PROXY_PATH = require.resolve('http-proxy');
const CONFIG_LOADER_PATH = require.resolve('../../../../src/config/loader');
const CODEX_CHANNELS_PATH = require.resolve('../../../../src/platforms/drivers/codex/channels-implementation');
const CHANNEL_SCHEDULER_PATH = require.resolve('../../../../src/server/services/channel-scheduler');
const CHANNEL_HEALTH_PATH = require.resolve('../../../../src/server/services/channel-health');
const PROXY_RUNTIME_PATH = require.resolve('../../../../src/server/services/proxy-runtime');
const WEBSOCKET_PATH = require.resolve('../../../../src/server/websocket-server');
const PRICING_PATH = require.resolve('../../../../src/server/utils/pricing');
const CODEX_STATS_PATH = require.resolve('../../../../src/platforms/drivers/codex/statistics-implementation');
const REQUEST_LOGGER_PATH = require.resolve('../../../../src/server/services/request-logger');
const PROXY_LOG_HELPER_PATH = require.resolve('../../../../src/server/services/proxy-log-helper');
const RESPONSE_DECODER_PATH = require.resolve('../../../../src/server/services/response-decoder');
const PROXY_UTILS_PATH = require.resolve('../../../../src/shared/proxy-utils');
const RESPONSE_USAGE_PATH = require.resolve('../../../../src/shared/response-usage-parser');
const SERVER_SHUTDOWN_PATH = require.resolve('../../../../src/server/services/server-shutdown');

let proxyImplementation;
let proxyPort;
let proxyEvents;
let allocationOptions;
let capturedRequest;
let excludedChannelIds;
let codexChannel;
let originalModules;

function stub(modulePath, exports) {
  if (!originalModules.has(modulePath)) {
    originalModules.set(modulePath, require.cache[modulePath]);
  }
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports
  };
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
      path: '/v1/responses',
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
    req.end(JSON.stringify({ model: 'gpt-5' }));
  });
}

beforeEach(async () => {
  originalModules = new Map();
  proxyEvents = {};
  allocationOptions = null;
  capturedRequest = null;
  excludedChannelIds = [];
  proxyPort = await getFreePort();
  codexChannel = {
    id: 'api-channel',
    name: 'Codex API',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'upstream-key',
    authMode: 'api_key',
    modelRedirects: []
  };

  stub(CONFIG_LOADER_PATH, {
    loadConfig: vi.fn(() => ({ ports: { codexProxy: proxyPort } }))
  });
  stub(CODEX_CHANNELS_PATH, {
    getEffectiveApiKey: vi.fn(() => 'upstream-key'),
    getCodexProxyExcludedChannelIds: vi.fn(() => excludedChannelIds)
  });
  stub(CHANNEL_SCHEDULER_PATH, {
    allocateChannel: vi.fn(async (options) => {
      allocationOptions = options;
      return codexChannel;
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
  stub(WEBSOCKET_PATH, {
    broadcastLog: vi.fn(),
    broadcastSchedulerState: vi.fn()
  });
  stub(PRICING_PATH, {
    resolveModelPricing: vi.fn(() => ({})),
    calculateTokenCost: vi.fn(() => 0)
  });
  stub(CODEX_STATS_PATH, { recordRequest: vi.fn() });
  stub(REQUEST_LOGGER_PATH, { persistProxyRequestSnapshot: vi.fn() });
  stub(PROXY_LOG_HELPER_PATH, {
    publishUsageLog: vi.fn(),
    publishFailureLog: vi.fn()
  });
  stub(RESPONSE_DECODER_PATH, { createDecodedStream: source => source });
  stub(PROXY_UTILS_PATH, {
    redirectModel: model => model,
    resolveTargetUrl: () => 'https://api.example.com/v1/responses',
    isChatCompletionsPath: vi.fn(() => false),
    ensureOpenAiStreamUsage: vi.fn(() => false)
  });
  stub(RESPONSE_USAGE_PATH, {
    parseSSEUsage: vi.fn(() => ({})),
    parseNonStreamingUsage: vi.fn(() => ({})),
    mergeUsageIntoTokenData: vi.fn(),
    createTokenData: vi.fn(() => ({
      model: '',
      inputTokens: 0,
      outputTokens: 0,
      cacheCreation: 0,
      cacheRead: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0
    }))
  });
  stub(SERVER_SHUTDOWN_PATH, {
    attachServerShutdownHandling: vi.fn(),
    expediteServerShutdown: vi.fn(() => null)
  });
  stub(HTTP_PROXY_PATH, {
    createProxyServer: vi.fn(() => ({
      on: vi.fn((event, listener) => {
        proxyEvents[event] = listener;
      }),
      web: vi.fn((req, res) => {
        capturedRequest = req;
        res.statusCode = 200;
        res.end('ok');
      })
    }))
  });

  delete require.cache[PROXY_PATH];
  proxyImplementation = require('../../../../src/platforms/drivers/codex/proxy-implementation');
});

afterEach(async () => {
  await proxyImplementation?.stopCodexProxyServer?.();
  delete require.cache[PROXY_PATH];
  for (const [modulePath, previous] of originalModules) {
    if (previous) {
      require.cache[modulePath] = previous;
    } else {
      delete require.cache[modulePath];
    }
  }
});

test('blocks Codex proxy startup while an OAuth channel is enabled', async () => {
  excludedChannelIds = ['oauth-channel'];

  await expect(proxyImplementation.startCodexProxyServer()).rejects.toThrow(
    'Codex dynamic proxy supports API-key channels only'
  );
});

test('excludes OAuth channels and injects the allocated API key into requests', async () => {
  const started = await proxyImplementation.startCodexProxyServer();
  excludedChannelIds = ['oauth-channel'];

  const response = await request(started.port);

  expect(response.statusCode).toBe(200);
  expect(allocationOptions).toEqual({
    source: 'codex',
    enableSessionBinding: false,
    excludeChannelIds: ['oauth-channel']
  });
  expect(capturedRequest.selectedChannel).toBe(codexChannel);
  expect(capturedRequest.effectiveApiKey).toBe('upstream-key');

  const headers = {};
  const proxyReq = {
    removeHeader: vi.fn(name => delete headers[name.toLowerCase()]),
    setHeader: vi.fn((name, value) => {
      headers[name.toLowerCase()] = value;
    }),
    getHeader: vi.fn(name => headers[name.toLowerCase()]),
    write: vi.fn(),
    end: vi.fn()
  };

  proxyEvents.proxyReq(proxyReq, capturedRequest);

  expect(headers.authorization).toBe('Bearer upstream-key');
  expect(proxyReq.removeHeader).toHaveBeenCalledWith('authorization');
  expect(proxyReq.end).toHaveBeenCalled();
});
describe('codex Proxy Driver', () => { test('exposes structured lifecycle operations', async () => { const { createDriver } = require('../../../../src/platforms/drivers/codex/proxy'); const driver = createDriver({ requireImpl: () => ({ getCodexProxyStatus: () => ({ running: false }), startCodexProxyServer: options => ({ running: true, options }), stopCodexProxyServer: options => ({ running: false, options }) }) }); expect(driver.status()).toMatchObject({ status: 'ok', platform: 'codex', capability: 'proxy', operation: 'status', data: { running: false } }); await expect(driver.start({ port: 1234 })).toMatchObject({ status: 'ok', operation: 'start', data: { running: true, options: { port: 1234 } } }); }); });
