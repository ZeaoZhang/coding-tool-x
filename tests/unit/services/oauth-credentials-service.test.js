const fs = require('fs');
const os = require('os');
const path = require('path');

let testDir;
let service;
let fingerprintForMock;
let inspectToolMock;
let readAllNativeOAuthMock;
let clearNativeOAuthMock;
let disableNativeOAuthCredentialMock;
let applyOAuthCredentialMock;
let maskTokenMock;
let decodeJwtPayloadMock;
let removeFileIfExistsMock;
let deleteClaudeBackupMock;
let deleteCodexBackupMock;
let deleteGeminiBackupMock;
let deleteOpenCodeBackupMock;
let disableClaudeChannelsMock;
let disableCodexChannelsMock;
let disableGeminiChannelsMock;
let disableOpenCodeChannelsMock;
let disableOmpChannelsMock;
let getProxyStatusMock;
let stopProxyServerMock;
let getCodexProxyStatusMock;
let stopCodexProxyServerMock;
let getGeminiProxyStatusMock;
let stopGeminiProxyServerMock;
let getOpenCodeProxyStatusMock;
let stopOpenCodeProxyServerMock;
let getOmpProxyStatusMock;
let stopOmpProxyServerMock;

function stubModules() {
  const pathsModulePath = require.resolve('../../../src/config/paths');
  require.cache[pathsModulePath] = {
    id: pathsModulePath,
    filename: pathsModulePath,
    loaded: true,
    exports: {
      PATHS: {
        oauthCredentials: path.join(testDir, 'oauth', 'credentials.json'),
        activeChannel: {
          claude: path.join(testDir, 'active', 'claude.json'),
          codex: path.join(testDir, 'active', 'codex.json'),
          gemini: path.join(testDir, 'active', 'gemini.json'),
          opencode: path.join(testDir, 'active', 'opencode.json'),
          omp: path.join(testDir, 'active', 'omp.json')
        }
      }
    }
  };

  fingerprintForMock = vi.fn((tool, value) => `${tool}:${value}`);
  inspectToolMock = vi.fn((tool) => ({ tool, connected: false }));
  readAllNativeOAuthMock = vi.fn(() => []);
  clearNativeOAuthMock = vi.fn();
  disableNativeOAuthCredentialMock = vi.fn();
  applyOAuthCredentialMock = vi.fn();
  const nativeAdapterPath = require.resolve('../../../src/server/services/native-oauth-adapters');
  require.cache[nativeAdapterPath] = {
    id: nativeAdapterPath,
    filename: nativeAdapterPath,
    loaded: true,
    exports: {
      SUPPORTED_TOOLS: ['claude', 'codex', 'gemini', 'opencode', 'omp'],
      fingerprintFor: fingerprintForMock,
      inspectTool: inspectToolMock,
      readAllNativeOAuth: readAllNativeOAuthMock,
      clearNativeOAuth: clearNativeOAuthMock,
      disableNativeOAuthCredential: disableNativeOAuthCredentialMock,
      applyOAuthCredential: applyOAuthCredentialMock
    }
  };

  maskTokenMock = vi.fn((token) => (token ? `***${String(token).slice(-4)}` : ''));
  decodeJwtPayloadMock = vi.fn((token) => {
    if (token === 'id-token') {
      return { email: 'dev@example.com', sub: 'acct-123', name: 'Dev' };
    }
    return {};
  });
  removeFileIfExistsMock = vi.fn((filePath) => {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (_) {}
  });
  const oauthUtilsPath = require.resolve('../../../src/server/services/oauth-utils');
  require.cache[oauthUtilsPath] = {
    id: oauthUtilsPath,
    filename: oauthUtilsPath,
    loaded: true,
    exports: {
      maskToken: maskTokenMock,
      decodeJwtPayload: decodeJwtPayloadMock,
      removeFileIfExists: removeFileIfExistsMock
    }
  };

  deleteClaudeBackupMock = vi.fn();
  deleteCodexBackupMock = vi.fn();
  deleteGeminiBackupMock = vi.fn();
  deleteOpenCodeBackupMock = vi.fn();
  require.cache[require.resolve('../../../src/server/services/settings-manager')] = {
    id: require.resolve('../../../src/server/services/settings-manager'),
    filename: require.resolve('../../../src/server/services/settings-manager'),
    loaded: true,
    exports: { deleteBackup: deleteClaudeBackupMock }
  };
  require.cache[require.resolve('../../../src/server/services/codex-settings-manager')] = {
    id: require.resolve('../../../src/server/services/codex-settings-manager'),
    filename: require.resolve('../../../src/server/services/codex-settings-manager'),
    loaded: true,
    exports: { deleteBackup: deleteCodexBackupMock }
  };
  require.cache[require.resolve('../../../src/server/services/gemini-settings-manager')] = {
    id: require.resolve('../../../src/server/services/gemini-settings-manager'),
    filename: require.resolve('../../../src/server/services/gemini-settings-manager'),
    loaded: true,
    exports: { deleteBackup: deleteGeminiBackupMock }
  };
  require.cache[require.resolve('../../../src/server/services/opencode-settings-manager')] = {
    id: require.resolve('../../../src/server/services/opencode-settings-manager'),
    filename: require.resolve('../../../src/server/services/opencode-settings-manager'),
    loaded: true,
    exports: { deleteBackup: deleteOpenCodeBackupMock }
  };

  disableClaudeChannelsMock = vi.fn();
  disableCodexChannelsMock = vi.fn();
  disableGeminiChannelsMock = vi.fn();
  disableOpenCodeChannelsMock = vi.fn();
  disableOmpChannelsMock = vi.fn();
  require.cache[require.resolve('../../../src/server/services/channels')] = {
    id: require.resolve('../../../src/server/services/channels'),
    filename: require.resolve('../../../src/server/services/channels'),
    loaded: true,
    exports: { disableAllChannels: disableClaudeChannelsMock }
  };
  require.cache[require.resolve('../../../src/server/services/codex-channels')] = {
    id: require.resolve('../../../src/server/services/codex-channels'),
    filename: require.resolve('../../../src/server/services/codex-channels'),
    loaded: true,
    exports: { disableAllChannels: disableCodexChannelsMock }
  };
  require.cache[require.resolve('../../../src/server/services/gemini-channels')] = {
    id: require.resolve('../../../src/server/services/gemini-channels'),
    filename: require.resolve('../../../src/server/services/gemini-channels'),
    loaded: true,
    exports: { disableAllChannels: disableGeminiChannelsMock }
  };
  require.cache[require.resolve('../../../src/server/services/opencode-channels')] = {
    id: require.resolve('../../../src/server/services/opencode-channels'),
    filename: require.resolve('../../../src/server/services/opencode-channels'),
    loaded: true,
    exports: { disableAllChannels: disableOpenCodeChannelsMock }
  };
  require.cache[require.resolve('../../../src/server/services/omp-channels')] = {
    id: require.resolve('../../../src/server/services/omp-channels'),
    filename: require.resolve('../../../src/server/services/omp-channels'),
    loaded: true,
    exports: { disableAllChannels: disableOmpChannelsMock }
  };

  getProxyStatusMock = vi.fn(() => ({ running: false }));
  stopProxyServerMock = vi.fn(async () => {});
  require.cache[require.resolve('../../../src/server/proxy-server')] = {
    id: require.resolve('../../../src/server/proxy-server'),
    filename: require.resolve('../../../src/server/proxy-server'),
    loaded: true,
    exports: {
      getProxyStatus: getProxyStatusMock,
      stopProxyServer: stopProxyServerMock
    }
  };

  getCodexProxyStatusMock = vi.fn(() => ({ running: false }));
  stopCodexProxyServerMock = vi.fn(async () => {});
  require.cache[require.resolve('../../../src/server/codex-proxy-server')] = {
    id: require.resolve('../../../src/server/codex-proxy-server'),
    filename: require.resolve('../../../src/server/codex-proxy-server'),
    loaded: true,
    exports: {
      getCodexProxyStatus: getCodexProxyStatusMock,
      stopCodexProxyServer: stopCodexProxyServerMock
    }
  };

  getGeminiProxyStatusMock = vi.fn(() => ({ running: false }));
  stopGeminiProxyServerMock = vi.fn(async () => {});
  require.cache[require.resolve('../../../src/server/gemini-proxy-server')] = {
    id: require.resolve('../../../src/server/gemini-proxy-server'),
    filename: require.resolve('../../../src/server/gemini-proxy-server'),
    loaded: true,
    exports: {
      getGeminiProxyStatus: getGeminiProxyStatusMock,
      stopGeminiProxyServer: stopGeminiProxyServerMock
    }
  };

  getOpenCodeProxyStatusMock = vi.fn(() => ({ running: false }));
  stopOpenCodeProxyServerMock = vi.fn(async () => {});
  require.cache[require.resolve('../../../src/server/opencode-proxy-server')] = {
    id: require.resolve('../../../src/server/opencode-proxy-server'),
    filename: require.resolve('../../../src/server/opencode-proxy-server'),
    loaded: true,
    exports: {
      getOpenCodeProxyStatus: getOpenCodeProxyStatusMock,
      stopOpenCodeProxyServer: stopOpenCodeProxyServerMock
    }
  };

  getOmpProxyStatusMock = vi.fn(() => ({ running: false }));
  stopOmpProxyServerMock = vi.fn(async () => {});
  require.cache[require.resolve('../../../src/server/omp-proxy-server')] = {
    id: require.resolve('../../../src/server/omp-proxy-server'),
    filename: require.resolve('../../../src/server/omp-proxy-server'),
    loaded: true,
    exports: {
      getOmpProxyStatus: getOmpProxyStatusMock,
      stopOmpProxyServer: stopOmpProxyServerMock
    }
  };
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oauth-creds-'));
  stubModules();
  delete require.cache[require.resolve('../../../src/server/services/oauth-credentials-service')];
  service = require('../../../src/server/services/oauth-credentials-service');
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/server/services/oauth-credentials-service',
    '../../../src/config/paths',
    '../../../src/server/services/native-oauth-adapters',
    '../../../src/server/services/oauth-utils',
    '../../../src/server/services/settings-manager',
    '../../../src/server/services/codex-settings-manager',
    '../../../src/server/services/gemini-settings-manager',
    '../../../src/server/services/opencode-settings-manager',
    '../../../src/server/services/channels',
    '../../../src/server/services/codex-channels',
    '../../../src/server/services/gemini-channels',
    '../../../src/server/services/opencode-channels',
    '../../../src/server/services/omp-channels',
    '../../../src/server/proxy-server',
    '../../../src/server/codex-proxy-server',
    '../../../src/server/gemini-proxy-server',
    '../../../src/server/opencode-proxy-server',
    '../../../src/server/omp-proxy-server'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('oauth credential import', () => {
  test('imports Claude credential from JSON payload', () => {
    const credential = service.importCredential('claude', {
      name: 'Claude Main',
      raw: JSON.stringify({
        accessToken: 'claude-access-token',
        refreshToken: 'claude-refresh-token'
      })
    });

    expect(credential.tool).toBe('claude');
    expect(credential.name).toBe('Claude Main');
    expect(credential.tokenPreview).toBe('***oken');
    expect(service.getToolSummary('claude').defaultCredentialId).toBe(credential.id);
  });

  test('imports Codex credential and derives account email from id token', () => {
    const credential = service.importCredential('codex', {
      raw: JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: 'codex-access',
          refresh_token: 'codex-refresh',
          id_token: 'id-token'
        }
      })
    });

    expect(credential.accountEmail).toBe('dev@example.com');
    expect(credential.name).toBe('codex - dev@example.com');
  });

  test('imports Gemini credential from access_token JSON shape', () => {
    const credential = service.importCredential('gemini', {
      raw: JSON.stringify({
        access_token: 'gem-access',
        refresh_token: 'gem-refresh',
        email: 'gem@example.com'
      })
    });

    expect(credential.accountEmail).toBe('gem@example.com');
    expect(credential.name).toBe('gemini - gem@example.com');
  });

  test('imports OpenCode credential from nested provider payload', () => {
    const credential = service.importCredential('opencode', {
      raw: JSON.stringify({
        openai: {
          type: 'oauth',
          access: 'open-access',
          refresh: 'open-refresh',
          accountId: 'acct-001'
        }
      })
    });

    expect(credential.providerId).toBe('openai');
    expect(credential.accountId).toBe('acct-001');
    expect(credential.name).toBe('opencode - openai - acct-001');
  });

  test('imports OMP credential from auth-broker row payload', () => {
    const credential = service.importCredential('omp', {
      raw: JSON.stringify({
        provider: 'anthropic',
        credential_type: 'oauth',
        identity_key: 'acct-omp',
        data: {
          access: 'omp-access',
          refresh: 'omp-refresh',
          expires: 2000000000000,
          accountId: 'acct-omp'
        }
      })
    });

    expect(credential.providerId).toBe('anthropic');
    expect(credential.accountId).toBe('acct-omp');
    expect(credential.name).toBe('omp - anthropic - acct-omp');
  });
});

