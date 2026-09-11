'use strict';

const { createApiOperationsDriver } = require('../../../src/shared/driver-factories/api');
const { createDriver: createOmpChannelsDriver } = require('../../../src/platforms/drivers/omp/channels');

describe('API operation Driver contract', () => {
  const manifest = {
    api: {
      routes: [
        { operation: 'listProjects', capability: 'projects' },
        { operation: 'enabled', capability: 'channels' },
        { operation: 'missing', capability: 'projects' }
      ]
    }
  };

  test('delegates through the owning API boundary with normalized arguments', async () => {
    const calls = [];
    const runtime = {
      getDriver: (platform, capability, context) => {
        calls.push({ platform, capability, context });
        return {
          listProjects: (options) => ({ projects: ['alpha'], fresh: options.force })
        };
      }
    };
    const driver = createApiOperationsDriver({ platform: 'demo', runtime, manifest });
    const result = await driver.listProjects({
      platform: 'demo',
      capability: 'projects',
      operation: 'listProjects',
      manifest,
      config: { currentProject: 'alpha' },
      params: {},
      query: { fresh: '1' },
      body: {},
      route: manifest.api.routes[0]
    });

    expect(result).toEqual({
      status: 'ok',
      platform: 'demo',
      capability: 'projects',
      operation: 'listProjects',
      data: { projects: ['alpha'], fresh: true, currentProject: null }
    });
    expect(calls[0]).toMatchObject({
      platform: 'demo',
      capability: 'projects',
      context: { config: { currentProject: 'alpha' }, route: manifest.api.routes[0] }
    });
  });

  test('maps aliases and returns typed unsupported results', async () => {
    const runtime = {
      getDriver: (platform, capability) => capability === 'channels'
        ? { getEnabled: options => ({ options }) }
        : {}
    };
    const driver = createApiOperationsDriver({ platform: 'demo', runtime, manifest });
    await expect(driver.enabled({
      platform: 'demo',
      query: { fresh: 'true' },
      route: manifest.api.routes[1]
    })).resolves.toEqual({
      status: 'ok',
      platform: 'demo',
      capability: 'channels',
      operation: 'enabled',
      data: { options: { fresh: 'true', config: undefined, force: true } }
    });
    await expect(driver.missing({ platform: 'demo', route: manifest.api.routes[2] })).resolves.toEqual({
      status: 'unsupported',
      platform: 'demo',
      capability: 'projects',
      operation: 'missing'
    });
  });

  test('converts target failures into typed results with hidden causes', async () => {
    const cause = new Error('storage unavailable');
    const driver = createApiOperationsDriver({
      platform: 'demo',
      runtime: { getDriver: () => ({ listProjects: () => { throw cause; } }) },
      manifest
    });
    const result = await driver.listProjects({ platform: 'demo', route: manifest.api.routes[0] });
    expect(result).toMatchObject({
      status: 'failed',
      platform: 'demo',
      capability: 'projects',
      operation: 'listProjects',
      error: 'storage unavailable'
    });
    expect(result.cause).toBe(cause);
    expect(Object.keys(result)).not.toContain('cause');
  });

  test('uses the concrete route when operations share the same name', async () => {
    const sessionStatusRoute = { operation: 'status', capability: 'sessions' };
    const proxyStatusRoute = { operation: 'status', capability: 'proxy' };
    const statusManifest = { api: { routes: [sessionStatusRoute, proxyStatusRoute] } };
    const index = {
      getSessionStatus: vi.fn(async (_platform, sessionId) => ({ sessionId }))
    };
    const driver = createApiOperationsDriver({
      platform: 'codex',
      manifest: statusManifest,
      sessionHistoryIndex: index,
      runtime: { getDriver: vi.fn() }
    });

    await expect(driver.status({
      platform: 'codex',
      route: sessionStatusRoute,
      params: { sessionId: 'session-1' },
      query: {}
    })).resolves.toMatchObject({
      status: 'ok',
      data: { sessionId: 'session-1' }
    });
    expect(index.getSessionStatus).toHaveBeenCalledWith(
      'codex',
      'session-1',
      { consistency: 'stale-ok' }
    );
  });

  test('passes pagination options to indexed message reads', async () => {
    const messagesRoute = { operation: 'messages', capability: 'sessions' };
    const index = {
      getMessagePage: vi.fn(async () => ({ messages: [], pagination: { page: 2, limit: 20 } }))
    };
    const driver = createApiOperationsDriver({
      platform: 'omp',
      manifest: { api: { routes: [messagesRoute] } },
      sessionHistoryIndex: index
    });

    await driver.messages({
      platform: 'omp',
      route: messagesRoute,
      params: { sessionId: 'session-2' },
      query: { page: '2', limit: '20', order: 'asc' }
    });

    expect(index.getMessagePage).toHaveBeenCalledWith('omp', 'session-2', {
      page: 2,
      limit: 20,
      order: 'asc',
      consistency: 'stale-ok'
    });
  });

  test('invokes Claude session Drivers through their stable argument contract', async () => {
    const sessionsRoute = { operation: 'listSessions', capability: 'sessions' };
    const listSessions = vi.fn(async () => ({ status: 'ok', data: [] }));
    const driver = createApiOperationsDriver({
      platform: 'claude',
      manifest: { api: { routes: [sessionsRoute] } },
      config: { projectsDir: '/sessions' },
      runtime: { getDriver: () => ({ listSessions }) }
    });

    await driver.listSessions({
      platform: 'claude',
      route: sessionsRoute,
      config: { projectsDir: '/sessions' },
      params: { projectName: 'project-1' },
      query: { fresh: '1' }
    });

    expect(listSessions).toHaveBeenCalledWith('project-1', expect.objectContaining({
      force: true,
      consistency: 'complete',
      config: { projectsDir: '/sessions' }
    }));
  });

  test('includes the Claude project name for session mutations', async () => {
    const deleteRoute = { operation: 'delete', capability: 'sessions' };
    const forkRoute = { operation: 'fork', capability: 'sessions' };
    const deleteSession = vi.fn(async () => ({ status: 'ok', data: { success: true } }));
    const fork = vi.fn(async () => ({ status: 'ok', data: { newSessionId: 'fork-1' } }));
    const driver = createApiOperationsDriver({
      platform: 'claude',
      manifest: { api: { routes: [deleteRoute, forkRoute] } },
      runtime: { getDriver: () => ({ delete: deleteSession, fork }) }
    });

    await driver.delete({
      platform: 'claude',
      route: deleteRoute,
      config: { projectsDir: '/sessions' },
      params: { projectName: 'project-1', sessionId: 'session-1' },
      query: {}
    });
    await driver.fork({
      platform: 'claude',
      route: forkRoute,
      config: { projectsDir: '/sessions' },
      params: { projectName: 'project-1', sessionId: 'session-1' },
      body: { alias: 'copy' }
    });

    expect(deleteSession).toHaveBeenCalledWith('project-1', 'session-1', expect.objectContaining({
      config: { projectsDir: '/sessions' }
    }));
    expect(fork).toHaveBeenCalledWith('project-1', 'session-1', expect.objectContaining({
      alias: 'copy',
      config: { projectsDir: '/sessions' }
    }));
  });

  test('passes OMP catalog metadata request bodies through the API boundary', async () => {
    const route = { operation: 'catalogMetadata', capability: 'channels' };
    const payload = {
      providerKey: 'omp-oauth',
      allowedModels: ['gpt-5.6-luna', 'gpt-5.6-sol']
    };
    const getCatalogMetadata = vi.fn(input => ({
      models: input.allowedModels.map(id => ({ id })),
      warnings: [],
      source: { name: 'models.dev' }
    }));
    const channelsDriver = createOmpChannelsDriver({
      requireImpl: () => ({
        getChannels: () => [],
        getCatalogMetadata
      })
    });
    const driver = createApiOperationsDriver({
      platform: 'omp',
      runtime: { getDriver: () => channelsDriver },
      manifest: { api: { routes: [route] } }
    });

    await expect(driver.catalogMetadata({
      platform: 'omp',
      route,
      body: payload
    })).resolves.toMatchObject({
      status: 'ok',
      data: {
        models: [{ id: 'gpt-5.6-luna' }, { id: 'gpt-5.6-sol' }]
      }
    });
    expect(getCatalogMetadata).toHaveBeenCalledWith(payload);
  });

  test('passes Gemini search keywords and project scope through the API contract', async () => {
    const projectSearchRoute = { operation: 'search', capability: 'sessions' };
    const globalSearchRoute = { operation: 'searchAcrossProjects', capability: 'sessions' };
    const search = vi.fn(async () => ({ status: 'ok', data: [] }));
    const searchAcrossProjects = vi.fn(async () => ({ status: 'ok', data: [] }));
    const driver = createApiOperationsDriver({
      platform: 'gemini',
      manifest: { api: { routes: [projectSearchRoute, globalSearchRoute] } },
      runtime: { getDriver: () => ({ search, searchAcrossProjects }) }
    });

    await driver.search({
      platform: 'gemini',
      route: projectSearchRoute,
      params: { projectName: 'project-hash' },
      query: { keyword: 'needle', context: '21' }
    });
    await driver.searchAcrossProjects({
      platform: 'gemini',
      route: globalSearchRoute,
      params: {},
      query: { keyword: 'global needle', context: '35' }
    });

    expect(search).toHaveBeenCalledWith('project-hash', 'needle', 21, expect.any(Object));
    expect(searchAcrossProjects).toHaveBeenCalledWith('global needle', 35, expect.any(Object));
  });
});
