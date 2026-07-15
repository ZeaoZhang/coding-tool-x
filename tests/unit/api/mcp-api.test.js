const express = require('express');
const http = require('http');

let mockService;

beforeEach(() => {
  mockService = {
    getAllServers: vi.fn(() => ({
      fetch: { id: 'fetch', name: 'Fetch', server: { type: 'stdio', command: 'uvx' } }
    })),
    getServer: vi.fn((id) => (id === 'fetch'
      ? { id: 'fetch', name: 'Fetch', server: { type: 'stdio', command: 'uvx' } }
      : null)),
    saveServer: vi.fn(async (server) => server),
    deleteServer: vi.fn(async () => true),
    toggleServerApp: vi.fn(async (id, app, enabled) => ({ id, apps: { [app]: enabled } })),
    getPresets: vi.fn(() => [{ id: 'fetch', name: 'Fetch' }]),
    importFromPlatform: vi.fn(async () => 2),
    getStats: vi.fn(() => ({ total: 1, claude: 1, codex: 0, gemini: 0, opencode: 0, omp: 0 })),
    testServer: vi.fn(async () => ({ success: true, message: 'ok' })),
    updateServerStatus: vi.fn(async () => ({ success: true })),
    updateServerOrder: vi.fn((serverIds) => ({ fetch: { order: serverIds.indexOf('fetch') } })),
    exportServers: vi.fn((format) => ({
      format,
      filename: `mcp.${format === 'codex' ? 'toml' : 'json'}`,
      content: format === 'codex' ? 'mcpServers = {}' : '{"mcpServers":{}}'
    })),
    getServerTools: vi.fn(async () => ({ status: 'online', duration: 10, tools: [{ name: 'fetch' }] })),
    callServerTool: vi.fn(async () => ({ result: { ok: true }, duration: 12, isError: false }))
  };

  const servicePath = require.resolve('../../../src/server/services/mcp-service');
  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: mockService
  };

  delete require.cache[require.resolve('../../../src/server/api/mcp')];
});

afterEach(() => {
  delete require.cache[require.resolve('../../../src/server/api/mcp')];
  delete require.cache[require.resolve('../../../src/server/services/mcp-service')];
});

function buildApp() {
  const router = require('../../../src/server/api/mcp');
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
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: data ? JSON.parse(data) : null,
              text: data
            });
          } catch {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: data,
              text: data
            });
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

describe('GET /servers', () => {
  test('returns all configured servers', async () => {
    const res = await request(buildApp()).get('/servers');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.servers.fetch.name).toBe('Fetch');
    expect(mockService.getAllServers).toHaveBeenCalled();
  });
});

