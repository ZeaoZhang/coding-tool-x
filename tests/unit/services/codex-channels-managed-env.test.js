const fs = require('fs');
const os = require('os');
const path = require('path');
const toml = require('toml');
const tomlStringify = require('@iarna/toml').stringify;

const PATHS_PATH = require.resolve('../../../src/config/paths');
const CODEX_CONFIG_PATH = require.resolve('../../../src/server/services/codex-config');
const SETTINGS_MANAGER_PATH = require.resolve('../../../src/server/services/codex-settings-manager');
const ENV_MANAGER_PATH = require.resolve('../../../src/server/services/codex-env-manager');
const NATIVE_OAUTH_PATH = require.resolve('../../../src/server/services/native-oauth-adapters');
const MODULE_PATH = require.resolve('../../../src/server/services/codex-channels');

let testDir;
let codexDir;
let channelsPath;
let configPath;
let isProxyConfigMock;
let readConfigMock;
let syncCodexUserEnvironmentMock;
let clearNativeOAuthMock;
let service;

function loadConfigFromDisk() {
  if (!fs.existsSync(configPath)) {
    throw new Error('config.toml not found');
  }
  return toml.parse(fs.readFileSync(configPath, 'utf8'));
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-channels-managed-env-'));
  codexDir = path.join(testDir, '.codex');
  channelsPath = path.join(testDir, '.cc-tool', 'storage', 'channels', 'codex.json');
  configPath = path.join(codexDir, 'config.toml');
  fs.mkdirSync(codexDir, { recursive: true });
  isProxyConfigMock = vi.fn(() => false);
  readConfigMock = vi.fn(() => loadConfigFromDisk());
  syncCodexUserEnvironmentMock = vi.fn();
  clearNativeOAuthMock = vi.fn();

  delete require.cache[MODULE_PATH];
  require.cache[PATHS_PATH] = {
    id: PATHS_PATH,
    filename: PATHS_PATH,
    loaded: true,
    exports: {
      PATHS: {
        channels: {
          codex: channelsPath
        }
      }
    }
  };
  require.cache[CODEX_CONFIG_PATH] = {
    id: CODEX_CONFIG_PATH,
    filename: CODEX_CONFIG_PATH,
    loaded: true,
    exports: {
      getCodexDir: () => codexDir
    }
  };
  require.cache[SETTINGS_MANAGER_PATH] = {
    id: SETTINGS_MANAGER_PATH,
    filename: SETTINGS_MANAGER_PATH,
    loaded: true,
    exports: {
      isProxyConfig: isProxyConfigMock,
      readConfig: readConfigMock
    }
  };
  require.cache[ENV_MANAGER_PATH] = {
    id: ENV_MANAGER_PATH,
    filename: ENV_MANAGER_PATH,
    loaded: true,
    exports: {
      syncCodexUserEnvironment: syncCodexUserEnvironmentMock
    }
  };
  require.cache[NATIVE_OAUTH_PATH] = {
    id: NATIVE_OAUTH_PATH,
    filename: NATIVE_OAUTH_PATH,
    loaded: true,
    exports: {
      clearNativeOAuth: clearNativeOAuthMock
    }
  };

  service = require('../../../src/server/services/codex-channels');
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    MODULE_PATH,
    PATHS_PATH,
    CODEX_CONFIG_PATH,
    SETTINGS_MANAGER_PATH,
    ENV_MANAGER_PATH,
    NATIVE_OAUTH_PATH
  ].forEach((mod) => {
    delete require.cache[mod];
  });
});

describe('codex-channels managed env sync', () => {
  test('applyChannelToSettings writes shared env key for single-channel mode', () => {
    const channel = service.createChannel(
      'Primary',
      'provider-a',
      'https://api.example.com/v1',
      'secret-a',
      'responses',
      { enabled: true }
    );

    syncCodexUserEnvironmentMock.mockClear();
    clearNativeOAuthMock.mockClear();

    service.applyChannelToSettings(channel.id);

    const config = loadConfigFromDisk();
    expect(config.model_provider).toBe('provider-a');
    expect(config.model_providers['provider-a'].env_key).toBe('CC_PROXY_KEY');
    expect(syncCodexUserEnvironmentMock).toHaveBeenLastCalledWith({
      CC_PROXY_KEY: 'secret-a'
    }, {
      replace: true
    });
    expect(clearNativeOAuthMock).toHaveBeenCalledWith('codex');
  });

  test('enabling another channel in single-channel mode auto-applies config and shared env', () => {
    const channelA = service.createChannel(
      'Primary',
      'provider-a',
      'https://api-a.example.com/v1',
      'secret-a',
      'responses',
      { enabled: true }
    );
    const channelB = service.createChannel(
      'Backup',
      'provider-b',
      'https://api-b.example.com/v1',
      'secret-b',
      'responses',
      { enabled: false }
    );

    syncCodexUserEnvironmentMock.mockClear();
    clearNativeOAuthMock.mockClear();

    service.updateChannel(channelB.id, { enabled: true });

    const config = loadConfigFromDisk();
    const channels = service.getChannels().channels;
    expect(config.model_provider).toBe('provider-b');
    expect(config.model_providers['provider-b'].env_key).toBe('CC_PROXY_KEY');
    expect(syncCodexUserEnvironmentMock).toHaveBeenLastCalledWith({
      CC_PROXY_KEY: 'secret-b'
    }, {
      replace: true
    });
    expect(channels.find(channel => channel.id === channelA.id).enabled).toBe(false);
    expect(channels.find(channel => channel.id === channelB.id).enabled).toBe(true);
  });

  test('proxy mode still syncs the shared env key to PROXY_KEY', () => {
    service.createChannel(
      'Primary',
      'provider-a',
      'https://api.example.com/v1',
      'secret-a',
      'responses',
      { enabled: true }
    );

    syncCodexUserEnvironmentMock.mockClear();
    isProxyConfigMock.mockReturnValue(true);

    service.syncAllChannelEnvVars();

    expect(syncCodexUserEnvironmentMock).toHaveBeenLastCalledWith({
      CC_PROXY_KEY: 'PROXY_KEY'
    }, {
      replace: true
    });
  });

  test('applyChannelToSettings prunes only managed providers and preserves external providers', () => {
    const channelA = service.createChannel(
      'Primary',
      'provider-a',
      'https://api-a.example.com/v1',
      'secret-a',
      'responses',
      { enabled: true }
    );
    service.createChannel(
      'Backup',
      'provider-b',
      'https://api-b.example.com/v1',
      'secret-b',
      'responses',
      { enabled: false }
    );

    fs.writeFileSync(configPath, tomlStringify({
      model_provider: 'external-provider',
      model_providers: {
        'provider-a': { base_url: 'https://old-a.example.com/v1' },
        'provider-b': { base_url: 'https://old-b.example.com/v1' },
        'external-provider': { base_url: 'https://external.example.com/v1' },
        'cc-proxy': { base_url: 'http://127.0.0.1:9999/v1' }
      }
    }), 'utf8');

    service.applyChannelToSettings(channelA.id);

    const config = loadConfigFromDisk();
    expect(config.model_provider).toBe('provider-a');
    expect(config.model_providers['provider-a']).toEqual(expect.objectContaining({
      base_url: 'https://api-a.example.com/v1'
    }));
    expect(config.model_providers['provider-b']).toBeUndefined();
    expect(config.model_providers['cc-proxy']).toBeUndefined();
    expect(config.model_providers['external-provider']).toEqual(expect.objectContaining({
      base_url: 'https://external.example.com/v1'
    }));
  });
});
