'use strict';

const OMP_PROXY_SERVER_MODULE = require.resolve('../../src/server/omp-proxy-server');
const INDEX_MODULE = require.resolve('../../src/index');

let originalArgv;
let stopOmpProxyServer;

beforeEach(() => {
  originalArgv = process.argv;
  stopOmpProxyServer = vi.fn(() => Promise.resolve());
  require.cache[OMP_PROXY_SERVER_MODULE] = {
    id: OMP_PROXY_SERVER_MODULE,
    filename: OMP_PROXY_SERVER_MODULE,
    loaded: true,
    exports: {
      getOmpProxyStatus: vi.fn(() => ({ running: true })),
      stopOmpProxyServer
    }
  };
  process.argv = ['node', INDEX_MODULE, '--version', '--daemon'];
  delete require.cache[INDEX_MODULE];
});

afterEach(() => {
  process.argv = originalArgv;
  delete require.cache[INDEX_MODULE];
  delete require.cache[OMP_PROXY_SERVER_MODULE];
});

test('preserves OMP managed mode during process shutdown', async () => {
  const index = require('../../src/index');

  await index._test.stopOwnedOmpGatewayBeforeExit();

  expect(stopOmpProxyServer).toHaveBeenCalledWith({
    forceAfterMs: 1500,
    preserveManagedMode: true
  });
});