describe('GET /servers/:id', () => {
  test('returns 404 when server does not exist', async () => {
    const res = await request(buildApp()).get('/servers/missing');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /servers', () => {
  test('validates missing id', async () => {
    const res = await request(buildApp()).post('/servers', { server: { type: 'stdio', command: 'uvx' } });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('saves a server successfully', async () => {
    const payload = { id: 'fetch', name: 'Fetch', server: { type: 'stdio', command: 'uvx' } };
    const res = await request(buildApp()).post('/servers', payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockService.saveServer).toHaveBeenCalledWith(payload);
  });

  test('saves streamable_http server configs pasted from standard MCP JSON', async () => {
    const payload = {
      id: 'finData',
      name: 'finData',
      server: {
        type: 'streamable_http',
        url: 'https://mcp.api-inference.modelscope.net/ee05eeb4aa204c/mcp'
      }
    };

    const res = await request(buildApp()).post('/servers', payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockService.saveServer).toHaveBeenCalledWith(payload);
  });
});

describe('DELETE /servers/:id', () => {
  test('returns 404 when delete reports false', async () => {
    mockService.deleteServer.mockResolvedValue(false);
    const res = await request(buildApp()).delete('/servers/fetch');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /servers/:id/toggle', () => {
  test('validates missing app', async () => {
    const res = await request(buildApp()).post('/servers/fetch/toggle', { enabled: true });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('validates enabled must be boolean', async () => {
    const res = await request(buildApp()).post('/servers/fetch/toggle', { app: 'claude', enabled: 'yes' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('toggles platform state successfully', async () => {
    const res = await request(buildApp()).post('/servers/fetch/toggle', { app: 'codex', enabled: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockService.toggleServerApp).toHaveBeenCalledWith('fetch', 'codex', true);
  });

  test('accepts OMP platform toggles', async () => {
    const res = await request(buildApp()).post('/servers/fetch/toggle', { app: 'omp', enabled: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockService.toggleServerApp).toHaveBeenCalledWith('fetch', 'omp', true);
  });
});

describe('GET /presets and POST /import/:platform', () => {
  test('returns presets', async () => {
    const res = await request(buildApp()).get('/presets');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.presets).toHaveLength(1);
  });

  test('rejects invalid import platform', async () => {
    const res = await request(buildApp()).post('/import/invalid', {});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('imports valid platform and returns count', async () => {
    const res = await request(buildApp()).post('/import/codex', {});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.imported).toBe(2);
  });

  test('imports OMP platform configs', async () => {
    const res = await request(buildApp()).post('/import/omp', {});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockService.importFromPlatform).toHaveBeenCalledWith('omp');
  });
});

describe('GET /stats', () => {
  test('returns stats payload', async () => {
    const res = await request(buildApp()).get('/stats');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.stats.total).toBe(1);
  });
});

describe('POST /servers/:id/test', () => {
  test('updates status to online after successful test', async () => {
    mockService.testServer.mockResolvedValue({ success: true, message: 'ok' });
    const res = await request(buildApp()).post('/servers/fetch/test', {});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockService.updateServerStatus).toHaveBeenCalledWith('fetch', 'online');
  });

  test('returns hint when test throws', async () => {
    const error = new Error('missing');
    error.data = { hint: { title: 'Install uvx' } };
    mockService.testServer.mockRejectedValue(error);

    const res = await request(buildApp()).post('/servers/fetch/test', {});

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.hint).toEqual({ title: 'Install uvx' });
  });
});

describe('POST /servers/order', () => {
  test('validates serverIds array', async () => {
    const res = await request(buildApp()).post('/servers/order', { serverIds: 'fetch' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('updates server order', async () => {
    const res = await request(buildApp()).post('/servers/order', { serverIds: ['fetch'] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockService.updateServerOrder).toHaveBeenCalledWith(['fetch']);
  });
});

describe('GET /export and /export/download', () => {
  test('rejects invalid export format', async () => {
    const res = await request(buildApp()).get('/export?format=xml');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('returns export payload for valid format', async () => {
    const res = await request(buildApp()).get('/export?format=json');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockService.exportServers).toHaveBeenCalledWith('json');
  });

  test('returns export payload for Gemini and OMP formats', async () => {
    const app = buildApp();
    const geminiRes = await request(app).get('/export?format=gemini');
    const ompRes = await request(app).get('/export?format=omp');

    expect(geminiRes.status).toBe(200);
    expect(ompRes.status).toBe(200);
    expect(mockService.exportServers).toHaveBeenCalledWith('gemini');
    expect(mockService.exportServers).toHaveBeenCalledWith('omp');
  });

  test('download returns codex content with toml content-type', async () => {
    const res = await request(buildApp()).get('/export/download?format=codex');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/toml/);
    expect(res.headers['content-disposition']).toContain('mcp.toml');
    expect(res.text).toBe('mcpServers = {}');
  });
});

describe('tool routes', () => {
  test('GET /servers/:id/tools returns 502 when service status is error', async () => {
    mockService.getServerTools.mockResolvedValue({
      status: 'error',
      error: 'failed to fetch',
      hint: { title: 'Install tool' },
      duration: 22
    });

    const res = await request(buildApp()).get('/servers/fetch/tools');

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.tools).toEqual([]);
  });

  test('POST /servers/:id/tools/test validates toolName', async () => {
    const res = await request(buildApp()).post('/servers/fetch/tools/test', {});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('POST /servers/:id/tools/test calls service', async () => {
    const res = await request(buildApp()).post('/servers/fetch/tools/test', {
      toolName: 'fetch',
      arguments: { url: 'https://example.com' }
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockService.callServerTool).toHaveBeenCalledWith('fetch', 'fetch', { url: 'https://example.com' });
  });

  test('GET /servers/:id/info returns server info and tools', async () => {
    const res = await request(buildApp()).get('/servers/fetch/info');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.serverInfo.name).toBe('Fetch');
    expect(Array.isArray(res.body.tools)).toBe(true);
  });
});
