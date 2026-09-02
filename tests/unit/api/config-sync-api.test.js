const express = require('express');
const http = require('http');

let configSyncService;

function buildApp() {
  delete require.cache[require.resolve('../../../src/server/api/config-sync')];
  const router = require('../../../src/server/api/config-sync');
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
  configSyncService = {
    getAvailableConfigs: vi.fn(() => ({ skills: ['one'], commands: [] })),
    getStats: vi.fn(() => ({ global: 2, workspace: 1 })),
    previewSync: vi.fn(() => ({ copy: 3, skip: 1 })),
    executeSync: vi.fn(() => ({ copied: 3, skipped: 0 }))
  };

  const servicePath = require.resolve('../../../src/platforms/drivers/claude/config-sync');
  function ConfigSyncServiceMock() {
    return configSyncService;
  }
  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: {
      ConfigSyncService: ConfigSyncServiceMock
    }
  };
});

afterEach(() => {
  [
    '../../../src/server/api/config-sync',
    '../../../src/platforms/drivers/claude/config-sync'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('config-sync api routes', () => {
  test('validates workspace source when projectPath is missing and returns available configs', async () => {
    const app = buildApp();

    const missingProject = await request(app).get('/available?source=workspace');
    const ok = await request(app).get('/available?source=global');

    expect(missingProject.status).toBe(400);
    expect(ok.status).toBe(200);
    expect(configSyncService.getAvailableConfigs).toHaveBeenCalledWith('global', undefined);
  });

  test('returns sync stats', async () => {
    const res = await request(buildApp()).get('/stats?projectPath=/tmp/demo');

    expect(res.status).toBe(200);
    expect(configSyncService.getStats).toHaveBeenCalledWith('/tmp/demo');
  });

  test('validates preview request payload', async () => {
    const app = buildApp();

    const missingEndpoints = await request(app).post('/preview', { configTypes: ['skills'] });
    const missingTypes = await request(app).post('/preview', { source: 'global', target: 'workspace', configTypes: [] });

    expect(missingEndpoints.status).toBe(400);
    expect(missingTypes.status).toBe(400);
  });

  test('previews and executes sync with overwrite flag', async () => {
    const app = buildApp();
    const payload = {
      source: 'global',
      target: 'workspace',
      configTypes: ['skills', 'commands'],
      projectPath: '/tmp/demo',
      selectedItems: { skills: ['one'] }
    };

    const preview = await request(app).post('/preview', payload);
    const execute = await request(app).post('/execute', { ...payload, overwrite: true });

    expect(preview.status).toBe(200);
    expect(configSyncService.previewSync).toHaveBeenCalledWith(payload);
    expect(execute.status).toBe(200);
    expect(configSyncService.executeSync).toHaveBeenCalledWith({ ...payload, overwrite: true });
  });
});
