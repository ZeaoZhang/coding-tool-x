const path = require('path');

let registryExports;
let loaderExports;
let eventBus;

function loadFreshPluginManager() {
  delete require.cache[require.resolve('../../../src/plugins/plugin-manager')];
  return require('../../../src/plugins/plugin-manager');
}

beforeEach(() => {
  registryExports = {
    loadRegistry: vi.fn(() => ({
      plugins: {
        beta: { enabled: true, loadOrder: 20 },
        alpha: { enabled: true, loadOrder: 5 },
        disabled: { enabled: false, loadOrder: 1 }
      }
    })),
    listPlugins: vi.fn(() => [])
  };

  loaderExports = {
    loadPlugin: vi.fn((name) => ({ success: name !== 'beta', error: name === 'beta' ? 'load failed' : undefined })),
    unloadPlugin: vi.fn(() => ({ success: true })),
    getLoadedPlugins: vi.fn(() => ['alpha']),
    getLoadedPluginDetails: vi.fn((name) => {
      if (name !== 'alpha') return null;
      return {
        context: {
          _getCommands: () => new Map([['review', vi.fn(async () => 'done')]])
        }
      };
    })
  };

  eventBus = {
    emitSync: vi.fn()
  };

  require.cache[require.resolve('../../../src/plugins/registry')] = {
    id: require.resolve('../../../src/plugins/registry'),
    filename: require.resolve('../../../src/plugins/registry'),
    loaded: true,
    exports: registryExports
  };
  require.cache[require.resolve('../../../src/plugins/plugin-loader')] = {
    id: require.resolve('../../../src/plugins/plugin-loader'),
    filename: require.resolve('../../../src/plugins/plugin-loader'),
    loaded: true,
    exports: loaderExports
  };
  require.cache[require.resolve('../../../src/plugins/event-bus')] = {
    id: require.resolve('../../../src/plugins/event-bus'),
    filename: require.resolve('../../../src/plugins/event-bus'),
    loaded: true,
    exports: eventBus
  };
});

afterEach(() => {
  [
    '../../../src/plugins/plugin-manager',
    '../../../src/plugins/registry',
    '../../../src/plugins/plugin-loader',
    '../../../src/plugins/event-bus'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('plugin-manager initialization and commands', () => {
  test('initializes enabled plugins in loadOrder and records failures', () => {
    const manager = loadFreshPluginManager();

    const result = manager.initializePlugins({ config: { env: 'test' }, args: ['ctx'] });

    expect(result.loaded).toBe(1);
    expect(result.failed).toEqual([{ name: 'beta', error: 'load failed' }]);
    expect(loaderExports.loadPlugin.mock.calls.map((call) => call[0])).toEqual(['alpha', 'beta']);
    expect(manager.isPluginCommand('review')).toBe(true);
    expect(eventBus.emitSync).toHaveBeenCalledWith('cli:init', { config: { env: 'test' }, args: ['ctx'] });
  });


  test('passes parsed plugin metadata into each loader call', () => {
    const manager = loadFreshPluginManager();

    manager.initializePlugins();

    expect(loaderExports.loadPlugin.mock.calls[0][1]).toEqual({
      pluginInfo: expect.objectContaining({ loadOrder: 5, enabled: true })
    });
  });
  test('returns already initialized on second initialize call', () => {
    const manager = loadFreshPluginManager();
    manager.initializePlugins();

    const result = manager.initializePlugins();

    expect(result.message).toBe('Plugins already initialized');
    expect(loaderExports.getLoadedPlugins).toHaveBeenCalled();
  });

  test('executes plugin command and reports unknown commands', async () => {
    const manager = loadFreshPluginManager();
    manager.initializePlugins();

    const ok = await manager.executePluginCommand('review', ['--fast']);
    const missing = await manager.executePluginCommand('missing');

    expect(ok.success).toBe(true);
    expect(ok.pluginName).toBe('alpha');
    expect(missing.success).toBe(false);
  });

  test('shutdown unloads plugins in reverse order and clears command registry', async () => {
    const manager = loadFreshPluginManager();
    manager.initializePlugins();
    loaderExports.getLoadedPlugins.mockReturnValue(['alpha', 'gamma']);

    const result = manager.shutdownPlugins();

    expect(result.success).toBe(true);
    expect(loaderExports.unloadPlugin.mock.calls.map((call) => call[0])).toEqual(['gamma', 'alpha']);
    expect(eventBus.emitSync).toHaveBeenCalledWith('cli:shutdown', {});
    expect(manager.getRegisteredCommands().size).toBe(0);
    expect(manager.isInitialized()).toBe(false);
  });
});
