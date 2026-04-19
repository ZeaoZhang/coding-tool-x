'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const PATHS_PATH = require.resolve('../../../src/config/paths');
const MODULE_PATH = require.resolve('../../../src/server/services/gemini-settings-manager');

let testDir;
let envPath;
let envBackupPath;
let settingsPath;
let settingsBackupPath;
let manager;

function expectChmodPaths(chmodSpy, paths) {
  if (process.platform === 'win32') {
    expect(chmodSpy).not.toHaveBeenCalled();
    return;
  }

  paths.forEach(filePath => {
    expect(chmodSpy).toHaveBeenCalledWith(filePath, 0o600);
  });
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-settings-manager-'));
  envPath = path.join(testDir, '.gemini', '.env');
  envBackupPath = path.join(testDir, '.gemini', '.env.cc-tool-backup');
  settingsPath = path.join(testDir, '.gemini', 'settings.json');
  settingsBackupPath = path.join(testDir, '.gemini', 'settings.json.cc-tool-backup');

  delete require.cache[MODULE_PATH];
  require.cache[PATHS_PATH] = {
    id: PATHS_PATH,
    filename: PATHS_PATH,
    loaded: true,
    exports: {
      NATIVE_PATHS: {
        gemini: {
          env: envPath,
          envBackup: envBackupPath
        }
      }
    }
  };

  manager = require('../../../src/server/services/gemini-settings-manager');
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(testDir, { recursive: true, force: true });
  [MODULE_PATH, PATHS_PATH].forEach((mod) => {
    delete require.cache[mod];
  });
});

describe('gemini-settings-manager env/settings IO', () => {
  test('reads env files and writes env/settings with expected content', () => {
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    fs.writeFileSync(envPath, [
      '# comment',
      'GEMINI_API_KEY = test-key',
      'GOOGLE_GEMINI_BASE_URL=http://127.0.0.1:4567'
    ].join('\n'), 'utf8');

    const chmodSpy = vi.spyOn(fs, 'chmodSync').mockImplementation(() => {});

    expect(manager.readEnv()).toEqual({
      GEMINI_API_KEY: 'test-key',
      GOOGLE_GEMINI_BASE_URL: 'http://127.0.0.1:4567'
    });

    manager.writeEnv({
      GEMINI_API_KEY: 'next-key',
      GEMINI_MODEL: 'gemini-2.5-pro'
    });
    manager.writeSettings({
      security: {
        auth: { selectedType: 'gemini-api-key' }
      }
    });

    expect(fs.readFileSync(envPath, 'utf8')).toBe('GEMINI_API_KEY=next-key\nGEMINI_MODEL=gemini-2.5-pro\n');
    expect(manager.readSettings()).toEqual({
      security: {
        auth: { selectedType: 'gemini-api-key' }
      }
    });
    expectChmodPaths(chmodSpy, [envPath]);
  });
});

describe('gemini-settings-manager backup and restore', () => {
  test('backs up and restores env/settings files', () => {
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    fs.writeFileSync(envPath, 'GEMINI_API_KEY=original-key\n', 'utf8');
    fs.writeFileSync(settingsPath, JSON.stringify({
      security: { auth: { selectedType: 'oauth-personal' } }
    }, null, 2), 'utf8');

    const chmodSpy = vi.spyOn(fs, 'chmodSync').mockImplementation(() => {});
    const backup = manager.backupSettings();
    fs.writeFileSync(envPath, 'GEMINI_API_KEY=proxy-key\n', 'utf8');
    fs.writeFileSync(settingsPath, JSON.stringify({
      security: { auth: { selectedType: 'gemini-api-key' } }
    }, null, 2), 'utf8');

    const restored = manager.restoreSettings();

    expect(backup).toEqual({ success: true, alreadyExists: false });
    expect(restored).toEqual({ success: true });
    expect(fs.readFileSync(envPath, 'utf8')).toBe('GEMINI_API_KEY=original-key\n');
    expect(manager.readSettings()).toEqual({
      security: { auth: { selectedType: 'oauth-personal' } }
    });
    expectChmodPaths(chmodSpy, [envBackupPath, envPath]);
    expect(fs.existsSync(envBackupPath)).toBe(false);
    expect(fs.existsSync(settingsBackupPath)).toBe(false);
  });
});

describe('gemini-settings-manager proxy config', () => {
  test('writes proxy env vars and default auth settings', () => {
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    fs.writeFileSync(envPath, 'CUSTOM=value\nGEMINI_MODEL=gemini-1.5-pro\n', 'utf8');

    const chmodSpy = vi.spyOn(fs, 'chmodSync').mockImplementation(() => {});
    const result = manager.setProxyConfig(9876);

    expect(result).toEqual({ success: true, port: 9876 });
    expect(manager.readEnv()).toEqual({
      CUSTOM: 'value',
      GEMINI_MODEL: 'gemini-1.5-pro',
      GOOGLE_GEMINI_BASE_URL: 'http://127.0.0.1:9876',
      GEMINI_API_KEY: 'PROXY_KEY'
    });
    expect(manager.readSettings()).toEqual({
      security: {
        auth: { selectedType: 'gemini-api-key' }
      }
    });
    expectChmodPaths(chmodSpy, [envBackupPath, envPath]);
  });

  test('detects proxy config, extracts the current proxy port, and deletes backups', () => {
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    fs.writeFileSync(envPath, [
      'GOOGLE_GEMINI_BASE_URL=http://localhost:7654',
      'GEMINI_API_KEY=PROXY_KEY'
    ].join('\n'), 'utf8');
    fs.writeFileSync(envBackupPath, 'GEMINI_API_KEY=backup\n', 'utf8');
    fs.writeFileSync(settingsBackupPath, '{}', 'utf8');

    expect(manager.isProxyConfig()).toBe(true);
    expect(manager.getCurrentProxyPort()).toBe(7654);
    expect(manager.deleteBackup()).toEqual({ success: true });
    expect(fs.existsSync(envBackupPath)).toBe(false);
    expect(fs.existsSync(settingsBackupPath)).toBe(false);
  });
});
