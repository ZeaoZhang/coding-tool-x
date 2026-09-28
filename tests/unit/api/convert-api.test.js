const express = require('express');
const http = require('http');

let gatewayConverter;
let requestLogger;

function buildApp() {
  delete require.cache[require.resolve('../../../src/server/api/convert')];
  const router = require('../../../src/server/api/convert');
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

function request(app) {
  return {
    get(url, headers) { return call(app, 'GET', url, undefined, headers); },
    post(url, body, headers) { return call(app, 'POST', url, body, headers); }
  };
}

function call(app, method, url, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const rawBody = body ? JSON.stringify(body) : null;
      const req = http.request({
        hostname: '127.0.0.1',
        port: server.address().port,
        path: url,
        method,
        headers: {
          ...(rawBody ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(rawBody)
          } : {}),
          ...extraHeaders
        }
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          server.close();
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });
      req.on('error', reject);
      if (rawBody) req.write(rawBody);
      req.end();
    });
  });
}

beforeEach(() => {
  gatewayConverter = {
    SUPPORTED_SOURCE_TYPES: ['claude', 'codex', 'gemini'],
    SUPPORTED_TARGET_APIS: ['responses', 'chat.completions'],
    convertToOpenCodePayload: vi.fn(({ sourceType, payload, options }) => ({
      sourceType,
      payload,
      options,
      targetApi: 'responses'
    })),
    convertClaudeToOpenCodePayload: vi.fn(({ payload }) => ({ payload, converted: 'claude' })),
    convertCodexToOpenCodePayload: vi.fn(({ payload }) => ({ payload, converted: 'codex' })),
    convertGeminiToOpenCodePayload: vi.fn(({ payload }) => ({ payload, converted: 'gemini' })),
    normalizeSourceType: vi.fn((value) => String(value).trim().toLowerCase())
  };

  require.cache[require.resolve('../../../src/platforms/drivers/opencode/gateway-converter')] = {
    id: require.resolve('../../../src/platforms/drivers/opencode/gateway-converter'),
    filename: require.resolve('../../../src/platforms/drivers/opencode/gateway-converter'),
    loaded: true,
    exports: gatewayConverter
  };

  const requestLoggerPath = require.resolve('../../../src/server/services/request-logger');
  const actualRequestLogger = require(requestLoggerPath);
  requestLogger = {
    ...actualRequestLogger,
    loadLatestProxyRequestSnapshot: vi.fn((target) => target === 'omp' ? ({
      request: { headers: { 'x-cli-version': 'from-omp-log' } },
      route: { providerApi: 'openai-responses', path: '/v1/responses' }
    }) : null),
    loadLatestProxyRequestHeaders: vi.fn(() => ({ 'x-cli-version': 'from-target-log' }))
  };
  require.cache[requestLoggerPath].exports = requestLogger;
});

afterEach(() => {
  [
    '../../../src/server/api/convert',
    '../../../src/platforms/drivers/opencode/gateway-converter',
    '../../../src/server/services/request-logger'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('convert api', () => {
  test.each(['omp', 'opencode'])('%s exposes only Claude Code, Codex, and Gemini conversion formats', async (target) => {
    const res = await request(buildApp()).get(`/${target}/formats`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      target,
      sourceTypes: [
        { id: 'claude', name: 'Claude Code' },
        { id: 'codex', name: 'Codex' },
        { id: 'gemini', name: 'Gemini' }
      ],
      targetApis: target === 'omp' ? ['responses'] : ['responses', 'chat.completions'],
      defaultTargetApi: 'responses'
    }));
  });

  test.each(['omp', 'opencode'])('%s conversion route validates and delegates through the shared converter', async (target) => {
    const app = buildApp();
    expect((await request(app).post(`/${target}`, { payload: { a: 1 } })).status).toBe(400);
    expect((await request(app).post(`/${target}`, {
      sourceType: 'unknown',
      payload: { a: 1 }
    })).status).toBe(400);

    const res = await request(app).post(`/${target}`, {
      sourceType: ' Claude ',
      payload: { prompt: 'hello' },
      options: { api: 'responses' }
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      success: true,
      target,
      requestHeaders: expect.any(Object)
    }));
    expect(res.body.requestHeaders).toEqual({ 'x-cli-version': 'from-target-log' });
    expect(gatewayConverter.convertToOpenCodePayload).toHaveBeenCalledWith({
      sourceType: 'claude',
      payload: { prompt: 'hello' },
      options: target === 'omp'
        ? { api: 'responses', targetApi: 'responses' }
        : { api: 'responses' }
    });
  });

  test('legacy duplicate source-specific and unscoped routes are not exposed', async () => {
    const app = buildApp();
    expect((await request(app).get('/formats')).status).toBe(404);
    expect((await request(app).post('/opencode/claude', { payload: { a: 1 } })).status).toBe(404);
  });

  test('conversion metadata rejects cross-origin browser requests', async () => {
    const res = await request(buildApp()).get('/omp/formats', { Origin: 'https://attacker.example' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CROSS_ORIGIN_REQUEST_BLOCKED');
  });

  test('OMP conversion follows the latest logged provider protocol and rejects unsupported routes', async () => {
    const app = buildApp();
    const result = await request(app).post('/omp', {
      sourceType: 'codex',
      payload: { input: 'hello' },
      options: { targetApi: 'responses' }
    });

    expect(result.status).toBe(200);
    expect(result.body.endpoint).toBe('/v1/responses');
    expect(requestLogger.loadLatestProxyRequestSnapshot).toHaveBeenCalledWith('omp');

    requestLogger.loadLatestProxyRequestSnapshot.mockImplementation((target) => target === 'omp' ? ({
      route: { providerApi: 'anthropic-messages', path: '/v1/messages' }
    }) : null);
    const unsupported = await request(app).post('/omp', {
      sourceType: 'codex',
      payload: { input: 'hello' }
    });
    expect(unsupported.status).toBe(500);
    expect(unsupported.body.error).toMatch(/does not identify a supported/);
    requestLogger.loadLatestProxyRequestSnapshot.mockReset();
    requestLogger.loadLatestProxyRequestSnapshot.mockImplementation((target) => target === 'omp' ? ({
      request: { headers: { 'x-cli-version': 'from-omp-log' } },
      route: { providerApi: 'openai-responses', path: '/v1/responses' }
    }) : null);
  });
});
