const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

let testDir;
let service;
let fingerprintForMock;
let inspectToolMock;
let readAllNativeOAuthMock;
let updateCodexOAuthTokensMock;
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
  updateCodexOAuthTokensMock = vi.fn();
  clearNativeOAuthMock = vi.fn();
  disableNativeOAuthCredentialMock = vi.fn();
  applyOAuthCredentialMock = vi.fn();
  const nativeAdapterPath = require.resolve('../../../src/platforms/native-oauth-adapters');
  require.cache[nativeAdapterPath] = {
    id: nativeAdapterPath,
    filename: nativeAdapterPath,
    loaded: true,
    exports: {
      SUPPORTED_TOOLS: ['claude', 'codex', 'gemini', 'omp', 'opencode'],
      fingerprintFor: fingerprintForMock,
      inspectTool: inspectToolMock,
      readAllNativeOAuth: readAllNativeOAuthMock,
      updateCodexOAuthTokens: updateCodexOAuthTokensMock,
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

function writeCredential(tool, credential) {
  const storePath = path.join(testDir, 'oauth', 'credentials.json');
  const tools = {
    claude: { defaultCredentialId: null, credentials: [] },
    codex: { defaultCredentialId: null, credentials: [] },
    gemini: { defaultCredentialId: null, credentials: [] },
    omp: { defaultCredentialId: null, credentials: [] },
    opencode: { defaultCredentialId: null, credentials: [] }
  };
  tools[tool] = {
    defaultCredentialId: credential.id,
    credentials: [credential]
  };
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify({ version: 1, tools }, null, 2), 'utf8');
}

function mockHttpsResponses(responses) {
  const requests = [];
  vi.spyOn(https, 'request').mockImplementation((options, callback) => {
    const request = new EventEmitter();
    request.write = vi.fn();
    request.destroy = vi.fn();
    request.end = vi.fn(() => {
      const responseSpec = responses.shift() || { statusCode: 500, body: '{}' };
      const response = new EventEmitter();
      response.statusCode = responseSpec.statusCode;
      process.nextTick(() => {
        callback(response);
        response.emit('data', responseSpec.body);
        response.emit('end');
      });
    });
    requests.push({ options, request });
    return request;
  });
  return requests;
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oauth-creds-'));
  stubModules();
  delete require.cache[require.resolve('../../../src/platforms/oauth-credentials-service')];
  service = require('../../../src/platforms/oauth-credentials-service');
});

