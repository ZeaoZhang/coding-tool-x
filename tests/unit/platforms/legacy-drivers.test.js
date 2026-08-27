'use strict';

const { createDriverRegistry, getDriverRegistry } = require('../../../src/platforms/driver-registry');
const { createPlatformRuntime } = require('../../../src/platforms/runtime');

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
      '../../server/services/codex-channels': {
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
    expect(requireImpl.calls).toEqual(['../../server/services/codex-channels']);
    expect(driver.create('name', 'provider', 'url', 'key')).toEqual({ op: 'create', args: ['name', 'provider', 'url', 'key'] });
    expect(driver.update('id', { enabled: false })).toEqual({ op: 'update', args: ['id', { enabled: false }] });
    expect(driver.remove('id')).toEqual({ op: 'delete', args: ['id'] });
    expect(driver.sync()).toEqual({ op: 'sync' });
  });

  test('normalizes Claude getAllChannels into list', () => {
    const getAllChannels = vi.fn(() => [{ id: 'claude-channel' }]);
    const requireImpl = makeRequire({
      '../../server/services/channels': { getAllChannels }
    });
    const { createLegacyDriver } = require('../../../src/platforms/drivers/legacy');
    const driver = createLegacyDriver({ platform: 'claude', capability: 'channels', requireImpl });

    expect(driver.list()).toEqual([{ id: 'claude-channel' }]);
    expect(getAllChannels).toHaveBeenCalledTimes(1);
  });

  test('passes OMP proxy lifecycle options through exactly', async () => {
    const startOmpProxyServer = vi.fn(options => ({ op: 'start', options }));
    const stopOmpProxyServer = vi.fn(options => ({ op: 'stop', options }));
    const getOmpProxyStatus = vi.fn(() => ({ running: true, port: 20092 }));
    const requireImpl = makeRequire({
      '../../server/omp-proxy-server': {
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
      '../../server/codex-proxy-server': {
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

  test('returns an explicit unsupported result for missing legacy operations', () => {
    const requireImpl = makeRequire({
      '../../server/services/omp-channels': {
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
      '../../server/services/codex-channels': {
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
    expect(platformRegistry.resolvePaths).toHaveBeenCalledWith('codex', {});
    expect(requireImpl.calls).toEqual(['../../server/services/codex-channels']);
  });
});
