const express = require('express');
const { once } = require('events');
const createPlatformRouter = require('../../../src/server/api/platforms');

async function requestJson(app, route) {
  const server = app.listen(0);
  await once(server, 'listening');
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${route}`);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('platform catalog and generic routes', () => {
  it('catalog exposes only safe public platform fields', async () => {
    const app = express();
    app.use('/api/platforms', createPlatformRouter({
      registry: {
        list: () => [{
          key: 'demo-cli',
          label: 'Demo',
          command: 'demo',
          iconToken: 'terminal',
          color: '#000',
          capabilities: { sessions: 'generic-jsonl' },
          paths: { home: '/private/home' },
          driverIds: { sessions: 'generic-jsonl' }
        }]
      },
      runtime: {}
    }));

    const response = await requestJson(app, '/api/platforms');
    expect(response.status).toBe(200);
    expect(response.body.platforms[0]).toEqual(expect.objectContaining({
      key: 'demo-cli',
      label: 'Demo',
      capabilities: { sessions: true }
    }));
    expect(response.body.platforms[0]).not.toHaveProperty('paths');
    expect(response.body.platforms[0]).not.toHaveProperty('driverIds');
  });

  it('returns an explicit 404 for an unsupported capability', async () => {
    const app = express();
    app.use('/api/platforms', createPlatformRouter({
      registry: {
        resolve: () => ({ key: 'demo-cli' }),
        getCapability: () => 'unsupported'
      },
      runtime: { getDriver: vi.fn() }
    }));

    const response = await requestJson(app, '/api/platforms/demo-cli/proxy/status');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('unsupported');
    expect(response.body.error.platform).toBe('demo-cli');
    expect(response.body.error.capability).toBe('proxy');
  });

  it('dispatches projects, sessions, channels, and proxy status through drivers', async () => {
    const drivers = {
      projects: { listProjects: vi.fn(async () => ({ projects: [{ name: 'demo' }] })) },
      sessions: { listSessions: vi.fn(async () => [{ sessionId: 's1' }]) },
      channels: { list: vi.fn(async () => [{ id: 'channel-1' }]) },
      proxy: { status: vi.fn(async () => ({ running: false })) }
    };
    const app = express();
    app.use('/api/platforms', createPlatformRouter({
      registry: {
        resolve: () => ({ key: 'demo-cli', capabilities: { projects: 'projects', sessions: 'sessions', channels: 'channels', proxy: 'proxy' } }),
        getCapability: (_platform, capability) => capability
      },
      runtime: {
        getDriver: (_platform, capability) => drivers[capability]
      }
    }));

    await expect(requestJson(app, '/api/platforms/demo-cli/projects?fresh=1')).resolves.toMatchObject({
      status: 200,
      body: { projects: [{ name: 'demo' }] }
    });
    await expect(requestJson(app, '/api/platforms/demo-cli/sessions/my-project')).resolves.toMatchObject({
      status: 200,
      body: [{ sessionId: 's1' }]
    });
    await expect(requestJson(app, '/api/platforms/demo-cli/channels')).resolves.toMatchObject({
      status: 200,
      body: [{ id: 'channel-1' }]
    });
    await expect(requestJson(app, '/api/platforms/demo-cli/proxy/status')).resolves.toMatchObject({
      status: 200,
      body: { running: false }
    });

    expect(drivers.projects.listProjects).toHaveBeenCalledWith({ force: true });
    expect(drivers.sessions.listSessions).toHaveBeenCalledWith('my-project', { force: false });
    expect(drivers.channels.list).toHaveBeenCalledWith({ force: false });
    expect(drivers.proxy.status).toHaveBeenCalledWith({ force: false });
  });

  it.each([
    ['unavailable', 503],
    ['invalid', 400],
    ['failed', 500]
  ])('maps %s driver results to the documented HTTP status', async (state, status) => {
    const app = express();
    app.use('/api/platforms', createPlatformRouter({
      registry: {
        resolve: () => ({ key: 'demo-cli', capabilities: { projects: 'projects' } }),
        getCapability: () => 'projects'
      },
      runtime: {
        getDriver: () => ({
          listProjects: async () => ({ status: state, error: `${state} projects` })
        })
      }
    }));

    const response = await requestJson(app, '/api/platforms/demo-cli/projects');
    expect(response.status).toBe(status);
    expect(response.body.error).toEqual(expect.objectContaining({ status: state, code: state }));
  });

  it('reports unknown platforms without falling back to another platform', async () => {
    const app = express();
    app.use('/api/platforms', createPlatformRouter({
      registry: { resolve: () => null },
      runtime: { getDriver: vi.fn() }
    }));

    const response = await requestJson(app, '/api/platforms/not-configured/projects');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('not_found');
    expect(response.body.error.platform).toBe('not-configured');
  });

  it('maps thrown driver errors to failed results with operation context', async () => {
    const app = express();
    app.use('/api/platforms', createPlatformRouter({
      registry: {
        resolve: () => ({ key: 'demo-cli', capabilities: { projects: 'projects' } }),
        getCapability: () => 'projects'
      },
      runtime: {
        getDriver: () => ({
          listProjects: async () => { throw new Error('disk failure'); }
        })
      }
    }));

    const response = await requestJson(app, '/api/platforms/demo-cli/projects');
    expect(response.status).toBe(500);
    expect(response.body.error).toEqual(expect.objectContaining({
      status: 'failed',
      code: 'failed',
      platform: 'demo-cli',
      capability: 'projects',
      operation: 'listProjects',
      error: 'disk failure'
    }));
  });
});
