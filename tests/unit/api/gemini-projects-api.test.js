const express = require('express');
const http = require('http');

let geminiSessionsService;
let isGeminiInstalledMock;

function buildApp(config = {}) {
  delete require.cache[require.resolve('../../../src/server/api/gemini-projects')];
  const createRouter = require('../../../src/server/api/gemini-projects');
  const app = express();
  app.use(express.json());
  app.use('/', createRouter(config));
  return app;
}

function request(app) {
  return {
    get(url) { return call(app, 'GET', url); },
    post(url, body) { return call(app, 'POST', url, body); },
    delete(url) { return call(app, 'DELETE', url); }
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
  geminiSessionsService = {
    getProjects: vi.fn(() => [{ name: 'hash-a' }]),
    saveProjectOrder: vi.fn(),
    deleteProject: vi.fn(() => ({ success: true }))
  };
  isGeminiInstalledMock = vi.fn(() => true);

  require.cache[require.resolve('../../../src/server/services/gemini-sessions')] = {
    id: require.resolve('../../../src/server/services/gemini-sessions'),
    filename: require.resolve('../../../src/server/services/gemini-sessions'),
    loaded: true,
    exports: geminiSessionsService
  };
  require.cache[require.resolve('../../../src/server/services/gemini-config')] = {
    id: require.resolve('../../../src/server/services/gemini-config'),
    filename: require.resolve('../../../src/server/services/gemini-config'),
    loaded: true,
    exports: { isGeminiInstalled: isGeminiInstalledMock }
  };
});

afterEach(() => {
  [
    '../../../src/server/api/gemini-projects',
    '../../../src/server/services/gemini-sessions',
    '../../../src/server/services/gemini-config'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('gemini-projects api', () => {
  test('GET / returns empty payload when Gemini is not installed', async () => {
    isGeminiInstalledMock.mockReturnValue(false);
    const res = await request(buildApp()).get('/');
    expect(res.body.error).toContain('Gemini CLI not installed');
  });

  test('GET / returns projects and currentProject', async () => {
    const res = await request(buildApp()).get('/');
    expect(res.body).toEqual({
      projects: [{ name: 'hash-a' }],
      currentProject: 'hash-a'
    });
  });

  test('POST /order validates input and DELETE delegates project removal', async () => {
    const app = buildApp();
    expect((await request(app).post('/order', { order: 'bad' })).status).toBe(400);
    expect((await request(app).post('/order', { order: ['hash-a'] })).status).toBe(200);
    expect(geminiSessionsService.saveProjectOrder).toHaveBeenCalledWith(['hash-a']);
    expect((await request(app).delete('/hash-a')).status).toBe(200);
    expect(geminiSessionsService.deleteProject).toHaveBeenCalledWith('hash-a');
  });
});