describe('oauth credential store operations', () => {
  test('syncLocalCredential stores detected native credentials', () => {
    readAllNativeOAuthMock.mockImplementation((tool) => (
      tool === 'claude'
        ? [{ accessToken: 'local-token', primaryToken: 'local-token', accountEmail: 'local@example.com' }]
        : []
    ));

    const result = service.syncLocalCredential('claude');

    expect(result.credential.accountEmail).toBe('local@example.com');
    expect(result.summary.credentials).toHaveLength(1);
  });

  test('syncLocalCredential throws when no local credentials exist', () => {
    expect(() => service.syncLocalCredential('claude')).toThrow(/未检测到/);
  });

  test('setDefaultCredential switches the default credential', () => {
    const first = service.importCredential('claude', { raw: JSON.stringify({ accessToken: 'token-1' }) });
    const second = service.importCredential('claude', { raw: JSON.stringify({ accessToken: 'token-2' }) });

    const summary = service.setDefaultCredential('claude', second.id);

    expect(summary.defaultCredentialId).toBe(second.id);
    expect(summary.credentials.find((credential) => credential.id === second.id).isDefault).toBe(true);
    expect(first.id).not.toBe(second.id);
  });

  test('deleteCredential removes entry and rotates default', () => {
    const first = service.importCredential('claude', { raw: JSON.stringify({ accessToken: 'token-1' }) });
    const second = service.importCredential('claude', { raw: JSON.stringify({ accessToken: 'token-2' }) });

    const summary = service.deleteCredential('claude', first.id);

    expect(summary.credentials).toHaveLength(1);
    expect(summary.defaultCredentialId).toBe(second.id);
  });
});

