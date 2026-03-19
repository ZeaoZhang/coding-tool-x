'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const toml = require('toml');

const PATHS_PATH = require.resolve('../../../src/config/paths');
const ENV_MANAGER_PATH = require.resolve('../../../src/server/services/codex-env-manager');
const MODULE_PATH = require.resolve('../../../src/server/services/codex-settings-manager');

let testDir;
let configPath;
let authPath;
let configBackupPath;
let authBackupPath;
let syncCodexUserEnvironment;
let manager;

function writeToml(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-settings-manager-'));
  configPath = path.join(testDir, '.codex', 'config.toml');
  authPath = path.join(testDir, '.codex', 'auth.json');
  configBackupPath = path.join(testDir, '.codex', 'config.toml.cc-tool-backup');
  authBackupPath = path.join(testDir, '.codex', 'auth.json.cc-tool-backup');
  syncCodexUserEnvironment = vi.fn(() => ({
    isFirstTime: true,
    shellConfigPath: '~/.zshrc',
    sourceCommand: 'source ~/.zshrc',
    reloadRequired: true
  }));

  delete require.cache[MODULE_PATH];
  require.cache[PATHS_PATH] = {
    id: PATHS_PATH,
    filename: PATHS_PATH,
    loaded: true,
    exports: {
      NATIVE_PATHS: {
        codex: {
          config: configPath,
          auth: authPath,
          configBackup: configBackupPath,
          authBackup: authBackupPath
        }
      }
    }
  };
  require.cache[ENV_MANAGER_PATH] = {
    id: ENV_MANAGER_PATH,
    filename: ENV_MANAGER_PATH,
    loaded: true,
    exports: { syncCodexUserEnvironment }
  };

  manager = require('../../../src/server/services/codex-settings-manager');
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  [MODULE_PATH, PATHS_PATH, ENV_MANAGER_PATH].forEach((mod) => {
    delete require.cache[mod];
  });
});

describe('codex-settings-manager read/write flows', () => {
  test('writes and reads config.toml and auth.json', () => {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const config = {
      model_provider: 'provider-a',
      model_providers: {
        'provider-a': {
          base_url: 'https://api.example.com/v1',
          wire_api: 'responses',
          env_key: 'OPENAI_API_KEY'
        }
      }
    };

    manager.writeConfig(config);
    manager.writeAuth({ accessToken: 'token-123' });

    expect(manager.configExists()).toBe(true);
    expect(manager.authExists()).toBe(true);
    expect(manager.readConfig()).toEqual(config);
    expect(manager.readAuth()).toEqual({ accessToken: 'token-123' });
  });
});

describe('codex-settings-manager backup and restore', () => {
  test('backs up config/auth and restores them while clearing managed env keys', () => {
    writeToml(configPath, [
      'model_provider = "provider-a"',
      '',
      '[model_providers.provider-a]',
      'base_url = "https://api.example.com/v1"'
    ].join('\n'));
    fs.mkdirSync(path.dirname(authPath), { recursive: true });
    fs.writeFileSync(authPath, JSON.stringify({ accessToken: 'original-token' }, null, 2), 'utf8');

    const backup = manager.backupSettings();
    writeToml(configPath, [
      'model_provider = "cc-proxy"',
      '',
      '[model_providers.cc-proxy]',
      'base_url = "http://127.0.0.1:4317/v1"'
    ].join('\n'));
    fs.writeFileSync(authPath, JSON.stringify({ accessToken: 'proxy-token' }, null, 2), 'utf8');

    const restored = manager.restoreSettings();

    expect(backup).toEqual({ success: true, alreadyExists: false });
    expect(restored).toEqual({ success: true });
    expect(manager.readConfig()).toEqual({
      model_provider: 'provider-a',
      model_providers: {
        'provider-a': {
          base_url: 'https://api.example.com/v1'
        }
      }
    });
    expect(manager.readAuth()).toEqual({ accessToken: 'original-token' });
    expect(fs.existsSync(configBackupPath)).toBe(false);
    expect(fs.existsSync(authBackupPath)).toBe(false);
    expect(syncCodexUserEnvironment).toHaveBeenCalledWith({}, {
      replace: false,
      removeKeys: ['CC_PROXY_KEY']
    });
  });
});

describe('codex-settings-manager proxy config', () => {
  test('sets proxy provider config and returns env injection metadata', () => {
    writeToml(configPath, [
      'model_provider = "provider-a"',
      '',
      '[model_providers.provider-a]',
      'base_url = "https://api.example.com/v1"',
      'wire_api = "responses"'
    ].join('\n'));

    const result = manager.setProxyConfig(4317);

    expect(result).toEqual({
      success: true,
      port: 4317,
      envInjected: true,
      isFirstTime: true,
      shellConfigPath: '~/.zshrc',
      sourceCommand: 'source ~/.zshrc',
      reloadRequired: true
    });
    expect(manager.readConfig()).toEqual({
      model_provider: 'cc-proxy',
      model_providers: {
        'provider-a': {
          base_url: 'https://api.example.com/v1',
          wire_api: 'responses'
        },
        'cc-proxy': {
          name: 'cc-proxy',
          base_url: 'http://127.0.0.1:4317/v1',
          wire_api: 'responses',
          env_key: 'CC_PROXY_KEY',
          requires_openai_auth: false
        }
      }
    });
    expect(syncCodexUserEnvironment).toHaveBeenCalledWith({
      CC_PROXY_KEY: 'PROXY_KEY'
    }, {
      replace: false
    });
  });

  test('detects proxy mode and extracts the current proxy port', () => {
    writeToml(configPath, [
      'model_provider = "cc-proxy"',
      '',
      '[model_providers.cc-proxy]',
      'base_url = "http://127.0.0.1:5555/v1"'
    ].join('\n'));

    expect(manager.isProxyConfig()).toBe(true);
    expect(manager.getCurrentProxyPort()).toBe(5555);

    writeToml(configPath, [
      'model_provider = "provider-a"',
      '',
      '[model_providers.provider-a]',
      'base_url = "https://api.example.com/v1"'
    ].join('\n'));

    expect(manager.isProxyConfig()).toBe(false);
    expect(manager.getCurrentProxyPort()).toBeNull();
  });
});
