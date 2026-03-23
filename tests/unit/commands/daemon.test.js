'use strict';

const PM2_PATH = require.resolve('pm2');
const CONFIG_PATH = require.resolve('../../../src/config/loader');
const PATHS_PATH = require.resolve('../../../src/config/paths');
const PORT_HELPER_PATH = require.resolve('../../../src/utils/port-helper');
const MODULE_PATH = require.resolve('../../../src/commands/daemon');

let processList;
let pm2Mock;
let loadConfig;
let findProcessByPort;
let killProcessByPort;
let waitForPortRelease;
let getPortToolIssue;
let formatPortToolIssue;
let daemon;
let logSpy;
let errorSpy;

function loadModule() {
  delete require.cache[MODULE_PATH];
  daemon = require('../../../src/commands/daemon');
}

beforeEach(() => {
  processList = [];

  pm2Mock = {
    connect: vi.fn((cb) => cb(null)),
    disconnect: vi.fn(),
    list: vi.fn((cb) => cb(null, processList)),
    stop: vi.fn((name, cb) => cb(null)),
    delete: vi.fn((name, cb) => cb(null)),
    dump: vi.fn((cb) => cb && cb(null))
  };

  loadConfig = vi.fn(() => ({
    ports: {
      webUI: 19999,
      proxy: 20088,
      codexProxy: 20089,
      geminiProxy: 20090,
      opencodeProxy: 20091
    }
  }));

  findProcessByPort = vi.fn(() => []);
  killProcessByPort = vi.fn(() => false);
  waitForPortRelease = vi.fn(() => Promise.resolve(true));
  getPortToolIssue = vi.fn(() => null);
  formatPortToolIssue = vi.fn(() => []);

  require.cache[PM2_PATH] = {
    id: PM2_PATH,
    filename: PM2_PATH,
    loaded: true,
    exports: pm2Mock
  };
  require.cache[CONFIG_PATH] = {
    id: CONFIG_PATH,
    filename: CONFIG_PATH,
    loaded: true,
    exports: { loadConfig }
  };
  require.cache[PATHS_PATH] = {
    id: PATHS_PATH,
    filename: PATHS_PATH,
    loaded: true,
    exports: {
      PATHS: { logs: '/tmp/logs' },
      ensureStorageDirMigrated: vi.fn()
    }
  };
  require.cache[PORT_HELPER_PATH] = {
    id: PORT_HELPER_PATH,
    filename: PORT_HELPER_PATH,
    loaded: true,
    exports: {
      findProcessByPort,
      killProcessByPort,
      waitForPortRelease,
      getPortToolIssue,
      formatPortToolIssue
    }
  };

  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  loadModule();
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  [
    MODULE_PATH,
    PM2_PATH,
    CONFIG_PATH,
    PATHS_PATH,
    PORT_HELPER_PATH
  ].forEach((mod) => {
    delete require.cache[mod];
  });
});

describe('daemon handleStop', () => {
  test('stops pm2-managed process and dumps state when service is online', async () => {
    processList = [{ name: 'cc-tool', pid: 1234, pm2_env: { status: 'online' } }];

    await daemon.handleStop();

    expect(pm2Mock.stop).toHaveBeenCalledWith('cc-tool', expect.any(Function));
    expect(pm2Mock.delete).toHaveBeenCalledWith('cc-tool', expect.any(Function));
    expect(pm2Mock.dump).toHaveBeenCalled();
    expect(pm2Mock.disconnect).toHaveBeenCalled();
    expect(killProcessByPort).not.toHaveBeenCalled();
  });

  test('cleans orphaned managed ports even when pm2 process record is already stopped', async () => {
    processList = [{ name: 'cc-tool', pid: 1234, pm2_env: { status: 'stopped' } }];

    const releaseChecks = [false, true, true, true, true, true];
    waitForPortRelease.mockImplementation(() => Promise.resolve(releaseChecks.shift() ?? true));
    killProcessByPort.mockImplementation((port) => port === 19999);

    await daemon.handleStop();

    expect(pm2Mock.stop).not.toHaveBeenCalled();
    expect(pm2Mock.delete).toHaveBeenCalledWith('cc-tool', expect.any(Function));
    expect(killProcessByPort).toHaveBeenCalledWith(19999);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Coding-Tool 服务已停止'));
  });
});

describe('daemon stop helpers', () => {
  test('should only send stop to active pm2 states', () => {
    expect(daemon._test.shouldStopPM2Process('online')).toBe(true);
    expect(daemon._test.shouldStopPM2Process('stopped')).toBe(false);
  });
});