describe('oauth credential application and cleanup', () => {
  test('applyStoredCredential stops proxy, cleans artifacts and updates lastUsedAt', async () => {
    const credential = service.importCredential('claude', {
      raw: JSON.stringify({ accessToken: 'claude-access-token', refreshToken: 'refresh' })
    });
    getProxyStatusMock.mockReturnValue({ running: true });
    fs.mkdirSync(path.join(testDir, 'active'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'active', 'claude.json'), '{"active":true}', 'utf8');

    const result = await service.applyStoredCredential('claude', credential.id);

    expect(result.proxyStopped).toBe(true);
    expect(stopProxyServerMock).toHaveBeenCalled();
    expect(deleteClaudeBackupMock).toHaveBeenCalled();
    expect(disableClaudeChannelsMock).toHaveBeenCalled();
    expect(applyOAuthCredentialMock).toHaveBeenCalledWith('claude', expect.objectContaining({
      accessToken: 'claude-access-token'
    }));
    expect(fs.existsSync(path.join(testDir, 'active', 'claude.json'))).toBe(false);
    expect(result.toolSummary.credentials[0].lastUsedAt).toBeTypeOf('number');
  });

  test('applyStoredCredential preserves OpenCode channel enablement while applying OAuth', async () => {
    const credential = service.importCredential('opencode', {
      raw: JSON.stringify({
        openai: {
          type: 'oauth',
          access: 'open-access',
          refresh: 'open-refresh'
        }
      })
    });

    const result = await service.applyStoredCredential('opencode', credential.id);

    expect(disableOpenCodeChannelsMock).not.toHaveBeenCalled();
    expect(applyOAuthCredentialMock).toHaveBeenCalledWith('opencode', expect.objectContaining({
      accessToken: 'open-access'
    }));
    expect(result.toolSummary.credentials[0].lastUsedAt).toBeTypeOf('number');
  });

  test('applyStoredCredential preserves OMP channel enablement while applying OAuth', async () => {
    const credential = service.importCredential('omp', {
      raw: JSON.stringify({
        provider: 'openai-codex',
        credential_type: 'oauth',
        data: {
          access: 'omp-access',
          refresh: 'omp-refresh'
        }
      })
    });

    const result = await service.applyStoredCredential('omp', credential.id);

    expect(disableOmpChannelsMock).not.toHaveBeenCalled();
    expect(applyOAuthCredentialMock).toHaveBeenCalledWith('omp', expect.objectContaining({
      providerId: 'openai-codex',
      accessToken: 'omp-access'
    }));
    expect(result.toolSummary.credentials[0].lastUsedAt).toBeTypeOf('number');
  });

  test('clearNativeOAuthState delegates to native adapter and returns latest state', () => {
    inspectToolMock.mockReturnValue({ tool: 'claude', connected: false, mode: 'oauth' });

    const state = service.clearNativeOAuthState('claude');

    expect(clearNativeOAuthMock).toHaveBeenCalledWith('claude');
    expect(state).toEqual({ tool: 'claude', connected: false, mode: 'oauth' });
  });

  test('disableStoredCredential delegates to native adapter and returns refreshed state', () => {
    const credential = service.importCredential('opencode', {
      raw: JSON.stringify({
        openai: {
          type: 'oauth',
          access: 'open-access',
          refresh: 'open-refresh',
          accountId: 'acct-001'
        }
      })
    });
    inspectToolMock.mockReturnValue({ tool: 'opencode', mode: 'mixed', oauthPresent: true });

    const result = service.disableStoredCredential('opencode', credential.id);

    expect(disableNativeOAuthCredentialMock).toHaveBeenCalledWith('opencode', expect.objectContaining({
      providerId: 'openai',
      accessToken: 'open-access'
    }));
    expect(result.nativeState).toEqual({ tool: 'opencode', mode: 'mixed', oauthPresent: true });
  });
});

describe('oauth credential usage lookup', () => {
  test('returns error when stored credential has no usable token', async () => {
    const storePath = path.join(testDir, 'oauth', 'credentials.json');
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify({
      version: 1,
      tools: {
        claude: {
          defaultCredentialId: 'cred-1',
          credentials: [{
            id: 'cred-1',
            tool: 'claude',
            name: 'broken',
            source: 'manual',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            fingerprint: 'claude:none',
            secrets: {}
          }]
        },
        codex: { defaultCredentialId: null, credentials: [] },
        gemini: { defaultCredentialId: null, credentials: [] },
        opencode: { defaultCredentialId: null, credentials: [] },
        omp: { defaultCredentialId: null, credentials: [] }
      }
    }, null, 2), 'utf8');

    const result = await service.fetchCredentialUsage('claude', 'cred-1');

    expect(result).toEqual({ error: '无有效 token' });
  });
});
