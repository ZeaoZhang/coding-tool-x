const express = require('express');
const http = require('http');

let promptsService;

beforeEach(() => {
  promptsService = {
    getAllPresets: vi.fn(() => ({ presets: [{ id: 'default', name: 'Default' }] })),
    getActivePreset: vi.fn(() => ({ preset: { id: 'default', name: 'Default' } })),
    getPreset: vi.fn((id) => (id === 'default' ? { id, name: 'Default' } : null)),
    savePreset: vi.fn((preset) => preset),
    deletePreset: vi.fn((id) => id === 'default'),
    activatePreset: vi.fn(async (id) => ({ id, name: 'Default' })),
    deactivatePrompt: vi.fn(async () => ({ removed: 4 })),
    getPlatformStatus: vi.fn(() => ({ claude: true, codex: false })),
    readPlatformPrompt: vi.fn((platform) => `${platform} prompt`),
    importFromPlatform: vi.fn((platform, name) => ({ id: `${platform}-${name}`, name })),
    getStats: vi.fn(() => ({ totalPresets: 1, activePlatforms: 1 }))
  };

  const servicePath = require.resolve('../../../src/server/services/prompts-service');
  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: promptsService
  };

  delete require.cache[require.resolve('../../../src/server/api/prompts')];
});

afterEach(() => {
  delete require.cache[require.resolve('../../../src/server/api/prompts')];
  delete require.cache[require.resolve('../../../src/server/services/prompts-service')];
});

function buildApp() {
  const router = require('../../../src/server/api/prompts');
  const app = express();
  app.use(express.json());
  app.use('/', router);
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
      const port = server.address().port;
      const rawBody = body ? JSON.stringify(body) : null;
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: url,
        method,
        headers: {
          ...(rawBody ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(rawBody)
          } : {})
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
      req.on('error', (error) => {
        server.close();
        reject(error);
      });
      if (rawBody) req.write(rawBody);
      req.end();
    });
  });
}

function stubPlatformRegistry(definitions) {
  const runtime = require('../../../src/platforms/runtime');
  const byKey = new Map(definitions.map(definition => [definition.key, definition]));
  const registry = {
    list: () => definitions,
    resolve: key => byKey.get(String(key).trim().toLowerCase()) || null,
    getCapability: (key, capability) => byKey.get(String(key).trim().toLowerCase())?.capabilities?.[capability] || null
  };
  const registrySpy = vi.spyOn(runtime, 'getPlatformRegistry').mockReturnValue(registry);
  return () => registrySpy.mockRestore();
}

describe('prompts api preset routes', () => {
  test('lists presets and active preset', async () => {
    const app = buildApp();
    const presetsRes = await request(app).get('/presets');
    const activeRes = await request(app).get('/presets/active');

    expect(presetsRes.status).toBe(200);
    expect(presetsRes.body.success).toBe(true);
    expect(activeRes.status).toBe(200);
    expect(activeRes.body.success).toBe(true);
  });

  test('returns 404 for missing preset', async () => {
    const res = await request(buildApp()).get('/presets/missing');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('validates preset id and name when saving', async () => {
    const missingId = await request(buildApp()).post('/presets', { name: 'Preset' });
    const missingName = await request(buildApp()).post('/presets', { id: 'preset-1' });

    expect(missingId.status).toBe(400);
    expect(missingName.status).toBe(400);
  });

  test('saves, activates and deletes presets', async () => {
    const app = buildApp();
    const saveRes = await request(app).post('/presets', { id: 'default', name: 'Default' });
    const activateRes = await request(app).post('/presets/default/activate', {});
    const deleteRes = await request(app).delete('/presets/default');

    expect(saveRes.status).toBe(200);
    expect(saveRes.body.success).toBe(true);
    expect(activateRes.status).toBe(200);
    expect(activateRes.body.success).toBe(true);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);
  });
});

describe('prompts api platform routes', () => {
  test('deactivates prompts and returns platform status', async () => {
    const app = buildApp();
    const deactivateRes = await request(app).post('/deactivate', {});
    const statusRes = await request(app).get('/platform-status');

    expect(deactivateRes.status).toBe(200);
    expect(deactivateRes.body.success).toBe(true);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.success).toBe(true);
  });

  test('returns typed not-found responses for unknown platform reads/imports', async () => {
    const readRes = await request(buildApp()).get('/platform/invalid');
    const importRes = await request(buildApp()).post('/import/invalid', { name: 'Preset' });

    expect(readRes.status).toBe(404);
    expect(readRes.body.code).toBe('not_found');
    expect(importRes.status).toBe(404);
    expect(importRes.body.code).toBe('not_found');
  });

  test('reads and imports a registered generic prompt platform', async () => {
    const restore = stubPlatformRegistry([
      { key: 'demo-cli', capabilities: { prompts: 'generic-prompt' } }
    ]);

    try {
      const app = buildApp();
      const readRes = await request(app).get('/platform/demo-cli');
      const importRes = await request(app).post('/import/demo-cli', { name: 'Demo' });

      expect(readRes.status).toBe(200);
      expect(readRes.body.platform).toBe('demo-cli');
      expect(importRes.status).toBe(200);
      expect(promptsService.readPlatformPrompt).toHaveBeenCalledWith('demo-cli');
      expect(promptsService.importFromPlatform).toHaveBeenCalledWith('demo-cli', 'Demo');
    } finally {
      restore();
    }
  });

  test('returns typed unsupported response for a registered non-prompt platform', async () => {
    const restore = stubPlatformRegistry([
      { key: 'mcp-only', capabilities: { mcp: 'generic-mcp' } }
    ]);

    try {
      const res = await request(buildApp()).get('/platform/mcp-only');

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('unsupported');
      expect(res.body.platform).toBe('mcp-only');
    } finally {
      restore();
    }
  });

  test('reads platform prompt, imports preset, and returns stats', async () => {
    const app = buildApp();
    const readRes = await request(app).get('/platform/claude');
    const importRes = await request(app).post('/import/claude', { name: 'Imported' });
    const statsRes = await request(app).get('/stats');

    expect(readRes.status).toBe(200);
    expect(readRes.body.content).toBe('claude prompt');
    expect(importRes.status).toBe(200);
    expect(importRes.body.success).toBe(true);
    expect(statsRes.status).toBe(200);
    expect(statsRes.body.stats.totalPresets).toBe(1);
  });
});
