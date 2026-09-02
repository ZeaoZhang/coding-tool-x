const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

let geminiSessionsService;
let isGeminiInstalledMock;
const PATHS_PATH = require.resolve('../../../src/config/paths');
const SNAPSHOT_CACHE_PATH = require.resolve('../../../src/server/services/snapshot-cache');
const PROJECT_SNAPSHOTS_PATH = require.resolve('../../../src/server/services/project-snapshots');

function buildApp(config = {}) {
  delete require.cache[require.resolve('../../../src/platforms/drivers/gemini/api-projects')];
  const createRouter = require('../../../src/platforms/drivers/gemini/api-projects');
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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-projects-api-test-'));
  geminiSessionsService = {
    getProjects: vi.fn(() => [{ name: 'hash-a' }]),
    saveProjectOrder: vi.fn(),
    deleteProject: vi.fn(() => ({ success: true }))
  };
  isGeminiInstalledMock = vi.fn(() => true);

  require.cache[require.resolve('../../../src/platforms/drivers/gemini/sessions-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/gemini/sessions-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/gemini/sessions-implementation'),
    loaded: true,
    exports: geminiSessionsService
  };
  require.cache[require.resolve('../../../src/platforms/drivers/gemini/config')] = {
    id: require.resolve('../../../src/platforms/drivers/gemini/config'),
    filename: require.resolve('../../../src/platforms/drivers/gemini/config'),
    loaded: true,
    exports: { isGeminiInstalled: isGeminiInstalledMock }
  };
  require.cache[PATHS_PATH] = {
    id: PATHS_PATH,
    filename: PATHS_PATH,
    loaded: true,
    exports: {
      PATHS: {
        storage: tempDir,
        cache: path.join(tempDir, 'cache'),
        snapshotCache: path.join(tempDir, 'cache', 'snapshots')
      }
    }
  };
});

afterEach(() => {
  [
    '../../../src/platforms/drivers/gemini/api-projects',
    '../../../src/platforms/drivers/gemini/sessions-implementation',
    '../../../src/platforms/drivers/gemini/config',
    '../../../src/config/paths',
    '../../../src/server/services/snapshot-cache',
    '../../../src/server/services/project-snapshots'
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

  test('GET /?fresh=1 returns projects and currentProject', async () => {
    const res = await request(buildApp()).get('/?fresh=1');
    expect(res.body).toMatchObject({
      projects: [{ name: 'hash-a' }],
      currentProject: 'hash-a'
    });
    expect(res.body.meta).toMatchObject({ stale: false, refreshing: false });
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
