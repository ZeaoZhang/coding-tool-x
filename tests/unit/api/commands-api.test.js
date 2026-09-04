const express = require('express');
const http = require('http');

let services;

beforeEach(() => {
  services = {
    claude: createMockService(),
    codex: createMockService(),
    gemini: createMockService(),
    opencode: createMockService(),
    omp: createMockService()
  };

  const CommandsServiceStub = function(platform = 'claude') {
    return services[platform] || services.claude;
  };

  const servicePath = require.resolve('../../../src/platforms/commands-service');
  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: {
      CommandsService: CommandsServiceStub
    }
  };

  delete require.cache[require.resolve('../../../src/server/api/commands')];
});

afterEach(() => {
  delete require.cache[require.resolve('../../../src/server/api/commands')];
  delete require.cache[require.resolve('../../../src/platforms/commands-service')];
});

function createMockService() {
  return {
    listCommands: vi.fn(() => ({ commands: [{ name: 'review', scope: 'user' }] })),
    getStats: vi.fn(() => ({ total: 1, user: 1, project: 0 })),
    getCommand: vi.fn((name) => (name === 'review' ? { name, body: 'Do review' } : null)),
    createCommand: vi.fn((payload) => payload),
    updateCommand: vi.fn((payload) => payload),
    deleteCommand: vi.fn(() => ({ success: true, message: 'deleted' })),
    listAllCommands: vi.fn(async () => ({ commands: [{ name: 'remote-review', repoOwner: 'demo', repoName: 'repo' }] })),
    getRepos: vi.fn(() => [{ owner: 'demo', name: 'repo' }]),
    addRepo: vi.fn(() => [{ owner: 'demo', name: 'repo' }]),
    removeRepo: vi.fn(() => []),
    toggleRepo: vi.fn(() => [{ owner: 'demo', name: 'repo', enabled: false }]),
    installFromRemote: vi.fn(async (command) => ({ success: true, installed: command.name })),
    uninstallCommand: vi.fn(() => ({ success: true, removed: true }))
  };
}

