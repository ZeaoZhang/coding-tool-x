'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const UI_CONFIG_PATH = require.resolve('../../../src/server/services/ui-config');
const PATHS_PATH = require.resolve('../../../src/config/paths');

let testDir;
let testConfigFile;
let loadUIConfig;
let saveUIConfig;
let updateUIConfig;
let updateNestedUIConfig;

function loadService() {
  delete require.cache[UI_CONFIG_PATH];
  const mod = require('../../../src/server/services/ui-config');
  loadUIConfig = mod.loadUIConfig;
  saveUIConfig = mod.saveUIConfig;
  updateUIConfig = mod.updateUIConfig;
  updateNestedUIConfig = mod.updateNestedUIConfig;
  return mod;
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-ui-config-test-'));
  testConfigFile = path.join(testDir, 'ui-config.json');
  delete require.cache[UI_CONFIG_PATH];
  require.cache[PATHS_PATH] = {
    id: PATHS_PATH, filename: PATHS_PATH, loaded: true,
    exports: { PATHS: { uiConfig: testConfigFile }, ensureStorageDirMigrated: () => {} }
  };
  loadService();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete require.cache[UI_CONFIG_PATH];
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('loadUIConfig', () => {
  test('returns canonical defaults when file does not exist', () => {
    const config = loadUIConfig();
    expect(config.enabledCliPlatforms).toEqual(['claude', 'codex', 'opencode', 'omp']);
    expect(config).not.toHaveProperty('homeCliColumns');
    expect(config).not.toHaveProperty('dashboardChannelOrder');
    expect(config).not.toHaveProperty('customCliPlatforms');
  });

  test('allows more than four enabled platforms and preserves explicit order', () => {
    fs.writeFileSync(testConfigFile, JSON.stringify({
      enabledCliPlatforms: ['omp', 'claude', 'codex', 'gemini', 'opencode']
    }));
    loadService();
    expect(loadUIConfig().enabledCliPlatforms).toEqual(['omp', 'claude', 'codex', 'gemini', 'opencode']);
  });

  test('preserves an explicitly empty enabled list', () => {
    fs.writeFileSync(testConfigFile, JSON.stringify({ enabledCliPlatforms: [] }));
    loadService();
    expect(loadUIConfig().enabledCliPlatforms).toEqual([]);
  });
  test('rewrites explicit noncanonical enabled platforms on read', () => {
    fs.writeFileSync(testConfigFile, JSON.stringify({
      enabledCliPlatforms: [' OMP ', 'omp', 'unknown', 'CLAUDE']
    }));
    loadService();
    expect(loadUIConfig().enabledCliPlatforms).toEqual(['omp', 'claude']);
    expect(JSON.parse(fs.readFileSync(testConfigFile, 'utf8')).enabledCliPlatforms)
      .toEqual(['omp', 'claude']);
  });

  test('maps the exact legacy default to the new default', () => {
    fs.writeFileSync(testConfigFile, JSON.stringify({
      homeCliColumns: ['claude', 'codex', 'gemini', 'opencode']
    }));
    loadService();
    const config = loadUIConfig();
    expect(config.enabledCliPlatforms).toEqual(['claude', 'codex', 'opencode', 'omp']);
    expect(config).not.toHaveProperty('homeCliColumns');
  });

  test('migrates legacy order using known registry keys and new defaults', () => {
    fs.writeFileSync(testConfigFile, JSON.stringify({
      dashboardChannelOrder: ['gemini', 'omp', 'claude']
    }));
    loadService();
    expect(loadUIConfig().enabledCliPlatforms).toEqual(['gemini', 'omp', 'claude', 'codex', 'opencode']);
  });

  test('prefers homeCliColumns over dashboardChannelOrder during migration', () => {
    fs.writeFileSync(testConfigFile, JSON.stringify({
      homeCliColumns: ['codex'], dashboardChannelOrder: ['gemini']
    }));
    loadService();
    expect(loadUIConfig().enabledCliPlatforms).toEqual(['codex', 'claude', 'opencode', 'omp']);
  });

  test('discards custom platform keys and metadata during migration', () => {
    fs.writeFileSync(testConfigFile, JSON.stringify({
      homeCliColumns: ['my-cli', 'claude'],
      customCliPlatforms: [{ key: 'my-cli', name: 'Injected', command: 'evil' }]
    }));
    loadService();
    const config = loadUIConfig();
    expect(config.enabledCliPlatforms).toEqual(['claude', 'codex', 'opencode', 'omp']);
    expect(config).not.toHaveProperty('customCliPlatforms');
  });
  test('accepts formal manifest keys from the lazy registry', () => {
    const runtimePath = require.resolve('../../../src/platforms/runtime');
    require.cache[runtimePath] = {
      id: runtimePath, filename: runtimePath, loaded: true,
      exports: { getPlatformRegistry: () => ({ list: () => [
        { key: 'claude' }, { key: 'codex' }, { key: 'gemini' },
        { key: 'opencode' }, { key: 'omp' }, { key: 'demo-cli' }
      ] }) }
    };
    fs.writeFileSync(testConfigFile, JSON.stringify({ enabledCliPlatforms: ['demo-cli', 'unknown'] }));
    loadService();
    expect(loadUIConfig().enabledCliPlatforms).toEqual(['demo-cli']);
  });

  test('retains normalized settings when canonical rewrite fails', () => {
    fs.writeFileSync(testConfigFile, JSON.stringify({ theme: 'dark', homeCliColumns: ['codex'] }));
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('rename failed'); });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    loadService();
    expect(loadUIConfig().theme).toBe('dark');
    expect(loadUIConfig().enabledCliPlatforms).toEqual(['codex', 'claude', 'opencode', 'omp']);
    expect(errorSpy).toHaveBeenCalledWith('Error rewriting UI config:', expect.any(Error));
    renameSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test('atomically rewrites a legacy file and remains canonical on next load', () => {
    fs.writeFileSync(testConfigFile, JSON.stringify({ homeCliColumns: ['codex'] }));
    loadService();
    const first = loadUIConfig();
    const rewritten = JSON.parse(fs.readFileSync(testConfigFile, 'utf8'));
    expect(rewritten.enabledCliPlatforms).toEqual(first.enabledCliPlatforms);
    expect(rewritten).not.toHaveProperty('homeCliColumns');
    const mtime = fs.statSync(testConfigFile).mtimeMs;
    loadService();
    expect(loadUIConfig()).toEqual(first);
    expect(fs.statSync(testConfigFile).mtimeMs).toBe(mtime);
  });

  test('rewrites a valid file that omits enabledCliPlatforms', () => {
    fs.writeFileSync(testConfigFile, JSON.stringify({ theme: 'dark' }));
    loadUIConfig();
    expect(JSON.parse(fs.readFileSync(testConfigFile, 'utf8'))).toMatchObject({
      theme: 'dark', enabledCliPlatforms: ['claude', 'codex', 'opencode', 'omp']
    });
  });
  test('rewrites arbitrary extra keys out of an otherwise canonical file on read', () => {
    fs.writeFileSync(testConfigFile, JSON.stringify({
      theme: 'dark',
      enabledCliPlatforms: ['omp', 'claude'],
      injected: 'discard'
    }));
    loadService();
    const config = loadUIConfig();
    expect(config.enabledCliPlatforms).toEqual(['omp', 'claude']);
    expect(JSON.parse(fs.readFileSync(testConfigFile, 'utf8'))).toEqual({
      theme: 'dark',
      panelVisibility: { showChannels: true, showLogs: true },
      channelBalance: { showRemaining: false },
      channelLocks: { claude: false, codex: false, gemini: false, opencode: false, omp: false },
      channelCollapse: { claude: [], codex: [], gemini: [], opencode: [], omp: [] },
      channelOrder: { claude: [], codex: [], gemini: [], opencode: [], omp: [] },
      enabledCliPlatforms: ['omp', 'claude']
    });
  });

  test('returns canonical defaults for corrupt JSON and preserves the load error', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fs.writeFileSync(testConfigFile, '{ not valid json');
    loadService();
    expect(loadUIConfig().enabledCliPlatforms).toEqual(['claude', 'codex', 'opencode', 'omp']);
    expect(errorSpy).toHaveBeenCalledWith('Error loading UI config:', expect.any(Error));
    errorSpy.mockRestore();
  });
  test.each(['null', '[]', '"text"'])('falls back for valid JSON %s', (content) => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fs.writeFileSync(testConfigFile, content);
    loadService();
    expect(loadUIConfig().enabledCliPlatforms).toEqual(['claude', 'codex', 'opencode', 'omp']);
    expect(errorSpy).toHaveBeenCalledWith('Error loading UI config:', expect.any(Error));
    errorSpy.mockRestore();
  });

  test('fills nested defaults and returns deep copies', () => {
    fs.writeFileSync(testConfigFile, JSON.stringify({ theme: 'dark', channelLocks: { claude: true } }));
    loadService();
    const first = loadUIConfig();
    expect(first.channelLocks).toMatchObject({ claude: true, codex: false, gemini: false });
    first.panelVisibility.showChannels = false;
    expect(loadUIConfig().panelVisibility.showChannels).toBe(true);
  });
});

