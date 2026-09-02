const fs = require('fs');
const os = require('os');
const path = require('path');

let testDir;
let clearNativeOAuthMock;
let readNativeOAuthMock;
let channelsService;
let isWindowsLikePlatformMock;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'channels-service-'));
  clearNativeOAuthMock = vi.fn();
  readNativeOAuthMock = vi.fn(() => null);
  isWindowsLikePlatformMock = vi.fn(() => false);

  require.cache[require.resolve('../../../src/config/paths')] = {
    id: require.resolve('../../../src/config/paths'),
    filename: require.resolve('../../../src/config/paths'),
    loaded: true,
    exports: {
      PATHS: {
        channels: {
          claude: path.join(testDir, '.cc-tool', 'channels', 'claude.json')
        },
        activeChannel: {
          claude: path.join(testDir, '.cc-tool', 'state', 'active-channel.json')
        }
      },
      NATIVE_PATHS: {
        claude: {
          settings: path.join(testDir, '.claude', 'settings.json')
        }
      }
    }
  };

  require.cache[require.resolve('../../../src/platforms/drivers/claude/native-config-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/claude/native-config-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/claude/native-config-implementation'),
    loaded: true,
    exports: {
      isProxyConfig: vi.fn(() => false)
    }
  };

  require.cache[require.resolve('../../../src/platforms/drivers/shared/native-oauth-adapters')] = {
    id: require.resolve('../../../src/platforms/drivers/shared/native-oauth-adapters'),
    filename: require.resolve('../../../src/platforms/drivers/shared/native-oauth-adapters'),
    loaded: true,
    exports: {
      clearNativeOAuth: clearNativeOAuthMock,
      readNativeOAuth: readNativeOAuthMock
    }
  };

  require.cache[require.resolve('../../../src/utils/home-dir')] = {
    id: require.resolve('../../../src/utils/home-dir'),
    filename: require.resolve('../../../src/utils/home-dir'),
    loaded: true,
    exports: {
      isWindowsLikePlatform: isWindowsLikePlatformMock
    }
  };

  delete require.cache[require.resolve('../../../src/platforms/drivers/claude/channels-implementation')];
  channelsService = require('../../../src/platforms/drivers/claude/channels-implementation');
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/platforms/drivers/claude/channels-implementation',
    '../../../src/config/paths',
    '../../../src/platforms/drivers/claude/native-config-implementation',
    '../../../src/platforms/drivers/shared/native-oauth-adapters',
    '../../../src/utils/home-dir'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('channels service Claude settings integration', () => {
  test('updateClaudeSettingsWithModelConfig writes managed env vars, model config, and proxy settings', () => {
    const settingsPath = path.join(testDir, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({
      env: {
        ANTHROPIC_AUTH_TOKEN: 'old-auth',
        CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token',
        ANTHROPIC_MODEL: 'old-model',
        HTTPS_PROXY: 'http://old-proxy'
      }
    }, null, 2), 'utf8');

    channelsService.updateClaudeSettingsWithModelConfig({
      baseUrl: 'https://claude.example.com',
      apiKey: 'managed-key',
      presetId: 'third-party',
      modelConfig: {
        model: 'claude-3-7-sonnet',
        haikuModel: 'haiku-custom',
        sonnetModel: 'sonnet-custom',
        opusModel: 'opus-custom'
      },
      proxyUrl: 'http://proxy.internal:8080'
    });

    expect(clearNativeOAuthMock).toHaveBeenCalledWith('claude');
    expect(readJson(settingsPath)).toEqual({
      env: {
        ANTHROPIC_BASE_URL: 'https://claude.example.com',
        ANTHROPIC_API_KEY: 'managed-key',
        ANTHROPIC_MODEL: 'claude-3-7-sonnet',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'haiku-custom',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'sonnet-custom',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'opus-custom',
        HTTPS_PROXY: 'http://proxy.internal:8080',
        HTTP_PROXY: 'http://proxy.internal:8080'
      },
      apiKeyHelper: 'echo \'managed-key\''
    });
  });

  test('updateClaudeSettings preserves the existing auth mode when writing credentials', () => {
    const settingsPath = path.join(testDir, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

    fs.writeFileSync(settingsPath, JSON.stringify({
      env: {
        ANTHROPIC_AUTH_TOKEN: 'old-auth'
      }
    }, null, 2), 'utf8');
    channelsService.updateClaudeSettings('https://auth-mode.example', 'new-auth');
    expect(readJson(settingsPath)).toEqual({
      env: {
        ANTHROPIC_BASE_URL: 'https://auth-mode.example',
        ANTHROPIC_AUTH_TOKEN: 'new-auth'
      },
      apiKeyHelper: 'echo \'new-auth\''
    });

    fs.writeFileSync(settingsPath, JSON.stringify({
      env: {
        ANTHROPIC_API_KEY: 'old-api-key'
      }
    }, null, 2), 'utf8');
    channelsService.updateClaudeSettings('https://api-key-mode.example', 'new-api-key');
    expect(readJson(settingsPath)).toEqual({
      env: {
        ANTHROPIC_API_KEY: 'new-api-key',
        ANTHROPIC_BASE_URL: 'https://api-key-mode.example'
      },
      apiKeyHelper: 'echo \'new-api-key\''
    });
  });

  test('selects the active channel from the saved state and falls back to the first enabled channel', () => {
    let now = 1700000000000;
    vi.spyOn(Date, 'now').mockImplementation(() => now++);

    const primary = channelsService.createChannel('Primary', 'https://primary.example', 'key-primary');
    const secondary = channelsService.createChannel('Secondary', 'https://secondary.example', 'key-secondary', undefined, {
      enabled: false
    });

    const activeStatePath = path.join(testDir, '.cc-tool', 'state', 'active-channel.json');
    fs.mkdirSync(path.dirname(activeStatePath), { recursive: true });
    fs.writeFileSync(activeStatePath, JSON.stringify({ activeChannelId: secondary.id }, null, 2), 'utf8');

    expect(channelsService.getCurrentChannel()).toEqual(expect.objectContaining({
      id: secondary.id,
      name: 'Secondary'
    }));
    expect(channelsService.getCurrentSettings()).toEqual({
      baseUrl: 'https://secondary.example',
      apiKey: 'key-secondary',
      channelName: 'Secondary',
      channelId: secondary.id
    });

    fs.writeFileSync(activeStatePath, JSON.stringify({ activeChannelId: 'missing-channel' }, null, 2), 'utf8');
    expect(channelsService.getCurrentChannel()).toEqual(expect.objectContaining({
      id: primary.id,
      name: 'Primary'
    }));
    expect(channelsService.getBestChannelForRestore()).toEqual(expect.objectContaining({
      id: primary.id,
      name: 'Primary'
    }));
  });

  test('createChannel writes settings.json for the enabled channel when proxy is off', () => {
    const settingsPath = path.join(testDir, '.claude', 'settings.json');

    const channel = channelsService.createChannel('Primary', 'https://primary.example', 'key-primary');

    expect(readJson(settingsPath)).toEqual({
      env: {
        ANTHROPIC_BASE_URL: 'https://primary.example',
        ANTHROPIC_API_KEY: 'key-primary'
      },
      apiKeyHelper: "echo 'key-primary'"
    });
    expect(channel.enabled).toBe(true);
  });

  test('updateChannel writes settings.json when enabling a different channel in single-channel mode', () => {
    let now = 1700000001000;
    vi.spyOn(Date, 'now').mockImplementation(() => now++);

    const settingsPath = path.join(testDir, '.claude', 'settings.json');
    const primary = channelsService.createChannel('Primary', 'https://primary.example', 'key-primary');
    const secondary = channelsService.createChannel('Secondary', 'https://secondary.example', 'key-secondary', undefined, {
      enabled: false
    });

    channelsService.updateChannel(secondary.id, { enabled: true });

    expect(readJson(settingsPath)).toEqual({
      env: {
        ANTHROPIC_BASE_URL: 'https://secondary.example',
        ANTHROPIC_API_KEY: 'key-secondary'
      },
      apiKeyHelper: "echo 'key-secondary'"
    });

    const allChannels = channelsService.getAllChannels();
    expect(allChannels.find(ch => ch.id === primary.id)?.enabled).toBe(false);
    expect(allChannels.find(ch => ch.id === secondary.id)?.enabled).toBe(true);
  });

  test('updateChannel writes settings.json when editing the active enabled channel', () => {
    const settingsPath = path.join(testDir, '.claude', 'settings.json');
    const primary = channelsService.createChannel('Primary', 'https://primary.example', 'key-primary');

    channelsService.updateChannel(primary.id, {
      baseUrl: 'https://primary-next.example',
      apiKey: 'key-next'
    });

    expect(readJson(settingsPath)).toEqual({
      env: {
        ANTHROPIC_BASE_URL: 'https://primary-next.example',
        ANTHROPIC_API_KEY: 'key-next'
      },
      apiKeyHelper: "echo 'key-next'"
    });
  });

  test('writes Windows-compatible helper with the active credential value', () => {
    isWindowsLikePlatformMock.mockReturnValue(true);

    const settingsPath = path.join(testDir, '.claude', 'settings.json');
    channelsService.createChannel('Primary', 'https://primary.example', 'key-primary');

    expect(readJson(settingsPath)).toEqual({
      env: {
        ANTHROPIC_BASE_URL: 'https://primary.example',
        ANTHROPIC_API_KEY: 'key-primary'
      },
      apiKeyHelper: 'cmd /c echo key-primary'
    });
  });

  test('does not write native Claude settings for OpenAI-compatible gateway channels', () => {
    const settingsPath = path.join(testDir, '.claude', 'settings.json');

    const channel = channelsService.createChannel(
      'OpenAI Gateway',
      'https://api.openai.com/v1',
      'sk-openai',
      undefined,
      {
        gatewaySourceType: 'openai_compatible',
        targetApi: 'responses'
      }
    );

    expect(channel.targetApi).toBe('responses');
    expect(fs.existsSync(settingsPath)).toBe(false);
  });

  test('defaults non-official OpenAI-compatible gateways to chat completions for fuller usage data', () => {
    const channel = channelsService.createChannel(
      'GLM Gateway',
      'https://router.example.com/v1',
      'sk-router',
      undefined,
      {
        gatewaySourceType: 'openai_compatible',
        targetApi: 'responses'
      }
    );

    expect(channel.targetApi).toBe('chat.completions');
    expect(channelsService.getAllChannels()[0].targetApi).toBe('chat.completions');
  });

  test('rejects apply-to-settings for OpenAI-compatible gateway channels', () => {
    channelsService.createChannel(
      'OpenAI Gateway',
      'https://api.openai.com/v1',
      'sk-openai',
      undefined,
      {
        gatewaySourceType: 'openai_compatible',
        targetApi: 'responses'
      }
    );

    const channel = channelsService.getAllChannels()[0];

    expect(() => channelsService.applyChannelToSettings(channel.id)).toThrow(
      'OpenAI 格式渠道需要通过 Claude 代理使用，请先启动代理。'
    );
  });

  test('syncCurrentClaudeChannel imports native API-key settings without writing native settings', () => {
    const settingsPath = path.join(testDir, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: 'https://anthropic-proxy.example',
        ANTHROPIC_API_KEY: 'claude-current-key',
        ANTHROPIC_MODEL: 'claude-current-model'
      }
    }, null, 2), 'utf8');

    const result = channelsService.syncCurrentClaudeChannel();
    const channels = channelsService.getAllChannels();

    expect(result.added).toBe(1);
    expect(channels).toHaveLength(1);
    expect(channels[0]).toEqual(expect.objectContaining({
      name: 'Claude 当前配置',
      baseUrl: 'https://anthropic-proxy.example',
      apiKey: 'claude-current-key',
      modelConfig: expect.objectContaining({
        model: 'claude-current-model'
      })
    }));
    expect(readJson(settingsPath).env.ANTHROPIC_API_KEY).toBe('claude-current-key');
  });

  test('syncCurrentClaudeChannel skips OAuth-only settings', () => {
    readNativeOAuthMock.mockReturnValue({ accessToken: 'oauth-token' });
    const settingsPath = path.join(testDir, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({
      env: {
        CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token'
      }
    }, null, 2), 'utf8');

    const result = channelsService.syncCurrentClaudeChannel();

    expect(result.added).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.warnings[0]).toContain('OAuth');
    expect(channelsService.getAllChannels()).toHaveLength(0);
  });

  test('syncCurrentClaudeChannel does not import ctx proxy placeholder settings', () => {
    const settingsPath = path.join(testDir, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:3456',
        ANTHROPIC_API_KEY: 'PROXY_KEY'
      }
    }, null, 2), 'utf8');

    const result = channelsService.syncCurrentClaudeChannel();

    expect(result.added).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.warnings[0]).toContain('ctx 代理');
    expect(channelsService.getAllChannels()).toHaveLength(0);
  });
});
