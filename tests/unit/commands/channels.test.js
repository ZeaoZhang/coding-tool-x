'use strict';

const MODULE_PATH = require.resolve('../../../src/commands/channels');
const OMP_CHANNELS_PATH = require.resolve('../../../src/server/services/omp-channels');
const OMP_PROXY_PATH = require.resolve('../../../src/server/omp-proxy-server');

let originalOmpChannelsCache;
let originalOmpProxyCache;

beforeEach(() => {
  originalOmpChannelsCache = require.cache[OMP_CHANNELS_PATH];
  originalOmpProxyCache = require.cache[OMP_PROXY_PATH];

  require.cache[OMP_CHANNELS_PATH] = {
    id: OMP_CHANNELS_PATH,
    filename: OMP_CHANNELS_PATH,
    loaded: true,
    exports: {
      getChannels: vi.fn(() => ({ channels: [{ id: 'omp-1', name: 'OMP One' }] })),
      createChannel: vi.fn(),
      updateChannel: vi.fn()
    }
  };
  require.cache[OMP_PROXY_PATH] = {
    id: OMP_PROXY_PATH,
    filename: OMP_PROXY_PATH,
    loaded: true,
    exports: {
      getOmpProxyStatus: vi.fn(() => ({ running: true }))
    }
  };

  delete require.cache[MODULE_PATH];
});

afterEach(() => {
  delete require.cache[MODULE_PATH];
  if (originalOmpChannelsCache) {
    require.cache[OMP_CHANNELS_PATH] = originalOmpChannelsCache;
  } else {
    delete require.cache[OMP_CHANNELS_PATH];
  }
  if (originalOmpProxyCache) {
    require.cache[OMP_PROXY_PATH] = originalOmpProxyCache;
  } else {
    delete require.cache[OMP_PROXY_PATH];
  }
});

describe('channels command helpers', () => {
  test('includes OMP in scheduler status sources', () => {
    const { _test } = require('../../../src/commands/channels');

    expect(_test.buildSchedulerSources()).toEqual(expect.arrayContaining([
      { key: 'omp', label: 'OMP' }
    ]));
  });

  test('routes omp channel services through omp channels', () => {
    const { _test } = require('../../../src/commands/channels');
    const services = _test.getChannelServices('omp');

    expect(services.supportsCliCreate).toBe(false);
    expect(services.managedProviderConfig).toBe(true);
    expect(services.getAllChannels()).toEqual([{ id: 'omp-1', name: 'OMP One' }]);
    expect(services.getProxyStatus()).toEqual({ running: true });
  });
});
