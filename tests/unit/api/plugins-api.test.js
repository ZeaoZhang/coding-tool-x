const express = require('express');
const http = require('http');

let services;

beforeEach(() => {
  services = {
    claude: createMockService(),
    codex: createMockService(),
    gemini: createMockService({
      capabilities: {
        platform: 'gemini',
        supportsPlugins: false,
        repositories: false,
        market: false,
        install: false,
        uninstall: false
      }
    }),
    opencode: createMockService(),
    omp: createMockService({
      capabilities: {
        platform: 'omp',
        supportsPlugins: true,
        repositories: true,
        market: true,
        install: true,
        uninstall: true,
        toggle: true,
        config: true,
        import: false,
        syncRepos: false
      }
    })
  };

  const PluginsServiceStub = function(platform = 'claude') {
    return services[platform] || services.claude;
  };

  const servicePath = require.resolve('../../../src/server/services/plugins-service');
  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: {
      PluginsService: PluginsServiceStub
    }
  };

  delete require.cache[require.resolve('../../../src/server/api/plugins')];
});

afterEach(() => {
  delete require.cache[require.resolve('../../../src/server/api/plugins')];
  delete require.cache[require.resolve('../../../src/server/services/plugins-service')];
});

function createMockService(overrides = {}) {
  return {
    getCapabilities: vi.fn(() => overrides.capabilities || {
      platform: 'claude',
      supportsPlugins: true,
      repositories: true,
      market: true,
      install: true,
      uninstall: true
    }),
    listPlugins: vi.fn(() => ({ plugins: [{ name: 'demo-plugin', enabled: true }] })),
    getMarketPlugins: vi.fn(async () => [{ name: 'market-plugin' }]),
    installPlugin: vi.fn(async () => ({
      success: true,
      plugin: { name: 'demo-plugin', version: '1.0.0' }
    })),
    getRepos: vi.fn(() => [{ owner: 'demo', name: 'plugins', url: 'https://github.com/demo/plugins', token: 'secret-token' }]),
    addRepo: vi.fn(() => [{ owner: 'demo', name: 'plugins', url: 'https://github.com/demo/plugins', token: 'secret-token' }]),
    removeRepo: vi.fn(() => []),
    toggleRepo: vi.fn(() => [{ owner: 'demo', name: 'plugins', enabled: false }]),
    updateRepoAuth: vi.fn(() => [{ owner: 'demo', name: 'plugins', token: 'updated-token' }]),
    syncRepos: vi.fn(async () => ({ results: [{ repo: 'https://github.com/demo/plugins', success: true }] })),
    syncPlugins: vi.fn(async () => ({ plugins: [{ name: 'demo-plugin' }] })),
    getPluginReadme: vi.fn(async () => '# Demo'),
    getPlugin: vi.fn((name) => (name === 'demo-plugin' ? { name, enabled: true } : null)),
    uninstallPlugin: vi.fn(() => ({ success: true, message: 'Plugin removed successfully' })),
    togglePlugin: vi.fn((name, enabled) => ({ name, enabled })),
    updatePluginConfig: vi.fn((name) => ({ success: true, message: `Configuration updated for ${name}` }))
  };
}

