const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

let testDir;
let settingsPath;
let uiConfigPath;
let notifyScriptPath;
let execSyncSpy;

function buildApp() {
  delete require.cache[require.resolve('../../../src/server/api/claude-hooks')];
  const router = require('../../../src/server/api/claude-hooks');
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
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hooks-api-'));
  settingsPath = path.join(testDir, '.claude', 'settings.json');
  uiConfigPath = path.join(testDir, '.cc-tool', 'ui-config.json');
  notifyScriptPath = path.join(testDir, '.cc-tool', 'scripts', 'notify-hook.js');

  require.cache[require.resolve('../../../src/config/paths')] = {
    id: require.resolve('../../../src/config/paths'),
    filename: require.resolve('../../../src/config/paths'),
    loaded: true,
    exports: {
      PATHS: {
        uiConfig: uiConfigPath,
        notifyHook: notifyScriptPath
      },
      NATIVE_PATHS: {
        claude: {
          settings: settingsPath
        }
      }
    }
  };

  require.cache[require.resolve('../../../src/utils/home-dir')] = {
    id: require.resolve('../../../src/utils/home-dir'),
    filename: require.resolve('../../../src/utils/home-dir'),
    loaded: true,
    exports: {
      resolvePreferredHomeDir: vi.fn(() => testDir),
      normalizeWindowsHomePath: vi.fn((value) => value)
    }
  };

  require.cache[require.resolve('../../../src/server/services/network-access')] = {
    id: require.resolve('../../../src/server/services/network-access'),
    filename: require.resolve('../../../src/server/services/network-access'),
    loaded: true,
    exports: {
      createSameOriginGuard: vi.fn(() => (_req, _res, next) => next())
    }
  };

  execSyncSpy = vi.spyOn(childProcess, 'execSync').mockImplementation(() => Buffer.from(''));
});

afterEach(() => {
  execSyncSpy.mockRestore();
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/server/api/claude-hooks',
    '../../../src/config/paths',
    '../../../src/utils/home-dir',
    '../../../src/server/services/network-access'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('claude-hooks api', () => {
  test('GET / returns default disabled state when no config exists', async () => {
    const res = await request(buildApp()).get('/');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.stopHook).toEqual({ enabled: false, type: 'notification' });
    expect(res.body.feishu).toEqual({ enabled: false, webhookUrl: '' });
    expect(typeof res.body.platform).toBe('string');
  });

  test('POST / saves stop hook and feishu settings and writes notify script', async () => {
    const res = await request(buildApp()).post('/', {
      stopHook: { enabled: true, type: 'dialog' },
      feishu: { enabled: true, webhookUrl: 'https://open.feishu.cn/webhook/123' }
    });

    const savedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const savedUiConfig = JSON.parse(fs.readFileSync(uiConfigPath, 'utf8'));
    const notifyScript = fs.readFileSync(notifyScriptPath, 'utf8');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: '配置已保存',
      stopHook: { enabled: true, type: 'dialog' },
      feishu: { enabled: true, webhookUrl: 'https://open.feishu.cn/webhook/123' }
    });
    expect(savedSettings.hooks.Stop[0].hooks[0].command).toContain('--cc-notify-type=dialog');
    expect(savedUiConfig.feishuNotification).toEqual({
      enabled: true,
      webhookUrl: 'https://open.feishu.cn/webhook/123'
    });
    expect(notifyScript).toContain('open.feishu.cn/webhook/123');
    expect(notifyScript).toContain('execSync');
  });

  test('POST / disables all notifications, removes hook/script, and records user dismissal', async () => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: `node "${notifyScriptPath}" --cc-notify-type=notification` }] }]
      }
    }, null, 2), 'utf8');
    fs.mkdirSync(path.dirname(notifyScriptPath), { recursive: true });
    fs.writeFileSync(notifyScriptPath, '#!/usr/bin/env node', 'utf8');

    const res = await request(buildApp()).post('/', {
      stopHook: { enabled: false, type: 'notification' },
      feishu: { enabled: false, webhookUrl: '' }
    });

    const savedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const savedUiConfig = JSON.parse(fs.readFileSync(uiConfigPath, 'utf8'));

    expect(res.status).toBe(200);
    expect(savedSettings.hooks).toBeUndefined();
    expect(savedUiConfig.claudeNotificationDisabledByUser).toBe(true);
    expect(fs.existsSync(notifyScriptPath)).toBe(false);
  });

  test('POST /test runs system notification command and helper methods detect repair needs', async () => {
    const app = buildApp();
    const router = require('../../../src/server/api/claude-hooks');
    const res = await request(app).post('/test', { type: 'notification' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: '系统测试通知已发送' });
    expect(execSyncSpy).toHaveBeenCalled();
    expect(router._test.parseStopHookStatus({
      hooks: {
        Stop: [{ hooks: [{ command: `node "${notifyScriptPath}" --cc-notify-type=dialog` }] }]
      }
    })).toEqual({ enabled: true, type: 'dialog' });
    expect(router._test.shouldRepairStopHook({
      hooks: {
        Stop: [{ hooks: [{ command: 'node "/old/path/notify-hook.js"' }] }]
      }
    }, notifyScriptPath, () => false)).toBe(true);
  });
});
