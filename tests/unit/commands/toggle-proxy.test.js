'use strict';

const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const MODULE_PATH = require.resolve('../../../src/commands/toggle-proxy');
const CONFIG_PATH = require.resolve('../../../src/config/loader');
const RUNTIME_PATH = require.resolve('../../../src/platforms/runtime');

let originalConfigCache;
let runtimePlatform;
let runtimeDriverFactory;
let originalRuntimeCache;

beforeEach(() => {
  runtimePlatform = 'omp';
  runtimeDriverFactory = null;
  originalConfigCache = require.cache[CONFIG_PATH];
  originalRuntimeCache = require.cache[RUNTIME_PATH];
  require.cache[CONFIG_PATH] = {
    id: CONFIG_PATH,
    filename: CONFIG_PATH,
    loaded: true,
    exports: {
      loadConfig: vi.fn(() => ({ ports: { ompProxy: 29992 }, currentCliType: runtimePlatform }))
    }
  };
  require.cache[RUNTIME_PATH] = {
    id: RUNTIME_PATH,
    filename: RUNTIME_PATH,
    loaded: true,
    exports: {
      getPlatformRuntime: vi.fn(() => ({
        getDriver: vi.fn((platform, capability) => {
          expect(platform).toBe(runtimePlatform);
          if (runtimeDriverFactory) {
            return runtimeDriverFactory(platform, capability);
          }
          if (capability === 'proxy') {
            return {
              getCliMetadata: () => ({ defaultPort: 29992, managedProviderConfig: true }),
              status: vi.fn(() => ({ running: false, defaultPort: 29992 })),
              start: vi.fn(),
              stop: vi.fn()
            };
          }
          if (capability === 'channels') {
            return {
              getCliMetadata: () => ({ managedProviderConfig: true }),
              list: vi.fn(() => ({ status: 'ok', data: { channels: [] } }))
            };
          }
          return null;
        })
      })),
      getPlatformRegistry: () => ({
        resolve: platform => ({ key: platform, label: platform.toUpperCase() })
      })
    }
  };
  delete require.cache[MODULE_PATH];
});

afterEach(() => {
  delete require.cache[MODULE_PATH];
  if (originalConfigCache) {
    require.cache[CONFIG_PATH] = originalConfigCache;
  } else {
    delete require.cache[CONFIG_PATH];
  }
  if (originalRuntimeCache) {
    require.cache[RUNTIME_PATH] = originalRuntimeCache;
  } else {
    delete require.cache[RUNTIME_PATH];
  }
});

