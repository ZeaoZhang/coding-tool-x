'use strict';

const PM2_PATH = require.resolve('pm2');
const CONFIG_PATH = require.resolve('../../../src/config/loader');
const PATHS_PATH = require.resolve('../../../src/config/paths');
const PORT_HELPER_PATH = require.resolve('../../../src/utils/port-helper');
const SESSION_INDEX_PATH = require.resolve('../../../src/server/services/session-history-index');
const MODULE_PATH = require.resolve('../../../src/commands/daemon');

let processList;
let pm2Mock;
let loadConfig;
let findProcessByPort;
let killProcessByPort;
let waitForPortRelease;
let getPortToolIssue;
let formatPortToolIssue;
let cleanupStaleInventoryLocks;
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
    start: vi.fn((options, cb) => cb(null)),
    delete: vi.fn((name, cb) => cb(null)),
    dump: vi.fn((force, cb) => {
      const callback = typeof force === 'function' ? force : cb;
      callback && callback(null);
    })
  };

  loadConfig = vi.fn(() => ({
    ports: {
      webUI: 19999,
      proxy: 20088,
      codexProxy: 20089,
      geminiProxy: 20090,
      opencodeProxy: 20091,
      ompProxy: 20092
    }
  }));

  findProcessByPort = vi.fn(() => []);
  killProcessByPort = vi.fn(() => false);
  waitForPortRelease = vi.fn(() => Promise.resolve(true));
  getPortToolIssue = vi.fn(() => null);
  formatPortToolIssue = vi.fn(() => []);
  cleanupStaleInventoryLocks = vi.fn(() => ({ removed: [], retained: [] }));

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
      PATHS: {
        logs: '/tmp/logs',
        activeChannel: {
          claude: '/tmp/channels/claude.json',
          codex: '/tmp/channels/codex.json',
          gemini: '/tmp/channels/gemini.json',
          opencode: '/tmp/channels/opencode.json',
          omp: '/tmp/channels/omp.json'
        }
      },
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
  require.cache[SESSION_INDEX_PATH] = {
    id: SESSION_INDEX_PATH,
    filename: SESSION_INDEX_PATH,
    loaded: true,
    exports: { cleanupStaleInventoryLocks }
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
    PORT_HELPER_PATH,
    SESSION_INDEX_PATH
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
    expect(pm2Mock.dump).toHaveBeenCalledWith(true, expect.any(Function));
    expect(pm2Mock.disconnect).toHaveBeenCalled();
    expect(killProcessByPort).not.toHaveBeenCalled();
    expect(cleanupStaleInventoryLocks).toHaveBeenCalledTimes(1);
  });

  test('forces pm2 dump after deleting the last process to clear stale startup state', async () => {
    processList = [{ name: 'cc-tool', pid: 1234, pm2_env: { status: 'stopped' } }];
    pm2Mock.dump.mockImplementation((force, cb) => {
      cb(force ? null : new Error('Process list empty, cannot save empty list'));
    });

    await daemon.handleStop();

    expect(pm2Mock.delete).toHaveBeenCalledWith('cc-tool', expect.any(Function));
    expect(pm2Mock.dump).toHaveBeenCalledWith(true, expect.any(Function));
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Process list empty'));
  });

  test('does not dump pm2 state when only orphaned ports were cleaned', async () => {
    const releaseChecks = [false, true, true, true, true, true, true];
    waitForPortRelease.mockImplementation(() => Promise.resolve(releaseChecks.shift() ?? true));
    killProcessByPort.mockImplementation((port) => port === 19999);

    await daemon.handleStop();

    expect(pm2Mock.delete).not.toHaveBeenCalled();
    expect(pm2Mock.dump).not.toHaveBeenCalled();
    expect(killProcessByPort).toHaveBeenCalledWith(19999);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Coding-Tool 服务已停止'));
  });

  test('cleans orphaned managed ports even when pm2 process record is already stopped', async () => {
    processList = [{ name: 'cc-tool', pid: 1234, pm2_env: { status: 'stopped' } }];

    const releaseChecks = [false, true, true, true, true, true, true];
    waitForPortRelease.mockImplementation(() => Promise.resolve(releaseChecks.shift() ?? true));
    killProcessByPort.mockImplementation((port) => port === 19999);

    await daemon.handleStop();

    expect(pm2Mock.stop).not.toHaveBeenCalled();
    expect(pm2Mock.delete).toHaveBeenCalledWith('cc-tool', expect.any(Function));
    expect(killProcessByPort).toHaveBeenCalledWith(19999);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Coding-Tool 服务已停止'));
  });
});

