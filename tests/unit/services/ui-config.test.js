'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const UI_CONFIG_PATH = require.resolve('../../../src/server/services/ui-config');
const PATHS_PATH     = require.resolve('../../../src/config/paths');

let testDir;
let testConfigFile;
let loadUIConfig, saveUIConfig, updateUIConfig, updateNestedUIConfig;

beforeEach(() => {
  testDir        = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-ui-config-test-'));
  testConfigFile = path.join(testDir, 'ui-config.json');

  delete require.cache[UI_CONFIG_PATH];
  require.cache[PATHS_PATH] = {
    id: PATHS_PATH, filename: PATHS_PATH, loaded: true,
    exports: { PATHS: { uiConfig: testConfigFile }, ensureStorageDirMigrated: () => {} }
  };

  const mod        = require('../../../src/server/services/ui-config');
  loadUIConfig          = mod.loadUIConfig;
  saveUIConfig          = mod.saveUIConfig;
  updateUIConfig        = mod.updateUIConfig;
  updateNestedUIConfig  = mod.updateNestedUIConfig;
});

afterEach(() => {
  delete require.cache[UI_CONFIG_PATH];
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ─── loadUIConfig ─────────────────────────────────────────────────────────────

describe('loadUIConfig', () => {
  test('returns default config with theme=light when file does not exist', () => {
    const config = loadUIConfig();
    expect(config.theme).toBe('light');
  });

  test('returns all expected top-level default keys when file does not exist', () => {
    const config = loadUIConfig();
    expect(config).toHaveProperty('theme');
    expect(config).toHaveProperty('panelVisibility');
    expect(config).toHaveProperty('channelLocks');
    expect(config).toHaveProperty('channelCollapse');
    expect(config).toHaveProperty('channelOrder');
  });

  test('merges file data with defaults when file exists', () => {
    fs.writeFileSync(testConfigFile, JSON.stringify({ theme: 'dark' }), 'utf8');
    // Re-require to get fresh module that reads the file on init
    delete require.cache[UI_CONFIG_PATH];
    const mod = require('../../../src/server/services/ui-config');
    const config = mod.loadUIConfig();
    expect(config.theme).toBe('dark');
    // Defaults for missing keys are still present
    expect(config).toHaveProperty('panelVisibility');
    expect(config).toHaveProperty('channelLocks');
  });

  test('returns defaults when file contains invalid JSON', () => {
    fs.writeFileSync(testConfigFile, '{ not valid json', 'utf8');
    delete require.cache[UI_CONFIG_PATH];
    const mod = require('../../../src/server/services/ui-config');
    const config = mod.loadUIConfig();
    expect(config.theme).toBe('light');
  });

  test('fills in missing nested defaults for a partial config', () => {
    fs.writeFileSync(testConfigFile, JSON.stringify({ theme: 'dark', channelLocks: { claude: true } }), 'utf8');
    delete require.cache[UI_CONFIG_PATH];
    const mod = require('../../../src/server/services/ui-config');
    const config = mod.loadUIConfig();
    // Provided value preserved
    expect(config.channelLocks.claude).toBe(true);
    // Missing defaults filled in
    expect(config.channelLocks.codex).toBe(false);
    expect(config.channelLocks.gemini).toBe(false);
  });

  test('returns a deep copy — mutations do not affect the internal cache', () => {
    const first = loadUIConfig();
    first.theme = 'mutated';
    first.panelVisibility.showChannels = false;
    const second = loadUIConfig();
    expect(second.theme).toBe('light');
    expect(second.panelVisibility.showChannels).toBe(true);
  });
});

// ─── saveUIConfig ─────────────────────────────────────────────────────────────

describe('saveUIConfig', () => {
  test('writes the config as JSON to the file', () => {
    const config = { theme: 'dark', panelVisibility: {}, channelLocks: {}, channelCollapse: {}, channelOrder: {} };
    saveUIConfig(config);
    const written = JSON.parse(fs.readFileSync(testConfigFile, 'utf8'));
    expect(written.theme).toBe('dark');
  });

  test('updates in-memory cache so subsequent loadUIConfig returns saved data', () => {
    const config = loadUIConfig();
    config.theme = 'dark';
    saveUIConfig(config);
    const reloaded = loadUIConfig();
    expect(reloaded.theme).toBe('dark');
  });
});

// ─── updateUIConfig ───────────────────────────────────────────────────────────

describe('updateUIConfig', () => {
  test('sets the specified top-level key and persists it', () => {
    updateUIConfig('theme', 'dark');
    const config = loadUIConfig();
    expect(config.theme).toBe('dark');
  });

  test('returns the updated config object', () => {
    const result = updateUIConfig('theme', 'dark');
    expect(result.theme).toBe('dark');
  });

  test('writes the change to disk', () => {
    updateUIConfig('theme', 'dark');
    const written = JSON.parse(fs.readFileSync(testConfigFile, 'utf8'));
    expect(written.theme).toBe('dark');
  });
});

// ─── updateNestedUIConfig ─────────────────────────────────────────────────────

describe('updateNestedUIConfig', () => {
  test('sets a nested child key under an existing parent', () => {
    updateNestedUIConfig('channelLocks', 'claude', true);
    const config = loadUIConfig();
    expect(config.channelLocks.claude).toBe(true);
  });

  test('creates the parent object if it does not exist', () => {
    updateNestedUIConfig('brandNewParent', 'childKey', 'value');
    const config = loadUIConfig();
    expect(config.brandNewParent).toBeDefined();
    expect(config.brandNewParent.childKey).toBe('value');
  });

  test('returns the updated config object', () => {
    const result = updateNestedUIConfig('channelCollapse', 'gemini', ['session1']);
    expect(result.channelCollapse.gemini).toEqual(['session1']);
  });

  test('persists the nested change to disk', () => {
    updateNestedUIConfig('channelOrder', 'codex', ['a', 'b']);
    const written = JSON.parse(fs.readFileSync(testConfigFile, 'utf8'));
    expect(written.channelOrder.codex).toEqual(['a', 'b']);
  });
});

// ─── Default config structure ─────────────────────────────────────────────────

describe('default config structure', () => {
  test('panelVisibility has showChannels=true and showLogs=true', () => {
    const config = loadUIConfig();
    expect(config.panelVisibility.showChannels).toBe(true);
    expect(config.panelVisibility.showLogs).toBe(true);
  });

  test('channelLocks defaults are all false', () => {
    const config = loadUIConfig();
    expect(config.channelLocks.claude).toBe(false);
    expect(config.channelLocks.codex).toBe(false);
    expect(config.channelLocks.gemini).toBe(false);
  });

  test('channelCollapse defaults are empty arrays', () => {
    const config = loadUIConfig();
    expect(config.channelCollapse.claude).toEqual([]);
    expect(config.channelCollapse.codex).toEqual([]);
    expect(config.channelCollapse.gemini).toEqual([]);
  });

  test('channelOrder defaults are empty arrays', () => {
    const config = loadUIConfig();
    expect(config.channelOrder.claude).toEqual([]);
    expect(config.channelOrder.codex).toEqual([]);
    expect(config.channelOrder.gemini).toEqual([]);
  });
});
