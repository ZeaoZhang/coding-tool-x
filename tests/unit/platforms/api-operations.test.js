'use strict';

const { createApiOperationsDriver } = require('../../../src/shared/driver-factories/api');

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
});
