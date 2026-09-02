const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

let testDir;
let allowedProjectPath;
let resolvedAllowedProjectPath;
let services;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-api-'));
  allowedProjectPath = path.join(testDir, 'project');
  fs.mkdirSync(allowedProjectPath, { recursive: true });
  resolvedAllowedProjectPath = fs.realpathSync(allowedProjectPath);

  const pathsModulePath = require.resolve('../../../src/config/paths');
  require.cache[pathsModulePath] = {
    id: pathsModulePath,
    filename: pathsModulePath,
    loaded: true,
    exports: {
      PATHS: {
        workspaces: path.join(testDir, 'workspaces.json')
      },
      HOME_DIR: testDir
    }
  };

  services = {
    claude: createMockService(),
    codex: createMockService(),
    gemini: createMockService(),
    opencode: createMockService()
  };

  const AgentsServiceStub = function(platform = 'claude') {
    return services[platform] || services.claude;
  };

  const servicePath = require.resolve('../../../src/platforms/agents-service');
  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: {
      AgentsService: AgentsServiceStub
    }
  };

  delete require.cache[require.resolve('../../../src/server/api/agents')];
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  delete require.cache[require.resolve('../../../src/server/api/agents')];
  delete require.cache[require.resolve('../../../src/platforms/agents-service')];
  delete require.cache[require.resolve('../../../src/config/paths')];
});

function createMockService() {
  return {
    listAgents: vi.fn(() => ({ agents: [{ fileName: 'helper-agent', scope: 'user' }] })),
    getStats: vi.fn(() => ({ total: 1, user: 1, project: 0 })),
    getAgent: vi.fn((fileName) => (fileName === 'helper-agent'
      ? { fileName, scope: 'user', description: 'helper' }
      : null)),
    createAgent: vi.fn((payload) => payload),
    updateAgent: vi.fn((payload) => payload),
    deleteAgent: vi.fn(() => ({ success: true, message: 'deleted' })),
    listAllAgents: vi.fn(async () => ({ agents: [{ fileName: 'remote-agent', repoOwner: 'demo', repoName: 'repo' }] })),
    getRepos: vi.fn(() => [{ owner: 'demo', name: 'repo', branch: 'main' }]),
    addRepo: vi.fn(() => [{ owner: 'demo', name: 'repo', branch: 'main' }]),
    removeRepo: vi.fn(() => []),
    toggleRepo: vi.fn(() => [{ owner: 'demo', name: 'repo', enabled: false }]),
    installFromRemote: vi.fn(async (agent) => ({ success: true, installed: agent.fileName })),
    uninstallAgent: vi.fn(() => ({ success: true, removed: true }))
  };
}

function buildApp() {
  const router = require('../../../src/server/api/agents');
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

function request(app) {
  return {
    get(url) { return call(app, 'GET', url); },
    post(url, body) { return call(app, 'POST', url, body); },
    put(url, body) { return call(app, 'PUT', url, body); },
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

describe('agents api middleware and listing', () => {
  test('rejects unsupported platform in middleware', async () => {
    const res = await request(buildApp()).get('/?platform=unsupported');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('lists agents for a validated project path', async () => {
    const res = await request(buildApp()).get(`/?platform=opencode&projectPath=${encodeURIComponent(allowedProjectPath)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.platform).toBe('opencode');
    expect(services.opencode.listAgents).toHaveBeenCalledWith(resolvedAllowedProjectPath);
  });

  test('lists Gemini agents for a validated project path', async () => {
    const res = await request(buildApp()).get(`/?platform=gemini&projectPath=${encodeURIComponent(allowedProjectPath)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.platform).toBe('gemini');
    expect(services.gemini.listAgents).toHaveBeenCalledWith(resolvedAllowedProjectPath);
  });

  test('returns 400 for invalid optional projectPath', async () => {
    const res = await request(buildApp()).get('/?projectPath=relative/path');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('returns stats for validated project path', async () => {
    const res = await request(buildApp()).get(`/stats?projectPath=${encodeURIComponent(allowedProjectPath)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.total).toBe(1);
  });
});

describe('agent CRUD routes', () => {
  test('requires projectPath for project-scoped agent detail', async () => {
    const res = await request(buildApp()).get('/project/helper-agent');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('rejects invalid agent file name', async () => {
    const res = await request(buildApp()).get('/user/bad..name');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('creates a user-scoped agent successfully', async () => {
    const res = await request(buildApp()).post('/', {
      fileName: 'helper-agent',
      scope: 'user',
      description: 'Helper'
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(services.claude.createAgent).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'helper-agent',
      scope: 'user',
      name: 'helper-agent',
      description: 'Helper'
    }));
  });

  test('rejects project-scoped codex agents', async () => {
    const res = await request(buildApp()).post('/', {
      platform: 'codex',
      fileName: 'helper-agent',
      scope: 'project',
      projectPath: allowedProjectPath
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('updates an agent with validated project path', async () => {
    const res = await request(buildApp()).put('/project/helper-agent', {
      platform: 'opencode',
      projectPath: allowedProjectPath,
      description: 'Updated'
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(services.opencode.updateAgent).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'helper-agent',
      projectPath: resolvedAllowedProjectPath,
      description: 'Updated'
    }));
  });

  test('deletes an agent using validated scope and file name', async () => {
    const res = await request(buildApp()).delete(`/project/helper-agent?projectPath=${encodeURIComponent(allowedProjectPath)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(services.claude.deleteAgent).toHaveBeenCalledWith('helper-agent', 'project', resolvedAllowedProjectPath);
  });
});

describe('agent repository routes', () => {
  test('rejects repo operations for codex platform', async () => {
    const res = await request(buildApp()).get('/repos?platform=codex');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('validates owner and name when adding repo', async () => {
    const res = await request(buildApp()).post('/repos', { branch: 'main' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('toggles repo enabled state', async () => {
    const res = await request(buildApp()).put('/repos/demo/repo/toggle', {
      enabled: false,
      directory: 'nested'
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(services.claude.toggleRepo).toHaveBeenCalledWith('demo', 'repo', 'nested', false);
  });
});

describe('remote install and uninstall routes', () => {
  test('lists all remote agents with refresh flag', async () => {
    const res = await request(buildApp()).get(`/all?refresh=1&projectPath=${encodeURIComponent(allowedProjectPath)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(services.claude.listAllAgents).toHaveBeenCalledWith(resolvedAllowedProjectPath, true);
  });

  test('validates repoPath before install', async () => {
    const res = await request(buildApp()).post('/install', {
      fileName: 'helper-agent',
      repoOwner: 'demo',
      repoName: 'repo',
      repoPath: '../bad.md'
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('installs remote agent when payload is valid', async () => {
    const agent = {
      fileName: 'helper-agent',
      repoOwner: 'demo',
      repoName: 'repo',
      repoPath: 'agents/helper-agent.md'
    };
    const res = await request(buildApp()).post('/install', agent);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(services.claude.installFromRemote).toHaveBeenCalledWith(agent);
  });

  test('returns 400 when service rejects remote install validation', async () => {
    services.claude.installFromRemote.mockRejectedValue(new Error('代理仓库路径不合法'));
    const res = await request(buildApp()).post('/install', {
      fileName: 'helper-agent',
      repoOwner: 'demo',
      repoName: 'repo',
      repoPath: 'agents/helper-agent.md'
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('requires fileName when uninstalling', async () => {
    const res = await request(buildApp()).post('/uninstall', {});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
