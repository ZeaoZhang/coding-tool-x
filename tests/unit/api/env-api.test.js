const express = require('express');
const http = require('http');

let envChecker;
let envManager;

function buildApp() {
  delete require.cache[require.resolve('../../../src/server/api/env')];
  const router = require('../../../src/server/api/env');
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

function request(app) {
  return {
    get(url) { return call(app, 'GET', url); },
    post(url, body) { return call(app, 'POST', url, body); },
    delete(url) { return call(app, 'DELETE', url); }
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
  envChecker = {
    checkEnvConflicts: vi.fn(() => [{ key: 'ANTHROPIC_API_KEY', source: '.zshrc' }]),
    getConflictStats: vi.fn(() => ({ total: 1, byPlatform: { claude: 1 } }))
  };

  envManager = {
    BACKUP_DIR: '/tmp/env-backups',
    deleteEnvVars: vi.fn(() => ({
      results: [
        { key: 'A', success: true },
        { key: 'B', success: false }
      ],
      backupPath: '/tmp/env-backups/backup.json'
    })),
    getBackupList: vi.fn(() => [{ fileName: 'backup.json' }]),
    restoreFromBackup: vi.fn(() => ({ restored: 2 })),
    deleteBackup: vi.fn()
  };

  require.cache[require.resolve('../../../src/server/services/env-checker')] = {
    id: require.resolve('../../../src/server/services/env-checker'),
    filename: require.resolve('../../../src/server/services/env-checker'),
    loaded: true,
    exports: envChecker
  };

  require.cache[require.resolve('../../../src/server/services/env-manager')] = {
    id: require.resolve('../../../src/server/services/env-manager'),
    filename: require.resolve('../../../src/server/services/env-manager'),
    loaded: true,
    exports: envManager
  };
});

afterEach(() => {
  [
    '../../../src/server/api/env',
    '../../../src/server/services/env-checker',
    '../../../src/server/services/env-manager'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('env api routes', () => {
  test('checks conflicts and returns stats', async () => {
    const res = await request(buildApp()).get('/check?platform=claude');

    expect(res.status).toBe(200);
    expect(envChecker.checkEnvConflicts).toHaveBeenCalledWith('claude');
    expect(res.body).toEqual({
      success: true,
      conflicts: [{ key: 'ANTHROPIC_API_KEY', source: '.zshrc' }],
      stats: { total: 1, byPlatform: { claude: 1 } }
    });
  });

  test('delete validates conflicts and returns success summary', async () => {
    const app = buildApp();

    const invalid = await request(app).post('/delete', { conflicts: [] });
    const ok = await request(app).post('/delete', {
      conflicts: [{ key: 'ANTHROPIC_API_KEY' }, { key: 'OPENAI_API_KEY' }]
    });

    expect(invalid.status).toBe(400);
    expect(ok.status).toBe(200);
    expect(envManager.deleteEnvVars).toHaveBeenCalledWith([{ key: 'ANTHROPIC_API_KEY' }, { key: 'OPENAI_API_KEY' }]);
    expect(ok.body.message).toBe('已删除 1 个环境变量，备份已保存');
  });

  test('lists backups, restores a backup, and deletes backup files', async () => {
    const app = buildApp();

    const backups = await request(app).get('/backups');
    const missingBackup = await request(app).post('/restore', {});
    const restored = await request(app).post('/restore', { backupPath: '/tmp/env-backups/backup.json' });
    const deleted = await request(app).delete('/backups/backup.json');

    expect(backups.status).toBe(200);
    expect(backups.body.backups).toEqual([{ fileName: 'backup.json' }]);
    expect(missingBackup.status).toBe(400);
    expect(restored.status).toBe(200);
    expect(envManager.restoreFromBackup).toHaveBeenCalledWith('/tmp/env-backups/backup.json');
    expect(deleted.status).toBe(200);
    expect(envManager.deleteBackup).toHaveBeenCalledWith('/tmp/env-backups/backup.json');
  });
});
