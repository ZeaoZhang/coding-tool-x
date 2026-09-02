'use strict';

const fs = require('fs');
const path = require('path');
const MODULE_PATH = require.resolve('../../../src/commands/toggle-proxy');
const CONFIG_PATH = require.resolve('../../../src/config/loader');
const RUNTIME_PATH = require.resolve('../../../src/platforms/runtime');

let originalConfigCache;
let originalRuntimeCache;

beforeEach(() => {
  originalConfigCache = require.cache[CONFIG_PATH];
  originalRuntimeCache = require.cache[RUNTIME_PATH];
  require.cache[CONFIG_PATH] = {
    id: CONFIG_PATH,
    filename: CONFIG_PATH,
    loaded: true,
    exports: {
      loadConfig: vi.fn(() => ({ ports: { ompProxy: 29992 }, currentCliType: 'omp' }))
    }
  };
  require.cache[RUNTIME_PATH] = {
    id: RUNTIME_PATH,
    filename: RUNTIME_PATH,
    loaded: true,
    exports: {
      getPlatformRuntime: vi.fn(() => ({
        getDriver: vi.fn((platform, capability) => {
          expect(platform).toBe('omp');
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
});
