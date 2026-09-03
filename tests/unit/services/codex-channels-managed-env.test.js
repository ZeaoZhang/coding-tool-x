const fs = require('fs');
const os = require('os');
const path = require('path');
const toml = require('toml');
const tomlStringify = require('@iarna/toml').stringify;

const PATHS_PATH = require.resolve('../../../src/config/paths');
const CODEX_CONFIG_PATH = require.resolve('../../../src/platforms/drivers/codex/config');
const SETTINGS_MANAGER_PATH = require.resolve('../../../src/platforms/drivers/codex/native-config-implementation');
const ENV_MANAGER_PATH = require.resolve('../../../src/platforms/drivers/codex/env-manager');
const NATIVE_OAUTH_PATH = require.resolve('../../../src/platforms/native-oauth-adapters');
const MODULE_PATH = require.resolve('../../../src/platforms/drivers/codex/channels-implementation');

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

  service = require('../../../src/platforms/drivers/codex/channels-implementation');
});

afterEach(() => {
  delete process.env.CODEX_CURRENT_KEY;
  delete process.env.CC_PROXY_KEY;
  delete process.env.OPENAI_API_KEY;
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
  test('applyChannelToSettings defaults Codex channels to API key auth', () => {
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
    expect(config.model_providers['provider-a'].requires_openai_auth).toBe(false);
    expect(syncCodexUserEnvironmentMock).toHaveBeenLastCalledWith({
      CC_PROXY_KEY: 'secret-a'
    }, {
      replace: true
    });
    expect(clearNativeOAuthMock).not.toHaveBeenCalled();
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
    expect(clearNativeOAuthMock).not.toHaveBeenCalled();
    expect(channels.find(channel => channel.id === channelA.id).enabled).toBe(false);
    expect(channels.find(channel => channel.id === channelB.id).enabled).toBe(true);
  });

  test('legacy OpenAI auth flag is normalized back to API key auth', () => {
    const channel = service.createChannel(
      'Legacy OpenAI Login',
      'provider-login',
      'https://api.openai.com/v1',
      'secret-login',
      'responses',
      { enabled: true, requiresOpenaiAuth: true }
    );

    syncCodexUserEnvironmentMock.mockClear();
    clearNativeOAuthMock.mockClear();

    service.applyChannelToSettings(channel.id);

    const config = loadConfigFromDisk();
    expect(config.model_provider).toBe('provider-login');
    expect(config.model_providers['provider-login'].requires_openai_auth).toBe(false);
    expect(syncCodexUserEnvironmentMock).toHaveBeenLastCalledWith({
      CC_PROXY_KEY: 'secret-login'
    }, {
      replace: true
    });
    expect(clearNativeOAuthMock).not.toHaveBeenCalled();
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

  test('syncCurrentCodexChannel imports current model provider from config.toml env_key', () => {
    process.env.CODEX_CURRENT_KEY = 'codex-current-key';
    fs.writeFileSync(configPath, tomlStringify({
      model_provider: 'current-provider',
      model_providers: {
        'current-provider': {
          name: 'Current Provider',
          base_url: 'https://codex-current.example/v1',
          env_key: 'CODEX_CURRENT_KEY',
          wire_api: 'responses'
        }
      }
    }), 'utf8');

    const result = service.syncCurrentCodexChannel();
    const saved = JSON.parse(fs.readFileSync(channelsPath, 'utf8'));

    expect(result.added).toBe(1);
    expect(saved.channels).toHaveLength(1);
    expect(saved.channels[0]).toEqual(expect.objectContaining({
      name: 'Current Provider',
      providerKey: 'current-provider',
      baseUrl: 'https://codex-current.example/v1',
      apiKey: 'codex-current-key',
      wireApi: 'responses'
    }));
  });

  test('syncCurrentCodexChannel imports default OpenAI provider from OPENAI_API_KEY without config.toml', () => {
    process.env.OPENAI_API_KEY = 'openai-current-key';

    const result = service.syncCurrentCodexChannel();
    const saved = JSON.parse(fs.readFileSync(channelsPath, 'utf8'));

    expect(result.added).toBe(1);
    expect(saved.channels).toHaveLength(1);
    expect(saved.channels[0]).toEqual(expect.objectContaining({
      name: 'OpenAI',
      providerKey: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'openai-current-key',
      wireApi: 'responses'
    }));
  });

  test('syncCurrentCodexChannel skips cc-proxy current provider without importing proxy credentials', () => {
    process.env.CC_PROXY_KEY = 'PROXY_KEY';
    fs.mkdirSync(path.dirname(channelsPath), { recursive: true });
    fs.writeFileSync(channelsPath, JSON.stringify({
      channels: [{
        id: 'existing-codex',
        name: 'Existing Codex',
        providerKey: 'real-provider',
        baseUrl: 'https://real.example/v1',
        apiKey: 'real-key',
        enabled: true
      }]
    }, null, 2), 'utf8');
    fs.writeFileSync(configPath, tomlStringify({
      model_provider: 'cc-proxy',
      model_providers: {
        'cc-proxy': {
          base_url: 'http://127.0.0.1:4567/v1',
          env_key: 'CC_PROXY_KEY',
          wire_api: 'responses'
        }
      }
    }), 'utf8');

    const result = service.syncCurrentCodexChannel();
    const saved = JSON.parse(fs.readFileSync(channelsPath, 'utf8'));

    expect(result.added).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.warnings[0]).toContain('ctx 代理');
    expect(saved.channels).toHaveLength(1);
    expect(saved.channels[0].apiKey).toBe('real-key');
  });

  test('syncCurrentCodexChannel treats env values resolving to PROXY_KEY as non-importable proxy credentials', () => {
    process.env.CC_PROXY_KEY = 'PROXY_KEY';
    fs.writeFileSync(configPath, tomlStringify({
      model_provider: 'current-provider',
      model_providers: {
        'current-provider': {
          base_url: 'https://codex-current.example/v1',
          env_key: 'CC_PROXY_KEY',
          wire_api: 'responses'
        }
      }
    }), 'utf8');

    const result = service.syncCurrentCodexChannel();

    expect(result.added).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.warnings[0]).toContain('缺少可解析 API Key');
    expect(fs.existsSync(channelsPath)).toBe(false);
  });

  test('syncCurrentCodexChannel skips OpenAI login providers', () => {
    fs.writeFileSync(configPath, tomlStringify({
      model_provider: 'openai-login',
      model_providers: {
        'openai-login': {
          base_url: 'https://api.openai.com/v1',
          wire_api: 'responses',
          requires_openai_auth: true
        }
      }
    }), 'utf8');

    const result = service.syncCurrentCodexChannel();

    expect(result.added).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.warnings[0]).toContain('OAuth');
    expect(fs.existsSync(channelsPath)).toBe(false);
  });
});