describe('save and update UI config', () => {
  test('normalizes, persists, and returns canonical config', () => {
    const result = saveUIConfig({
      theme: 'dark', enabledCliPlatforms: [' GEMINI ', 'gemini', 'unknown'],
      homeCliColumns: ['codex'], customCliPlatforms: [{ key: 'evil' }]
    });
    expect(result.enabledCliPlatforms).toEqual(['gemini']);
    expect(result).not.toHaveProperty('homeCliColumns');
    expect(result).not.toHaveProperty('customCliPlatforms');
    expect(JSON.parse(fs.readFileSync(testConfigFile, 'utf8'))).toEqual(result);
  });

  test('merges partial saves and preserves an explicitly empty selection', () => {
    fs.writeFileSync(testConfigFile, JSON.stringify({
      theme: 'dark',
      panelVisibility: { showChannels: false, showLogs: false },
      enabledCliPlatforms: ['claude']
    }));

    const result = saveUIConfig({ enabledCliPlatforms: [] });

    expect(result.theme).toBe('dark');
    expect(result.panelVisibility).toEqual({ showChannels: false, showLogs: false });
    expect(result.enabledCliPlatforms).toEqual([]);
  });
  test('omits unknown top-level keys from canonical output', () => {
    const result = saveUIConfig({ theme: 'dark', enabledCliPlatforms: ['claude'], injected: 'discard' });
    expect(result).not.toHaveProperty('injected');
    expect(JSON.parse(fs.readFileSync(testConfigFile, 'utf8'))).not.toHaveProperty('injected');
  });

  test('preserves established notification fields while omitting arbitrary extras', () => {
    const result = saveUIConfig({
      theme: 'dark', enabledCliPlatforms: ['claude'], injected: 'discard',
      remoteNotifications: { providers: [] }, claudeNotificationDisabledByUser: true
    });
    expect(result.remoteNotifications).toEqual({ providers: [] });
    expect(result.claudeNotificationDisabledByUser).toBe(true);
    expect(result).not.toHaveProperty('injected');
  });
  test('updateUIConfig returns the normalized config', () => {
    const result = updateUIConfig('enabledCliPlatforms', ['omp', 'omp', 'invalid']);
    expect(result.enabledCliPlatforms).toEqual(['omp']);
  });

  test('updateNestedUIConfig preserves generic nested settings', () => {
    const result = updateNestedUIConfig('channelLocks', 'claude', true);
    expect(result.channelLocks.claude).toBe(true);
    expect(loadUIConfig().channelLocks.claude).toBe(true);
  });

  test('installs the file watcher after saving before the first load', () => {
    const watchSpy = vi.spyOn(fs, 'watchFile');
    const result = saveUIConfig({ theme: 'dark' });
    expect(result.theme).toBe('dark');
    expect(watchSpy).toHaveBeenCalledWith(testConfigFile, { persistent: false }, expect.any(Function));
    watchSpy.mockRestore();
  });
});

describe('default config structure', () => {
  test('retains generic panel and channel defaults', () => {
    const config = loadUIConfig();
    expect(config.panelVisibility).toEqual({ showChannels: true, showLogs: true });
    expect(config.channelBalance).toEqual({ showRemaining: false });
    expect(config.channelLocks.claude).toBe(false);
    expect(config.channelCollapse.claude).toEqual([]);
    expect(config.channelOrder.claude).toEqual([]);
  });
});
