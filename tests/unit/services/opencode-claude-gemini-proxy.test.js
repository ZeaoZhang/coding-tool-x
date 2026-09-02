'use strict';

const http = require('http');
const path = require('path');

const PROXY_PATH = require.resolve('../../../src/platforms/drivers/opencode/proxy-implementation');
const PATHS_PATH = require.resolve('../../../src/config/paths');
const CONFIG_LOADER_PATH = require.resolve('../../../src/config/loader');
const OPENCODE_CHANNELS_PATH = require.resolve('../../../src/platforms/drivers/opencode/channels-implementation');
const CHANNEL_SCHEDULER_PATH = require.resolve('../../../src/server/services/channel-scheduler');
const CHANNEL_HEALTH_PATH = require.resolve('../../../src/server/services/channel-health');
const PROXY_RUNTIME_PATH = require.resolve('../../../src/server/services/proxy-runtime');
const WEBSOCKET_PATH = require.resolve('../../../src/server/websocket-server');
const PROXY_LOG_HELPER_PATH = require.resolve('../../../src/server/services/proxy-log-helper');
const OPENCODE_STATS_PATH = require.resolve('../../../src/platforms/drivers/opencode/statistics-implementation');
const REQUEST_LOGGER_PATH = require.resolve('../../../src/server/services/request-logger');
const MODEL_DETECTOR_PATH = require.resolve('../../../src/server/services/model-detector');
const PRICING_PATH = require.resolve('../../../src/server/utils/pricing');

let upstream;
let proxy;
let upstreamPort;
/** @type {Array<{url:string,headers:object,body:object}>} */
let received = [];
let _channelConfig = {};
let healthStubs;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise(resolve => server?.close(() => resolve()));
}

function request({ port: p, path: requestPath, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: p,
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
  received = [];
  _channelConfig = {};

  upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      let bodyObj = {};
      const raw = Buffer.concat(chunks).toString('utf8');
      try { bodyObj = JSON.parse(raw); } catch { /* keep empty */ }

      const entry = { url: req.url, headers: { ...req.headers }, body: bodyObj };
      received.push(entry);

      const isCountTokens = req.url.includes('/count_tokens');

      if (isCountTokens) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ input_tokens: 10 }));
        return;
      }

      // Determine SSE flavour from the gatewaySourceType in channel config
      const isGemini = _channelConfig.gatewaySourceType === 'gemini';

      if (isGemini) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end([
          'data: {"candidates":[{"content":{"parts":[{"text":"Hello from Gemini"}]}}],"modelVersion":"gemini-2.5-pro","usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":3,"totalTokenCount":8}}\n\n'
        ].join(''));
      } else {
        // Claude SSE
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end([
          'data: {"type":"message_start","message":{"id":"msg_test","model":"claude-sonnet-4-20250514","usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello from Claude"}}\n\n',
          'data: {"type":"content_block_stop","index":0}\n\n',
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
          'data: {"type":"message_stop"}\n\n'
        ].join(''));
      }
    });
  });
  upstreamPort = await listen(upstream);

  // Common stubs
  stub(PATHS_PATH, { PATHS: { requestSnapshots: { opencode: path.join('/tmp', 'opencode-test.jsonl') } } });
  stub(CONFIG_LOADER_PATH, { loadConfig: () => ({ ports: { opencodeProxy: 0 } }) });
  stub(OPENCODE_CHANNELS_PATH, {
    getEnabledChannels: () => [_channelConfig],
    getEffectiveApiKey: async () => 'upstream-secret'
  });
  stub(CHANNEL_SCHEDULER_PATH, {
    allocateChannel: vi.fn(async () => _channelConfig),
    releaseChannel: vi.fn(),
    getSchedulerState: () => ({})
  });
  healthStubs = { recordSuccess: vi.fn(), recordFailure: vi.fn() };
  stub(CHANNEL_HEALTH_PATH, healthStubs);
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
  proxy = require('../../../src/platforms/drivers/opencode/proxy-implementation');
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