describe('daemon restart flow', () => {
  test('restarts by stopping the existing service before starting again', async () => {
    processList = [{ name: 'cc-tool', pid: 1234, pm2_env: { status: 'online' } }];
    pm2Mock.stop.mockImplementation((name, cb) => {
      processList = [];
      cb(null);
    });
    pm2Mock.start.mockImplementation((options, cb) => {
      processList = [{ name: 'cc-tool', pid: 5678, pm2_env: { status: 'online' } }];
      cb(null);
    });
    findProcessByPort.mockImplementation((port) => (port === 19999 ? ['5678'] : []));

    await daemon.handleRestart();

    expect(pm2Mock.stop).toHaveBeenCalledWith('cc-tool', expect.any(Function));
    expect(pm2Mock.delete).toHaveBeenCalledWith('cc-tool', expect.any(Function));
    expect(pm2Mock.start).toHaveBeenCalledWith(expect.objectContaining({
      name: 'cc-tool',
      kill_timeout: 125000
    }), expect.any(Function));
    expect(pm2Mock.disconnect).toHaveBeenCalled();
  });
});

describe('daemon stop helpers', () => {
  test('maps LAN host mode to a canonical --host daemon arg', () => {
    expect(daemon._test.buildStartOptions(19999, true, false).args).toContain('--host');
  });
  test('allows PM2 enough time for graceful gateway shutdown', () => {
    expect(daemon._test.buildStartOptions(19999, false, false).kill_timeout).toBe(125000);
  });

  test('explicitly hides the PM2-managed Node process on Windows', () => {
    expect(daemon._test.buildStartOptions(19999, false, false).windowsHide).toBe(true);
  });

  test('forwards runtime environment so restart keeps native CLI profiles', () => {
    const keys = [
      'HOME',
      'PATH',
      'CODEX_HOME',
      'OMP_COMMAND',
      'OMP_CONFIG_DIR',
      'OMP_PROFILE',
      'PI_CODING_AGENT_DIR',
      'OMP_CODING_AGENT_DIR'
    ];
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    try {
      process.env.HOME = '/tmp/ctx-home';
      process.env.PATH = '/tmp/ctx-bin';
      process.env.CODEX_HOME = '/tmp/ctx-codex';
      process.env.OMP_COMMAND = '/tmp/ctx-bin/omp';
      process.env.OMP_CONFIG_DIR = '/tmp/ctx-omp';
      process.env.OMP_PROFILE = 'work';
      process.env.PI_CODING_AGENT_DIR = '/tmp/ctx-pi';
      process.env.OMP_CODING_AGENT_DIR = '/tmp/ctx-omp-agent';

      expect(daemon._test.buildStartOptions(19999, false, false).env).toMatchObject({
        HOME: '/tmp/ctx-home',
        PATH: '/tmp/ctx-bin',
        CODEX_HOME: '/tmp/ctx-codex',
        OMP_COMMAND: '/tmp/ctx-bin/omp',
        OMP_CONFIG_DIR: '/tmp/ctx-omp',
        OMP_PROFILE: 'work',
        PI_CODING_AGENT_DIR: '/tmp/ctx-pi',
        OMP_CODING_AGENT_DIR: '/tmp/ctx-omp-agent'
      });
    } finally {
      keys.forEach((key) => {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      });
    }
  });

  test('clears stale CODEX_HOME from the PM2 child environment', () => {
    const previous = process.env.CODEX_HOME;
    try {
      delete process.env.CODEX_HOME;
      expect(daemon._test.buildStartOptions(19999, false, false).env.CODEX_HOME).toBe('');
    } finally {
      if (previous === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previous;
    }
  });

  test('should only send stop to active pm2 states', () => {
    expect(daemon._test.shouldStopPM2Process('online')).toBe(true);
    expect(daemon._test.shouldStopPM2Process('stopped')).toBe(false);
  });

  test('detects stale pm2 runtime path from startup log', () => {
    const issue = daemon._test.detectStalePm2RuntimeIssue(
      "Error: Cannot find module '/Users/zhangzeao/workspace/coding-tool/node_modules/pm2/lib/ProcessContainerFork.js'"
    );

    expect(issue).toEqual({
      missingPath: '/Users/zhangzeao/workspace/coding-tool/node_modules/pm2/lib/ProcessContainerFork.js',
      currentPath: require.resolve('pm2/lib/ProcessContainerFork')
    });
  });

  test('ignores current pm2 runtime path in startup log', () => {
    const currentForkPath = require.resolve('pm2/lib/ProcessContainerFork');

    expect(
      daemon._test.detectStalePm2RuntimeIssue(
        `Error: Cannot find module '${currentForkPath}'`
      )
    ).toBeNull();
  });
});

describe('daemon backend proxy status', () => {
  const platform = { key: 'demo-cli', label: 'Demo CLI', portKey: 'demoProxy', defaultPort: 23100, apiBasePath: '/api/custom/proxy' };
  const registry = { list: () => [platform], resolve: () => platform };

  test('queries the manifest endpoint instead of creating a local proxy driver', async () => {
    const httpRequest = vi.fn(async () => ({ status: 200, data: { running: true, port: 23100 } }));
    const getDriver = vi.fn(() => { throw new Error('Must not load a CLI-local driver'); });
    const entries = await daemon._test.getProxyStatusEntries({
      registry, runtime: { getDriver }, httpRequest,
      config: { ports: { demoProxy: 23101 } }
    });
    expect(entries).toEqual([expect.objectContaining({
      platform, state: { running: true, port: 23100 }, port: 23101
    })]);
    expect(httpRequest).toHaveBeenCalledWith('GET', '/api/custom/proxy/status');
    expect(getDriver).not.toHaveBeenCalled();
  });

  test.each([
    { status: 200, data: {} },
    { status: 500, data: { running: false } },
    { status: 503, data: { error: { status: 'unavailable', error: 'backend unavailable' } } }
  ])('never turns a failed or invalid backend response into stopped: %j', async (response) => {
    const [entry] = await daemon._test.getProxyStatusEntries({
      registry, config: {}, httpRequest: async () => response
    });
    expect(entry.state.status).not.toBe('ok');
    expect(entry.state.status).toBeTruthy();
    expect(entry.state.running).toBeUndefined();
  });

  test('reports an unreachable backend as a query failure', async () => {
    const [entry] = await daemon._test.getProxyStatusEntries({
      registry, config: {}, httpRequest: async () => { throw new Error('ECONNREFUSED'); }
    });
    expect(entry.state).toMatchObject({ status: 'failed', error: 'ECONNREFUSED' });
  });

  test('accepts a wrapped backend response and preserves a genuinely stopped state', async () => {
    const [entry] = await daemon._test.getProxyStatusEntries({
      registry, config: {}, httpRequest: async () => ({ status: 200, data: { status: 'ok', data: { running: false, port: 23100 } } })
    });
    expect(entry.state).toEqual({ running: false, port: 23100 });
  });

  test('uses the running daemon port and HTTPS arguments', () => {
    expect(daemon._test.getUIConnectionOptions({ pm2_env: { CC_TOOL_PORT: '23102', args: ['ui', '--daemon', '--https'] } }, { ports: { webUI: 19999 } }))
      .toEqual({ port: 23102, useHttps: true });
    expect(daemon._test.getUIConnectionOptions(null, { ports: { webUI: 19998 } }))
      .toEqual({ port: 19998, useHttps: false });
  });

  test('reads all six manifest endpoints from the real router in a separate process', async () => {
    const { spawn } = require('child_process');
    const { createPlatformRegistry } = require('../../../src/platforms/registry');
    const backendRegistry = createPlatformRegistry({ userFile: {}, pathOverlay: {} });
    const routerPath = require.resolve('../../../src/server/api/platform-routes');
    const genericRouterPath = require.resolve('../../../src/server/api/platforms');
    const registryPath = require.resolve('../../../src/platforms/registry');
    const child = spawn(process.execPath, ['-e', `
      const express = require('express');
      const { createPlatformRegistry } = require(${JSON.stringify(registryPath)});
      const registry = createPlatformRegistry({ userFile: {}, pathOverlay: {} });
      const runtime = { getDriver: (key, capability) => capability === 'proxy' ? {
        status: () => ({ status: 'ok', data: { running: key === 'omp' || key === 'codex', port: registry.resolve(key).defaultPort } })
      } : null };
      const app = express();
      app.use('/api/platforms', require(${JSON.stringify(genericRouterPath)})({ registry, runtime }));
      app.use('/api', require(${JSON.stringify(routerPath)})({ registry, runtime }));
      const server = app.listen(0, '127.0.0.1', () => process.send(server.address().port));
    `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    try {
      const port = await new Promise((resolve, reject) => {
        child.once('message', resolve);
        child.once('error', reject);
        child.once('exit', (code) => reject(new Error('Backend exited: ' + code)));
      });
      const entries = await daemon._test.getProxyStatusEntries({ registry: backendRegistry, config: { ports: { webUI: port } } });
      expect(entries).toHaveLength(6);
      for (const entry of entries) {
        expect(entry.state).toEqual({
          running: entry.platform.key === 'omp' || entry.platform.key === 'codex',
          port: entry.platform.defaultPort
        });
      }
    } finally {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await exited;
    }
  });
});