function buildApp() {
  const router = require('../../../src/server/api/plugins');
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
            resolve({
              status: res.statusCode,
              body: data ? JSON.parse(data) : null
            });
          } catch {
            resolve({
              status: res.statusCode,
              body: data
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

describe('GET / and GET /market', () => {
  test('lists plugins for requested platform', async () => {
    const res = await request(buildApp()).get('/?platform=opencode');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.platform).toBe('opencode');
    expect(services.opencode.listPlugins).toHaveBeenCalled();
  });

  test('lists plugins for Codex platform instead of falling back to Claude', async () => {
    const res = await request(buildApp()).get('/?platform=codex');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.platform).toBe('codex');
    expect(services.codex.listPlugins).toHaveBeenCalled();
    expect(services.claude.listPlugins).not.toHaveBeenCalled();
  });

  test('lists plugins for OMP platform', async () => {
    const res = await request(buildApp()).get('/?platform=omp');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.platform).toBe('omp');
    expect(services.omp.listPlugins).toHaveBeenCalled();
    expect(services.claude.listPlugins).not.toHaveBeenCalled();
  });

  test('passes refresh flag to market lookup', async () => {
    const res = await request(buildApp()).get('/market?platform=claude&refresh=1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(services.claude.getMarketPlugins).toHaveBeenCalledWith(true);
  });

  test('GET /capabilities returns platform capability contract', async () => {
    const res = await request(buildApp()).get('/capabilities?platform=gemini');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.platform).toBe('gemini');
    expect(res.body.capabilities).toEqual(expect.objectContaining({
      platform: 'gemini',
      supportsPlugins: false,
      repositories: false
    }));
    expect(services.gemini.getCapabilities).toHaveBeenCalled();
  });

  test('GET /capabilities returns OMP package/extension capability contract', async () => {
    const res = await request(buildApp()).get('/capabilities?platform=omp');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.platform).toBe('omp');
    expect(res.body.capabilities).toEqual(expect.objectContaining({
      platform: 'omp',
      supportsPlugins: true,
      repositories: true,
      config: true
    }));
    expect(services.omp.getCapabilities).toHaveBeenCalled();
  });
});