function buildApp() {
  const router = require('../../../src/server/api/commands');
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

describe('commands api basic routes', () => {
  test('lists commands for selected platform', async () => {
    const res = await request(buildApp()).get('/?platform=opencode&projectPath=/tmp/project');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.platform).toBe('opencode');
    expect(services.opencode.listCommands).toHaveBeenCalledWith('/tmp/project');
  });

  test('lists commands for Gemini platform', async () => {
    const res = await request(buildApp()).get('/?platform=gemini&projectPath=/tmp/project');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.platform).toBe('gemini');
    expect(services.gemini.listCommands).toHaveBeenCalledWith('/tmp/project');
  });

  test('lists commands for Codex platform instead of falling back to Claude', async () => {
    const res = await request(buildApp()).get('/?platform=codex&projectPath=/tmp/project');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.platform).toBe('codex');
    expect(services.codex.listCommands).toHaveBeenCalledWith('/tmp/project');
    expect(services.claude.listCommands).not.toHaveBeenCalled();
  });

  test('lists commands for OMP/OMP commands', async () => {
    const res = await request(buildApp()).get('/?platform=omp&projectPath=/tmp/project');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.platform).toBe('omp');
    expect(services.omp.listCommands).toHaveBeenCalledWith('/tmp/project');
    expect(services.claude.listCommands).not.toHaveBeenCalled();
  });

  test('returns command stats', async () => {
    const res = await request(buildApp()).get('/stats');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  test('requires projectPath for project-scoped command detail', async () => {
    const res = await request(buildApp()).get('/project/review');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('returns 404 for missing command detail', async () => {
    const res = await request(buildApp()).get('/user/missing');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe('commands api CRUD routes', () => {
  test('validates missing name on create', async () => {
    const res = await request(buildApp()).post('/', { scope: 'user' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('creates a project-scoped command', async () => {
    const res = await request(buildApp()).post('/', {
      name: 'review',
      scope: 'project',
      projectPath: '/tmp/project',
      body: 'Do review',
      subtask: true
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(services.claude.createCommand).toHaveBeenCalledWith(expect.objectContaining({
      name: 'review',
      scope: 'project',
      projectPath: '/tmp/project',
      subtask: true
    }));
  });

  test('returns 400 when service rejects unsafe namespace on create', async () => {
    services.claude.createCommand.mockImplementation(() => {
      throw new Error('Invalid command namespace');
    });
    const res = await request(buildApp()).post('/', {
      name: 'review',
      scope: 'user',
      namespace: '../team'
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('updates a command', async () => {
    const res = await request(buildApp()).put('/user/review', {
      description: 'Updated description'
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(services.claude.updateCommand).toHaveBeenCalledWith(expect.objectContaining({
      name: 'review',
      scope: 'user',
      description: 'Updated description'
    }));
  });

  test('deletes a command', async () => {
    const res = await request(buildApp()).delete('/user/review?namespace=team');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(services.claude.deleteCommand).toHaveBeenCalledWith('review', 'user', null, 'team');
  });
});

describe('commands api repo and remote routes', () => {
  test('lists all commands with refresh flag', async () => {
    const res = await request(buildApp()).get('/all?refresh=1&platform=opencode');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(services.opencode.listAllCommands).toHaveBeenCalledWith(null, true);
  });

  test('validates owner and name when adding repo', async () => {
    const res = await request(buildApp()).post('/repos', { branch: 'main' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('toggles repo status', async () => {
    const res = await request(buildApp()).put('/repos/demo/repo/toggle', {
      enabled: false,
      directory: 'nested'
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(services.claude.toggleRepo).toHaveBeenCalledWith('demo', 'repo', 'nested', false);
  });

  test('validates remote install payload', async () => {
    const res = await request(buildApp()).post('/install', { name: 'review' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('installs remote command and uninstalls by path', async () => {
    const installRes = await request(buildApp()).post('/install', {
      name: 'review',
      repoOwner: 'demo',
      repoName: 'repo'
    });
    const uninstallRes = await request(buildApp()).post('/uninstall', { path: 'review.md' });

    expect(installRes.status).toBe(200);
    expect(installRes.body.success).toBe(true);
    expect(services.claude.installFromRemote).toHaveBeenCalled();
    expect(uninstallRes.status).toBe(200);
    expect(uninstallRes.body.success).toBe(true);
    expect(services.claude.uninstallCommand).toHaveBeenCalledWith('review.md');
  });

  test('returns 400 when service rejects unsafe remote uninstall path', async () => {
    services.claude.uninstallCommand.mockImplementation(() => {
      throw new Error('Invalid target name');
    });
    const res = await request(buildApp()).post('/uninstall', { path: '../review.md' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

test('keeps Claude as the default when the platform is absent', async () => {
  const res = await request(buildApp()).get('/?projectPath=/tmp/project');

  expect(res.status).toBe(200);
  expect(res.body.platform).toBe('claude');
  expect(services.claude.listCommands).toHaveBeenCalledWith('/tmp/project');
});

test('rejects an unknown non-empty platform without falling back to Claude', async () => {
  const res = await request(buildApp()).get('/?platform=missing&projectPath=/tmp/project');

  expect(res.status).toBe(404);
  expect(res.body.success).toBe(false);
  expect(services.claude.listCommands).not.toHaveBeenCalled();
});

test('routes a registered custom platform to its own command service', async () => {
  const runtime = require('../../../src/platforms/runtime');
  const definition = { key: 'demo-cli', label: 'Demo CLI' };
  const registry = {
    resolve: vi.fn(key => key === 'demo-cli' ? definition : null)
  };
  services['demo-cli'] = createMockService();
  const registrySpy = vi.spyOn(runtime, 'getPlatformRegistry').mockReturnValue(registry);

  try {
    const res = await request(buildApp()).get('/?platform=demo-cli&projectPath=/tmp/project');

    expect(res.status).toBe(200);
    expect(res.body.platform).toBe('demo-cli');
    expect(services['demo-cli'].listCommands).toHaveBeenCalledWith('/tmp/project');
    expect(services.claude.listCommands).not.toHaveBeenCalled();
  } finally {
    registrySpy.mockRestore();
  }
});
