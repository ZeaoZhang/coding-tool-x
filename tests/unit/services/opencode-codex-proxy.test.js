'use strict';

const http = require('http');
const path = require('path');

const PROXY_PATH = require.resolve('../../../src/server/opencode-proxy-server');
const PATHS_PATH = require.resolve('../../../src/config/paths');
const CONFIG_LOADER_PATH = require.resolve('../../../src/config/loader');
const OPENCODE_CHANNELS_PATH = require.resolve('../../../src/server/services/opencode-channels');
const CHANNEL_SCHEDULER_PATH = require.resolve('../../../src/server/services/channel-scheduler');
const CHANNEL_HEALTH_PATH = require.resolve('../../../src/server/services/channel-health');
const PROXY_RUNTIME_PATH = require.resolve('../../../src/server/services/proxy-runtime');
const WEBSOCKET_PATH = require.resolve('../../../src/server/websocket-server');
const PROXY_LOG_HELPER_PATH = require.resolve('../../../src/server/services/proxy-log-helper');
const OPENCODE_STATS_PATH = require.resolve('../../../src/server/services/opencode-statistics-service');
const REQUEST_LOGGER_PATH = require.resolve('../../../src/server/services/request-logger');
const MODEL_DETECTOR_PATH = require.resolve('../../../src/server/services/model-detector');
const PRICING_PATH = require.resolve('../../../src/server/utils/pricing');

let upstream;
let proxy;
let received;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise(resolve => server?.close(() => resolve()));
}

function request({ port, path: requestPath, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: requestPath,
      headers: {
        authorization: 'Bearer client-capability',
        'content-type': 'application/json'
      }
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

function stub(modulePath, exports) {
  require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports };
}

beforeEach(async () => {
  received = null;
  upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      received = { url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end([
        'data: {"type":"response.created","response":{"id":"resp_test","model":"gpt-5.5","status":"in_progress"}}\n\n',
        'data: {"type":"response.completed","response":{"id":"resp_test","model":"gpt-5.5","status":"completed","output":[]}}\n\n',
        'data: [DONE]\n\n'
      ].join(''));
    });
  });
  const upstreamPort = await listen(upstream);

  stub(PATHS_PATH, { PATHS: { requestSnapshots: { opencode: path.join('/tmp', 'opencode-test.jsonl') } } });
  stub(CONFIG_LOADER_PATH, { loadConfig: () => ({ ports: { opencodeProxy: 0 } }) });
  stub(OPENCODE_CHANNELS_PATH, {
    getEnabledChannels: () => [{
      id: 'codex-channel',
      name: 'Codex Edge',
      baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
      apiKey: 'upstream-secret',
      gatewaySourceType: 'codex',
      model: 'gpt-5.5',
      modelRedirects: []
    }],
    getEffectiveApiKey: async () => 'upstream-secret'
  });
  stub(CHANNEL_SCHEDULER_PATH, {
    allocateChannel: vi.fn(async () => ({
      id: 'codex-channel',
      name: 'Codex Edge',
      baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
      apiKey: 'upstream-secret',
      gatewaySourceType: 'codex',
      model: 'gpt-5.5',
      modelRedirects: []
    })),
    releaseChannel: vi.fn(),
    getSchedulerState: () => ({})
  });
  stub(CHANNEL_HEALTH_PATH, { recordSuccess: vi.fn(), recordFailure: vi.fn() });
  stub(PROXY_RUNTIME_PATH, {
    saveProxyStartTime: vi.fn(),
    clearProxyStartTime: vi.fn(),
    getProxyStartTime: () => null,
    getProxyRuntime: () => null
  });
  stub(WEBSOCKET_PATH, { broadcastLog: vi.fn(), broadcastSchedulerState: vi.fn() });
  stub(PROXY_LOG_HELPER_PATH, { publishUsageLog: vi.fn(), publishFailureLog: vi.fn() });
  stub(OPENCODE_STATS_PATH, { recordRequest: vi.fn() });
  stub(REQUEST_LOGGER_PATH, { persistProxyRequestSnapshot: vi.fn(), loadClaudeRequestTemplate: () => ({}) });
  stub(MODEL_DETECTOR_PATH, { probeModelAvailability: vi.fn(), fetchModelsFromProvider: vi.fn() });
  stub(PRICING_PATH, { resolveModelPricing: () => ({}), calculateTokenCost: () => 0 });

  delete require.cache[PROXY_PATH];
  proxy = require('../../../src/server/opencode-proxy-server');
});

afterEach(async () => {
  await proxy?.stopOpenCodeProxyServer?.();
  await close(upstream);
  [
    PROXY_PATH,
    PATHS_PATH,
    CONFIG_LOADER_PATH,
    OPENCODE_CHANNELS_PATH,
    CHANNEL_SCHEDULER_PATH,
    CHANNEL_HEALTH_PATH,
    PROXY_RUNTIME_PATH,
    WEBSOCKET_PATH,
    PROXY_LOG_HELPER_PATH,
    OPENCODE_STATS_PATH,
    REQUEST_LOGGER_PATH,
    MODEL_DETECTOR_PATH,
    PRICING_PATH
  ].forEach(modulePath => delete require.cache[modulePath]);
});

test('sends current Codex compatibility metadata through the OpenCode proxy', async () => {
  const started = await proxy.startOpenCodeProxyServer({ port: 0 });
  const response = await request({
    port: started.port,
    path: '/v1/responses',
    body: {
      model: 'gpt-5.5',
      stream: true,
      input: [
        { type: 'message', role: 'system', content: [{ type: 'input_text', text: 'rules' }] },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }
      ],
      temperature: 0.2,
      max_output_tokens: 128
    }
  });

  expect(response.statusCode).toBe(200);
  expect(received.url).toBe('/v1/responses');
  expect(received.headers.authorization).toBe('Bearer upstream-secret');
  expect(received.headers.originator).toBe('codex_exec');
  expect(received.headers['user-agent']).toContain('codex_exec/0.144.1');
  expect(received.headers['session-id']).toBeTruthy();
  expect(received.headers['thread-id']).toBeTruthy();
  expect(received.headers['x-codex-window-id']).toBeTruthy();
  expect(received.headers['x-codex-turn-metadata']).toBeTruthy();
  expect(received.body.input[0].role).toBe('developer');
  expect(received.body.temperature).toBeUndefined();
  expect(received.body.max_output_tokens).toBeUndefined();
  expect(received.body.client_metadata['x-codex-turn-metadata']).toBe(received.headers['x-codex-turn-metadata']);
});