afterEach(() => {
  vi.restoreAllMocks();
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

  test('restores a selected OMP OAuth credential into the native auth broker', () => {
    writeCredential('omp', {
      id: 'stored-omp-credential',
      tool: 'omp',
      providerId: 'openai-codex',
      accountId: 'account-1',
      accountEmail: 'dev@example.com',
      identityKey: 'account-1',
      expiresAt: Date.now() + 3600 * 1000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      fingerprint: 'omp:stored',
      secrets: {
        providerId: 'openai-codex',
        accessToken: 'stored-access-token',
        refreshToken: 'stored-refresh-token',
        accountId: 'account-1',
        primaryToken: 'stored-access-token'
      }
    });

    const result = service.restoreStoredOmpOAuthCredentials([{
      id: 'omp-oauth-channel',
      enabled: true,
      authMode: 'oauth',
      authRef: {
        credentialId: 'stored-omp-credential',
        providerId: 'openai-codex',
        accountId: 'account-1'
      }
    }]);

    expect(result).toEqual({ restored: ['stored-omp-credential'], warnings: [] });
    expect(applyOAuthCredentialMock).toHaveBeenCalledWith('omp', expect.objectContaining({
      providerId: 'openai-codex',
      accessToken: 'stored-access-token',
      refreshToken: 'stored-refresh-token',
      accountId: 'account-1'
    }));
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

  test('normalizes Claude rolling quota windows and reset times', () => {
    const result = service.normalizeOAuthQuota('claude', {
      five_hour: {
        used_percent: 20,
        resets_at: '2026-09-17T10:00:00.000Z'
      },
      seven_day: {
        utilization: 0.4,
        reset_after_seconds: 3600
      }
    });

    expect(result).toMatchObject({
      status: 'available',
      quota: {
        primary: { id: 'primary', label: '5h', remainingPercent: 80, usedPercent: 20 },
        secondary: { id: 'secondary', label: '7d', remainingPercent: 60, usedPercent: 40 }
      }
    });
    expect(result.quota.primary.resetsAt).toBe('2026-09-17T10:00:00.000Z');
    expect(Date.parse(result.quota.secondary.resetsAt)).not.toBeNaN();
  });

  test('fetches Claude usage from the OAuth usage endpoint', async () => {
    const requests = mockHttpsResponses([{
      statusCode: 200,
      body: JSON.stringify({
        five_hour: { used_percent: 10 },
        seven_day: { used_percent: 30 }
      })
    }]);
    writeCredential('claude', {
      id: 'claude-credential',
      tool: 'claude',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      fingerprint: 'claude:test',
      secrets: { accessToken: 'claude-access-token', primaryToken: 'claude-access-token' }
    });

    const result = await service.fetchCredentialUsage('claude', 'claude-credential');

    expect(result.quota.primary.remainingPercent).toBe(90);
    expect(requests[0].options.path).toBe('/api/oauth/usage');
    expect(requests[0].options.headers).toMatchObject({
      Authorization: 'Bearer claude-access-token',
      'anthropic-beta': 'oauth-2025-04-20'
    });
  });

  test('normalizes Codex canonical usage windows and additional limits', () => {
    const result = service.normalizeOAuthQuota('codex', {
      rate_limit: {
        primary_window: { used_percent: 20, reset_at: 1780000000 },
        secondary_window: { used_percent: 40, reset_at: '2026-09-20T10:00:00.000Z' }
      },
      additional_rate_limits: [{
        limit_name: 'GPT-5-Codex',
        rate_limit: {
          primary_window: { remaining_fraction: 0.25, reset_at: '2026-09-19T10:00:00.000Z' }
        }
      }]
    });

    expect(result).toMatchObject({
      status: 'available',
      quota: {
        primary: { id: 'primary', remainingPercent: 80, usedPercent: 20 },
        secondary: { id: 'secondary', remainingPercent: 60, usedPercent: 40 }
      }
    });
    expect(result.quota.additional).toEqual([
      expect.objectContaining({
        id: 'additional:0:primary',
        label: 'GPT-5-Codex 5h',
        remainingPercent: 25,
        usedPercent: 75,
        resetsAt: '2026-09-19T10:00:00.000Z'
      })
    ]);
  });

  test('normalizes Gemini model quota buckets', () => {
    const result = service.normalizeOAuthQuota('gemini', {
      buckets: [
        { modelId: 'gemini-2.5-pro', remainingFraction: 0.8, resetTime: '2026-09-18T12:00:00.000Z' },
        { modelId: 'gemini-2.5-flash', remainingFraction: 0 }
      ]
    });

    expect(result).toMatchObject({
      status: 'available',
      quota: {
        windows: [
          {
            id: 'gemini:gemini-2.5-pro',
            label: 'gemini-2.5-pro',
            remainingPercent: 80,
            usedPercent: 20,
            resetsAt: '2026-09-18T12:00:00.000Z'
          },
          {
            id: 'gemini:gemini-2.5-flash',
            remainingPercent: 0,
            usedPercent: 100
          }
        ]
      }
    });
  });

  test('uses Codex access token, account claim and wham usage endpoint', async () => {
    decodeJwtPayloadMock.mockImplementation((token) => token === 'id-token'
      ? { 'https://api.openai.com/auth.chatgpt_account_id': 'chatgpt-account-1' }
      : {});
    const requests = mockHttpsResponses([{
      statusCode: 200,
      body: JSON.stringify({
        rate_limit: {
          primary_window: { used_percent: 20 },
          secondary_window: { used_percent: 40 }
        }
      })
    }]);
    writeCredential('codex', {
      id: 'codex-credential',
      tool: 'codex',
      providerId: '',
      accountId: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      fingerprint: 'codex:test',
      secrets: {
        accessToken: 'access-token',
        idToken: 'id-token',
        primaryToken: 'access-token'
      }
    });

    const result = await service.fetchCredentialUsage('codex', 'codex-credential');

    expect(result.quota.primary.remainingPercent).toBe(80);
    expect(requests).toHaveLength(1);
    expect(requests[0].options.path).toBe('/backend-api/wham/usage');
    expect(requests[0].options.headers).toMatchObject({
      Authorization: 'Bearer access-token',
      'ChatGPT-Account-Id': 'chatgpt-account-1'
    });
  });

  test('refreshes an expired Codex OAuth token before loading quota', async () => {
    decodeJwtPayloadMock.mockImplementation((token) => token === 'fresh-access-token'
      ? { 'https://api.openai.com/auth': { chatgpt_account_id: 'fresh-account-1' } }
      : {});
    const requests = mockHttpsResponses([
      {
        statusCode: 200,
        body: JSON.stringify({
          access_token: 'fresh-access-token',
          refresh_token: 'rotated-refresh-token',
          expires_in: 3600
        })
      },
      {
        statusCode: 200,
        body: JSON.stringify({
          rate_limit: {
            primary_window: { used_percent: 15 },
            secondary_window: { used_percent: 35 }
          }
        })
      }
    ]);
    writeCredential('codex', {
      id: 'expired-codex-credential',
      tool: 'codex',
      accountId: 'old-account-1',
      expiresAt: Date.now() - 1000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      fingerprint: 'codex:expired',
      secrets: {
        accessToken: 'expired-access-token',
        refreshToken: 'refresh-token',
        idToken: '',
        accountId: 'old-account-1',
        primaryToken: 'expired-access-token'
      }
    });

    const result = await service.fetchCredentialUsage('codex', 'expired-codex-credential');

    expect(result.quota).toMatchObject({
      primary: { remainingPercent: 85 },
      secondary: { remainingPercent: 65 }
    });
    expect(requests[0].options.path).toBe('/oauth/token');
    expect(requests[0].options.method).toBe('POST');
    expect(requests[1].options.path).toBe('/backend-api/wham/usage');
    expect(requests[1].options.headers.Authorization).toBe('Bearer fresh-access-token');
    expect(requests[1].options.headers['ChatGPT-Account-Id']).toBe('fresh-account-1');
    expect(updateCodexOAuthTokensMock).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'fresh-access-token',
      refreshToken: 'rotated-refresh-token',
      accountId: 'fresh-account-1'
    }));
  });

  test('reimports a refreshed OMP OAuth token into the native auth broker', async () => {
    decodeJwtPayloadMock.mockImplementation((token) => token === 'fresh-omp-access-token'
      ? { 'https://api.openai.com/auth': { chatgpt_account_id: 'fresh-omp-account-1' } }
      : {});
    const requests = mockHttpsResponses([
      {
        statusCode: 200,
        body: JSON.stringify({
          access_token: 'fresh-omp-access-token',
          refresh_token: 'rotated-omp-refresh-token',
          expires_in: 3600
        })
      },
      {
        statusCode: 200,
        body: JSON.stringify({
          rate_limit: {
            primary_window: { used_percent: 20 },
            secondary_window: { used_percent: 40 }
          }
        })
      }
    ]);
    writeCredential('omp', {
      id: 'expired-omp-credential',
      tool: 'omp',
      providerId: 'openai-codex',
      accountId: 'old-omp-account-1',
      accountEmail: 'dev@example.com',
      identityKey: 'old-omp-account-1',
      expiresAt: Date.now() - 1000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      fingerprint: 'omp:expired',
      secrets: {
        providerId: 'openai-codex',
        accessToken: 'expired-omp-access-token',
        refreshToken: 'omp-refresh-token',
        accountId: 'old-omp-account-1',
        primaryToken: 'expired-omp-access-token'
      }
    });

    const result = await service.fetchCredentialUsage('omp', 'expired-omp-credential');

    expect(result.quota).toMatchObject({
      primary: { remainingPercent: 80 },
      secondary: { remainingPercent: 60 }
    });
    expect(requests[0].options.path).toBe('/oauth/token');
    expect(requests[1].options.path).toBe('/backend-api/wham/usage');
    expect(applyOAuthCredentialMock).toHaveBeenCalledWith('omp', expect.objectContaining({
      providerId: 'openai-codex',
      accessToken: 'fresh-omp-access-token',
      refreshToken: 'rotated-omp-refresh-token',
      accountId: 'fresh-omp-account-1',
      accountEmail: 'dev@example.com',
      identityKey: 'old-omp-account-1'
    }));
  });

  test('uses OpenCode OpenAI OAuth tokens with the Codex usage endpoint', async () => {
    decodeJwtPayloadMock.mockImplementation((token) => token === 'openai-access-token'
      ? { 'https://api.openai.com/auth': { chatgpt_account_id: 'openai-account-1' } }
      : {});
    const requests = mockHttpsResponses([{
      statusCode: 200,
      body: JSON.stringify({
        rate_limit: {
          primary_window: { used_percent: 10 },
          secondary_window: { used_percent: 30 }
        }
      })
    }]);
    writeCredential('opencode', {
      id: 'opencode-credential',
      tool: 'opencode',
      providerId: 'openai-codex',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      fingerprint: 'opencode:test',
      secrets: {
        accessToken: 'openai-access-token',
        primaryToken: 'openai-access-token'
      }
    });

    const result = await service.fetchCredentialUsage('opencode', 'opencode-credential');

    expect(result.quota).toMatchObject({
      primary: { remainingPercent: 90 },
      secondary: { remainingPercent: 70 }
    });
    expect(requests[0].options.path).toBe('/backend-api/wham/usage');
    expect(requests[0].options.headers).toMatchObject({
      Authorization: 'Bearer openai-access-token',
      'ChatGPT-Account-Id': 'openai-account-1'
    });
  });

  test('loads Gemini project before retrieving quota buckets', async () => {
    const requests = mockHttpsResponses([
      {
        statusCode: 200,
        body: JSON.stringify({ cloudaicompanionProject: { id: 'project-1' } })
      },
      {
        statusCode: 200,
        body: JSON.stringify({
          buckets: [{ modelId: 'gemini-2.5-pro', remainingFraction: 0.7, resetTime: '2026-09-18T12:00:00.000Z' }]
        })
      }
    ]);
    writeCredential('gemini', {
      id: 'gemini-credential',
      tool: 'gemini',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      fingerprint: 'gemini:test',
      secrets: { accessToken: 'gemini-access-token', primaryToken: 'gemini-access-token' }
    });

    const result = await service.fetchCredentialUsage('gemini', 'gemini-credential');

    expect(result.quota.windows[0]).toMatchObject({
      id: 'gemini:gemini-2.5-pro',
      remainingPercent: 70,
      resetsAt: '2026-09-18T12:00:00.000Z'
    });
    expect(requests).toHaveLength(2);
    expect(requests[0].options.path).toBe('/v1internal:loadCodeAssist');
    expect(requests[1].options.path).toBe('/v1internal:retrieveUserQuota');
    expect(JSON.parse(requests[1].request.write.mock.calls[0][0])).toEqual({ project: 'project-1' });
    expect(requests[1].options.headers.Authorization).toBe('Bearer gemini-access-token');
  });

  test('reports an expired OAuth grant without fabricating quota', async () => {
    mockHttpsResponses([{ statusCode: 401, body: JSON.stringify({ error: 'unauthorized' }) }]);
    writeCredential('claude', {
      id: 'expired-credential',
      tool: 'claude',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      fingerprint: 'claude:expired',
      secrets: { accessToken: 'expired-token', primaryToken: 'expired-token' }
    });

    const result = await service.fetchCredentialUsage('claude', 'expired-credential');

    expect(result).toMatchObject({ quota: null, status: 'unauthorized' });
  });
});
