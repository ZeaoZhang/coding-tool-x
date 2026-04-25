const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

let testDir;
let pm2Stub;
let execSpy;

function buildApp() {
  delete require.cache[require.resolve('../../../src/server/api/pm2-autostart')];
  const createRouter = require('../../../src/server/api/pm2-autostart');
  const app = express();
  app.use(express.json());
  app.use('/', createRouter());
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
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm2-autostart-api-'));
  pm2Stub = {
    connect: vi.fn((callback) => callback(null)),
    list: vi.fn((callback) => callback(null, [{ name: 'ctx-web' }])),
    save: vi.fn((callback) => callback(null)),
    disconnect: vi.fn()
  };

  require.cache[require.resolve('pm2')] = {
    id: require.resolve('pm2'),
    filename: require.resolve('pm2'),
    loaded: true,
    exports: pm2Stub
  };

  require.cache[require.resolve('../../../src/config/paths')] = {
    id: require.resolve('../../../src/config/paths'),
    filename: require.resolve('../../../src/config/paths'),
    loaded: true,
    exports: {
      HOME_DIR: testDir
    }
  };

  execSpy = vi.spyOn(childProcess, 'exec').mockImplementation((command, options, callback) => {
    callback(null, `ran: ${command}`, '');
    return {};
  });
});

afterEach(() => {
  execSpy.mockRestore();
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/server/api/pm2-autostart',
    '../../../src/config/paths',
    'pm2'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('pm2-autostart api', () => {
  test('helper getExecOptions handles unix and windows runtime platforms', () => {
    const routerFactory = require('../../../src/server/api/pm2-autostart');

    expect(routerFactory._test.getExecOptions(1234, 'linux')).toEqual({
      shell: '/bin/bash',
      timeout: 1234,
      windowsHide: true
    });
    expect(routerFactory._test.getExecOptions(5678, 'win32')).toEqual({
      timeout: 5678,
      windowsHide: true
    });
  });

  test('helper startup commands use bundled pm2 binary instead of PATH lookup', () => {
    const routerFactory = require('../../../src/server/api/pm2-autostart');

    expect(routerFactory._test.getPm2CliCommand()).toContain(require.resolve('pm2/bin/pm2'));
    expect(routerFactory._test.getStartupCommand('darwin')).toContain(require.resolve('pm2/bin/pm2'));
    expect(routerFactory._test.getUnstartupCommand('linux')).toContain(require.resolve('pm2/bin/pm2'));
  });

  test('GET / returns autostart status payload', async () => {
    const res = await request(buildApp()).get('/');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.enabled).toBe('boolean');
    expect(res.body.data.platform).toBe(process.platform);
  });

  test('POST / validates action', async () => {
    const res = await request(buildApp()).post('/', { action: 'invalid' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      message: 'Invalid action. Must be "enable" or "disable"'
    });
  });

  test('POST / enable returns a friendly message when no PM2 processes exist', async () => {
    pm2Stub.list.mockImplementation((callback) => callback(null, []));

    const res = await request(buildApp()).post('/', { action: 'enable' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('ctx start');
    expect(pm2Stub.disconnect).toHaveBeenCalled();
  });

  test('POST / enable saves process list and runs startup command', async () => {
    const res = await request(buildApp()).post('/', { action: 'enable' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: '开机自启已启用。重启电脑后自动启动',
      data: { action: 'enable', enabled: true }
    });
    expect(pm2Stub.save).toHaveBeenCalled();
    expect(execSpy).toHaveBeenCalled();
    expect(execSpy.mock.calls[0][0]).toContain(require.resolve('pm2/bin/pm2'));
    expect(execSpy.mock.calls[0][0]).toContain('startup');
  });

  test('POST / disable treats "not set" stderr as already disabled', async () => {
    execSpy.mockImplementation((command, options, callback) => {
      callback(new Error('not set'), '', 'service not set');
      return {};
    });

    const res = await request(buildApp()).post('/', { action: 'disable' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: '开机自启已禁用（或未启用）',
      data: { action: 'disable', enabled: false }
    });
  });
});
