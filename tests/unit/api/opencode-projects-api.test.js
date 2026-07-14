const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

let opencodeSessionsService;
const PATHS_PATH = require.resolve('../../../src/config/paths');
const SNAPSHOT_CACHE_PATH = require.resolve('../../../src/server/services/snapshot-cache');
const PROJECT_SNAPSHOTS_PATH = require.resolve('../../../src/server/services/project-snapshots');

function buildApp(config = {}) {
  delete require.cache[require.resolve('../../../src/server/api/opencode-projects')];
  const createRouter = require('../../../src/server/api/opencode-projects');
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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-projects-api-test-'));
  opencodeSessionsService = {
    getProjects: vi.fn(() => [{ name: 'repo-open' }]),
    saveProjectOrder: vi.fn(),
    deleteProject: vi.fn(() => ({ success: true })),
    isOpenCodeInstalled: vi.fn(() => true)
  };

  require.cache[require.resolve('../../../src/server/services/opencode-sessions')] = {
    id: require.resolve('../../../src/server/services/opencode-sessions'),
    filename: require.resolve('../../../src/server/services/opencode-sessions'),
    loaded: true,
    exports: opencodeSessionsService
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
    '../../../src/server/api/opencode-projects',
    '../../../src/server/services/opencode-sessions',
    '../../../src/config/paths',
    '../../../src/server/services/snapshot-cache',
    '../../../src/server/services/project-snapshots'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('opencode-projects api', () => {
  test('GET / returns empty payload when OpenCode is not installed', async () => {
    opencodeSessionsService.isOpenCodeInstalled.mockReturnValue(false);
    const res = await request(buildApp()).get('/');
    expect(res.body.error).toContain('OpenCode CLI not installed');
  });

  test('GET /?fresh=1 returns projects and currentProject', async () => {
    const res = await request(buildApp()).get('/?fresh=1');
    expect(res.body).toMatchObject({
      projects: [{ name: 'repo-open' }],
      currentProject: 'repo-open'
    });
    expect(res.body.meta).toMatchObject({ stale: false, refreshing: false });
  });

  test('POST /order validates array and DELETE returns 404 for not found errors', async () => {
    const app = buildApp();
    expect((await request(app).post('/order', { order: 'bad' })).status).toBe(400);
    expect((await request(app).post('/order', { order: ['repo-open'] })).status).toBe(200);
    expect(opencodeSessionsService.saveProjectOrder).toHaveBeenCalledWith(['repo-open']);

    opencodeSessionsService.deleteProject.mockImplementationOnce(() => {
      throw new Error('Project not found');
    });
    expect((await request(app).delete('/repo-open')).status).toBe(404);
  });
});
