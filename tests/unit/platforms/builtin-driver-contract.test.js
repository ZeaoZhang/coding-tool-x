'use strict';

const platforms = ['claude', 'codex', 'gemini', 'opencode', 'omp'];

function serviceFor(platform, channels = []) {
  const list = platform === 'claude' ? () => channels : () => ({ channels });
  const syncName = {
    claude: 'syncCurrentClaudeChannel',
    codex: 'syncCurrentCodexChannel',
    gemini: 'syncCurrentGeminiChannel',
    opencode: 'syncCurrentOpenCodeChannel',
    omp: 'syncCurrentOmpChannel'
  }[platform];
  return {
    [platform === 'claude' ? 'getAllChannels' : 'getChannels']: list,
    getEnabledChannels: () => channels,
    createChannel: input => input,
    updateChannel: (id, patch) => ({ id, ...patch }),
    deleteChannel: id => ({ success: true, id }),
    markChannelAsRecentlyUsed: id => ({ id }),
    applyChannelToSettings: id => ({ id }),
    getEffectiveApiKey: channel => channel.apiKey || null,
    disableAllChannels: () => undefined,
    [syncName]: () => ({ synced: true })
  };
}

describe('built-in channel Driver contract', () => {
  test.each(platforms)('%s exposes the stable channel operations', platform => {
    const driverModule = require(`../../../src/platforms/drivers/${platform}/channels`);
    const servicePath = {
      claude: './claude/channels-implementation',
      codex: './codex/channels-implementation',
      gemini: './gemini/channels-implementation',
      opencode: './opencode/channels-implementation',
      omp: './omp/channels-implementation'
    }[platform];
    const driver = driverModule.createDriver({
      requireImpl: requested => requested === servicePath ? serviceFor(platform) : null
    });

    for (const operation of ['list', 'getEnabled', 'create', 'update', 'remove', 'syncCurrent', 'applyNativeConfig', 'getEffectiveApiKey', 'disableAll']) {
      expect(typeof driver[operation]).toBe('function');
    }
  });


  test('returns sanitized channel DTOs with platform extensions in extra', () => {
    const { createDriver } = require('../../../src/platforms/drivers/claude/channels');
    const driver = createDriver({
      requireImpl: () => serviceFor('claude', [{ id: 'one', name: 'One', apiKey: 'secret', customFlag: true }])
    });

    const result = driver.list();
    expect(result).toMatchObject({ status: 'ok', platform: 'claude', capability: 'channels', operation: 'list' });
    expect(result.data.channels[0]).toEqual({ id: 'one', name: 'One', extra: { customFlag: true } });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  test.each(platforms)('%s reports invalid input with operation context', platform => {
    const driverModule = require(`../../../src/platforms/drivers/${platform}/channels`);
    const driver = driverModule.createDriver({ requireImpl: () => serviceFor(platform) });
    expect(driver.update('', null)).toEqual(expect.objectContaining({
      status: 'invalid', platform, capability: 'channels', operation: 'update'
    }));
  });

  test('preserves native failures as non-enumerable causes', () => {
    const { createDriver } = require('../../../src/platforms/drivers/codex/channels');
    const cause = new Error('native storage unavailable');
    const driver = createDriver({
      requireImpl: () => ({ getChannels: () => { throw cause; } })
    });
    const result = driver.list();
    expect(result).toMatchObject({ status: 'failed', platform: 'codex', capability: 'channels', operation: 'list' });
    expect(result.cause).toBe(cause);
    expect(Object.keys(result)).not.toContain('cause');
  });

  test('resolves migrated resource capabilities through built-in Drivers', () => {
    const { getPlatformRuntime } = require('../../../src/platforms/runtime');
    const runtime = getPlatformRuntime();
    for (const platform of platforms) {
      for (const capability of ['resourceSync', 'mcp']) {
        expect(runtime.getDriver(platform, capability)).toBeTruthy();
      }
      if (platform !== 'omp') {
        expect(runtime.getDriver(platform, 'prompts')).toBeTruthy();
      }
    }
  });

  test('resolves every built-in manifest capability through Runtime', () => {
    const { getPlatformRuntime } = require('../../../src/platforms/runtime');
    const runtime = getPlatformRuntime();
    for (const platform of platforms) {
      for (const capability of ['channels', 'projects', 'proxy', 'sessions']) {
        expect(runtime.getDriver(platform, capability)).toBeTruthy();
      }
      expect(runtime.getDriver(platform, 'does-not-exist')).toBeNull();
    }
  });
});
describe('built-in project Driver contract', () => {
  test.each(platforms)('%s exposes project operations and adapts platform config', platform => {
    const service = {
      getProjects: vi.fn((...args) => ({ projects: [], args })),
      getProjectAndSessionCounts: vi.fn((...args) => ({ projectCount: 0, sessionCount: 0, args })),
      getProjectOrder: vi.fn((...args) => ({ order: [], args })),
      saveProjectOrder: vi.fn((...args) => ({ saved: true, args })),
      deleteProject: vi.fn((...args) => ({ deleted: true, args }))
    };
    if (platform === 'claude') {
      service.getProjectsWithStats = vi.fn((...args) => ({ projects: [], stats: {}, args }));
    }

    const driver = require(`../../../src/platforms/drivers/${platform}/projects`).createDriver({
      requireImpl: () => service
    });
    const options = { config: { profile: `${platform}-profile` }, force: true };

    expect(driver.listProjects(options)).toMatchObject({
      status: 'ok',
      platform,
      capability: 'projects',
      operation: 'listProjects'
    });
    expect(driver.getProjectAndSessionCounts(options)).toMatchObject({
      status: 'ok',
      operation: 'getProjectAndSessionCounts'
    });
    expect(driver.saveProjectOrder(['one'], options)).toMatchObject({
      status: 'ok',
      operation: 'saveProjectOrder'
    });
    expect(driver.deleteProject('one', options)).toMatchObject({
      status: 'ok',
      operation: 'deleteProject'
    });

    const expectedConfig = platform === 'claude' ? options.config : options;
    const projectsCall = platform === 'claude'
      ? service.getProjectsWithStats.mock.calls[0]
      : service.getProjects.mock.calls[0];
    expect(projectsCall[0]).toEqual(expectedConfig);
    if (platform === 'claude') expect(projectsCall[1]).toEqual(options);
    expect(service.getProjectAndSessionCounts).toHaveBeenCalledWith(expectedConfig);
    expect(service.saveProjectOrder).toHaveBeenCalledWith(
      ...(platform === 'claude' ? [options.config, ['one']] : [['one']])
    );
    expect(service.deleteProject).toHaveBeenCalledWith(
      ...(platform === 'claude' ? [options.config, 'one'] : ['one'])
    );
  });
});

describe('built-in session and statistics Driver contracts', () => {
  test.each(platforms)('%s exposes session operations through its Driver', platform => {
    const service = new Proxy({}, {
      get: () => vi.fn(() => [])
    });
    const driver = require(`../../../src/platforms/drivers/${platform}/sessions`).createDriver({
      requireImpl: () => service
    });

    for (const operation of ['listSessions', 'recent', 'search', 'delete', 'fork']) {
      expect(typeof driver[operation]).toBe('function');
    }
  });

  test.each(platforms)('%s exposes statistics operations through its Driver', platform => {
    const service = new Proxy({}, {
      get: () => vi.fn(() => ({}))
    });
    const driver = require(`../../../src/platforms/drivers/${platform}/statistics`).createDriver({
      requireImpl: () => service
    });

    for (const operation of ['getStatistics', 'getDailyStatistics', 'getTodayStatistics', 'recordRequest', 'resetStatistics']) {
      expect(typeof driver[operation]).toBe('function');
    }
    expect(driver.getStatistics()).toMatchObject({
      status: 'ok',
      platform,
      capability: 'statistics',
      operation: 'getStatistics'
    });
  });
});
