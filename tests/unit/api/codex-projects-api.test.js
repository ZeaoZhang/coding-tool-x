const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

let codexSessionsService;
let isCodexInstalledMock;
const PATHS_PATH = require.resolve('../../../src/config/paths');
const SNAPSHOT_CACHE_PATH = require.resolve('../../../src/server/services/snapshot-cache');
const PROJECT_SNAPSHOTS_PATH = require.resolve('../../../src/server/services/project-snapshots');

function buildApp(config = {}) {
  delete require.cache[require.resolve('../../../src/platforms/drivers/codex/api-projects')];
  const createRouter = require('../../../src/platforms/drivers/codex/api-projects');
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

      req.on('error', (error) => {
        server.close();
        reject(error);
      });

      if (rawBody) req.write(rawBody);
      req.end();
    });
  });
}

beforeEach(() => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-projects-api-test-'));
  codexSessionsService = {
    getProjects: vi.fn(() => [{ name: 'repo-a' }, { name: 'repo-b' }]),
    saveProjectOrder: vi.fn(),
    deleteProject: vi.fn(() => ({ success: true }))
  };
  isCodexInstalledMock = vi.fn(() => true);

  require.cache[require.resolve('../../../src/platforms/drivers/codex/sessions-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/codex/sessions-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/codex/sessions-implementation'),
    loaded: true,
    exports: codexSessionsService
  };
  require.cache[require.resolve('../../../src/platforms/drivers/codex/config')] = {
    id: require.resolve('../../../src/platforms/drivers/codex/config'),
    filename: require.resolve('../../../src/platforms/drivers/codex/config'),
    loaded: true,
    exports: {
      isCodexInstalled: isCodexInstalledMock
    }
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
    '../../../src/platforms/drivers/codex/api-projects',
    '../../../src/platforms/drivers/codex/sessions-implementation',
    '../../../src/platforms/drivers/codex/config',
    '../../../src/config/paths',
    '../../../src/server/services/snapshot-cache',
    '../../../src/server/services/project-snapshots'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('codex-projects api', () => {
  test('GET / returns empty payload when Codex is not installed', async () => {
    isCodexInstalledMock.mockReturnValue(false);

    const res = await request(buildApp()).get('/');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      projects: [],
      currentProject: null,
      error: 'Codex CLI not installed or not found'
    });
  });

  test('GET /?fresh=1 returns projects and currentProject', async () => {
    const res = await request(buildApp()).get('/?fresh=1');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      projects: [{ name: 'repo-a' }, { name: 'repo-b' }],
      currentProject: 'repo-a'
    });
    expect(res.body.meta).toMatchObject({ stale: false, refreshing: false });
  });

  test('POST /order validates body and DELETE proxies project removal', async () => {
    const app = buildApp();

    const invalid = await request(app).post('/order', { order: 'bad' });
    const valid = await request(app).post('/order', { order: ['repo-b', 'repo-a'] });
    const deleted = await request(app).delete('/repo-a');

    expect(invalid.status).toBe(400);
    expect(valid.status).toBe(200);
    expect(codexSessionsService.saveProjectOrder).toHaveBeenCalledWith(['repo-b', 'repo-a']);
    expect(deleted.status).toBe(200);
    expect(codexSessionsService.deleteProject).toHaveBeenCalledWith('repo-a');
  });
});
