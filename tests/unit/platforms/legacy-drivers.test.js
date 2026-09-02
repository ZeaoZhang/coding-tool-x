'use strict';

const { createDriverRegistry, getDriverRegistry } = require('../../../src/platforms/driver-registry');
const { createPlatformRuntime } = require('../../../src/platforms/runtime');
const { spawnSync } = require('child_process');

function makeRequire(stubs) {
  const calls = [];
  const requireImpl = (modulePath) => {
    calls.push(modulePath);
    if (!Object.prototype.hasOwnProperty.call(stubs, modulePath)) {
      throw new Error(`Unexpected module load: ${modulePath}`);
    }
    return stubs[modulePath];
  };
  requireImpl.calls = calls;
  return requireImpl;
}

describe('legacy drivers', () => {
  test('lazily loads codex channels and exposes the normalized list operation', () => {
    const requireImpl = makeRequire({
      './codex/channels-implementation': {
        getChannels: vi.fn(() => ({ channels: [{ id: 'codex-channel' }] })),
        createChannel: vi.fn((...args) => ({ op: 'create', args })),
        updateChannel: vi.fn((...args) => ({ op: 'update', args })),
        deleteChannel: vi.fn((...args) => ({ op: 'delete', args })),
        syncCurrentCodexChannel: vi.fn(() => ({ op: 'sync' }))
      }
    });
    const { createLegacyDriver } = require('../../../src/platforms/drivers/legacy');
    const driver = createLegacyDriver({ platform: 'codex', capability: 'channels', requireImpl });

    expect(requireImpl.calls).toEqual([]);
    expect(driver.list()).toEqual([{ id: 'codex-channel' }]);
    expect(requireImpl.calls).toEqual(['./codex/channels-implementation']);
    expect(driver.create('name', 'provider', 'url', 'key')).toEqual({ op: 'create', args: ['name', 'provider', 'url', 'key'] });
    expect(driver.update('id', { enabled: false })).toEqual({ op: 'update', args: ['id', { enabled: false }] });
    expect(driver.remove('id')).toEqual({ op: 'delete', args: ['id'] });
    expect(driver.sync()).toEqual({ op: 'sync' });
  });

  test('normalizes Claude getAllChannels into list', () => {
    const getAllChannels = vi.fn(() => [{ id: 'claude-channel' }]);
    const requireImpl = makeRequire({
      './claude/channels-implementation': { getAllChannels }
    });
    const { createLegacyDriver } = require('../../../src/platforms/drivers/legacy');
    const driver = createLegacyDriver({ platform: 'claude', capability: 'channels', requireImpl });

    expect(driver.list()).toEqual([{ id: 'claude-channel' }]);
    expect(getAllChannels).toHaveBeenCalledTimes(1);
  });

  test('preserves unsupported non-Claude channel list results from legacy modules', () => {
    const unsupportedResult = {
      status: 'unsupported',
      platform: 'codex',
      capability: 'channels',
      operation: 'list'
    };
    const requireImpl = makeRequire({
      './codex/channels-implementation': {
        getChannels: vi.fn(() => unsupportedResult)
      }
    });
    const { createLegacyDriver } = require('../../../src/platforms/drivers/legacy');
    const driver = createLegacyDriver({ platform: 'codex', capability: 'channels', requireImpl });

    expect(driver.list()).toBe(unsupportedResult);
  });

  test('normalizes session operations and Claude argument positions', () => {
    const { createLegacyDriver } = require('../../../src/platforms/drivers/legacy');
    const config = { profile: 'claude-profile' };
    const options = { config, limit: 2 };
    const claudeGetSessions = vi.fn((...args) => ({ op: 'sessions', args }));
    const claudeRecent = vi.fn((...args) => ({ op: 'recent', args }));
    const claudeSearch = vi.fn((...args) => ({ op: 'search', args }));
    const claudeDelete = vi.fn((...args) => ({ op: 'delete', args }));
    const claudeFork = vi.fn((...args) => ({ op: 'fork', args }));
    const claudeRequireImpl = makeRequire({
      './claude/sessions-implementation': {
        getSessionsForProject: claudeGetSessions,
        getRecentSessions: claudeRecent,
        searchSessions: claudeSearch,
        deleteSession: claudeDelete,
        forkSession: claudeFork,
        getProjects: vi.fn(),
        getProjectAndSessionCounts: vi.fn()
      }
    });
    const claudeDriver = createLegacyDriver({ platform: 'claude', capability: 'sessions', requireImpl: claudeRequireImpl });

    expect(claudeDriver.listProjects).toBeUndefined();
    expect(claudeDriver.counts).toBeUndefined();
    expect(claudeDriver.listSessions('project', options)).toEqual({
      op: 'sessions',
      args: [config, 'project', options]
    });
    expect(claudeDriver.recent(3, options)).toEqual({
      op: 'recent',
      args: [config, 3]
    });
    expect(claudeDriver.search('project', 'needle', 21, options)).toEqual({
      op: 'search',
      args: [config, 'project', 'needle', 21]
    });
    expect(claudeDriver.delete('project', 'session-id', options)).toEqual({
      op: 'delete',
      args: [config, 'project', 'session-id']
    });
    expect(claudeDriver.fork('project', 'session-id', options)).toEqual({
      op: 'fork',
      args: [config, 'project', 'session-id', options]
    });

    expect(claudeGetSessions).toHaveBeenCalledWith(config, 'project', options);
    expect(claudeRecent).toHaveBeenCalledWith(config, 3);
    expect(claudeSearch).toHaveBeenCalledWith(config, 'project', 'needle', 21);
    expect(claudeDelete).toHaveBeenCalledWith(config, 'project', 'session-id');
    expect(claudeFork).toHaveBeenCalledWith(config, 'project', 'session-id', options);
    const cases = [
      ['codex', './codex/sessions-implementation', 'getSessionsByProject'],
      ['gemini', './gemini/sessions-implementation', 'getProjectSessions'],
      ['opencode', './opencode/sessions-implementation', 'getSessionsByProjectId'],
      ['omp', './omp/sessions-implementation', 'getSessionsByProject']
    ];
    for (const [platform, modulePath, listSessionsExport] of cases) {
      const exports = {
        [listSessionsExport]: vi.fn((...args) => ({ platform, op: 'sessions', args })),
        getRecentSessions: vi.fn((...args) => ({ platform, op: 'recent', args })),
        searchSessions: vi.fn((...args) => ({ platform, op: 'search', args })),
        deleteSession: vi.fn((...args) => ({ platform, op: 'delete', args })),
        forkSession: vi.fn((...args) => ({ platform, op: 'fork', args })),
        getProjectAndSessionCounts: vi.fn((...args) => ({ platform, op: 'counts', args }))
      };
      const requireImpl = makeRequire({ [modulePath]: exports });
      const driver = createLegacyDriver({ platform, capability: 'sessions', requireImpl });

      expect(driver.listProjects).toBeUndefined();
      expect(driver.counts).toBeUndefined();
      expect(driver.listSessions('project', { limit: 2 })).toEqual({ platform, op: 'sessions', args: ['project', { limit: 2 }] });
      expect(driver.recent(3)).toEqual({ platform, op: 'recent', args: [3] });
      expect(driver.search('needle')).toEqual({ platform, op: 'search', args: ['needle'] });
      expect(driver.delete('session-id')).toEqual({ platform, op: 'delete', args: ['session-id'] });
      expect(driver.fork('session-id')).toEqual({ platform, op: 'fork', args: ['session-id'] });
      expect(driver.status('session-id')).toEqual({ status: 'unsupported', platform, capability: 'sessions', operation: 'status' });
      expect(driver.messages('session-id')).toEqual({ status: 'unsupported', platform, capability: 'sessions', operation: 'messages' });
    }
  });

  test('creates project drivers for every legacy platform and maps deletion', () => {
    const cases = [
      ['claude', './claude/sessions-implementation'],
      ['codex', './codex/sessions-implementation'],
      ['gemini', './gemini/sessions-implementation'],
      ['opencode', './opencode/sessions-implementation'],
      ['omp', './omp/sessions-implementation']
    ];
    const { createLegacyDriver } = require('../../../src/platforms/drivers/legacy');

    for (const [platform, modulePath] of cases) {
      const getProjects = vi.fn((...args) => ({ op: 'projects', args }));
      const getProjectAndSessionCounts = vi.fn((...args) => ({ op: 'counts', args }));
      const deleteProject = vi.fn((...args) => ({ op: 'delete', args }));
      const requireImpl = makeRequire({ [modulePath]: { getProjects, getProjectAndSessionCounts, deleteProject } });
      const driver = createLegacyDriver({ platform, capability: 'projects', requireImpl });
      const options = { config: { profile: platform }, force: true };

      expect(driver.listProjects(options)).toEqual({ op: 'projects', args: platform === 'claude' ? [options.config] : [options] });
      expect(driver.counts(options)).toEqual({ op: 'counts', args: platform === 'claude' ? [options.config] : [options] });
      expect(driver.getProjectAndSessionCounts(options)).toEqual({ op: 'counts', args: platform === 'claude' ? [options.config] : [options] });
      expect(driver.deleteProject('project-id', options)).toEqual({ op: 'delete', args: platform === 'claude' ? [options.config, 'project-id'] : ['project-id'] });
      expect(requireImpl.calls).toEqual([modulePath]);
    }
  });

  test('prefers Claude project statistics and falls back to basic projects', () => {
    const { createLegacyDriver } = require('../../../src/platforms/drivers/legacy');
    const options = { config: { profile: 'claude-profile' }, force: true };
    const getProjectsWithStats = vi.fn((...args) => ({ op: 'rich-projects', args }));
    const getProjects = vi.fn((...args) => ({ op: 'projects', args }));
    const richDriver = createLegacyDriver({
      platform: 'claude',
      capability: 'projects',
      requireImpl: makeRequire({ './claude/sessions-implementation': { getProjectsWithStats, getProjects } })
    });

    expect(richDriver.listProjects(options)).toEqual({ op: 'rich-projects', args: [options.config, options] });
    expect(getProjectsWithStats).toHaveBeenCalledWith(options.config, options);
    expect(getProjects).not.toHaveBeenCalled();

    const fallbackGetProjects = vi.fn((...args) => ({ op: 'projects', args }));
    const fallbackDriver = createLegacyDriver({
      platform: 'claude',
      capability: 'projects',
      requireImpl: makeRequire({ './claude/sessions-implementation': { getProjects: fallbackGetProjects } })
    });
    expect(fallbackDriver.listProjects(options)).toEqual({ op: 'projects', args: [options.config] });
    expect(fallbackGetProjects).toHaveBeenCalledWith(options.config);
  });

  test('exposes Claude project order through the projects driver with config-bound arguments', () => {
    const { createLegacyDriver } = require('../../../src/platforms/drivers/legacy');
    const options = { config: { profile: 'claude-profile' }, force: true };
    const getProjectOrder = vi.fn((...args) => ({ op: 'order', args }));
    const driver = createLegacyDriver({
      platform: 'claude',
      capability: 'projects',
      requireImpl: makeRequire({ './claude/sessions-implementation': { getProjectOrder } })
    });

    expect(driver.getProjectOrder(options)).toEqual({ op: 'order', args: [options.config] });
    expect(getProjectOrder).toHaveBeenCalledWith(options.config);
  });

  test('exposes normalized statistics operations and unsupported reset when absent', () => {
    const getStatistics = vi.fn(() => ({ total: 7 }));
    const getDailyStatistics = vi.fn(date => ({ daily: date }));
    const getTodayStatistics = vi.fn(() => ({ today: true }));
    const recordRequest = vi.fn(request => ({ recorded: request.id }));
    const requireImpl = makeRequire({
      './codex/statistics-implementation': {
        getStatistics,
        getDailyStatistics,
        getTodayStatistics,
        recordRequest
      }
    });
    const { createLegacyDriver } = require('../../../src/platforms/drivers/legacy');
    const driver = createLegacyDriver({ platform: 'codex', capability: 'statistics', requireImpl });

    expect(driver.summary()).toEqual({ total: 7 });
    expect(driver.list()).toEqual({ total: 7 });
    expect(driver.daily('2026-08-27')).toEqual({ daily: '2026-08-27' });
    expect(driver.today()).toEqual({ today: true });
    expect(getDailyStatistics).toHaveBeenCalledWith('2026-08-27');
    expect(getTodayStatistics).toHaveBeenCalledWith();
    expect(driver.record({ id: 'request-1' })).toEqual({ recorded: 'request-1' });
    expect(driver.reset()).toEqual({ status: 'unsupported', platform: 'codex', capability: 'statistics', operation: 'reset' });
  });

  test('maps native configuration operations through the registry driver', () => {
    const setProxyConfig = vi.fn(port => ({ success: true, port }));
    const restoreSettings = vi.fn(() => ({ success: true }));
    const hasBackup = vi.fn(() => true);
    const deleteBackup = vi.fn(() => ({ success: true }));
    const requireImpl = makeRequire({
      './codex/native-config-implementation': {
        setProxyConfig,
        restoreSettings,
        isProxyConfig: vi.fn(() => true),
        settingsExists: vi.fn(() => true),
        hasBackup,
        deleteBackup
      }
    });
    const { createLegacyDriver } = require('../../../src/platforms/drivers/legacy');
    const driver = createLegacyDriver({ platform: 'codex', capability: 'nativeConfig', requireImpl });

    expect(driver.setProxyConfig(21111)).toEqual({ success: true, port: 21111 });
    expect(driver.restoreSettings()).toEqual({ success: true });
    expect(driver.hasBackup()).toBe(true);
    expect(driver.deleteBackup()).toEqual({ success: true });
    expect(requireImpl.calls).toEqual(['./codex/native-config-implementation']);
  });

  test('falls back statistics daily and today operations to getTodayStatistics when needed', () => {
    const getTodayStatistics = vi.fn(() => ({ today: true }));
    const requireImpl = makeRequire({
      './gemini/statistics-implementation': { getTodayStatistics }
    });
    const { createLegacyDriver } = require('../../../src/platforms/drivers/legacy');
    const driver = createLegacyDriver({ platform: 'gemini', capability: 'statistics', requireImpl });

    expect(driver.daily()).toEqual({ today: true });
    expect(driver.today()).toEqual({ today: true });
    expect(getTodayStatistics).toHaveBeenCalledTimes(2);
  });

  test('uses real require cache stubs for config paths, codex channels, omp channels, and proxy drivers', () => {
    const script = `
      const assert = require('assert');
      const pathsPath = require.resolve('./src/config/paths');
      const codexChannelsPath = require.resolve('./src/platforms/drivers/codex/channels-implementation');
      const ompChannelsPath = require.resolve('./src/platforms/drivers/omp/channels-implementation');
      const ompProxyPath = require.resolve('./src/platforms/drivers/omp/proxy-implementation');
      const codexProxyPath = require.resolve('./src/platforms/drivers/codex/proxy-implementation');
      const originals = new Map();
      const unsupportedResult = { status: 'unsupported', platform: 'codex', capability: 'channels', operation: 'list' };
      const ompChannelsResult = { channels: [{ id: 'omp-channel' }] };
      const calls = [];
      const startOmpProxyServer = options => { calls.push(['omp-start', options]); return { op: 'omp-start', options }; };
      const stopOmpProxyServer = options => { calls.push(['omp-stop', options]); return { op: 'omp-stop', options }; };
      const startCodexProxyServer = options => { calls.push(['codex-start', options]); return { op: 'codex-start', options }; };
      const stopCodexProxyServer = options => { calls.push(['codex-stop', options]); return { op: 'codex-stop', options }; };
      function stub(modulePath, exports) {
        originals.set(modulePath, require.cache[modulePath]);
        delete require.cache[modulePath];
        require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports };
      }
      try {
        stub(pathsPath, { PATHS: { activeChannel: { codex: '/tmp/codex-active.json' } } });
        stub(codexChannelsPath, { getChannels: () => unsupportedResult });
        stub(ompChannelsPath, { getChannels: () => ompChannelsResult });
        stub(ompProxyPath, {
          getOmpProxyStatus: () => ({ running: true, port: 20092 }),
          startOmpProxyServer,
          stopOmpProxyServer
        });
        stub(codexProxyPath, {
          getCodexProxyStatus: () => ({ running: false, port: null }),
          startCodexProxyServer,
          stopCodexProxyServer
        });
        const { createLegacyDriver } = require('./src/platforms/drivers/legacy');
        assert.strictEqual(require('./src/config/paths').PATHS.activeChannel.codex, '/tmp/codex-active.json');
        assert.strictEqual(createLegacyDriver({ platform: 'codex', capability: 'channels' }).list(), unsupportedResult);
        assert.deepStrictEqual(createLegacyDriver({ platform: 'omp', capability: 'channels' }).list(), ompChannelsResult.channels);
        assert.deepStrictEqual(require.cache[ompChannelsPath].exports.getChannels(), ompChannelsResult);
        assert.strictEqual(require.cache[ompChannelsPath].loaded, true);
        const ompDriver = createLegacyDriver({ platform: 'omp', capability: 'proxy' });
        const ompStartOptions = { preserveManagedMode: true, forceAfterMs: 25 };
        const ompStopOptions = { drain: true, restoration: { activeChannelId: 'channel-1' } };
        assert.deepStrictEqual(ompDriver.start(ompStartOptions), { op: 'omp-start', options: ompStartOptions });
        assert.deepStrictEqual(ompDriver.stop(ompStopOptions), { op: 'omp-stop', options: ompStopOptions });
        assert.deepStrictEqual(calls.slice(0, 2), [['omp-start', ompStartOptions], ['omp-stop', ompStopOptions]]);
        const codexDriver = createLegacyDriver({ platform: 'codex', capability: 'proxy' });
        assert.deepStrictEqual(codexDriver.start({ port: 21111 }), { op: 'codex-start', options: { port: 21111 } });
        assert.deepStrictEqual(codexDriver.stop({ clearStartTime: false }), { op: 'codex-stop', options: { clearStartTime: false } });
      } finally {
        for (const [modulePath, original] of originals.entries()) {
          if (original) require.cache[modulePath] = original;
          else delete require.cache[modulePath];
        }
      }
    `;

    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: process.cwd(),
      encoding: 'utf8'
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  test('passes OMP proxy lifecycle options through exactly', async () => {
    const startOmpProxyServer = vi.fn(options => ({ op: 'start', options }));
    const stopOmpProxyServer = vi.fn(options => ({ op: 'stop', options }));
    const getOmpProxyStatus = vi.fn(() => ({ running: true, port: 20092 }));
    const requireImpl = makeRequire({
      './omp/proxy-implementation': {
        startOmpProxyServer,
        stopOmpProxyServer,
        getOmpProxyStatus
      }
    });
    const { createLegacyDriver } = require('../../../src/platforms/drivers/legacy');
    const driver = createLegacyDriver({ platform: 'omp', capability: 'proxy', requireImpl });

    const startOptions = { preserveManagedMode: true, forceAfterMs: 25 };
    const stopOptions = { drain: true, restoration: { activeChannelId: 'channel-1' } };
    expect(await driver.start(startOptions)).toEqual({ op: 'start', options: startOptions });
    expect(await driver.stop(stopOptions)).toEqual({ op: 'stop', options: stopOptions });
    expect(driver.status()).toEqual({ running: true, port: 20092 });
    expect(startOmpProxyServer).toHaveBeenCalledWith(startOptions);
    expect(stopOmpProxyServer).toHaveBeenCalledWith(stopOptions);
  });

  test('passes non-OMP proxy lifecycle calls through', async () => {
    const startCodexProxyServer = vi.fn(options => ({ op: 'start', options }));
    const stopCodexProxyServer = vi.fn(options => ({ op: 'stop', options }));
    const getCodexProxyStatus = vi.fn(() => ({ running: false, port: null }));
    const requireImpl = makeRequire({
      './codex/proxy-implementation': {
        startCodexProxyServer,
        stopCodexProxyServer,
        getCodexProxyStatus
      }
    });
    const { createLegacyDriver } = require('../../../src/platforms/drivers/legacy');
    const driver = createLegacyDriver({ platform: 'codex', capability: 'proxy', requireImpl });

    expect(driver.status()).toEqual({ running: false, port: null });
    expect(await driver.start({ port: 21111 })).toEqual({ op: 'start', options: { port: 21111 } });
    expect(await driver.stop({ clearStartTime: false })).toEqual({ op: 'stop', options: { clearStartTime: false } });
  });

  test('restores a standard proxy through the driver and syncs native config', async () => {
    const startCodexProxyServer = vi.fn(async options => ({ success: true, port: 21111, options }));
    const setProxyConfig = vi.fn(() => ({ success: true }));
    const requireImpl = makeRequire({
      './codex/proxy-implementation': { startCodexProxyServer },
      './codex/native-config-implementation': { setProxyConfig }
    });
    const { createLegacyDriver } = require('../../../src/platforms/drivers/legacy');
    const driver = createLegacyDriver({
      platform: 'codex',
      capability: 'proxy',
      requireImpl,
      manifest: { portKey: 'codexProxy', defaultPort: 20089 }
    });

    await expect(driver.restoreOnBoot({ config: { ports: { codexProxy: 21111 } } }))
      .resolves.toMatchObject({ status: 'ok', platform: 'codex', port: 21111 });
    expect(startCodexProxyServer).toHaveBeenCalledWith({});
    expect(setProxyConfig).toHaveBeenCalledWith(21111);
  });

  test('returns an explicit unsupported result for missing legacy operations', () => {
    const requireImpl = makeRequire({
      './omp/channels-implementation': {
        getChannels: vi.fn(() => ({ channels: [] }))
      }
    });
    const { createLegacyDriver } = require('../../../src/platforms/drivers/legacy');
    const driver = createLegacyDriver({ platform: 'omp', capability: 'channels', requireImpl });

    expect(driver.reset()).toEqual({
      status: 'unsupported',
      platform: 'omp',
      capability: 'channels',
      operation: 'reset'
    });
  });

  test('dispatches MCP and prompt capabilities to built-in Drivers', () => {
    const mcpRead = vi.fn(() => ({ status: 'ok', data: { mcpServers: {} } }));
    const mcpWrite = vi.fn(() => ({ status: 'ok', data: { saved: true } }));
    const promptRead = vi.fn(() => ({ status: 'ok', data: 'codex prompt' }));
    const promptWrite = vi.fn(() => ({ status: 'ok', data: { saved: true } }));
    const requireImpl = makeRequire({
      './codex/mcp': {
        createDriver: vi.fn(() => ({ read: mcpRead, write: mcpWrite }))
      },
      './codex/prompts': {
        createDriver: vi.fn(() => ({ read: promptRead, write: promptWrite }))
      }
    });
    const { createLegacyDriver } = require('../../../src/platforms/drivers/legacy');
    const mcpDriver = createLegacyDriver({
      platform: 'codex',
      capability: 'mcp',
      requireImpl,
      useBuiltInDrivers: true
    });
    const promptDriver = createLegacyDriver({
      platform: 'codex',
      capability: 'prompts',
      requireImpl,
      useBuiltInDrivers: true
    });

    expect(mcpDriver.read()).toEqual({ mcpServers: {} });
    expect(mcpDriver.write({ mcpServers: { demo: {} } })).toEqual({ saved: true });
    expect(promptDriver.read()).toBe('codex prompt');
    expect(promptDriver.write('content')).toEqual({ saved: true });
    expect(mcpRead).toHaveBeenCalledWith();
    expect(mcpWrite).toHaveBeenCalledWith({ mcpServers: { demo: {} } });
    expect(promptRead).toHaveBeenCalledWith();
    expect(promptWrite).toHaveBeenCalledWith('content');
    expect(requireImpl.calls).toEqual(['./codex/mcp', './codex/prompts']);

    expect(createLegacyDriver({
      platform: 'codex',
      capability: 'mcp',
      requireImpl: makeRequire({}),
      useBuiltInDrivers: false
    })).toEqual({ status: 'unsupported', platform: 'codex', capability: 'mcp' });
  });

  test('registers legacy factories without loading config paths or implementation modules', () => {
    const requireImpl = makeRequire({});
    const { registerLegacyDrivers } = require('../../../src/platforms/drivers/legacy');
    const registry = createDriverRegistry();

    registerLegacyDrivers(registry, { requireImpl });

    expect(registry.ids()).toEqual(expect.arrayContaining([
      'legacy:claude',
      'legacy:codex',
      'legacy:gemini',
      'legacy:opencode',
      'legacy:omp'
    ]));
    expect(requireImpl.calls).toEqual([]);
  });

  test('default registry creates legacy drivers instead of temporary unsupported factories', () => {
    const registry = getDriverRegistry();
    const driver = registry.create('legacy:claude', { platform: 'claude', capability: 'channels' });

    expect(driver).toEqual(expect.objectContaining({
      platform: 'claude',
      capability: 'channels'
    }));
    expect(typeof driver.list).toBe('function');
    expect(driver.status).toBeUndefined();
  });

  test('runtime caches stubs for registry-backed legacy drivers', () => {
    const requireImpl = makeRequire({
      './codex/channels-implementation': {
        getChannels: vi.fn(() => ({ channels: [{ id: 'codex-channel' }] }))
      }
    });
    const { registerLegacyDrivers } = require('../../../src/platforms/drivers/legacy');
    const driverRegistry = createDriverRegistry();
    registerLegacyDrivers(driverRegistry, { requireImpl });
    const platformRegistry = {
      getCapability: vi.fn(() => 'legacy:codex'),
      resolve: vi.fn(() => ({ key: 'codex', capabilities: { channels: 'legacy:codex' } })),
      resolvePaths: vi.fn(() => ({ home: '/tmp/codex' }))
    };
    const runtime = createPlatformRuntime({ registry: platformRegistry, driverRegistry });

    expect(runtime.invoke('codex', 'channels', 'list')).toEqual([{ id: 'codex-channel' }]);
    expect(platformRegistry.resolvePaths).not.toHaveBeenCalled();
    expect(requireImpl.calls).toEqual(['./codex/channels-implementation']);
  });
});
