const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

let testDir;
let channels;
let startOpenCodeProxyServerMock;
let stopOpenCodeProxyServerMock;
let getOpenCodeProxyStatusMock;
let collectProxyModelListMock;
let configExistsMock;
let hasBackupMock;
let setProxyConfigMock;
let deleteBackupMock;
let isProxyConfigMock;
let getCurrentProxyPortMock;
let readConfigMock;
let selectConfigPathMock;
let getChannelsMock;
let getEnabledChannelsMock;
let markChannelAsRecentlyUsedMock;
let applyChannelToSettingsMock;
let clearNativeOAuthMock;
let getSchedulerStateMock;
let broadcastProxyStateMock;
let broadcastSchedulerStateMock;
let nativeConfig;
let nativeConfigPath;

function buildApp() {
  delete require.cache[require.resolve('../../../src/server/api/opencode-proxy')];
  const router = require('../../../src/server/api/opencode-proxy');
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
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-proxy-api-'));
  channels = [
    {
      id: 'open-1',
      name: 'Primary',
      baseUrl: 'https://open-one.example',
      providerKey: 'provider-one',
      model: 'gpt-4.1',
      speedTestModel: 'gpt-4.1-mini',
      modelConfig: { opusModel: 'opus-1' },
      modelRedirects: [{ from: 'alias-a', to: 'alias-b' }],
      enabled: true,
      updatedAt: 100
    },
    {
      id: 'open-2',
      name: 'Secondary',
      baseUrl: 'https://open-two.example',
      providerKey: 'provider-two',
      model: 'gpt-5',
      allowedModels: ['allowed-1', 'allowed-2'],
      enabled: true,
      updatedAt: 200
    }
  ];

  startOpenCodeProxyServerMock = vi.fn(async () => ({ success: true, port: 23003 }));
  stopOpenCodeProxyServerMock = vi.fn(async () => ({ port: 23003 }));
  getOpenCodeProxyStatusMock = vi.fn(() => ({ running: false, port: null }));
  collectProxyModelListMock = vi.fn(async () => ['detected-a', 'alias-b']);
  configExistsMock = vi.fn(() => true);
  hasBackupMock = vi.fn(() => false);
  setProxyConfigMock = vi.fn();
  deleteBackupMock = vi.fn();
  isProxyConfigMock = vi.fn(() => false);
  getCurrentProxyPortMock = vi.fn(() => null);
  nativeConfigPath = path.join(testDir, 'native', 'config.json');
  nativeConfig = {
    model: 'provider-two/gpt-5',
    provider: {
      'provider-two': {
        options: {
          baseURL: 'https://open-two.example',
          apiKey: 'secondary-key'
        }
      }
    }
  };
  readConfigMock = vi.fn(() => nativeConfig);
  selectConfigPathMock = vi.fn(() => nativeConfigPath);
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
  getSchedulerStateMock = vi.fn(() => ({ active: false }));
  broadcastProxyStateMock = vi.fn();
  broadcastSchedulerStateMock = vi.fn();

  require.cache[require.resolve('../../../src/server/opencode-proxy-server')] = {
    id: require.resolve('../../../src/server/opencode-proxy-server'),
    filename: require.resolve('../../../src/server/opencode-proxy-server'),
    loaded: true,
    exports: {
      startOpenCodeProxyServer: startOpenCodeProxyServerMock,
      stopOpenCodeProxyServer: stopOpenCodeProxyServerMock,
      getOpenCodeProxyStatus: getOpenCodeProxyStatusMock,
      collectProxyModelList: collectProxyModelListMock
    }
  };

  require.cache[require.resolve('../../../src/server/services/opencode-settings-manager')] = {
    id: require.resolve('../../../src/server/services/opencode-settings-manager'),
    filename: require.resolve('../../../src/server/services/opencode-settings-manager'),
    loaded: true,
    exports: {
      configExists: configExistsMock,
      hasBackup: hasBackupMock,
      setProxyConfig: setProxyConfigMock,
      restoreSettings: vi.fn(),
      deleteBackup: deleteBackupMock,
      isProxyConfig: isProxyConfigMock,
      getCurrentProxyPort: getCurrentProxyPortMock,
      readConfig: readConfigMock,
      selectConfigPath: selectConfigPathMock
    }
  };

  require.cache[require.resolve('../../../src/server/services/opencode-channels')] = {
    id: require.resolve('../../../src/server/services/opencode-channels'),
    filename: require.resolve('../../../src/server/services/opencode-channels'),
    loaded: true,
    exports: {
      getChannels: getChannelsMock,
      getEnabledChannels: getEnabledChannelsMock,
      markChannelAsRecentlyUsed: markChannelAsRecentlyUsedMock,
      applyChannelToSettings: applyChannelToSettingsMock,
      getEffectiveApiKeyCandidates: vi.fn((channel) => {
        if (channel.id === 'open-2') return ['secondary-key'];
        return [channel.apiKey].filter(Boolean);
      })
    }
  };

  require.cache[require.resolve('../../../src/server/services/native-oauth-adapters')] = {
    id: require.resolve('../../../src/server/services/native-oauth-adapters'),
    filename: require.resolve('../../../src/server/services/native-oauth-adapters'),
    loaded: true,
    exports: {
      clearNativeOAuth: clearNativeOAuthMock
    }
  };

  require.cache[require.resolve('../../../src/server/services/channel-scheduler')] = {
    id: require.resolve('../../../src/server/services/channel-scheduler'),
    filename: require.resolve('../../../src/server/services/channel-scheduler'),
    loaded: true,
    exports: {
      getSchedulerState: getSchedulerStateMock
    }
  };

  require.cache[require.resolve('../../../src/server/websocket-server')] = {
    id: require.resolve('../../../src/server/websocket-server'),
    filename: require.resolve('../../../src/server/websocket-server'),
    loaded: true,
    exports: {
      broadcastProxyState: broadcastProxyStateMock,
      broadcastSchedulerState: broadcastSchedulerStateMock
    }
  };

  require.cache[require.resolve('../../../src/config/paths')] = {
    id: require.resolve('../../../src/config/paths'),
    filename: require.resolve('../../../src/config/paths'),
    loaded: true,
    exports: {
      PATHS: {
        activeChannel: {
          opencode: path.join(testDir, 'state', 'opencode-active.json')
        }
      },
      ensureStorageDirMigrated: vi.fn()
    }
  };
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/server/api/opencode-proxy',
    '../../../src/server/opencode-proxy-server',
    '../../../src/server/services/opencode-settings-manager',
    '../../../src/server/services/opencode-channels',
    '../../../src/server/services/native-oauth-adapters',
    '../../../src/server/services/channel-scheduler',
    '../../../src/server/websocket-server',
    '../../../src/config/paths'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('opencode proxy routes', () => {
  test('status reports counts and sanitized active channel', async () => {
    fs.mkdirSync(path.join(testDir, 'state'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'state', 'opencode-active.json'), JSON.stringify({ activeChannelId: 'open-2' }), 'utf8');
    getOpenCodeProxyStatusMock.mockReturnValue({ running: true, port: 23003 });

    const res = await request(buildApp()).get('/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      proxy: { running: true, port: 23003 },
      config: {
        isProxyConfig: false,
        configExists: true,
        hasBackup: false,
        currentProxyPort: null
      },
      activeChannel: {
        id: 'open-2',
        name: 'Secondary',
        baseUrl: 'https://open-two.example',
        websiteUrl: undefined
      },
      enabledChannelsCount: 2,
      totalChannelsCount: 2
    });
  });

  test('start validates enabled channels and writes proxy config with collected models', async () => {
    const app = buildApp();
    fs.mkdirSync(path.dirname(nativeConfigPath), { recursive: true });
    fs.writeFileSync(nativeConfigPath, JSON.stringify(nativeConfig), 'utf8');

    getEnabledChannelsMock.mockReturnValue([]);
    const missingChannels = await request(app).post('/start', {});

    getEnabledChannelsMock.mockReturnValue(channels);
    const started = await request(app).post('/start', {});

    expect(missingChannels.status).toBe(400);
    expect(started.status).toBe(200);
    expect(markChannelAsRecentlyUsedMock).toHaveBeenCalledWith('open-2');
    expect(collectProxyModelListMock).toHaveBeenCalledWith(channels, { useCacheOnly: true });
    expect(setProxyConfigMock).toHaveBeenCalledWith(23003, {
      channels: [
        {
          name: 'Primary',
          providerKey: 'provider-one',
          model: 'gpt-4.1',
          models: ['gpt-4.1', 'gpt-4.1-mini', 'opus-1', 'alias-a', 'alias-b', 'detected-a']
        },
        {
          name: 'Secondary',
          providerKey: 'provider-two',
          model: 'gpt-5',
          models: ['allowed-1', 'allowed-2']
        }
      ],
      model: 'gpt-4.1'
    });
    expect(JSON.parse(fs.readFileSync(path.join(testDir, 'state', 'opencode-active.json'), 'utf8'))).toEqual({
      activeChannelId: 'open-2'
    });
    expect(started.body.activeChannel).toEqual({
      id: 'open-2',
      name: 'Secondary',
      baseUrl: 'https://open-two.example',
      websiteUrl: undefined
    });
    expect(broadcastProxyStateMock).toHaveBeenCalledWith(
      'opencode',
      { running: false, port: null },
      expect.objectContaining({ id: 'open-2' }),
      channels
    );
  });

  test('stop removes active state, discards backup, restores single channel, and broadcasts scheduler state', async () => {
    fs.mkdirSync(path.join(testDir, 'state'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'state', 'opencode-active.json'), JSON.stringify({ activeChannelId: 'open-2' }), 'utf8');
    hasBackupMock.mockReturnValue(true);

    const res = await request(buildApp()).post('/stop', {});

    expect(res.status).toBe(200);
    expect(stopOpenCodeProxyServerMock).toHaveBeenCalled();
    expect(deleteBackupMock).toHaveBeenCalled();
    expect(applyChannelToSettingsMock).toHaveBeenCalledWith('open-2');
    expect(fs.existsSync(path.join(testDir, 'state', 'opencode-active.json'))).toBe(false);
    expect(res.body).toEqual(expect.objectContaining({
      success: true,
      restoredChannel: 'Primary'
    }));
    expect(broadcastProxyStateMock).toHaveBeenCalledWith('opencode', { running: false, port: null }, channels[0], channels);
    expect(broadcastSchedulerStateMock).toHaveBeenCalledWith('opencode', { active: false });
  });
});
