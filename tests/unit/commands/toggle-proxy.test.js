'use strict';

const MODULE_PATH = require.resolve('../../../src/commands/toggle-proxy');
const CONFIG_PATH = require.resolve('../../../src/config/loader');
const OMP_PROXY_PATH = require.resolve('../../../src/server/omp-proxy-server');

let originalConfigCache;
let originalOmpProxyCache;

beforeEach(() => {
  originalConfigCache = require.cache[CONFIG_PATH];
  originalOmpProxyCache = require.cache[OMP_PROXY_PATH];

  require.cache[CONFIG_PATH] = {
    id: CONFIG_PATH,
    filename: CONFIG_PATH,
    loaded: true,
    exports: {
      loadConfig: vi.fn(() => ({ ports: { ompProxy: 29992 }, currentCliType: 'omp' }))
    }
  };
  require.cache[OMP_PROXY_PATH] = {
    id: OMP_PROXY_PATH,
    filename: OMP_PROXY_PATH,
    loaded: true,
    exports: {
      getOmpProxyStatus: vi.fn(() => ({ running: false, defaultPort: 29992 })),
      startOmpProxyServer: vi.fn(),
      stopOmpProxyServer: vi.fn()
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
  if (originalOmpProxyCache) {
    require.cache[OMP_PROXY_PATH] = originalOmpProxyCache;
  } else {
    delete require.cache[OMP_PROXY_PATH];
  }
});

describe('toggle-proxy command helpers', () => {
  test('routes omp through the omp managed-provider service path', () => {
    const { _test } = require('../../../src/commands/toggle-proxy');
    const services = _test.getProxyServices('omp');

    expect(services.defaultPort).toBe(29992);
    expect(services.managedProviderConfig).toBe(true);
    expect(services.getProxyStatus()).toEqual({ running: false, defaultPort: 29992 });
  });
});
