const express = require('express');
const http = require('http');

let serviceExports;
let broadcastProxyStateMock;
let getProxyStatusMock;
let getCodexProxyStatusMock;
let getGeminiProxyStatusMock;
let getOpenCodeProxyStatusMock;
let getOmpProxyStatusMock;
let getClaudeChannelsMock;
let getCodexChannelsMock;
let getGeminiChannelsMock;
let getOpenCodeChannelsMock;
let getOmpChannelsMock;

beforeEach(() => {
  serviceExports = {
    SUPPORTED_TOOLS: ['claude', 'codex', 'gemini', 'opencode', 'omp'],
    getAllToolSummaries: vi.fn(() => ({ claude: { credentials: [] } })),
    getToolSummary: vi.fn((tool) => ({ tool, credentials: [] })),
    importCredential: vi.fn((tool, payload) => ({ tool, id: 'cred-1', payload })),
    syncLocalCredential: vi.fn((tool) => ({ tool, credential: { id: 'cred-1' } })),
    setDefaultCredential: vi.fn(() => ({ defaultCredentialId: 'cred-1', credentials: [] })),
    deleteCredential: vi.fn(() => ({ defaultCredentialId: null, credentials: [] })),
    applyStoredCredential: vi.fn(async () => ({ proxyStopped: true, credential: { id: 'cred-1' } })),
    disableStoredCredential: vi.fn(() => ({ credential: { id: 'cred-1' }, toolSummary: { credentials: [] }, nativeState: { tool: 'claude', cleared: true } })),
    clearNativeOAuthState: vi.fn((tool) => ({ tool, cleared: true })),
    fetchCredentialUsage: vi.fn(async () => ({ provider: 'claude', raw: { total: 1 } }))
  };

  broadcastProxyStateMock = vi.fn();
  getProxyStatusMock = vi.fn(() => ({ running: true }));
  getCodexProxyStatusMock = vi.fn(() => ({ running: false }));
  getGeminiProxyStatusMock = vi.fn(() => ({ running: false }));
  getOpenCodeProxyStatusMock = vi.fn(() => ({ running: false }));
  getOmpProxyStatusMock = vi.fn(() => ({ running: false, mode: 'models-yml-provider-config' }));
  getClaudeChannelsMock = vi.fn(() => [{ id: 'claude-1', enabled: true }]);
  getCodexChannelsMock = vi.fn(() => ({ channels: [{ id: 'codex-1', enabled: true }] }));
  getGeminiChannelsMock = vi.fn(() => ({ channels: [{ id: 'gemini-1', enabled: true }] }));
  getOpenCodeChannelsMock = vi.fn(() => ({ channels: [{ id: 'opencode-1', enabled: true }] }));
  getOmpChannelsMock = vi.fn(() => ({ channels: [{ id: 'omp-1', enabled: true }] }));

  require.cache[require.resolve('../../../src/server/services/oauth-credentials-service')] = {
    id: require.resolve('../../../src/server/services/oauth-credentials-service'),
    filename: require.resolve('../../../src/server/services/oauth-credentials-service'),
    loaded: true,
    exports: serviceExports
  };
  require.cache[require.resolve('../../../src/server/websocket-server')] = {
    id: require.resolve('../../../src/server/websocket-server'),
    filename: require.resolve('../../../src/server/websocket-server'),
    loaded: true,
    exports: {
      broadcastProxyState: broadcastProxyStateMock
    }
  };
  require.cache[require.resolve('../../../src/platforms/drivers/claude/proxy-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/claude/proxy-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/claude/proxy-implementation'),
    loaded: true,
    exports: {
      getProxyStatus: getProxyStatusMock
    }
  };
  require.cache[require.resolve('../../../src/platforms/drivers/codex/proxy-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/codex/proxy-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/codex/proxy-implementation'),
    loaded: true,
    exports: {
      getCodexProxyStatus: getCodexProxyStatusMock
    }
  };
  require.cache[require.resolve('../../../src/platforms/drivers/gemini/proxy-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/gemini/proxy-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/gemini/proxy-implementation'),
    loaded: true,
    exports: {
      getGeminiProxyStatus: getGeminiProxyStatusMock
    }
  };
  require.cache[require.resolve('../../../src/platforms/drivers/opencode/proxy-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/opencode/proxy-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/opencode/proxy-implementation'),
    loaded: true,
    exports: {
      getOpenCodeProxyStatus: getOpenCodeProxyStatusMock
    }
  };
  require.cache[require.resolve('../../../src/platforms/drivers/omp/proxy-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/omp/proxy-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/omp/proxy-implementation'),
    loaded: true,
    exports: {
      getOmpProxyStatus: getOmpProxyStatusMock
    }
  };
  require.cache[require.resolve('../../../src/platforms/drivers/claude/channels-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/claude/channels-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/claude/channels-implementation'),
    loaded: true,
    exports: { getAllChannels: getClaudeChannelsMock }
  };
  require.cache[require.resolve('../../../src/platforms/drivers/codex/channels-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/codex/channels-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/codex/channels-implementation'),
    loaded: true,
    exports: { getChannels: getCodexChannelsMock }
  };
  require.cache[require.resolve('../../../src/platforms/drivers/gemini/channels-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/gemini/channels-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/gemini/channels-implementation'),
    loaded: true,
    exports: { getChannels: getGeminiChannelsMock }
  };
  require.cache[require.resolve('../../../src/platforms/drivers/opencode/channels-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/opencode/channels-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/opencode/channels-implementation'),
    loaded: true,
    exports: { getChannels: getOpenCodeChannelsMock }
  };
  require.cache[require.resolve('../../../src/platforms/drivers/omp/channels-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/omp/channels-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/omp/channels-implementation'),
    loaded: true,
    exports: { getChannels: getOmpChannelsMock }
  };

  delete require.cache[require.resolve('../../../src/server/api/oauth-credentials')];
});

