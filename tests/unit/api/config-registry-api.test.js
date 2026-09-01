const express = require('express');
const http = require('http');

let mockService;
let registryService;
let syncManager;
let controlService;

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
        controlKey: `skill:claude:user:user:${name}`,
        platforms: { claude: true, codex: true, gemini: false, opencode: false, omp: true }
      };
    }),
    toggleEnabled: vi.fn((_type, _name, enabled) => ({
      enabled,
      platforms: { claude: true, codex: enabled, gemini: false, opencode: false, omp: enabled }
    })),
    togglePlatform: vi.fn((_type, _name, platform, enabled) => ({
      enabled: true,
      platforms: { claude: true, codex: platform === 'codex' ? enabled : false, gemini: false, opencode: false, omp: platform === 'omp' ? enabled : false, 'demo-cli': platform === 'demo-cli' ? enabled : false }
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

  const runtimePath = require.resolve('../../../src/platforms/runtime');
  const platformRegistry = {
    list: vi.fn((options = {}) => {
      const builtIns = [
        { key: 'claude' },
        { key: 'codex' },
        { key: 'gemini' },
        { key: 'opencode' },
        { key: 'omp' }
      ];

      if (options.enabledOnly) {
        return builtIns;
      }

      return [...builtIns, { key: 'demo-cli', enabled: false }];
    })
  };
  require.cache[runtimePath] = {
    id: runtimePath,
    filename: runtimePath,
    loaded: true,
    exports: {
      getPlatformRegistry: () => platformRegistry
    }
  };

  const projectionPath = require.resolve('../../../src/server/services/skill-projection-service');
  function SkillProjectionServiceMock() {}
  require.cache[projectionPath] = {
    id: projectionPath,
    filename: projectionPath,
    loaded: true,
    exports: { SkillProjectionService: SkillProjectionServiceMock }
  };

  controlService = {
    setSkillEnabled: vi.fn(({ controlKey, enabled, platform, scope }) => ({
      controlKey,
      enabled,
      platform,
      scope,
      artifact: { state: 'ready' }
    }))
  };
  const controlServicePath = require.resolve('../../../src/server/services/effective-control-service');
  function EffectiveControlServiceMock() {
    return controlService;
  }
  require.cache[controlServicePath] = {
    id: controlServicePath,
    filename: controlServicePath,
    loaded: true,
    exports: { EffectiveControlService: EffectiveControlServiceMock }
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
    '../../../src/server/services/config-sync-manager',
    '../../../src/platforms/runtime',
    '../../../src/server/services/effective-control-service',
    '../../../src/server/services/skill-projection-service'
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

  test('rejects reserved registry names before lookup', async () => {
    const app = buildApp();

    const enabled = await request(app).put('/commands/__proto__/toggle', { enabled: true });
    const platform = await request(app).put('/commands/constructor/platform/claude', { enabled: true });

    expect(enabled.status).toBe(400);
    expect(platform.status).toBe(400);
    expect(registryService.getItem).not.toHaveBeenCalledWith('commands', '__proto__');
  });

  test('toggle enabled syncs or removes non-Skill items across platforms', async () => {
    const app = buildApp();

    const enable = await request(app).put('/commands/demo-item/toggle', { enabled: true });
    const disable = await request(app).put('/commands/demo-item/toggle', { enabled: false });

    expect(enable.status).toBe(200);
    expect(syncManager.syncToPlatform).toHaveBeenCalledWith('claude', 'commands', 'demo-item');
    expect(syncManager.syncToPlatform).toHaveBeenCalledWith('codex', 'commands', 'demo-item');
    expect(syncManager.syncToPlatform).toHaveBeenCalledWith('omp', 'commands', 'demo-item');
    expect(disable.status).toBe(200);
    expect(syncManager.removeFromPlatform).toHaveBeenCalledWith('claude', 'commands', 'demo-item');
    expect(syncManager.removeFromPlatform).toHaveBeenCalledWith('codex', 'commands', 'demo-item');
    expect(syncManager.removeFromPlatform).toHaveBeenCalledWith('omp', 'commands', 'demo-item');
  });

  test('toggle platform syncs non-Skill OMP resources through OMP-specific path', async () => {
    const app = buildApp();

    const enable = await request(app).put('/commands/demo-item/platform/omp', { enabled: true });
    const disable = await request(app).put('/commands/demo-item/platform/omp', { enabled: false });

    expect(enable.status).toBe(200);
    expect(syncManager.syncToPlatform).toHaveBeenCalledWith('omp', 'commands', 'demo-item');
    expect(disable.status).toBe(200);
    expect(syncManager.removeFromPlatform).toHaveBeenCalledWith('omp', 'commands', 'demo-item');
  });

  test('validates disabled registry platforms for non-Skill resources', async () => {
    const app = buildApp();

    const enable = await request(app).put('/commands/demo-item/platform/demo-cli', { enabled: true });
    const disable = await request(app).put('/commands/demo-item/platform/demo-cli', { enabled: false });

    expect(enable.status).toBe(200);
    expect(disable.status).toBe(200);
    expect(syncManager.syncToPlatform).toHaveBeenCalledWith('demo-cli', 'commands', 'demo-item');
    expect(syncManager.removeFromPlatform).toHaveBeenCalledWith('demo-cli', 'commands', 'demo-item');
  });


  test('syncs all non-Skill registry items for a type', async () => {
    const res = await request(buildApp()).post('/commands/sync', {});

    expect(res.status).toBe(200);
    expect(syncManager.syncAll).toHaveBeenCalledWith('commands', {
      'demo-item': {
        enabled: true,
        platforms: { claude: true, codex: false, gemini: false, opencode: true, omp: true },
        type: 'commands'
      }
    });
    expect(res.body.synced).toBe(1);
    expect(res.body.warnings).toEqual(['warn']);
  });

  test('delegates Skill toggle to the effective control service without syncing or deleting', async () => {
    const app = buildApp();
    const res = await request(app).put('/skills/demo-item/toggle', {
      enabled: false,
      platform: 'claude',
      scope: 'user'
    });

    expect(res.status).toBe(200);
    expect(controlService.setSkillEnabled).toHaveBeenCalledWith(expect.objectContaining({
      controlKey: 'skill:claude:user:user:demo-item',
      platform: 'claude',
      scope: 'user',
      enabled: false
    }));
    expect(syncManager.removeFromClaude).not.toHaveBeenCalled();
  });
});
