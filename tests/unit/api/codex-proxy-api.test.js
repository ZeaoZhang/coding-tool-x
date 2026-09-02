const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

let testDir;
let channels;
let startCodexProxyServerMock;
let stopCodexProxyServerMock;
let getCodexProxyStatusMock;
let setProxyConfigMock;
let isProxyConfigMock;
let getCurrentProxyPortMock;
let configExistsMock;
let hasBackupMock;
let readConfigMock;
let deleteBackupMock;
let getChannelsMock;
let getEnabledChannelsMock;
let markChannelAsRecentlyUsedMock;
let applyChannelToSettingsMock;
let clearNativeOAuthMock;
let broadcastProxyStateMock;

function buildApp() {
  delete require.cache[require.resolve('../../../src/platforms/drivers/codex/api-proxy')];
  const router = require('../../../src/platforms/drivers/codex/api-proxy');
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

function request(app) {
  return {
    get(url) { return call(app, 'GET', url); },
    post(url, body) { return call(app, 'POST', url, body); }
  };
}

function call(app, method, url, body) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const rawBody = body ? JSON.stringify(body) : null;
      const req = http.request({
        hostname: '127.0.0.1',
        port: server.address().port,
        path: url,
        method,
        headers: rawBody ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(rawBody)
        } : {}
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          server.close();
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });

      req.on('error', (error) => {
        server.close();
        reject(error);
      });

      if (rawBody) req.write(rawBody);
      req.end();
    });
  });
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-proxy-api-'));
  channels = [
    {
      id: 'channel-a',
      name: 'Primary',
      baseUrl: 'https://codex-primary.example',
      websiteUrl: 'https://primary.example',
      providerKey: 'provider-a',
      enabled: true,
      updatedAt: 100
    },
    {
      id: 'channel-b',
      name: 'Preferred',
      baseUrl: 'https://codex-preferred.example',
      websiteUrl: 'https://preferred.example',
      providerKey: 'provider-b',
      enabled: true,
      updatedAt: 200
    }
  ];

  startCodexProxyServerMock = vi.fn(async () => ({ success: true, port: 21001 }));
  stopCodexProxyServerMock = vi.fn(async () => ({ port: 21001 }));
  getCodexProxyStatusMock = vi.fn(() => ({ running: false, port: null }));
  setProxyConfigMock = vi.fn(() => ({
    envInjected: true,
    reloadRequired: true,
    sourceCommand: 'source ~/.zshrc'
  }));
  isProxyConfigMock = vi.fn(() => false);
  getCurrentProxyPortMock = vi.fn(() => null);
  configExistsMock = vi.fn(() => true);
  hasBackupMock = vi.fn(() => false);
  readConfigMock = vi.fn(() => ({ model_provider: 'provider-b' }));
  deleteBackupMock = vi.fn();
  getChannelsMock = vi.fn(() => ({ channels }));
  getEnabledChannelsMock = vi.fn(() => channels.filter((channel) => channel.enabled !== false));
  markChannelAsRecentlyUsedMock = vi.fn((channelId) => {
    const index = channels.findIndex((channel) => channel.id === channelId);
    if (index === -1) return null;
    channels[index] = {
      ...channels[index],
      updatedAt: channels[index].updatedAt + 1000
    };
    return channels[index];
  });
  applyChannelToSettingsMock = vi.fn();
  clearNativeOAuthMock = vi.fn();
  broadcastProxyStateMock = vi.fn();

  require.cache[require.resolve('../../../src/platforms/drivers/codex/proxy-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/codex/proxy-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/codex/proxy-implementation'),
    loaded: true,
    exports: {
      startCodexProxyServer: startCodexProxyServerMock,
      stopCodexProxyServer: stopCodexProxyServerMock,
      getCodexProxyStatus: getCodexProxyStatusMock
    }
  };

  require.cache[require.resolve('../../../src/platforms/drivers/codex/native-config-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/codex/native-config-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/codex/native-config-implementation'),
    loaded: true,
    exports: {
      setProxyConfig: setProxyConfigMock,
      restoreSettings: vi.fn(),
      isProxyConfig: isProxyConfigMock,
      getCurrentProxyPort: getCurrentProxyPortMock,
      configExists: configExistsMock,
      hasBackup: hasBackupMock,
      readConfig: readConfigMock,
      deleteBackup: deleteBackupMock
    }
  };

  require.cache[require.resolve('../../../src/platforms/drivers/codex/channels-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/codex/channels-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/codex/channels-implementation'),
    loaded: true,
    exports: {
      getChannels: getChannelsMock,
      getEnabledChannels: getEnabledChannelsMock,
      markChannelAsRecentlyUsed: markChannelAsRecentlyUsedMock,
      applyChannelToSettings: applyChannelToSettingsMock
    }
  };

  require.cache[require.resolve('../../../src/platforms/native-oauth-adapters')] = {
    id: require.resolve('../../../src/platforms/native-oauth-adapters'),
    filename: require.resolve('../../../src/platforms/native-oauth-adapters'),
    loaded: true,
    exports: {
      clearNativeOAuth: clearNativeOAuthMock
    }
  };

  require.cache[require.resolve('../../../src/server/websocket-server')] = {
    id: require.resolve('../../../src/server/websocket-server'),
    filename: require.resolve('../../../src/server/websocket-server'),
    loaded: true,
    exports: {
      clearAllLogs: vi.fn(),
      broadcastProxyState: broadcastProxyStateMock
    }
  };

  require.cache[require.resolve('../../../src/config/paths')] = {
    id: require.resolve('../../../src/config/paths'),
    filename: require.resolve('../../../src/config/paths'),
    loaded: true,
    exports: {
      PATHS: {
        activeChannel: {
          codex: path.join(testDir, 'state', 'codex-active.json')
        }
      },
      ensureStorageDirMigrated: vi.fn()
    }
  };
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/platforms/drivers/codex/api-proxy',
    '../../../src/platforms/drivers/codex/proxy-implementation',
    '../../../src/platforms/drivers/codex/native-config-implementation',
    '../../../src/platforms/drivers/codex/channels-implementation',
    '../../../src/platforms/native-oauth-adapters',
    '../../../src/server/websocket-server',
    '../../../src/config/paths'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('codex proxy status and start routes', () => {
  test('status returns sanitized active channel from saved state', async () => {
    fs.mkdirSync(path.join(testDir, 'state'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'state', 'codex-active.json'), JSON.stringify({ activeChannelId: 'channel-b' }), 'utf8');
    getCodexProxyStatusMock.mockReturnValue({ running: true, port: 21001 });
    isProxyConfigMock.mockReturnValue(true);
    getCurrentProxyPortMock.mockReturnValue(21001);
    hasBackupMock.mockReturnValue(true);

    const res = await request(buildApp()).get('/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      proxy: { running: true, port: 21001 },
      config: {
        isProxyConfig: true,
        configExists: true,
        hasBackup: true,
        currentProxyPort: 21001
      },
      activeChannel: {
        id: 'channel-b',
        name: 'Preferred',
        baseUrl: 'https://codex-preferred.example',
        websiteUrl: 'https://preferred.example',
        providerKey: 'provider-b'
      }
    });
  });

  test('start validates config existence and enabled channels', async () => {
    const app = buildApp();

    configExistsMock.mockReturnValue(false);
    const missingConfig = await request(app).post('/start', {});

    configExistsMock.mockReturnValue(true);
    getEnabledChannelsMock.mockReturnValue([]);
    const noChannels = await request(app).post('/start', {});

    expect(missingConfig.status).toBe(400);
    expect(noChannels.status).toBe(400);
  });

  test('start prefers current provider, saves active channel, and returns env hint', async () => {
    const res = await request(buildApp()).post('/start', {});

    expect(res.status).toBe(200);
    expect(startCodexProxyServerMock).toHaveBeenCalled();
    expect(markChannelAsRecentlyUsedMock).toHaveBeenCalledWith('channel-b');
    expect(clearNativeOAuthMock).toHaveBeenCalledWith('codex');
    expect(setProxyConfigMock).toHaveBeenCalledWith(21001);
    expect(res.body).toEqual(expect.objectContaining({
      success: true,
      port: 21001,
      activeChannel: expect.objectContaining({
        id: 'channel-b',
        providerKey: 'provider-b'
      }),
      envHint: {
        command: 'source ~/.zshrc',
        message: '请在 Codex 终端执行: source ~/.zshrc'
      }
    }));
    expect(JSON.parse(fs.readFileSync(path.join(testDir, 'state', 'codex-active.json'), 'utf8'))).toEqual({
      activeChannelId: 'channel-b'
    });
    expect(broadcastProxyStateMock).toHaveBeenCalledWith('codex', { running: false, port: null }, channels[1], channels);
  });

  test('start falls back to the latest enabled channel when recently-used update hits a stale id', async () => {
    getEnabledChannelsMock.mockReturnValueOnce([
      {
        id: 'stale-channel',
        name: 'Stale',
        baseUrl: 'https://stale.example',
        providerKey: 'provider-b',
        enabled: true,
        updatedAt: 300
      },
      channels[0]
    ]);
    markChannelAsRecentlyUsedMock.mockImplementationOnce(() => {
      throw new Error('Channel not found');
    });

    const res = await request(buildApp()).post('/start', {});

    expect(res.status).toBe(200);
    expect(markChannelAsRecentlyUsedMock).toHaveBeenCalledWith('stale-channel');
    expect(res.body).toEqual(expect.objectContaining({
      success: true,
      activeChannel: expect.objectContaining({
        id: 'channel-b',
        providerKey: 'provider-b'
      })
    }));
    expect(JSON.parse(fs.readFileSync(path.join(testDir, 'state', 'codex-active.json'), 'utf8'))).toEqual({
      activeChannelId: 'channel-b'
    });
  });
});

describe('codex proxy stop route', () => {
  test('stop discards backup, restores active channel, and removes active channel file', async () => {
    fs.mkdirSync(path.join(testDir, 'state'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'state', 'codex-active.json'), JSON.stringify({ activeChannelId: 'channel-b' }), 'utf8');
    hasBackupMock.mockReturnValue(true);
    getCodexProxyStatusMock.mockReturnValue({ running: false, port: null });

    const res = await request(buildApp()).post('/stop', {});

    expect(res.status).toBe(200);
    expect(stopCodexProxyServerMock).toHaveBeenCalled();
    expect(deleteBackupMock).toHaveBeenCalled();
    expect(applyChannelToSettingsMock).toHaveBeenCalledWith('channel-b');
    expect(fs.existsSync(path.join(testDir, 'state', 'codex-active.json'))).toBe(false);
    expect(res.body).toEqual(expect.objectContaining({
      success: true,
      restoredChannel: 'Preferred'
    }));
    expect(broadcastProxyStateMock).toHaveBeenCalledWith(
      'codex',
      { running: false, port: null },
      channels[0],
      channels
    );
  });
});
