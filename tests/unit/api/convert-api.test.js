const express = require('express');
const http = require('http');

let sessionConverter;
let gatewayConverter;

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
    get(url) { return call(app, 'GET', url); },
    post(url, body) { return call(app, 'POST', url, body); }
  };
}

function call(app, method, url, body) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const rawBody = body ? JSON.stringify(body) : null;
      const req = http.request({
        hostname: '127.0.0.1',
        port: server.address().port,
        path: url,
        method,
        headers: rawBody ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(rawBody)
        } : {}
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
  sessionConverter = {
    convertSession: vi.fn(async (_sourceType, _targetType, sessionId, options) => ({
      success: true,
      sessionId,
      options
    })),
    previewConversion: vi.fn(async (sourceType, sessionId) => ({
      sourceType,
      sessionId,
      messages: 3
    }))
  };
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

  require.cache[require.resolve('../../../src/server/services/session-converter')] = {
    id: require.resolve('../../../src/server/services/session-converter'),
    filename: require.resolve('../../../src/server/services/session-converter'),
    loaded: true,
    exports: sessionConverter
  };
  require.cache[require.resolve('../../../src/platforms/drivers/opencode/gateway-converter')] = {
    id: require.resolve('../../../src/platforms/drivers/opencode/gateway-converter'),
    filename: require.resolve('../../../src/platforms/drivers/opencode/gateway-converter'),
    loaded: true,
    exports: gatewayConverter
  };
});

afterEach(() => {
  [
    '../../../src/server/api/convert',
    '../../../src/server/services/session-converter',
    '../../../src/platforms/drivers/opencode/gateway-converter'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('convert api', () => {
  test('returns supported formats and opencode gateway metadata', async () => {
    const app = buildApp();
    expect((await request(app).get('/formats')).body.formats).toHaveLength(3);
    expect((await request(app).get('/opencode/formats')).body).toEqual(expect.objectContaining({
      sourceTypes: [
        { id: 'claude', name: 'Claude Code' },
        { id: 'codex', name: 'Codex' },
        { id: 'gemini', name: 'Gemini' }
      ],
      targetApis: ['responses', 'chat.completions']
    }));
  });

  test('source-specific OpenCode routes validate payload and delegate to converters', async () => {
    const app = buildApp();
    expect((await request(app).post('/opencode/claude', {})).status).toBe(400);
    expect((await request(app).post('/opencode/claude', { payload: { a: 1 } })).body.converted).toBe('claude');
    expect((await request(app).post('/opencode/codex', { payload: { b: 2 } })).body.converted).toBe('codex');
    expect((await request(app).post('/opencode/gemini', { payload: { c: 3 } })).body.converted).toBe('gemini');
  });

  test('generic OpenCode route validates sourceType and delegates to gateway converter', async () => {
    const app = buildApp();
    expect((await request(app).post('/opencode', { payload: { a: 1 } })).status).toBe(400);
    expect((await request(app).post('/opencode', { sourceType: 'unknown', payload: { a: 1 } })).status).toBe(400);

    const res = await request(app).post('/opencode', {
      sourceType: ' Claude ',
      payload: { prompt: 'hello' },
      options: { api: 'responses' }
    });

    expect(res.status).toBe(200);
    expect(gatewayConverter.convertToOpenCodePayload).toHaveBeenCalledWith({
      sourceType: 'claude',
      payload: { prompt: 'hello' },
      options: { api: 'responses' }
    });
  });

  test('preview and convert routes validate parameters and delegate to services', async () => {
    const app = buildApp();
    expect((await request(app).post('/preview', { sourceType: 'claude' })).status).toBe(400);
    expect((await request(app).post('/', { sourceType: 'claude', targetType: 'claude', sessionId: 's1' })).status).toBe(400);
    expect((await request(app).post('/', { sourceType: 'bad', targetType: 'codex', sessionId: 's1' })).status).toBe(400);

    const preview = await request(app).post('/preview', {
      sourceType: 'claude',
      sessionId: 'session-1'
    });
    const converted = await request(app).post('/', {
      sourceType: 'claude',
      targetType: 'codex',
      sessionId: 'session-1',
      options: { includeMeta: true }
    });

    expect(preview.body).toEqual({
      success: true,
      preview: {
        sourceType: 'claude',
        sessionId: 'session-1',
        messages: 3
      }
    });
    expect(converted.body).toEqual({
      success: true,
      sessionId: 'session-1',
      options: { includeMeta: true }
    });
  });
});