describe('POST /install', () => {
  test('installs from source url', async () => {
    const res = await request(buildApp()).post('/install', {
      platform: 'opencode',
      source: 'npm:demo-plugin'
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(services.opencode.installPlugin).toHaveBeenCalledWith('npm:demo-plugin', null);
  });

  test('source installs stay source-based even when repo metadata is present', async () => {
    const res = await request(buildApp()).post('/install', {
      platform: 'opencode',
      source: 'https://github.com/demo/opencode-plugin.git',
      repo: {
        owner: 'demo',
        name: 'opencode-plugin',
        marketplace: 'demo-market'
      }
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(services.opencode.installPlugin).toHaveBeenCalledWith('https://github.com/demo/opencode-plugin.git', null);
  });

  test('installs from directory + repo payload with provider context', async () => {
    const res = await request(buildApp()).post('/install', {
      platform: 'claude',
      directory: 'plugins/demo-plugin',
      repo: {
        id: 'repo-1',
        provider: 'gitlab',
        host: 'https://gitlab.example.com',
        projectPath: 'team/demo-plugins',
        branch: 'main',
        marketplace: 'team-market'
      }
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(services.claude.installPlugin).toHaveBeenCalledWith(
      '',
      expect.objectContaining({
        id: 'repo-1',
        provider: 'gitlab',
        host: 'https://gitlab.example.com',
        projectPath: 'team/demo-plugins',
        directory: 'plugins/demo-plugin',
        marketplace: 'team-market'
      })
    );
  });

  test('installs a root-level repo plugin without dropping marketplace context', async () => {
    const res = await request(buildApp()).post('/install', {
      platform: 'codex',
      directory: '',
      repo: {
        id: 'repo-2',
        provider: 'github',
        owner: 'demo',
        name: 'root-plugin',
        marketplace: 'root-market'
      }
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(services.codex.installPlugin).toHaveBeenCalledWith(
      '',
      expect.objectContaining({
        id: 'repo-2',
        provider: 'github',
        owner: 'demo',
        name: 'root-plugin',
        directory: '',
        marketplace: 'root-market'
      })
    );
  });

  test('returns 400 when install source is missing', async () => {
    const res = await request(buildApp()).post('/install', {});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('returns 400 when service reports failure', async () => {
    services.claude.installPlugin.mockResolvedValue({ success: false, error: 'bad plugin' });
    const res = await request(buildApp()).post('/install', { source: 'bad-plugin' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('returns 400 when service rejects unsafe repo directory', async () => {
    services.claude.installPlugin.mockRejectedValue(new Error('Invalid plugin directory'));
    const res = await request(buildApp()).post('/install', {
      directory: '../demo-plugin',
      repo: {
        owner: 'demo',
        name: 'plugins'
      }
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('repository routes', () => {
  test('GET /repos returns repositories', async () => {
    const res = await request(buildApp()).get('/repos');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.repos[0].owner).toBe('demo');
    expect(res.body.repos[0].token).toBeUndefined();
    expect(res.body.repos[0].hasToken).toBe(true);
  });

  test('POST /repos validates repository url', async () => {
    const res = await request(buildApp()).post('/repos', {});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('PUT /repos/:owner/:name/toggle validates enabled', async () => {
    const res = await request(buildApp()).put('/repos/demo/plugins/toggle', { enabled: 'yes' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('PUT /repos/:owner/:name/toggle toggles repo', async () => {
    const res = await request(buildApp()).put('/repos/demo/plugins/toggle', { enabled: false, platform: 'opencode' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(services.opencode.toggleRepo).toHaveBeenCalledWith('demo', 'plugins', false, '');
  });

  test('PUT /repos/auth updates auth for a repository', async () => {
    const res = await request(buildApp()).put('/repos/auth', {
      id: 'repo-1',
      owner: 'demo',
      name: 'plugins',
      token: 'new-secret-token'
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(services.claude.updateRepoAuth).toHaveBeenCalledWith('demo', 'plugins', 'new-secret-token', false, 'repo-1');
    expect(res.body.repos[0].token).toBeUndefined();
    expect(res.body.repos[0].hasToken).toBe(true);
  });

  test('DELETE /repos removes using generic route with id', async () => {
    const res = await request(buildApp()).delete('/repos?id=repo-1&owner=demo&name=plugins');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(services.claude.removeRepo).toHaveBeenCalledWith('demo', 'plugins', 'repo-1');
  });

  test('POST /repos/sync proxies sync results', async () => {
    const res = await request(buildApp()).post('/repos/sync', { platform: 'opencode' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(services.opencode.syncRepos).toHaveBeenCalled();
  });
});

describe('plugin sync and readme routes', () => {
  test('POST /sync returns sync result', async () => {
    const res = await request(buildApp()).post('/sync', {});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(services.claude.syncPlugins).toHaveBeenCalled();
  });

  test('GET /:name/readme returns fallback payload on error', async () => {
    services.claude.getPluginReadme.mockRejectedValue(new Error('network down'));
    const res = await request(buildApp()).get('/demo-plugin/readme');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.readme).toBe('');
  });

  test('GET /:name/readme forwards provider-specific repo info', async () => {
    const res = await request(buildApp()).get('/demo-plugin/readme?repoId=repo-1&repoProvider=gitlab&repoHost=https://gitlab.example.com&repoProjectPath=team/plugins&repoBranch=main&directory=plugins/demo-plugin');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(services.claude.getPluginReadme).toHaveBeenCalledWith(expect.objectContaining({
      name: 'demo-plugin',
      repoId: 'repo-1',
      repoProvider: 'gitlab',
      repoHost: 'https://gitlab.example.com',
      repoProjectPath: 'team/plugins',
      directory: 'plugins/demo-plugin'
    }));
  });
});

describe('single plugin routes', () => {
  test('GET /:name returns 404 when plugin is missing', async () => {
    const res = await request(buildApp()).get('/missing-plugin');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('DELETE /:name returns 400 when uninstall fails', async () => {
    services.claude.uninstallPlugin.mockReturnValue({ success: false, error: 'not found' });
    const res = await request(buildApp()).delete('/demo-plugin');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('DELETE /:name returns 400 when service rejects unsafe plugin name', async () => {
    services.claude.uninstallPlugin.mockImplementation(() => {
      throw new Error('Invalid plugin name');
    });
    const res = await request(buildApp()).delete('/..%2Fdemo-plugin');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('PUT /:name/toggle validates enabled', async () => {
    const res = await request(buildApp()).put('/demo-plugin/toggle', { enabled: 'yes' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('PUT /:name/toggle updates plugin status', async () => {
    const res = await request(buildApp()).put('/demo-plugin/toggle', { enabled: false });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(services.claude.togglePlugin).toHaveBeenCalledWith('demo-plugin', false);
  });

  test('PUT /:name/config validates config object', async () => {
    const res = await request(buildApp()).put('/demo-plugin/config', { config: null });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('PUT /:name/config forwards config update', async () => {
    const res = await request(buildApp()).put('/demo-plugin/config', {
      config: { enabled: true, mode: 'strict' }
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(services.claude.updatePluginConfig).toHaveBeenCalledWith('demo-plugin', { enabled: true, mode: 'strict' });
  });
});
