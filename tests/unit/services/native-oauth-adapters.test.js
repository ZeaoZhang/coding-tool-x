const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const toml = require('toml');
const tomlStringify = require('@iarna/toml').stringify;

let testDir;
let pathsStub;
let claudeSettings;
let geminiEnv;
let geminiSettings;
let opencodeConfig;
let keychainStore;
let nativeAdapters;
let syncCodexUserEnvironmentMock;
let clearManagedChannelConfigMock;
let getProxyStatusMock;
let getCodexProxyStatusMock;
let getGeminiProxyStatusMock;
let getOpenCodeProxyStatusMock;
let getOmpProxyStatusMock;
let getOmpAuthProviderSnapshotMock;

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-oauth-adapters-'));
  keychainStore = new Map();
  claudeSettings = {
    env: {
      ANTHROPIC_API_KEY: 'channel-key',
      ANTHROPIC_BASE_URL: 'https://channel.example',
      ANTHROPIC_AUTH_TOKEN: 'old-token'
    }
  };
  geminiEnv = {
    GOOGLE_GEMINI_BASE_URL: 'https://gemini-channel.example',
    GEMINI_API_KEY: 'gemini-channel-key',
    GEMINI_MODEL: 'gemini-1.5'
  };
  geminiSettings = {
    security: {
      auth: {
        selectedType: 'gemini-api-key'
      }
    }
  };
  opencodeConfig = {
    model: 'anthropic/sonnet',
    provider: {
      openai: { __ctx_managed__: true },
      anthropic: {}
    }
  };

  pathsStub = {
    PATHS: {
      channels: {
        codex: path.join(testDir, '.cc-tool', 'channels', 'codex.json')
      }
    },
    NATIVE_PATHS: {
      claude: {
        credentials: path.join(testDir, '.claude', '.credentials.json'),
        settings: path.join(testDir, '.claude', 'settings.json'),
        dir: path.join(testDir, '.claude')
      },
      codex: {
        auth: path.join(testDir, '.codex', 'auth.json'),
        config: path.join(testDir, '.codex', 'config.toml'),
        dir: path.join(testDir, '.codex')
      },
      gemini: {
        oauthCredentialsEncrypted: path.join(testDir, '.gemini', 'oauth-credentials.enc'),
        oauthCredentialsLegacy: path.join(testDir, '.gemini', 'oauth-credentials.json'),
        googleAccounts: path.join(testDir, '.gemini', 'google-accounts.json')
      },
      opencode: {
        auth: path.join(testDir, '.opencode', 'auth.json')
      }
    }
  };

  fs.mkdirSync(pathsStub.NATIVE_PATHS.codex.dir, { recursive: true });
  writeJson(pathsStub.PATHS.channels.codex, {
    channels: [{ id: 'c1', providerKey: 'provider-a' }]
  });
  fs.mkdirSync(path.dirname(pathsStub.NATIVE_PATHS.codex.config), { recursive: true });
  fs.writeFileSync(pathsStub.NATIVE_PATHS.codex.config, tomlStringify({
    model_provider: 'provider-a',
    model_providers: {
      'provider-a': { base_url: 'https://provider-a.example' }
    }
  }), 'utf8');

  syncCodexUserEnvironmentMock = vi.fn();
  clearManagedChannelConfigMock = vi.fn(() => {
    opencodeConfig.provider = {};
  });
  getProxyStatusMock = vi.fn(() => ({ running: false }));
  getCodexProxyStatusMock = vi.fn(() => ({ running: false }));
  getGeminiProxyStatusMock = vi.fn(() => ({ running: false }));
  getOpenCodeProxyStatusMock = vi.fn(() => ({ running: false }));
  getOmpProxyStatusMock = vi.fn(() => ({ running: false }));
  getOmpAuthProviderSnapshotMock = vi.fn(() => ({
    available: true,
    providers: []
  }));

  require.cache[require.resolve('../../../src/config/paths')] = {
    id: require.resolve('../../../src/config/paths'),
    filename: require.resolve('../../../src/config/paths'),
    loaded: true,
    exports: pathsStub
  };

  require.cache[require.resolve('../../../src/platforms/drivers/claude/native-config-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/claude/native-config-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/claude/native-config-implementation'),
    loaded: true,
    exports: {
      settingsExists: vi.fn(() => true),
      readSettings: vi.fn(() => JSON.parse(JSON.stringify(claudeSettings))),
      writeSettings: vi.fn((value) => { claudeSettings = JSON.parse(JSON.stringify(value)); })
    }
  };

  require.cache[require.resolve('../../../src/platforms/drivers/codex/native-config-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/codex/native-config-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/codex/native-config-implementation'),
    loaded: true,
    exports: {
      readAuth: vi.fn(() => (fs.existsSync(pathsStub.NATIVE_PATHS.codex.auth) ? readJson(pathsStub.NATIVE_PATHS.codex.auth) : {})),
      writeAuth: vi.fn((value) => writeJson(pathsStub.NATIVE_PATHS.codex.auth, value)),
      readConfig: vi.fn(() => toml.parse(fs.readFileSync(pathsStub.NATIVE_PATHS.codex.config, 'utf8')))
    }
  };

  require.cache[require.resolve('../../../src/platforms/drivers/gemini/native-config-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/gemini/native-config-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/gemini/native-config-implementation'),
    loaded: true,
    exports: {
      configExists: vi.fn(() => true),
      readEnv: vi.fn(() => ({ ...geminiEnv })),
      writeEnv: vi.fn((value) => { geminiEnv = { ...value }; }),
      settingsExists: vi.fn(() => true),
      readSettings: vi.fn(() => JSON.parse(JSON.stringify(geminiSettings))),
      writeSettings: vi.fn((value) => { geminiSettings = JSON.parse(JSON.stringify(value)); })
    }
  };

  require.cache[require.resolve('../../../src/platforms/drivers/opencode/native-config-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/opencode/native-config-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/opencode/native-config-implementation'),
    loaded: true,
    exports: {
      clearManagedChannelConfig: clearManagedChannelConfigMock,
      selectConfigPath: vi.fn(() => path.join(testDir, '.opencode', 'config.json')),
      readConfig: vi.fn(() => JSON.parse(JSON.stringify(opencodeConfig))),
      writeConfig: vi.fn((configPath, value) => {
        opencodeConfig = JSON.parse(JSON.stringify(value));
        writeJson(configPath, value);
      })
    }
  };

  require.cache[require.resolve('../../../src/platforms/drivers/codex/env-manager')] = {
    id: require.resolve('../../../src/platforms/drivers/codex/env-manager'),
    filename: require.resolve('../../../src/platforms/drivers/codex/env-manager'),
    loaded: true,
    exports: {
      syncCodexUserEnvironment: syncCodexUserEnvironmentMock
    }
  };

  require.cache[require.resolve('../../../src/server/services/native-keychain')] = {
    id: require.resolve('../../../src/server/services/native-keychain'),
    filename: require.resolve('../../../src/server/services/native-keychain'),
    loaded: true,
    exports: {
      isSupported: vi.fn(() => true),
      getPassword: vi.fn((service, account) => keychainStore.get(`${service}:${account}`) || null),
      setPassword: vi.fn((service, account, value) => {
        keychainStore.set(`${service}:${account}`, value);
        return true;
      }),
      deletePassword: vi.fn((service, account) => {
        keychainStore.delete(`${service}:${account}`);
        return true;
      })
    }
  };

  require.cache[require.resolve('../../../src/server/services/oauth-utils')] = {
    id: require.resolve('../../../src/server/services/oauth-utils'),
    filename: require.resolve('../../../src/server/services/oauth-utils'),
    loaded: true,
    exports: {
      maskToken: vi.fn((token) => token ? `***${String(token).slice(-4)}` : ''),
      decodeJwtPayload: vi.fn((token) => token === 'id-token' ? { email: 'dev@example.com', exp: 2000000000 } : {}),
      removeFileIfExists: vi.fn((filePath) => {
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (_) {}
      }),
      sha256: vi.fn((value) => crypto.createHash('sha256').update(String(value)).digest('hex'))
    }
  };

  require.cache[require.resolve('../../../src/platforms/drivers/claude/proxy-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/claude/proxy-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/claude/proxy-implementation'),
    loaded: true,
    exports: { getProxyStatus: getProxyStatusMock }
  };
  require.cache[require.resolve('../../../src/platforms/drivers/codex/proxy-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/codex/proxy-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/codex/proxy-implementation'),
    loaded: true,
    exports: { getCodexProxyStatus: getCodexProxyStatusMock }
  };
  require.cache[require.resolve('../../../src/platforms/drivers/gemini/proxy-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/gemini/proxy-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/gemini/proxy-implementation'),
    loaded: true,
    exports: { getGeminiProxyStatus: getGeminiProxyStatusMock }
  };
  require.cache[require.resolve('../../../src/platforms/drivers/opencode/proxy-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/opencode/proxy-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/opencode/proxy-implementation'),
    loaded: true,
    exports: { getOpenCodeProxyStatus: getOpenCodeProxyStatusMock }
  };
  require.cache[require.resolve('../../../src/platforms/drivers/omp/proxy-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/omp/proxy-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/omp/proxy-implementation'),
    loaded: true,
    exports: { getOmpProxyStatus: getOmpProxyStatusMock }
  };
  require.cache[require.resolve('../../../src/platforms/drivers/omp/native-config-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/omp/native-config-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/omp/native-config-implementation'),
    loaded: true,
    exports: { isManagedOmpProvidersActive: vi.fn(() => false) }
  };
  require.cache[require.resolve('../../../src/platforms/drivers/omp/auth-providers')] = {
    id: require.resolve('../../../src/platforms/drivers/omp/auth-providers'),
    filename: require.resolve('../../../src/platforms/drivers/omp/auth-providers'),
    loaded: true,
    exports: {
      getOmpAuthProviderSnapshot: getOmpAuthProviderSnapshotMock,
      clearOmpAuthProviderCache: vi.fn()
    }
  };

  delete require.cache[require.resolve('../../../src/platforms/native-oauth-adapters')];
  nativeAdapters = require('../../../src/platforms/native-oauth-adapters');
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/platforms/native-oauth-adapters',
    '../../../src/config/paths',
    '../../../src/platforms/drivers/claude/native-config-implementation',
    '../../../src/platforms/drivers/codex/native-config-implementation',
    '../../../src/platforms/drivers/gemini/native-config-implementation',
    '../../../src/platforms/drivers/opencode/native-config-implementation',
    '../../../src/platforms/drivers/codex/env-manager',
    '../../../src/server/services/native-keychain',
    '../../../src/server/services/oauth-utils',
    '../../../src/platforms/drivers/claude/proxy-implementation',
    '../../../src/platforms/drivers/codex/proxy-implementation',
    '../../../src/platforms/drivers/gemini/proxy-implementation',
    '../../../src/platforms/drivers/opencode/proxy-implementation',
    '../../../src/platforms/drivers/omp/proxy-implementation',
    '../../../src/platforms/drivers/omp/native-config-implementation',
    '../../../src/platforms/drivers/omp/auth-providers'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('native-oauth-adapters high level flows', () => {
  test('applies, reads, inspects, and clears Claude OAuth credentials', () => {
    require.cache[require.resolve('../../../src/server/services/native-keychain')].exports.isSupported.mockReturnValue(false);

    const applyResult = nativeAdapters.applyOAuthCredential('claude', {
      accessToken: 'claude-access-token',
      refreshToken: 'claude-refresh-token'
    });
    const credential = nativeAdapters.readNativeOAuth('claude');
    const state = nativeAdapters.inspectTool('claude');

    expect(applyResult).toEqual({ storage: 'file' });
    expect(credential).toEqual(expect.objectContaining({
      accessToken: 'claude-access-token',
      refreshToken: 'claude-refresh-token',
      storage: 'file'
    }));
    expect(claudeSettings.env).toEqual({});
    expect(state).toEqual(expect.objectContaining({
      tool: 'claude',
      mode: 'oauth',
      oauthPresent: true,
      channelConfigured: false
    }));

    nativeAdapters.clearNativeOAuth('claude');
    expect(fs.existsSync(pathsStub.NATIVE_PATHS.claude.credentials)).toBe(false);
    expect(nativeAdapters.readNativeOAuth('claude')).toBeNull();
  });

  test('reports mixed mode for Claude when API key config and native OAuth both exist', () => {
    require.cache[require.resolve('../../../src/server/services/native-keychain')].exports.isSupported.mockReturnValue(false);
    writeJson(pathsStub.NATIVE_PATHS.claude.credentials, {
      claudeAiOauth: {
        accessToken: 'claude-access-token'
      }
    });

    const state = nativeAdapters.inspectTool('claude');

    expect(state).toEqual(expect.objectContaining({
      tool: 'claude',
      mode: 'channel',
      oauthPresent: true,
      channelConfigured: true
    }));
  });

  test('applies Codex OAuth, clears managed channel config, and prefers keychain on read', () => {
    const result = nativeAdapters.applyOAuthCredential('codex', {
      authMode: 'chatgpt',
      accessToken: 'codex-access',
      refreshToken: 'codex-refresh',
      idToken: 'id-token',
      accountId: 'acct-1'
    });
    const authPayload = readJson(pathsStub.NATIVE_PATHS.codex.auth);
    const configPayload = toml.parse(fs.readFileSync(pathsStub.NATIVE_PATHS.codex.config, 'utf8'));
    const credential = nativeAdapters.readNativeOAuth('codex');
    const state = nativeAdapters.inspectTool('codex');

    expect(result).toEqual({ storage: 'auth-file+keychain' });
    expect(syncCodexUserEnvironmentMock).toHaveBeenCalledWith({}, { replace: true });
    expect(authPayload.tokens.access_token).toBe('codex-access');
    expect(configPayload.model_provider).toBeUndefined();
    expect(configPayload.model_providers).toBeUndefined();
    expect(credential).toEqual(expect.objectContaining({
      accessToken: 'codex-access',
      accountEmail: 'dev@example.com',
      storage: 'keychain'
    }));
    expect(state.mode).toBe('oauth');
  });

  test('reports mixed mode for Codex when channel config and native OAuth both exist', () => {
    writeJson(pathsStub.NATIVE_PATHS.codex.auth, {
      auth_mode: 'chatgpt',
      tokens: {
        access_token: 'codex-access',
        refresh_token: 'codex-refresh',
        id_token: 'id-token'
      }
    });

    const state = nativeAdapters.inspectTool('codex');

    expect(state).toEqual(expect.objectContaining({
      tool: 'codex',
      mode: 'channel',
      oauthPresent: true,
      channelConfigured: true
    }));
  });

  test('applies, reads, inspects, and clears Gemini OAuth credentials', () => {
    require.cache[require.resolve('../../../src/server/services/native-keychain')].exports.isSupported.mockReturnValue(false);

    const result = nativeAdapters.applyOAuthCredential('gemini', {
      accessToken: 'gemini-access',
      refreshToken: 'gemini-refresh',
      tokenType: 'Bearer',
      scope: 'profile email',
      accountEmail: 'user@example.com'
    });
    const credential = nativeAdapters.readNativeOAuth('gemini');
    const state = nativeAdapters.inspectTool('gemini');

    expect(result).toEqual({ storage: 'encrypted-file' });
    expect(geminiEnv).toEqual({});
    expect(geminiSettings.security.auth.selectedType).toBe('oauth-personal');
    expect(readJson(pathsStub.NATIVE_PATHS.gemini.googleAccounts)).toEqual({
      active: 'user@example.com',
      old: []
    });
    expect(credential).toEqual(expect.objectContaining({
      accessToken: 'gemini-access',
      accountEmail: 'user@example.com',
      storage: 'encrypted-file'
    }));
    expect(state.mode).toBe('oauth');

    nativeAdapters.clearNativeOAuth('gemini');
    expect(readJson(pathsStub.NATIVE_PATHS.gemini.googleAccounts).active).toBeNull();
    expect(nativeAdapters.readNativeOAuth('gemini')).toBeNull();
  });

  test('reports mixed mode for Gemini when API key config and native OAuth both exist', () => {
    require.cache[require.resolve('../../../src/server/services/native-keychain')].exports.isSupported.mockReturnValue(false);
    writeJson(pathsStub.NATIVE_PATHS.gemini.oauthCredentialsLegacy, {
      access_token: 'gemini-access',
      refresh_token: 'gemini-refresh'
    });

    const state = nativeAdapters.inspectTool('gemini');

    expect(state).toEqual(expect.objectContaining({
      tool: 'gemini',
      mode: 'channel',
      oauthPresent: true,
      channelConfigured: true
    }));
  });

  test('applies OpenCode OAuth and sorts all credentials by active provider', () => {
    writeJson(pathsStub.NATIVE_PATHS.opencode.auth, {
      openai: {
        type: 'oauth',
        access: 'openai-token',
        refresh: 'openai-refresh'
      },
      anthropic: {
        type: 'oauth',
        access: 'anthropic-token',
        refresh: 'anthropic-refresh'
      }
    });
    const configPath = path.join(testDir, '.opencode', 'config.json');
    writeJson(configPath, opencodeConfig);

    const applyResult = nativeAdapters.applyOAuthCredential('opencode', {
      providerId: 'openai',
      accessToken: 'new-openai-token',
      refreshToken: 'new-refresh'
    });
    let allCredentials = nativeAdapters.readAllNativeOAuth('opencode');
    let primaryCredential = nativeAdapters.readNativeOAuth('opencode');
    const state = nativeAdapters.inspectTool('opencode');

    expect(applyResult).toEqual({ storage: 'auth-file' });
    expect(clearManagedChannelConfigMock).not.toHaveBeenCalled();
    expect(readJson(pathsStub.NATIVE_PATHS.opencode.auth).openai.access).toBe('new-openai-token');
    expect(allCredentials).toEqual(expect.arrayContaining([
      expect.objectContaining({
        providerId: 'openai',
        accessToken: 'new-openai-token'
      }),
      expect.objectContaining({
        providerId: 'anthropic',
        accessToken: 'anthropic-token'
      })
    ]));
    expect(primaryCredential).toEqual(expect.objectContaining({
      providerId: 'anthropic',
      accessToken: 'anthropic-token'
    }));
    expect(state).toEqual(expect.objectContaining({
      mode: 'mixed',
      oauthPresent: true,
      channelConfigured: true
    }));

    writeJson(pathsStub.NATIVE_PATHS.opencode.auth, {
      openai: {
        type: 'oauth',
        access: 'openai-token',
        refresh: 'openai-refresh'
      },
      anthropic: {
        type: 'oauth',
        access: 'anthropic-token',
        refresh: 'anthropic-refresh'
      }
    });
    allCredentials = nativeAdapters.readAllNativeOAuth('opencode');
    primaryCredential = nativeAdapters.readNativeOAuth('opencode');

    expect(allCredentials[0]).toEqual(expect.objectContaining({
      providerId: 'anthropic',
      accessToken: 'anthropic-token'
    }));
    expect(primaryCredential).toEqual(expect.objectContaining({
      providerId: 'anthropic',
      accessToken: 'anthropic-token'
    }));
  });

  test('disables a single OpenCode OAuth credential without clearing the rest', () => {
    writeJson(pathsStub.NATIVE_PATHS.opencode.auth, {
      openai: {
        type: 'oauth',
        access: 'openai-token',
        refresh: 'openai-refresh'
      },
      anthropic: {
        type: 'oauth',
        access: 'anthropic-token',
        refresh: 'anthropic-refresh'
      }
    });

    nativeAdapters.disableNativeOAuthCredential('opencode', {
      providerId: 'openai',
      accessToken: 'openai-token'
    });

    expect(readJson(pathsStub.NATIVE_PATHS.opencode.auth)).toEqual({
      anthropic: {
        type: 'oauth',
        access: 'anthropic-token',
        refresh: 'anthropic-refresh'
      }
    });
  });

  test('reads OMP OAuth accounts from auth-broker provider snapshot', () => {
    getOmpAuthProviderSnapshotMock.mockReturnValue({
      available: true,
      providers: [
        {
          id: 'openai-codex',
          loggedIn: true,
          accountCount: 1,
          accounts: [{ index: 1, identity: 'co***x@example.com' }]
        }
      ]
    });

    const credentials = nativeAdapters.readAllNativeOAuth('omp');
    const state = nativeAdapters.inspectTool('omp');

    expect(credentials).toEqual([
      expect.objectContaining({
        providerId: 'openai-codex',
        accountId: '1',
        accountEmail: 'co***x@example.com',
        storage: 'auth-broker'
      })
    ]);
    expect(state).toEqual(expect.objectContaining({
      tool: 'omp',
      mode: 'oauth',
      oauthPresent: true
    }));
  });

  test('clears OpenCode OAuth and retargets model to a remaining managed provider', () => {
    const configPath = path.join(testDir, '.opencode', 'config.json');
    opencodeConfig = {
      model: 'openai/gpt-4.1',
      provider: {
        openai: {},
        managed: {
          __ctx_managed__: true,
          name: 'Managed',
          options: {
            baseURL: 'https://managed.example',
            apiKey: 'managed-key'
          },
          models: {
            'gpt-4.1-mini': { name: 'gpt-4.1-mini' }
          }
        }
      }
    };
    writeJson(configPath, opencodeConfig);
    writeJson(pathsStub.NATIVE_PATHS.opencode.auth, {
      openai: {
        type: 'oauth',
        access: 'openai-token',
        refresh: 'openai-refresh'
      }
    });

    nativeAdapters.clearNativeOAuth('opencode');

    expect(fs.existsSync(pathsStub.NATIVE_PATHS.opencode.auth)).toBe(false);
    expect(opencodeConfig.provider.openai).toBeUndefined();
    expect(opencodeConfig.model).toBe('managed/gpt-4.1-mini');
  });

  test('treats external OpenCode provider config as channel-configured state', () => {
    const configPath = path.join(testDir, '.opencode', 'config.json');
    opencodeConfig = {
      model: 'external/gpt-4.1',
      provider: {
        external: {
          name: 'External Provider',
          npm: '@ai-sdk/openai-compatible',
          options: {
            baseURL: 'https://external.example',
            apiKey: 'external-key'
          },
          models: {
            'gpt-4.1': { name: 'gpt-4.1' }
          }
        }
      }
    };
    writeJson(configPath, opencodeConfig);

    const state = nativeAdapters.inspectTool('opencode');

    expect(state).toEqual(expect.objectContaining({
      tool: 'opencode',
      mode: 'channel',
      oauthPresent: false,
      channelConfigured: true
    }));
  });
});
