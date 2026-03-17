'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const SETTINGS_MGR_PATH = require.resolve('../../../src/server/services/settings-manager');
const PATHS_PATH        = require.resolve('../../../src/config/paths');

let testDir;
let testSettingsFile;
let testBackupFile;
let getSettingsPath, getBackupPath, settingsExists, hasBackup,
    readSettings, writeSettings, backupSettings, restoreSettings,
    deleteBackup, setProxyConfig, isProxyConfig, getCurrentProxyPort;

beforeEach(() => {
  testDir          = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-settings-mgr-test-'));
  testSettingsFile = path.join(testDir, 'settings.json');
  testBackupFile   = path.join(testDir, 'settings.json.cc-tool-backup');

  delete require.cache[SETTINGS_MGR_PATH];
  require.cache[PATHS_PATH] = {
    id: PATHS_PATH, filename: PATHS_PATH, loaded: true,
    exports: {
      PATHS: {},
      NATIVE_PATHS: { claude: { settings: testSettingsFile, settingsBackup: testBackupFile } }
    }
  };

  const mod        = require('../../../src/server/services/settings-manager');
  getSettingsPath  = mod.getSettingsPath;
  getBackupPath    = mod.getBackupPath;
  settingsExists   = mod.settingsExists;
  hasBackup        = mod.hasBackup;
  readSettings     = mod.readSettings;
  writeSettings    = mod.writeSettings;
  backupSettings   = mod.backupSettings;
  restoreSettings  = mod.restoreSettings;
  deleteBackup     = mod.deleteBackup;
  setProxyConfig   = mod.setProxyConfig;
  isProxyConfig    = mod.isProxyConfig;
  getCurrentProxyPort = mod.getCurrentProxyPort;
});