function responsesPayload(overrides = {}) {
  return {
    model: overrides.model || 'claude-sonnet-4-20250514',
    stream: overrides.stream !== undefined ? overrides.stream : true,
    input: overrides.input || [
      { type: 'message', role: 'system', content: [{ type: 'input_text', text: 'You are a helpful assistant.' }] },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hello, what can you do?' }] }
    ],
    tools: overrides.tools || [
      {
        type: 'function',
        name: 'mcp_get_weather',
        description: 'Get the current weather',
        parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] }
      }
    ],
    tool_choice: overrides.tool_choice || 'auto',
    reasoning_effort: overrides.reasoning_effort || 'medium',
    temperature: overrides.temperature !== undefined ? overrides.temperature : 0.7,
    max_output_tokens: overrides.max_output_tokens !== undefined ? overrides.max_output_tokens : 4096
  };
}

// ── Test 1: Claude /v1/responses streaming ──────────────────────────────

test('Claude gateway converts OpenCode Responses to Anthropic Messages with correct auth, path, and body', async () => {
  _channelConfig.gatewaySourceType = 'claude';
  _channelConfig.baseUrl = `http://127.0.0.1:${upstreamPort}/v1`;
  _channelConfig.model = 'claude-sonnet-4-20250514';
  _channelConfig.id = 'claude-test';
  _channelConfig.name = 'Claude Test';
  _channelConfig.apiKey = 'upstream-secret';

  const started = await proxy.startOpenCodeProxyServer({ port: 0 });
  const payload = responsesPayload();

  const response = await request({ port: started.port, path: '/v1/responses', body: payload });
  expect(response.statusCode, response.body).toBe(200);

  // Two upstream requests expected: count-token preflight then messages
  expect(received.length).toBeGreaterThanOrEqual(2);

  const countToken = received.find(r => r.url.includes('count_tokens'));
  const messages = received.find(r => r.url.includes('/messages') && !r.url.includes('count_tokens'));

  // Count-token preflight reached the right endpoint
  expect(countToken).toBeTruthy();
  expect(countToken.url).toContain('/v1/messages/count_tokens');
  expect(countToken.url).toContain('beta=true');

  // Messages request reached /v1/messages?beta=true
  expect(messages).toBeTruthy();
  expect(messages.url).toContain('/v1/messages');
  expect(messages.url).toContain('beta=true');
  expect(messages.url).not.toContain('count_tokens');

  // ── RED: current proxy sends BOTH x-api-key AND authorization: Bearer.
  // The shared wire sends only authorization: Bearer for non-official endpoints (localhost).
  // Assert the expected post-refactor single-auth behaviour:
  expect(messages.headers.authorization).toBe('Bearer upstream-secret');
  // x-api-key must NOT be present for non-official (localhost) endpoints
  expect(messages.headers['x-api-key']).toBeUndefined();

  // Fixed Anthropic headers
  expect(messages.headers['anthropic-version']).toBe('2023-06-01');
  expect(messages.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  expect(messages.headers['x-app']).toBe('cli');
  expect(messages.headers['content-type']).toBe('application/json');
  // stream → accept: text/event-stream
  expect(messages.headers.accept).toBe('text/event-stream');

  // Body shape
  expect(messages.body.model).toBe('claude-sonnet-4-20250514');
  expect(messages.body.stream).toBe(true);
  expect(messages.body.max_tokens).toBe(4096);
  expect(Array.isArray(messages.body.messages)).toBe(true);
  expect(Array.isArray(messages.body.system)).toBe(true);

  // Tools have mcp_ prefix preserved
  const toolNames = (messages.body.tools || []).map(t => t.name);
  expect(toolNames).toContain('mcp_get_weather');

  // Reasoning mapped
  expect(messages.body.thinking).toBeDefined();

  // Downstream completed
  expect(response.statusCode).toBe(200);
  expect(response.body).toContain('"type":"response.completed"');
  // Usage accounting must not break the success path (usage-parser imports)
  expect(healthStubs.recordSuccess).toHaveBeenCalled();
});

test('Claude gateway forwards providerConfig header overrides and suppresses generated credentials', async () => {
  _channelConfig.gatewaySourceType = 'claude';
  _channelConfig.baseUrl = `http://127.0.0.1:${upstreamPort}/v1`;
  _channelConfig.model = 'claude-sonnet-4-20250514';
  _channelConfig.id = 'claude-override-test';
  _channelConfig.name = 'Claude Override';
  _channelConfig.apiKey = 'upstream-secret';
  _channelConfig.providerConfig = {
    headers: { 'X-Api-Key': 'override-secret' }
  };

  const started = await proxy.startOpenCodeProxyServer({ port: 0 });
  const payload = responsesPayload();

  const response = await request({ port: started.port, path: '/v1/responses', body: payload });
  expect(response.statusCode, response.body).toBe(200);

  // Custom endpoint would generate Bearer; explicit X-Api-Key override must
  // suppress it on BOTH the count-token preflight and the messages request.
  expect(received.length).toBeGreaterThanOrEqual(2);
  for (const entry of received) {
    expect(entry.headers['x-api-key']).toBe('override-secret');
    expect(entry.headers.authorization).toBeUndefined();
  }
});

// ── Test 2: explicit google-generative-ai public Responses ─────────────

test('explicit google-generative-ai providerApi uses public Gemini format with x-goog-api-key only', async () => {
  _channelConfig.gatewaySourceType = 'gemini';
  // Use /v1beta in path so shouldUseGeminiCliFormat returns false for the URL.
  // The explicit providerApi ensures public format even without URL hints.
  _channelConfig.baseUrl = `http://127.0.0.1:${upstreamPort}/v1beta`;
  _channelConfig.model = 'gemini-2.5-pro';
  _channelConfig.id = 'gemini-public-test';
  _channelConfig.name = 'Gemini Public';
  _channelConfig.apiKey = 'upstream-secret';
  _channelConfig.providerApi = 'google-generative-ai';

  const started = await proxy.startOpenCodeProxyServer({ port: 0 });
  const payload = responsesPayload({ model: 'gemini-2.5-pro' });

  const response = await request({ port: started.port, path: '/v1/responses', body: payload });

  expect(received.length).toBeGreaterThanOrEqual(1);
  const req = received[0];

  // ── RED: current proxy sends BOTH x-goog-api-key AND authorization: Bearer
  // for ALL Gemini requests. The shared wire sends only x-goog-api-key for public format.
  expect(req.headers['x-goog-api-key']).toBe('upstream-secret');
  expect(req.headers.authorization).toBeUndefined();

  // No CLI metadata on public requests
  expect(req.headers['x-goog-api-client']).toBeUndefined();
  expect(req.headers['client-metadata']).toBeUndefined();

  // Public user-agent
  expect(req.headers['user-agent']).toBe('google-genai-sdk/0.8.0');

  // Public URL shape: /v1beta/models/<model>:streamGenerateContent?key=...&alt=sse
  expect(req.url).toContain('/v1beta/models/gemini-2.5-pro:streamGenerateContent');
  expect(req.url).toContain('alt=sse');
  expect(req.url).toContain('key=upstream-secret');
  expect(req.url).not.toContain('/v1internal');

  // Public body shape: contents + systemInstruction + generationConfig
  expect(req.body.contents).toBeDefined();
  expect(req.body.systemInstruction).toBeDefined();
  expect(req.body.generationConfig).toBeDefined();
  expect(req.body.project).toBeUndefined();
  expect(req.body.request).toBeUndefined();

  // Downstream completed
  expect(response.statusCode).toBe(200);
  expect(response.body).toContain('"type":"response.completed"');
});

// ── Test 3: explicit google-gemini-cli forces CLI format ────────────────

test('explicit google-gemini-cli providerApi uses CLI envelope and auth regardless of URL', async () => {
  _channelConfig.gatewaySourceType = 'gemini';
  // Use /v1beta in path — shouldUseGeminiCliFormat would return false,
  // but explicit providerApi forces CLI.
  _channelConfig.baseUrl = `http://127.0.0.1:${upstreamPort}/v1beta`;
  _channelConfig.model = 'gemini-2.5-pro';
  _channelConfig.id = 'gemini-cli-test';
  _channelConfig.name = 'Gemini CLI';
  _channelConfig.apiKey = 'upstream-secret';
  _channelConfig.providerApi = 'google-gemini-cli';

  const started = await proxy.startOpenCodeProxyServer({ port: 0 });
  const payload = responsesPayload({ model: 'gemini-2.5-pro' });

  const response = await request({ port: started.port, path: '/v1/responses', body: payload });

  expect(received.length).toBeGreaterThanOrEqual(1);
  const req = received[0];

  // ── RED: current proxy ignores providerApi; uses shouldUseGeminiCliFormat(url)
  // which returns false for /v1beta → sends public format.
  // Assertion expects CLI format.
  expect(req.url).toContain('/v1internal:streamGenerateContent');
  expect(req.url).toContain('alt=sse');
  expect(req.url).not.toContain('/v1beta');
  expect(req.url).not.toContain('/models/');

  // CLI auth and metadata
  expect(req.headers.authorization).toBe('Bearer upstream-secret');
  expect(req.headers['x-goog-api-key']).toBe('upstream-secret');
  expect(req.headers['user-agent']).toBe('google-api-nodejs-client/9.15.1');
  expect(req.headers['x-goog-api-client']).toBe('gl-node/22.17.0');
  expect(req.headers['client-metadata']).toContain('pluginType=GEMINI');

  // CLI envelope: { project, model, request }
  expect(req.body.project).toBe('');
  expect(req.body.model).toBe('gemini-2.5-pro');
  expect(req.body.request).toBeDefined();
  expect(req.body.request.contents).toBeDefined();
  expect(req.body.contents).toBeUndefined();

  // Downstream completed
  expect(response.statusCode).toBe(200);
  expect(response.body).toContain('"type":"response.completed"');
});

// ── Test 4: missing providerApi on legacy URL falls back via shouldUseGeminiCliFormat ─

test('missing providerApi on legacy Cloud Code prefix falls back to CLI format via URL detection', async () => {
  _channelConfig.gatewaySourceType = 'gemini';
  // Empty path on a non-Google host triggers shouldUseGeminiCliFormat → CLI
  _channelConfig.baseUrl = `http://127.0.0.1:${upstreamPort}`;
  _channelConfig.model = 'gemini-2.5-pro';
  _channelConfig.id = 'gemini-legacy-test';
  _channelConfig.name = 'Gemini Legacy';
  _channelConfig.apiKey = 'upstream-secret';
  // No providerApi set — falls back to URL-based detection

  const started = await proxy.startOpenCodeProxyServer({ port: 0 });
  const payload = responsesPayload({ model: 'gemini-2.5-pro' });

  const response = await request({ port: started.port, path: '/v1/responses', body: payload });

  expect(received.length).toBeGreaterThanOrEqual(1);
  const req = received[0];

  // ── This test should PASS against current proxy since it uses
  // shouldUseGeminiCliFormat which returns true for empty path on non-Google host.
  // After refactor, providerApi precedence still falls back to same URL detection,
  // so this test remains green through the transition.
  expect(req.url).toContain('/v1internal:streamGenerateContent');
  expect(req.url).toContain('alt=sse');
  expect(req.url).not.toContain('/models/');

  // CLI envelope
  expect(req.body.project).toBe('');
  expect(req.body.model).toBe('gemini-2.5-pro');
  expect(req.body.request).toBeDefined();
  expect(req.body.request.contents).toBeDefined();

  // CLI auth and metadata headers
  expect(req.headers.authorization).toBe('Bearer upstream-secret');
  expect(req.headers['x-goog-api-key']).toBe('upstream-secret');
  expect(req.headers['user-agent']).toBe('google-api-nodejs-client/9.15.1');
  expect(req.headers['x-goog-api-client']).toBe('gl-node/22.17.0');
  expect(req.headers['client-metadata']).toContain('pluginType=GEMINI');

  // Downstream completed
  expect(response.statusCode).toBe(200);
  expect(response.body).toContain('"type":"response.completed"');
});
