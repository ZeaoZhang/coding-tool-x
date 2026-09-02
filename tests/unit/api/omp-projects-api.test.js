const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

let ompSessionsService;
const PATHS_PATH = require.resolve('../../../src/config/paths');
const SNAPSHOT_CACHE_PATH = require.resolve('../../../src/server/services/snapshot-cache');
const PROJECT_SNAPSHOTS_PATH = require.resolve('../../../src/server/services/project-snapshots');

function buildApp(config = {}) {
  delete require.cache[require.resolve('../../../src/platforms/drivers/omp/api-projects')];
  const createRouter = require('../../../src/platforms/drivers/omp/api-projects');
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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-projects-api-test-'));
  ompSessionsService = {
    getProjects: vi.fn(() => [{ name: 'repo-omp' }]),
    saveProjectOrder: vi.fn(),
    deleteProject: vi.fn(() => ({ success: true })),
    isOmpInstalled: vi.fn(() => true)
  };

  require.cache[require.resolve('../../../src/platforms/drivers/omp/sessions-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/omp/sessions-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/omp/sessions-implementation'),
    loaded: true,
    exports: ompSessionsService
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
    '../../../src/platforms/drivers/omp/api-projects',
    '../../../src/platforms/drivers/omp/sessions-implementation',
    '../../../src/config/paths',
    '../../../src/server/services/snapshot-cache',
    '../../../src/server/services/project-snapshots'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('omp-projects api', () => {
  test('GET / returns empty payload when OMP is not installed', async () => {
    ompSessionsService.isOmpInstalled.mockReturnValue(false);
    const res = await request(buildApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      projects: [],
      currentProject: null,
      error: 'OMP CLI not installed or not found'
    });
  });

  test('GET /?fresh=1 returns projects and currentProject', async () => {
    const res = await request(buildApp()).get('/?fresh=1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      projects: [{ name: 'repo-omp' }],
      currentProject: 'repo-omp'
    });
    expect(res.body.meta).toMatchObject({ stale: false, refreshing: false });
  });

  test('POST /order validates body and DELETE proxies project removal', async () => {
    const app = buildApp();
    const invalid = await request(app).post('/order', { order: 'bad' });
    const valid = await request(app).post('/order', { order: ['repo-omp'] });
    const deleted = await request(app).delete('/repo-omp');

    expect(invalid.status).toBe(400);
    expect(valid.status).toBe(200);
    expect(ompSessionsService.saveProjectOrder).toHaveBeenCalledWith(['repo-omp']);
    expect(deleted.status).toBe(200);
    expect(ompSessionsService.deleteProject).toHaveBeenCalledWith('repo-omp');
  });

  test('DELETE returns 404 for not found errors', async () => {
    ompSessionsService.deleteProject.mockImplementationOnce(() => {
      throw new Error('Project not found');
    });
    const res = await request(buildApp()).delete('/repo-omp');
    expect(res.status).toBe(404);
  });
});