describe('toggle-proxy command helpers', () => {
  test('routes omp through the Runtime proxy Driver', () => {
    const { _test } = require('../../../src/commands/toggle-proxy');
    const services = _test.getProxyServices('omp');

    expect(services.defaultPort).toBe(29992);
    expect(services.managedProviderConfig).toBe(true);
    expect(services.getProxyStatus()).toEqual({ running: false, defaultPort: 29992 });
  });

  test('resolves native config operations through the platform runtime', () => {
    const setProxyConfig = vi.fn();
    const runtime = {
      getDriver: vi.fn((platform, capability) => {
        expect(platform).toBe('demo-cli');
        if (capability === 'nativeConfig') {
          return {
            setProxyConfig,
            restoreSettings: vi.fn(),
            hasBackup: vi.fn(() => true),
            deleteBackup: vi.fn()
          };
        }
        return { status: 'unsupported' };
      })
    };
    const { _test } = require('../../../src/commands/toggle-proxy');

    const manager = _test.getSettingsManager('demo-cli', runtime);
    manager.setProxyConfig(23100);

    expect(setProxyConfig).toHaveBeenCalledWith(23100);
    expect(runtime.getDriver).toHaveBeenCalledWith('demo-cli', 'nativeConfig');
  });

  test('keeps platform implementation out of the proxy command', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../../src/commands/toggle-proxy.js'),
      'utf8'
    );

    expect(source).not.toMatch(/server\/services\/(?:channels|.*settings-manager|native-oauth-adapters)/);
    expect(source).not.toMatch(/server\/(?:codex|gemini|opencode|omp-)?proxy-server/);
    expect(source).not.toMatch(/(?:cliType|normalizedCliType)\s*===\s*['"](?:claude|codex|gemini|opencode|omp)['"]/);
  });

  test('starts Codex proxy without deleting native OAuth credentials', async () => {
    runtimePlatform = 'codex';
    const events = [];
    const proxyDriver = {
      getCliMetadata: () => ({
        defaultPort: 20089,
        managedProviderConfig: false
      }),
      status: vi.fn(() => ({ running: false })),
      start: vi.fn(async () => {
        events.push('start');
        return { success: true, port: 20089 };
      }),
      stop: vi.fn()
    };
    const channelDriver = {
      getCliMetadata: () => ({ managedProviderConfig: false }),
      list: vi.fn(() => ({ status: 'ok', data: { channels: [] } }))
    };
    const nativeConfigDriver = {
      preserveNativeOAuthOnProxyStart: true,
      restoreNativeSettingsOnProxyStop: true,
      setProxyConfig: vi.fn(() => events.push('set')),
      clearNativeOAuth: vi.fn(() => events.push('clear')),
      hasBackup: vi.fn(() => true)
    };
    runtimeDriverFactory = (_platform, capability) => (
      capability === 'proxy'
        ? proxyDriver
        : capability === 'channels'
          ? channelDriver
          : capability === 'nativeConfig'
            ? nativeConfigDriver
            : null
    );
    const prompt = vi.spyOn(inquirer, 'prompt')
      .mockResolvedValueOnce({ confirm: true })
      .mockResolvedValueOnce({ continue: '' });

    await require('../../../src/commands/toggle-proxy').handleToggleProxy();

    expect(events).toEqual(['start', 'set']);
    expect(nativeConfigDriver.clearNativeOAuth).not.toHaveBeenCalled();
    prompt.mockRestore();
  });

  test('restores Codex native settings before deleting the backup', async () => {
    runtimePlatform = 'codex';
    const events = [];
    const proxyDriver = {
      getCliMetadata: () => ({
        defaultPort: 20089,
        managedProviderConfig: false
      }),
      status: vi.fn(() => ({ running: true, port: 20089 })),
      start: vi.fn(),
      stop: vi.fn(async () => {
        events.push('stop');
        return { success: true };
      })
    };
    const channelDriver = {
      getCliMetadata: () => ({ managedProviderConfig: false }),
      list: vi.fn(() => ({ status: 'ok', data: { channels: [] } }))
    };
    const nativeConfigDriver = {
      preserveNativeOAuthOnProxyStart: true,
      restoreNativeSettingsOnProxyStop: true,
      setProxyConfig: vi.fn(),
      hasBackup: vi.fn(() => true),
      restoreSettings: vi.fn(() => events.push('restore')),
      deleteBackup: vi.fn(() => events.push('delete'))
    };
    runtimeDriverFactory = (_platform, capability) => (
      capability === 'proxy'
        ? proxyDriver
        : capability === 'channels'
          ? channelDriver
          : capability === 'nativeConfig'
            ? nativeConfigDriver
            : null
    );
    const prompt = vi.spyOn(inquirer, 'prompt')
      .mockResolvedValueOnce({ confirm: true })
      .mockResolvedValueOnce({ continue: '' });

    await require('../../../src/commands/toggle-proxy').handleToggleProxy();

    expect(events).toEqual(['stop', 'restore']);
    expect(nativeConfigDriver.restoreSettings).toHaveBeenCalled();
    expect(nativeConfigDriver.deleteBackup).not.toHaveBeenCalled();
    prompt.mockRestore();
  });
  test('clears native OAuth before starting a non-Codex proxy', async () => {
    runtimePlatform = 'gemini';
    const events = [];
    const proxyDriver = {
      getCliMetadata: () => ({ defaultPort: 7654, managedProviderConfig: false }),
      status: vi.fn(() => ({ running: false })),
      start: vi.fn(async () => {
        events.push('start');
        return { success: true, port: 7654 };
      }),
      stop: vi.fn()
    };
    const channelDriver = {
      getCliMetadata: () => ({ managedProviderConfig: false }),
      list: vi.fn(() => ({ status: 'ok', data: { channels: [] } }))
    };
    const nativeConfigDriver = {
      clearNativeOAuth: vi.fn(() => events.push('clear')),
      setProxyConfig: vi.fn(() => events.push('set')),
      hasBackup: vi.fn(() => true)
    };
    runtimeDriverFactory = (_platform, capability) => (
      capability === 'proxy'
        ? proxyDriver
        : capability === 'channels'
          ? channelDriver
          : capability === 'nativeConfig'
            ? nativeConfigDriver
            : null
    );
    const prompt = vi.spyOn(inquirer, 'prompt')
      .mockResolvedValueOnce({ confirm: true })
      .mockResolvedValueOnce({ continue: '' });

    await require('../../../src/commands/toggle-proxy').handleToggleProxy();

    expect(events).toEqual(['start', 'clear', 'set']);
    expect(nativeConfigDriver.clearNativeOAuth).toHaveBeenCalledWith('gemini');
    prompt.mockRestore();
  });

  test('deletes non-Codex backups instead of restoring user edits', async () => {
    runtimePlatform = 'gemini';
    const events = [];
    const proxyDriver = {
      getCliMetadata: () => ({ defaultPort: 7654, managedProviderConfig: false }),
      status: vi.fn(() => ({ running: true })),
      start: vi.fn(),
      stop: vi.fn(async () => {
        events.push('stop');
        return { success: true };
      })
    };
    const channelDriver = {
      getCliMetadata: () => ({ managedProviderConfig: false }),
      list: vi.fn(() => ({ status: 'ok', data: { channels: [] } }))
    };
    const nativeConfigDriver = {
      setProxyConfig: vi.fn(),
      hasBackup: vi.fn(() => true),
      restoreSettings: vi.fn(() => events.push('restore')),
      deleteBackup: vi.fn(() => events.push('delete'))
    };
    runtimeDriverFactory = (_platform, capability) => (
      capability === 'proxy'
        ? proxyDriver
        : capability === 'channels'
          ? channelDriver
          : capability === 'nativeConfig'
            ? nativeConfigDriver
            : null
    );
    const prompt = vi.spyOn(inquirer, 'prompt')
      .mockResolvedValueOnce({ confirm: true })
      .mockResolvedValueOnce({ continue: '' });

    await require('../../../src/commands/toggle-proxy').handleToggleProxy();

    expect(events).toEqual(['stop', 'delete']);
    expect(nativeConfigDriver.restoreSettings).not.toHaveBeenCalled();
    expect(nativeConfigDriver.deleteBackup).toHaveBeenCalled();
    prompt.mockRestore();
  });
});
