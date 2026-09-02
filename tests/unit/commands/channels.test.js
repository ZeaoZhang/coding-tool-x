'use strict';

const fs = require('fs');
const path = require('path');
const MODULE_PATH = require.resolve('../../../src/commands/channels');
const RUNTIME_PATH = require.resolve('../../../src/platforms/runtime');

let originalRuntimeCache;

beforeEach(() => {
  originalRuntimeCache = require.cache[RUNTIME_PATH];
  require.cache[RUNTIME_PATH] = {
    id: RUNTIME_PATH,
    filename: RUNTIME_PATH,
    loaded: true,
    exports: {
      getPlatformRuntime: vi.fn(() => ({
        getDriver: vi.fn((platform, capability) => {
          if (capability === 'channels' && platform === 'omp') {
            return {
              getCliMetadata: () => ({
                supportsCliCreate: false,
                managedProviderConfig: true
              }),
              list: () => ({ status: 'ok', data: { channels: [{ id: 'omp-1', name: 'OMP One' }] } })
            };
          }
          if (capability === 'proxy' && platform === 'omp') {
            return {
              getCliMetadata: () => ({ defaultPort: 20092, managedProviderConfig: true }),
              status: () => ({ running: true })
            };
          }
          return null;
        })
      })),
      getPlatformRegistry: () => ({
        list: () => [{ key: 'omp', label: 'OMP' }]
      })
    }
  };
  delete require.cache[MODULE_PATH];
});

afterEach(() => {
  delete require.cache[MODULE_PATH];
  if (originalRuntimeCache) {
    require.cache[RUNTIME_PATH] = originalRuntimeCache;
  } else {
    delete require.cache[RUNTIME_PATH];
  }
});

describe('channels command helpers', () => {
  test('includes configured platforms in scheduler status sources', () => {
    const { _test } = require('../../../src/commands/channels');

    expect(_test.buildSchedulerSources()).toEqual([
      { key: 'omp', label: 'OMP' }
    ]);
  });

  test('routes omp channel services through Runtime Drivers', () => {
    const { _test } = require('../../../src/commands/channels');
    const services = _test.getChannelServices('omp');

    expect(services.supportsCliCreate).toBe(false);
    expect(services.managedProviderConfig).toBe(true);
    expect(services.getAllChannels()).toEqual([{ id: 'omp-1', name: 'OMP One' }]);
    expect(services.getProxyStatus()).toEqual({ running: true });
  });

  test('keeps platform implementation out of the channel command', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../../src/commands/channels.js'),
      'utf8'
    );

    expect(source).not.toMatch(/server\/services\/(?:channels|codex-channels|gemini-channels|opencode-channels|omp-channels)/);
    expect(source).not.toMatch(/server\/(?:codex|gemini|opencode|omp-)?proxy-server/);
    expect(source).not.toMatch(/(?:cliType|normalizedCliType)\s*===\s*['"](?:claude|codex|gemini|opencode|omp)['"]/);
  });
});