afterEach(() => {
  delete require.cache[SETTINGS_MGR_PATH];
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ─── getSettingsPath / getBackupPath ──────────────────────────────────────────

describe('getSettingsPath', () => {
  test('returns the injected settings file path', () => {
    expect(getSettingsPath()).toBe(testSettingsFile);
  });
});

describe('getBackupPath', () => {
  test('returns the injected backup file path', () => {
    expect(getBackupPath()).toBe(testBackupFile);
  });
});

// ─── settingsExists ───────────────────────────────────────────────────────────

describe('settingsExists', () => {
  test('returns false when settings file does not exist', () => {
    expect(settingsExists()).toBe(false);
  });

  test('returns true when settings file exists', () => {
    fs.writeFileSync(testSettingsFile, '{}', 'utf8');
    expect(settingsExists()).toBe(true);
  });
});

// ─── hasBackup ────────────────────────────────────────────────────────────────

describe('hasBackup', () => {
  test('returns false when backup file does not exist', () => {
    expect(hasBackup()).toBe(false);
  });

  test('returns true when backup file exists', () => {
    fs.writeFileSync(testBackupFile, '{}', 'utf8');
    expect(hasBackup()).toBe(true);
  });
});

// ─── readSettings ─────────────────────────────────────────────────────────────

describe('readSettings', () => {
  test('parses and returns valid JSON from settings file', () => {
    fs.writeFileSync(testSettingsFile, JSON.stringify({ env: { KEY: 'val' } }), 'utf8');
    const result = readSettings();
    expect(result.env.KEY).toBe('val');
  });

  test('throws when settings file does not exist', () => {
    expect(() => readSettings()).toThrow();
  });

  test('throws when settings file contains invalid JSON', () => {
    fs.writeFileSync(testSettingsFile, '{ broken', 'utf8');
    expect(() => readSettings()).toThrow();
  });
});

// ─── writeSettings ────────────────────────────────────────────────────────────

describe('writeSettings', () => {
  test('writes settings as pretty-printed JSON to disk', () => {
    writeSettings({ env: { ANTHROPIC_API_KEY: 'sk-test' } });
    const written = JSON.parse(fs.readFileSync(testSettingsFile, 'utf8'));
    expect(written.env.ANTHROPIC_API_KEY).toBe('sk-test');
  });

  test('written file can be read back with readSettings', () => {
    writeSettings({ apiKeyHelper: "echo 'key'" });
    const result = readSettings();
    expect(result.apiKeyHelper).toBe("echo 'key'");
  });
});

// ─── backupSettings ───────────────────────────────────────────────────────────

describe('backupSettings', () => {
  test('creates a backup and returns { success: true, alreadyExists: false }', () => {
    fs.writeFileSync(testSettingsFile, '{"env":{}}', 'utf8');
    const result = backupSettings();
    expect(result.success).toBe(true);
    expect(result.alreadyExists).toBe(false);
    expect(fs.existsSync(testBackupFile)).toBe(true);
  });

  test('returns { success: true, alreadyExists: true } when backup already exists', () => {
    fs.writeFileSync(testSettingsFile, '{"env":{}}', 'utf8');
    fs.writeFileSync(testBackupFile, '{"env":{}}', 'utf8');
    const result = backupSettings();
    expect(result.success).toBe(true);
    expect(result.alreadyExists).toBe(true);
  });

  test('throws when settings file does not exist', () => {
    expect(() => backupSettings()).toThrow();
  });

  test('backup file content matches original settings file', () => {
    const original = { env: { ANTHROPIC_API_KEY: 'original-key' } };
    fs.writeFileSync(testSettingsFile, JSON.stringify(original), 'utf8');
    backupSettings();
    const backup = JSON.parse(fs.readFileSync(testBackupFile, 'utf8'));
    expect(backup.env.ANTHROPIC_API_KEY).toBe('original-key');
  });
});

// ─── restoreSettings ──────────────────────────────────────────────────────────

describe('restoreSettings', () => {
  test('restores settings from backup and deletes the backup file', () => {
    const original = { env: { ANTHROPIC_API_KEY: 'restored-key' } };
    fs.writeFileSync(testSettingsFile, JSON.stringify({ env: {} }), 'utf8');
    fs.writeFileSync(testBackupFile, JSON.stringify(original), 'utf8');

    const result = restoreSettings();
    expect(result.success).toBe(true);

    const restored = JSON.parse(fs.readFileSync(testSettingsFile, 'utf8'));
    expect(restored.env.ANTHROPIC_API_KEY).toBe('restored-key');
    expect(fs.existsSync(testBackupFile)).toBe(false);
  });

  test('throws when no backup file exists', () => {
    expect(() => restoreSettings()).toThrow();
  });
});

// ─── deleteBackup ─────────────────────────────────────────────────────────────

describe('deleteBackup', () => {
  test('deletes the backup file and returns { success: true }', () => {
    fs.writeFileSync(testBackupFile, '{}', 'utf8');
    const result = deleteBackup();
    expect(result.success).toBe(true);
    expect(fs.existsSync(testBackupFile)).toBe(false);
  });

  test('returns { success: true } when no backup file exists', () => {
    const result = deleteBackup();
    expect(result.success).toBe(true);
  });
});

// ─── setProxyConfig ───────────────────────────────────────────────────────────

describe('setProxyConfig', () => {
  test('sets ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY and apiKeyHelper', () => {
    fs.writeFileSync(testSettingsFile, JSON.stringify({ env: {} }), 'utf8');
    setProxyConfig(9999);
    const settings = JSON.parse(fs.readFileSync(testSettingsFile, 'utf8'));
    expect(settings.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:9999');
    expect(settings.env.ANTHROPIC_API_KEY).toBe('PROXY_KEY');
    expect(settings.apiKeyHelper).toBe("echo 'PROXY_KEY'");
  });

  test('returns { success: true, port: proxyPort }', () => {
    fs.writeFileSync(testSettingsFile, JSON.stringify({ env: {} }), 'utf8');
    const result = setProxyConfig(8080);
    expect(result.success).toBe(true);
    expect(result.port).toBe(8080);
  });

  test('creates backup before modifying settings', () => {
    fs.writeFileSync(testSettingsFile, JSON.stringify({ env: {} }), 'utf8');
    setProxyConfig(9999);
    expect(fs.existsSync(testBackupFile)).toBe(true);
  });

  test('creates env object if missing from settings', () => {
    fs.writeFileSync(testSettingsFile, JSON.stringify({}), 'utf8');
    setProxyConfig(9999);
    const settings = JSON.parse(fs.readFileSync(testSettingsFile, 'utf8'));
    expect(settings.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:9999');
  });
});

// ─── isProxyConfig ────────────────────────────────────────────────────────────

describe('isProxyConfig', () => {
  test('returns false when settings file does not exist', () => {
    expect(isProxyConfig()).toBe(false);
  });

  test('returns true when ANTHROPIC_BASE_URL contains 127.0.0.1', () => {
    fs.writeFileSync(testSettingsFile, JSON.stringify({
      env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9999', ANTHROPIC_API_KEY: 'PROXY_KEY' }
    }), 'utf8');
    expect(isProxyConfig()).toBe(true);
  });

  test('returns true when ANTHROPIC_API_KEY is PROXY_KEY', () => {
    fs.writeFileSync(testSettingsFile, JSON.stringify({
      env: { ANTHROPIC_API_KEY: 'PROXY_KEY' }
    }), 'utf8');
    expect(isProxyConfig()).toBe(true);
  });

  test('returns false when settings contain a normal non-proxy config', () => {
    fs.writeFileSync(testSettingsFile, JSON.stringify({
      env: { ANTHROPIC_API_KEY: 'sk-real-key' }
    }), 'utf8');
    expect(isProxyConfig()).toBe(false);
  });
});

// ─── getCurrentProxyPort ──────────────────────────────────────────────────────

describe('getCurrentProxyPort', () => {
  test('returns the port number from a proxy config', () => {
    fs.writeFileSync(testSettingsFile, JSON.stringify({
      env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9999', ANTHROPIC_API_KEY: 'PROXY_KEY' }
    }), 'utf8');
    expect(getCurrentProxyPort()).toBe(9999);
  });

  test('returns null when settings file does not exist', () => {
    expect(getCurrentProxyPort()).toBeNull();
  });

  test('returns null when settings is not a proxy config', () => {
    fs.writeFileSync(testSettingsFile, JSON.stringify({
      env: { ANTHROPIC_API_KEY: 'sk-real-key' }
    }), 'utf8');
    expect(getCurrentProxyPort()).toBeNull();
  });

  test('returns null when ANTHROPIC_BASE_URL has no port', () => {
    // Force isProxyConfig via PROXY_KEY, but URL has no port number
    fs.writeFileSync(testSettingsFile, JSON.stringify({
      env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1', ANTHROPIC_API_KEY: 'PROXY_KEY' }
    }), 'utf8');
    // URL has no :port so match fails → null
    expect(getCurrentProxyPort()).toBeNull();
  });
});
