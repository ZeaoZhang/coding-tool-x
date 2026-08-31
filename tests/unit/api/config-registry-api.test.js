const express = require('express');
const http = require('http');

let registryService;
let syncManager;

function buildApp() {
  delete require.cache[require.resolve('../../../src/server/api/config-registry')];
  const router = require('../../../src/server/api/config-registry');
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

function request(app) {
  return {
    get(url) { return call(app, 'GET', url); },
    post(url, body) { return call(app, 'POST', url, body); },
    put(url, body) { return call(app, 'PUT', url, body); }
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
  registryService = {
    getStats: vi.fn(() => ({ skills: 2, commands: 1 })),
    listItems: vi.fn((type) => ({
      'demo-item': {
        enabled: true,
        platforms: { claude: true, codex: false, gemini: false, opencode: true, omp: true },
        type
      }
    })),
    importFromClaude: vi.fn(() => ({
      imported: 1,
      skipped: 0,
      items: ['demo-item']
    })),
    getItem: vi.fn((_type, name) => {
      if (name === 'missing-item') return null;
      return {
        enabled: true,
        platforms: { claude: true, codex: true, gemini: false, opencode: false, omp: true }
      };
    }),
    toggleEnabled: vi.fn((_type, _name, enabled) => ({
      enabled,
      platforms: { claude: true, codex: enabled, gemini: false, opencode: false, omp: enabled }
    })),
    togglePlatform: vi.fn((_type, _name, platform, enabled) => ({
      enabled: true,
      platforms: { claude: true, codex: platform === 'codex' ? enabled : false, gemini: false, opencode: false, omp: platform === 'omp' ? enabled : false }
    }))
  };

  syncManager = {
    syncToPlatform: vi.fn(),
    removeFromPlatform: vi.fn(),
    syncToClaude: vi.fn(),
    syncToCodex: vi.fn(),
    syncToGemini: vi.fn(),
    syncToOpenCode: vi.fn(),
    syncToOmp: vi.fn(),
    removeFromClaude: vi.fn(),
    removeFromCodex: vi.fn(),
    removeFromGemini: vi.fn(),
    removeFromOpenCode: vi.fn(),
    removeFromOmp: vi.fn(),
    syncAll: vi.fn(() => ({
      synced: ['demo-item'],
      removed: [],
      errors: [],
      warnings: ['warn']
    }))
  };

  const registryPath = require.resolve('../../../src/server/services/config-registry-service');
  function ConfigRegistryServiceMock() {
    return registryService;
  }
  require.cache[registryPath] = {
    id: registryPath,
    filename: registryPath,
    loaded: true,
    exports: {
      ConfigRegistryService: ConfigRegistryServiceMock,
      CONFIG_TYPES: ['skills', 'commands', 'agents', 'plugins'],
      SUPPORTED_PLATFORMS: ['claude', 'codex', 'gemini', 'opencode', 'omp']
    }
  };

  const syncManagerPath = require.resolve('../../../src/server/services/config-sync-manager');
  function ConfigSyncManagerMock() {
    return syncManager;
  }
  require.cache[syncManagerPath] = {
    id: syncManagerPath,
    filename: syncManagerPath,
    loaded: true,
    exports: {
      ConfigSyncManager: ConfigSyncManagerMock
    }
  };
});

afterEach(() => {
  [
    '../../../src/server/api/config-registry',
    '../../../src/server/services/config-registry-service',
    '../../../src/server/services/config-sync-manager'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('config-registry api stats and list routes', () => {
  test('returns registry stats and validates config types', async () => {
    const app = buildApp();

    const stats = await request(app).get('/stats');
    const invalidType = await request(app).get('/unknown');
    const list = await request(app).get('/skills');

    expect(stats.status).toBe(200);
    expect(stats.body.stats.skills).toBe(2);
    expect(invalidType.status).toBe(400);
    expect(list.status).toBe(200);
    expect(registryService.listItems).toHaveBeenCalledWith('skills');
  });
});

describe('config-registry api import and toggle routes', () => {
  test('imports from claude and syncs imported enabled claude items', async () => {
    const res = await request(buildApp()).post('/skills/import', {});

    expect(syncManager.syncToPlatform).toHaveBeenCalledWith('claude', 'skills', 'demo-item');
    expect(registryService.importFromClaude).toHaveBeenCalledWith('skills');
  });

  test('validates toggle enabled payload and handles missing items', async () => {
    const app = buildApp();

    const invalid = await request(app).put('/skills/demo-item/toggle', { enabled: 'yes' });
    const missing = await request(app).put('/skills/missing-item/toggle', { enabled: true });

    expect(invalid.status).toBe(400);
    expect(missing.status).toBe(404);
  });

  test('toggle enabled syncs or removes items across platforms', async () => {
    const app = buildApp();

    const enable = await request(app).put('/skills/demo-item/toggle', { enabled: true });
    const disable = await request(app).put('/skills/demo-item/toggle', { enabled: false });
    expect(syncManager.syncToPlatform).toHaveBeenCalledWith('claude', 'skills', 'demo-item');
    expect(syncManager.syncToPlatform).toHaveBeenCalledWith('codex', 'skills', 'demo-item');
    expect(syncManager.syncToPlatform).toHaveBeenCalledWith('omp', 'skills', 'demo-item');
    expect(disable.status).toBe(200);
    expect(syncManager.removeFromPlatform).toHaveBeenCalledWith('claude', 'skills', 'demo-item');
    expect(syncManager.removeFromPlatform).toHaveBeenCalledWith('codex', 'skills', 'demo-item');
    expect(syncManager.removeFromPlatform).toHaveBeenCalledWith('gemini', 'skills', 'demo-item');
    expect(syncManager.removeFromPlatform).toHaveBeenCalledWith('opencode', 'skills', 'demo-item');
    expect(syncManager.removeFromPlatform).toHaveBeenCalledWith('omp', 'skills', 'demo-item');
  });

  test('toggle platform validates input and syncs specific platforms', async () => {
    const app = buildApp();

    const invalidPlatform = await request(app).put('/skills/demo-item/platform/invalid', { enabled: true });
    const invalidBody = await request(app).put('/skills/demo-item/platform/codex', { enabled: 'yes' });
    const enable = await request(app).put('/skills/demo-item/platform/codex', { enabled: true });
    const disable = await request(app).put('/skills/demo-item/platform/codex', { enabled: false });

    expect(invalidPlatform.status).toBe(400);
    expect(syncManager.syncToPlatform).toHaveBeenCalledWith('codex', 'skills', 'demo-item');
    expect(disable.status).toBe(200);
    expect(syncManager.removeFromPlatform).toHaveBeenCalledWith('codex', 'skills', 'demo-item');
  });

  test('toggle platform syncs OMP through OMP-specific config path', async () => {
    const app = buildApp();

    const enable = await request(app).put('/skills/demo-item/platform/omp', { enabled: true });
    const disable = await request(app).put('/skills/demo-item/platform/omp', { enabled: false });
    expect(syncManager.syncToPlatform).toHaveBeenCalledWith('omp', 'skills', 'demo-item');
    expect(disable.status).toBe(200);
    expect(syncManager.removeFromPlatform).toHaveBeenCalledWith('omp', 'skills', 'demo-item');
  });

  test('syncs all registry items for a type', async () => {
    const res = await request(buildApp()).post('/skills/sync', {});

    expect(res.status).toBe(200);
    expect(syncManager.syncAll).toHaveBeenCalledWith('skills', {
      'demo-item': {
        enabled: true,
        platforms: { claude: true, codex: false, gemini: false, opencode: true, omp: true },
        type: 'skills'
      }
    });
    expect(res.body.synced).toBe(1);
    expect(res.body.warnings).toEqual(['warn']);
  });
});