afterEach(() => {
  [
    '../../../src/server/api/oauth-credentials',
    '../../../src/server/services/oauth-credentials-service',
    '../../../src/server/websocket-server',
    '../../../src/platforms/drivers/claude/proxy-implementation',
    '../../../src/platforms/drivers/codex/proxy-implementation',
    '../../../src/platforms/drivers/gemini/proxy-implementation',
    '../../../src/platforms/drivers/opencode/proxy-implementation',
    '../../../src/platforms/drivers/omp/proxy-implementation',
    '../../../src/platforms/drivers/claude/channels-implementation',
    '../../../src/platforms/drivers/codex/channels-implementation',
    '../../../src/platforms/drivers/gemini/channels-implementation',
    '../../../src/platforms/drivers/opencode/channels-implementation',
    '../../../src/platforms/drivers/omp/channels-implementation'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

function buildApp() {
  const router = require('../../../src/server/api/oauth-credentials');
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

describe('oauth-credentials api routes', () => {
  test('lists tool summaries and rejects unsupported tool', async () => {
    const app = buildApp();
    const listRes = await request(app).get('/');
    const badRes = await request(app).get('/invalid');

    expect(listRes.status).toBe(200);
    expect(listRes.body.tools).toEqual({ claude: { credentials: [] } });
    expect(badRes.status).toBe(404);
  });

  test('imports, syncs, sets default and deletes credentials', async () => {
    const app = buildApp();
    const importRes = await request(app).post('/claude/import', { raw: '{"accessToken":"token"}' });
    const syncRes = await request(app).post('/claude/sync-local', {});
    const defaultRes = await request(app).post('/claude/cred-1/default', {});
    const deleteRes = await request(app).delete('/claude/cred-1');

    expect(importRes.status).toBe(200);
    expect(syncRes.status).toBe(200);
    expect(defaultRes.status).toBe(200);
    expect(deleteRes.status).toBe(200);
    expect(serviceExports.importCredential).toHaveBeenCalledWith('claude', { raw: '{"accessToken":"token"}' });
    expect(serviceExports.syncLocalCredential).toHaveBeenCalledWith('claude');
    expect(serviceExports.setDefaultCredential).toHaveBeenCalledWith('claude', 'cred-1');
    expect(serviceExports.deleteCredential).toHaveBeenCalledWith('claude', 'cred-1');
  });

  test('apply route broadcasts proxy state and usage route returns payload', async () => {
    const app = buildApp();
    const applyRes = await request(app).post('/claude/cred-1/apply', {});
    const disableRes = await request(app).post('/claude/cred-1/disable-native', {});
    const clearRes = await request(app).post('/claude/clear-native', {});
    const usageRes = await request(app).get('/claude/cred-1/usage');

    expect(applyRes.status).toBe(200);
    expect(disableRes.status).toBe(200);
    expect(applyRes.body.message).toMatch(/OAuth 凭证控制/);
    expect(clearRes.status).toBe(200);
    expect(usageRes.status).toBe(200);
    expect(serviceExports.disableStoredCredential).toHaveBeenCalledWith('claude', 'cred-1');
    expect(broadcastProxyStateMock).toHaveBeenCalledWith('claude', { running: true }, { id: 'claude-1', enabled: true }, [{ id: 'claude-1', enabled: true }]);
    expect(serviceExports.fetchCredentialUsage).toHaveBeenCalledWith('claude', 'cred-1');
  });

  test('apply route broadcasts OMP proxy state', async () => {
    const app = buildApp();
    const applyRes = await request(app).post('/omp/cred-1/apply', {});

    expect(applyRes.status).toBe(200);
    expect(applyRes.body.message).toMatch(/OMP 已应用 OAuth 凭证/);
    expect(broadcastProxyStateMock).toHaveBeenCalledWith(
      'omp',
      { running: false, mode: 'models-yml-provider-config' },
      { id: 'omp-1', enabled: true },
      [{ id: 'omp-1', enabled: true }]
    );
  });
});
