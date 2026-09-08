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
let disableClaudeChannelsMock;
let disableCodexChannelsMock;
let disableGeminiChannelsMock;
let disableOmpChannelsMock;
let getProxyStatusMock;
let stopProxyServerMock;
let getCodexProxyStatusMock;
let stopCodexProxyServerMock;
let getGeminiProxyStatusMock;
let stopGeminiProxyServerMock;
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
  const nativeAdapterPath = require.resolve('../../../src/platforms/native-oauth-adapters');
  require.cache[nativeAdapterPath] = {
    id: nativeAdapterPath,
    filename: nativeAdapterPath,
    loaded: true,
    exports: {
      SUPPORTED_TOOLS: ['claude', 'codex', 'gemini', 'omp'],
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
  require.cache[require.resolve('../../../src/platforms/drivers/claude/native-config-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/claude/native-config-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/claude/native-config-implementation'),
    loaded: true,
    exports: { deleteBackup: deleteClaudeBackupMock }
  };
  require.cache[require.resolve('../../../src/platforms/drivers/codex/native-config-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/codex/native-config-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/codex/native-config-implementation'),
    loaded: true,
    exports: { deleteBackup: deleteCodexBackupMock }
  };
  require.cache[require.resolve('../../../src/platforms/drivers/gemini/native-config-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/gemini/native-config-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/gemini/native-config-implementation'),
    loaded: true,
    exports: { deleteBackup: deleteGeminiBackupMock }
  };

  disableClaudeChannelsMock = vi.fn();
  disableCodexChannelsMock = vi.fn();
  disableGeminiChannelsMock = vi.fn();
  disableOmpChannelsMock = vi.fn();
  require.cache[require.resolve('../../../src/platforms/drivers/claude/channels-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/claude/channels-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/claude/channels-implementation'),
    loaded: true,
    exports: { disableAllChannels: disableClaudeChannelsMock }
  };
  require.cache[require.resolve('../../../src/platforms/drivers/codex/channels-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/codex/channels-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/codex/channels-implementation'),
    loaded: true,
    exports: { disableAllChannels: disableCodexChannelsMock }
  };
  require.cache[require.resolve('../../../src/platforms/drivers/gemini/channels-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/gemini/channels-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/gemini/channels-implementation'),
    loaded: true,
    exports: { disableAllChannels: disableGeminiChannelsMock }
  };
  require.cache[require.resolve('../../../src/platforms/drivers/omp/channels-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/omp/channels-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/omp/channels-implementation'),
    loaded: true,
    exports: { disableAllChannels: disableOmpChannelsMock }
  };

  getProxyStatusMock = vi.fn(() => ({ running: false }));
  stopProxyServerMock = vi.fn(async () => {});
  require.cache[require.resolve('../../../src/platforms/drivers/claude/proxy-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/claude/proxy-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/claude/proxy-implementation'),
    loaded: true,
    exports: {
      getProxyStatus: getProxyStatusMock,
      stopProxyServer: stopProxyServerMock
    }
  };

  getCodexProxyStatusMock = vi.fn(() => ({ running: false }));
  stopCodexProxyServerMock = vi.fn(async () => {});
  require.cache[require.resolve('../../../src/platforms/drivers/codex/proxy-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/codex/proxy-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/codex/proxy-implementation'),
    loaded: true,
    exports: {
      getCodexProxyStatus: getCodexProxyStatusMock,
      stopCodexProxyServer: stopCodexProxyServerMock
    }
  };

  getGeminiProxyStatusMock = vi.fn(() => ({ running: false }));
  stopGeminiProxyServerMock = vi.fn(async () => {});
  require.cache[require.resolve('../../../src/platforms/drivers/gemini/proxy-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/gemini/proxy-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/gemini/proxy-implementation'),
    loaded: true,
    exports: {
      getGeminiProxyStatus: getGeminiProxyStatusMock,
      stopGeminiProxyServer: stopGeminiProxyServerMock
    }
  };


  getOmpProxyStatusMock = vi.fn(() => ({ running: false }));
  stopOmpProxyServerMock = vi.fn(async () => {});
  require.cache[require.resolve('../../../src/platforms/drivers/omp/proxy-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/omp/proxy-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/omp/proxy-implementation'),
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
  delete require.cache[require.resolve('../../../src/platforms/oauth-credentials-service')];
  service = require('../../../src/platforms/oauth-credentials-service');
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/platforms/oauth-credentials-service',
    '../../../src/config/paths',
    '../../../src/platforms/native-oauth-adapters',
    '../../../src/server/services/oauth-utils',
    '../../../src/platforms/drivers/claude/native-config-implementation',
    '../../../src/platforms/drivers/codex/native-config-implementation',
    '../../../src/platforms/drivers/gemini/native-config-implementation',
    '../../../src/platforms/drivers/claude/channels-implementation',
    '../../../src/platforms/drivers/codex/channels-implementation',
    '../../../src/platforms/drivers/omp/channels-implementation',
    '../../../src/platforms/drivers/claude/proxy-implementation',
    '../../../src/platforms/drivers/codex/proxy-implementation',
    '../../../src/platforms/drivers/gemini/proxy-implementation',
    '../../../src/platforms/drivers/omp/proxy-implementation'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
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
        omp: { defaultCredentialId: null, credentials: [] }
      }
    }, null, 2), 'utf8');

    const result = await service.fetchCredentialUsage('claude', 'cred-1');

    expect(result).toEqual({ error: '无有效 token' });
  });
});
