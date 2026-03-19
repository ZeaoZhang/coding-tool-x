const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

let testDir;
let channels;
let getAllChannelsMock;
let applyChannelToSettingsMock;
let getCurrentSettingsMock;
let startProxyServerMock;
let stopProxyServerMock;
let getProxyStatusMock;
let setProxyConfigMock;
let restoreSettingsMock;
let deleteBackupMock;
let isProxyConfigMock;
let getCurrentProxyPortMock;
let settingsExistsMock;
let hasBackupMock;
let readSettingsMock;
let clearNativeOAuthMock;
let readNativeOAuthMock;
let clearAllLogsMock;
let broadcastProxyStateMock;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-api-'));
  channels = [
    {
      id: 'channel-1',
      name: 'Primary',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'secret-1',
      websiteUrl: 'https://console.example.com',
      enabled: true,
      updatedAt: 100
    },
    {
      id: 'channel-2',
      name: 'Secondary',
      baseUrl: 'https://api.second.com',
      apiKey: 'secret-2',
      enabled: false,
      updatedAt: 50
    }
  ];

  startProxyServerMock = vi.fn(async () => ({ success: true, port: 20088 }));
  stopProxyServerMock = vi.fn(async () => ({ port: 20088 }));
  getProxyStatusMock = vi.fn(() => ({ running: false, port: null }));
  setProxyConfigMock = vi.fn();
  restoreSettingsMock = vi.fn();
  deleteBackupMock = vi.fn();
  isProxyConfigMock = vi.fn(() => false);
  getCurrentProxyPortMock = vi.fn(() => null);
  settingsExistsMock = vi.fn(() => true);
  hasBackupMock = vi.fn(() => false);
  readSettingsMock = vi.fn(() => ({
    env: {
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      ANTHROPIC_API_KEY: 'secret-1'
    }
  }));
  getAllChannelsMock = vi.fn(() => channels);
  applyChannelToSettingsMock = vi.fn();
  getCurrentSettingsMock = vi.fn(() => ({
    baseUrl: 'https://api.anthropic.com',
    apiKey: 'secret-1'
  }));
  clearNativeOAuthMock = vi.fn();
  readNativeOAuthMock = vi.fn(() => null);
  clearAllLogsMock = vi.fn();
  broadcastProxyStateMock = vi.fn();

  const proxyServerPath = require.resolve('../../../src/server/proxy-server');
  require.cache[proxyServerPath] = {
    id: proxyServerPath,
    filename: proxyServerPath,
    loaded: true,
    exports: {
      startProxyServer: startProxyServerMock,
      stopProxyServer: stopProxyServerMock,
      getProxyStatus: getProxyStatusMock
    }
  };

  const settingsManagerPath = require.resolve('../../../src/server/services/settings-manager');
  require.cache[settingsManagerPath] = {
    id: settingsManagerPath,
    filename: settingsManagerPath,
    loaded: true,
    exports: {
      setProxyConfig: setProxyConfigMock,
      restoreSettings: restoreSettingsMock,
      deleteBackup: deleteBackupMock,
      isProxyConfig: isProxyConfigMock,
      getCurrentProxyPort: getCurrentProxyPortMock,
      settingsExists: settingsExistsMock,
      hasBackup: hasBackupMock,
      readSettings: readSettingsMock
    }
  };

  const channelsPath = require.resolve('../../../src/server/services/channels');
  require.cache[channelsPath] = {
    id: channelsPath,
    filename: channelsPath,
    loaded: true,
    exports: {
      getAllChannels: getAllChannelsMock,
      applyChannelToSettings: applyChannelToSettingsMock,
      getCurrentSettings: getCurrentSettingsMock
    }
  };

  const nativeOauthPath = require.resolve('../../../src/server/services/native-oauth-adapters');
  require.cache[nativeOauthPath] = {
    id: nativeOauthPath,
    filename: nativeOauthPath,
    loaded: true,
    exports: {
      clearNativeOAuth: clearNativeOAuthMock,
      readNativeOAuth: readNativeOAuthMock
    }
  };

  const websocketPath = require.resolve('../../../src/server/websocket-server');
  require.cache[websocketPath] = {
    id: websocketPath,
    filename: websocketPath,
    loaded: true,
    exports: {
      clearAllLogs: clearAllLogsMock,
      broadcastProxyState: broadcastProxyStateMock
    }
  };

  const pathsPath = require.resolve('../../../src/config/paths');
  require.cache[pathsPath] = {
    id: pathsPath,
    filename: pathsPath,
    loaded: true,
    exports: {
      PATHS: {
        activeChannel: {
          claude: path.join(testDir, 'state', 'active-channel.json')
        }
      },
      NATIVE_PATHS: {
        claude: {
          settingsBackup: path.join(testDir, 'settings.backup.json')
        }
      },
      ensureStorageDirMigrated: vi.fn()
    }
  };

  delete require.cache[require.resolve('../../../src/server/api/proxy')];
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  delete require.cache[require.resolve('../../../src/server/api/proxy')];
  delete require.cache[require.resolve('../../../src/server/proxy-server')];
  delete require.cache[require.resolve('../../../src/server/services/settings-manager')];
  delete require.cache[require.resolve('../../../src/server/services/channels')];
  delete require.cache[require.resolve('../../../src/server/services/native-oauth-adapters')];
  delete require.cache[require.resolve('../../../src/server/websocket-server')];
  delete require.cache[require.resolve('../../../src/config/paths')];
});

