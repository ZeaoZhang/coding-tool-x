'use strict';
describe('gemini Proxy Driver', () => { test('exposes structured lifecycle operations', async () => { const { createDriver } = require('../../../../src/platforms/drivers/gemini/proxy'); const driver = createDriver({ requireImpl: () => ({ getGeminiProxyStatus: () => ({ running: false }), startGeminiProxyServer: options => ({ running: true, options }), stopGeminiProxyServer: options => ({ running: false, options }) }) }); expect(driver.status()).toMatchObject({ status: 'ok', platform: 'gemini', capability: 'proxy', operation: 'status', data: { running: false } }); await expect(driver.start({ port: 1234 })).toMatchObject({ status: 'ok', operation: 'start', data: { running: true, options: { port: 1234 } } }); }); });

const http = require('http');
const GEMINI_PROXY_PATH = require.resolve('../../../../src/platforms/drivers/gemini/proxy-implementation');
const HTTP_PROXY_PATH = require.resolve('http-proxy');
const CONFIG_LOADER_PATH = require.resolve('../../../../src/config/loader');
const GEMINI_CHANNELS_PATH = require.resolve('../../../../src/platforms/drivers/gemini/channels-implementation');
const CHANNEL_SCHEDULER_PATH = require.resolve('../../../../src/server/services/channel-scheduler');
const CHANNEL_HEALTH_PATH = require.resolve('../../../../src/server/services/channel-health');
const PROXY_RUNTIME_PATH = require.resolve('../../../../src/server/services/proxy-runtime');
const WEBSOCKET_PATH = require.resolve('../../../../src/server/websocket-server');
const PRICING_PATH = require.resolve('../../../../src/server/utils/pricing');
const STATS_PATH = require.resolve('../../../../src/platforms/drivers/gemini/statistics-implementation');
const REQUEST_LOGGER_PATH = require.resolve('../../../../src/server/services/request-logger');
const RESPONSE_DECODER_PATH = require.resolve('../../../../src/server/services/response-decoder');
const PROXY_UTILS_PATH = require.resolve('../../../../src/shared/proxy-utils');
const RESPONSE_USAGE_PATH = require.resolve('../../../../src/shared/response-usage-parser');
const SERVER_SHUTDOWN_PATH = require.resolve('../../../../src/server/services/server-shutdown');

let geminiProxy;
let proxyPort;
let proxyEvents;
let allocationOptions;
let capturedRequest;
let excludedChannelIds;
let geminiChannel;
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
      path: '/v1beta/models/gemini-2.5-pro:generateContent',
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
    req.end(JSON.stringify({ contents: [] }));
  });
}

beforeEach(async () => {
  originalModules = new Map();
  proxyEvents = {};
  allocationOptions = null;
  capturedRequest = null;
  excludedChannelIds = [];
  proxyPort = await getFreePort();
  geminiChannel = {
    id: 'api-channel',
    name: 'Gemini API',
    baseUrl: 'https://api.example.com',
    apiKey: 'upstream-key',
    authMode: 'api_key',
    modelRedirects: []
  };

  stub(CONFIG_LOADER_PATH, {
    loadConfig: vi.fn(() => ({ ports: { geminiProxy: proxyPort } }))
  });
  stub(GEMINI_CHANNELS_PATH, {
    getEffectiveApiKey: vi.fn(() => 'upstream-key'),
    getGeminiProxyExcludedChannelIds: vi.fn(() => excludedChannelIds)
  });
  stub(CHANNEL_SCHEDULER_PATH, {
    allocateChannel: vi.fn(async (options) => {
      allocationOptions = options;
      return geminiChannel;
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
  stub(STATS_PATH, { recordRequest: vi.fn() });
  stub(REQUEST_LOGGER_PATH, { persistProxyRequestSnapshot: vi.fn() });
  stub(RESPONSE_DECODER_PATH, { createDecodedStream: source => source });
  stub(PROXY_UTILS_PATH, {
    redirectModel: model => model,
    resolveTargetUrl: () => 'https://api.example.com'
  });
  stub(RESPONSE_USAGE_PATH, {
    parseSSEUsage: vi.fn(() => ({})),
    parseNonStreamingUsage: vi.fn(() => ({})),
    splitSSEEvents: vi.fn(() => []),
    parseSSEEventText: vi.fn(() => ({})),
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

  delete require.cache[GEMINI_PROXY_PATH];
  geminiProxy = require('../../../../src/platforms/drivers/gemini/proxy-implementation');
});

afterEach(async () => {
  await geminiProxy?.stopGeminiProxyServer?.();
  delete require.cache[GEMINI_PROXY_PATH];
  for (const [modulePath, previous] of originalModules) {
    if (previous) {
      require.cache[modulePath] = previous;
    } else {
      delete require.cache[modulePath];
    }
  }
});

test('blocks Gemini proxy startup while an OAuth channel is enabled', async () => {
  excludedChannelIds = ['oauth-channel'];

  await expect(geminiProxy.startGeminiProxyServer()).rejects.toThrow(
    'Gemini dynamic proxy supports API-key channels only'
  );
});

test('excludes OAuth channels and injects the allocated API key into requests', async () => {
  const started = await geminiProxy.startGeminiProxyServer();
  excludedChannelIds = ['oauth-channel'];

  const response = await request(started.port);

  expect(response.statusCode).toBe(200);
  expect(allocationOptions).toEqual({
    source: 'gemini',
    enableSessionBinding: false,
    excludeChannelIds: ['oauth-channel']
  });
  expect(capturedRequest.selectedChannel).toBe(geminiChannel);
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
