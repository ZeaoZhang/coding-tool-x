const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

let testDir;
let channels;
let startGeminiProxyServerMock;
let stopGeminiProxyServerMock;
let getGeminiProxyStatusMock;
let setProxyConfigMock;
let deleteBackupMock;
let isProxyConfigMock;
let getCurrentProxyPortMock;
let configExistsMock;
let hasBackupMock;
let readEnvMock;
let getChannelsMock;
let getEnabledChannelsMock;
let markChannelAsRecentlyUsedMock;
let applyChannelToSettingsMock;
let clearNativeOAuthMock;
let broadcastProxyStateMock;

function buildApp() {
  delete require.cache[require.resolve('../../../src/platforms/drivers/gemini/api-proxy')];
  const router = require('../../../src/platforms/drivers/gemini/api-proxy');
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
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-proxy-api-'));
  channels = [
    {
      id: 'gem-1',
      name: 'Fallback',
      baseUrl: 'https://gemini-fallback.example',
      apiKey: 'secret-fallback',
      model: 'gemini-1.5',
      enabled: true,
      updatedAt: 100
    },
    {
      id: 'gem-2',
      name: 'Matched',
      baseUrl: 'https://gemini-matched.example',
      apiKey: 'secret-matched',
      model: 'gemini-2.0',
      enabled: true,
      updatedAt: 200
    }
  ];

  startGeminiProxyServerMock = vi.fn(async () => ({ success: true, port: 22002 }));
  stopGeminiProxyServerMock = vi.fn(async () => ({ port: 22002 }));
  getGeminiProxyStatusMock = vi.fn(() => ({ running: false, port: null }));
  setProxyConfigMock = vi.fn();
  deleteBackupMock = vi.fn();
  isProxyConfigMock = vi.fn(() => false);
  getCurrentProxyPortMock = vi.fn(() => null);
  configExistsMock = vi.fn(() => true);
  hasBackupMock = vi.fn(() => false);
  readEnvMock = vi.fn(() => ({
    GOOGLE_GEMINI_BASE_URL: 'https://gemini-matched.example',
    GEMINI_API_KEY: 'secret-matched',
    GEMINI_MODEL: 'gemini-2.0'
  }));
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

  require.cache[require.resolve('../../../src/platforms/drivers/gemini/proxy-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/gemini/proxy-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/gemini/proxy-implementation'),
    loaded: true,
    exports: {
      startGeminiProxyServer: startGeminiProxyServerMock,
      stopGeminiProxyServer: stopGeminiProxyServerMock,
      getGeminiProxyStatus: getGeminiProxyStatusMock
    }
  };

  require.cache[require.resolve('../../../src/platforms/drivers/gemini/native-config-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/gemini/native-config-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/gemini/native-config-implementation'),
    loaded: true,
    exports: {
      setProxyConfig: setProxyConfigMock,
      restoreSettings: vi.fn(),
      deleteBackup: deleteBackupMock,
      isProxyConfig: isProxyConfigMock,
      getCurrentProxyPort: getCurrentProxyPortMock,
      configExists: configExistsMock,
      hasBackup: hasBackupMock,
      readEnv: readEnvMock
    }
  };

  require.cache[require.resolve('../../../src/platforms/drivers/gemini/channels-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/gemini/channels-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/gemini/channels-implementation'),
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
          gemini: path.join(testDir, 'state', 'gemini-active.json')
        }
      },
      ensureStorageDirMigrated: vi.fn()
    }
  };
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/platforms/drivers/gemini/api-proxy',
    '../../../src/platforms/drivers/gemini/proxy-implementation',
    '../../../src/platforms/drivers/gemini/native-config-implementation',
    '../../../src/platforms/drivers/gemini/channels-implementation',
    '../../../src/platforms/native-oauth-adapters',
    '../../../src/server/websocket-server',
    '../../../src/config/paths'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('gemini proxy routes', () => {
  test('status returns sanitized active channel without apiKey', async () => {
    fs.mkdirSync(path.join(testDir, 'state'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'state', 'gemini-active.json'), JSON.stringify({ activeChannelId: 'gem-2' }), 'utf8');
    getGeminiProxyStatusMock.mockReturnValue({ running: true, port: 22002 });

    const res = await request(buildApp()).get('/status');

    expect(res.status).toBe(200);
    expect(res.body.activeChannel).toEqual({
      id: 'gem-2',
      name: 'Matched',
      baseUrl: 'https://gemini-matched.example',
      model: 'gemini-2.0',
      enabled: true,
      updatedAt: 200
    });
    expect(res.body.activeChannel.apiKey).toBeUndefined();
  });

  test('start validates config and channel existence, then prefers current env match', async () => {
    const app = buildApp();

    configExistsMock.mockReturnValue(false);
    const missingConfig = await request(app).post('/start', {});

    configExistsMock.mockReturnValue(true);
    getEnabledChannelsMock.mockReturnValue([]);
    const missingChannels = await request(app).post('/start', {});

    getEnabledChannelsMock.mockReturnValue(channels);
    const started = await request(app).post('/start', {});

    expect(missingConfig.status).toBe(400);
    expect(missingChannels.status).toBe(400);
    expect(started.status).toBe(200);
    expect(markChannelAsRecentlyUsedMock).toHaveBeenCalledWith('gem-2');
    expect(clearNativeOAuthMock).toHaveBeenCalledWith('gemini');
    expect(setProxyConfigMock).toHaveBeenCalledWith(22002);
    expect(started.body.activeChannel).toEqual(expect.objectContaining({
      id: 'gem-2',
      name: 'Matched'
    }));
    expect(JSON.parse(fs.readFileSync(path.join(testDir, 'state', 'gemini-active.json'), 'utf8'))).toEqual({
      activeChannelId: 'gem-2'
    });
    expect(broadcastProxyStateMock).toHaveBeenCalledWith('gemini', { running: false, port: null }, channels[1], channels);
  });

  test('stop deletes backup, restores active channel, and removes state file', async () => {
    fs.mkdirSync(path.join(testDir, 'state'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'state', 'gemini-active.json'), JSON.stringify({ activeChannelId: 'gem-2' }), 'utf8');
    hasBackupMock.mockReturnValue(true);

    const res = await request(buildApp()).post('/stop', {});

    expect(res.status).toBe(200);
    expect(stopGeminiProxyServerMock).toHaveBeenCalled();
    expect(deleteBackupMock).toHaveBeenCalled();
    expect(applyChannelToSettingsMock).toHaveBeenCalledWith('gem-2');
    expect(fs.existsSync(path.join(testDir, 'state', 'gemini-active.json'))).toBe(false);
    expect(res.body.restoredChannel).toBe('Matched');
    expect(broadcastProxyStateMock).toHaveBeenCalledWith('gemini', { running: false, port: null }, channels[0], channels);
  });
});