function buildApp() {
  const router = require('../../../src/server/api/proxy');
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
      const port = server.address().port;
      const rawBody = body ? JSON.stringify(body) : null;
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: url,
        method,
        headers: {
          ...(rawBody ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(rawBody)
          } : {})
        }
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

describe('proxy status route', () => {
  test('returns proxy and config status summary', async () => {
    getProxyStatusMock.mockReturnValue({ running: true, port: 20088 });
    isProxyConfigMock.mockReturnValue(true);
    getCurrentProxyPortMock.mockReturnValue(20088);
    hasBackupMock.mockReturnValue(true);

    const res = await request(buildApp()).get('/status');

    expect(res.status).toBe(200);
    expect(res.body.proxy.running).toBe(true);
    expect(res.body.config.isProxyConfig).toBe(true);
    expect(res.body.enabledChannelsCount).toBe(1);
  });
});

describe('proxy start route', () => {
  test('returns 400 when settings file is missing', async () => {
    settingsExistsMock.mockReturnValue(false);

    const res = await request(buildApp()).post('/start', {});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/settings\.json/i);
  });

  test('returns 400 when no enabled channels exist', async () => {
    channels = channels.map((channel) => ({ ...channel, enabled: false }));

    const res = await request(buildApp()).post('/start', {});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/没有启用的渠道/);
  });

  test('falls back to first enabled channel when settings cannot identify active channel', async () => {
    readSettingsMock.mockReturnValue({
      env: {
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:20088',
        ANTHROPIC_API_KEY: ''
      }
    });

    const res = await request(buildApp()).post('/start', {});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.activeChannel).toEqual({
      id: 'channel-1',
      name: 'Primary',
      baseUrl: 'https://api.anthropic.com',
      websiteUrl: 'https://console.example.com'
    });
  });

  test('starts proxy and persists active channel on success', async () => {
    getProxyStatusMock.mockReturnValue({ running: true, port: 20088 });

    const res = await request(buildApp()).post('/start', {});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.activeChannel).toEqual({
      id: 'channel-1',
      name: 'Primary',
      baseUrl: 'https://api.anthropic.com',
      websiteUrl: 'https://console.example.com'
    });
    expect(startProxyServerMock).toHaveBeenCalled();
    expect(clearNativeOAuthMock).toHaveBeenCalledWith('claude');
    expect(setProxyConfigMock).toHaveBeenCalledWith(20088);
    expect(broadcastProxyStateMock).toHaveBeenCalled();
    expect(
      JSON.parse(fs.readFileSync(path.join(testDir, 'state', 'active-channel.json'), 'utf8')).activeChannelId
    ).toBe('channel-1');
  });
});

describe('proxy stop and log routes', () => {
  test('stops proxy and restores single-channel mode with saved active channel', async () => {
    hasBackupMock.mockReturnValue(true);
    fs.mkdirSync(path.join(testDir, 'state'), { recursive: true });
    fs.writeFileSync(
      path.join(testDir, 'state', 'active-channel.json'),
      JSON.stringify({ activeChannelId: 'channel-1' }),
      'utf8'
    );

    const res = await request(buildApp()).post('/stop', {});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.restoredChannel).toBe('Primary');
    expect(deleteBackupMock).toHaveBeenCalled();
    expect(restoreSettingsMock).not.toHaveBeenCalled();
    expect(applyChannelToSettingsMock).toHaveBeenCalledWith('channel-1');
    expect(fs.existsSync(path.join(testDir, 'state', 'active-channel.json'))).toBe(false);
    expect(broadcastProxyStateMock).toHaveBeenCalled();
  });

  test('clears logs successfully', async () => {
    const res = await request(buildApp()).post('/logs/clear', {});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(clearAllLogsMock).toHaveBeenCalled();
  });
});
