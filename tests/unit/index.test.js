'use strict';

const OMP_PROXY_SERVER_MODULE = require.resolve('../../src/server/omp-proxy-server');
const INDEX_MODULE = require.resolve('../../src/index');


const Module = require('module');

function loadIndexForArgs(args, blockedRequests = []) {
  const originalLoad = Module._load;
  const calls = [];
  const blocked = new Set(blockedRequests);
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  Module._load = function trackedLoad(request, parent, isMain) {
    calls.push(request);
    if (blocked.has(request)) {
      throw new Error(`Unexpected dependency load: ${request}`);
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  process.argv = ['node', INDEX_MODULE, ...args];
  delete require.cache[INDEX_MODULE];
  try {
    require('../../src/index');
    return calls;
  } finally {
    Module._load = originalLoad;
    logSpy.mockRestore();
    delete require.cache[INDEX_MODULE];
  }
}
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

test('--version avoids loading command, service, and plugin dependencies', () => {
  const calls = loadIndexForArgs(['--version']);
  expect(calls).not.toEqual(expect.arrayContaining([
    './config/loader',
    './commands/daemon',
    './commands/proxy-control',
    './commands/logs',
    './commands/stats',
    './commands/doctor',
    './commands/update',
    './plugins/plugin-manager',
    'inquirer'
  ]));
});

test('--help loads only the help registry instead of command handlers', () => {
  const calls = loadIndexForArgs(['--help']);
  expect(calls).not.toEqual(expect.arrayContaining([
    './config/loader',
    './commands/daemon',
    './commands/proxy-control',
    './commands/logs',
    './commands/stats',
    './commands/doctor',
    './commands/update',
    './plugins/plugin-manager',
    'inquirer'
  ]));
});

test('plugin list does not load the interactive installer', () => {
  const calls = loadIndexForArgs(['plugin', 'list']);
  expect(calls).not.toContain('inquirer');
  expect(calls).not.toContain('../plugins/plugin-installer');
  expect(calls).not.toContain('./plugins/plugin-manager');
});
