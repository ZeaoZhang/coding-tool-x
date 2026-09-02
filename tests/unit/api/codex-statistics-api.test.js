const express = require('express');
const http = require('http');

let codexStatsService;

function buildApp() {
  delete require.cache[require.resolve('../../../src/platforms/drivers/codex/api-statistics')];
  const router = require('../../../src/platforms/drivers/codex/api-statistics');
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

function request(app) {
  return {
    get(url) { return call(app, 'GET', url); }
  };
}

function call(app, method, url) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: server.address().port,
        path: url,
        method
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
      req.on('error', reject);
      req.end();
    });
  });
}

beforeEach(() => {
  codexStatsService = {
    getStatistics: vi.fn(() => ({ total: 10 })),
    getDailyStatistics: vi.fn((date) => ({ date, total: 2 })),
    getTodayStatistics: vi.fn(() => ({ total: 1 }))
  };

  require.cache[require.resolve('../../../src/platforms/drivers/codex/statistics-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/codex/statistics-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/codex/statistics-implementation'),
    loaded: true,
    exports: codexStatsService
  };
});

afterEach(() => {
  [
    '../../../src/platforms/drivers/codex/api-statistics',
    '../../../src/platforms/drivers/codex/statistics-implementation'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('codex-statistics api', () => {
  test('returns summary and today statistics', async () => {
    const app = buildApp();
    expect((await request(app).get('/summary')).body).toEqual({ total: 10 });
    expect((await request(app).get('/today')).body).toEqual({ total: 1 });
  });

  test('validates daily date format', async () => {
    const app = buildApp();
    const invalid = await request(app).get('/daily/not-a-date');
    const valid = await request(app).get('/daily/2025-01-01');

    expect(invalid.status).toBe(400);
    expect(valid.status).toBe(200);
    expect(codexStatsService.getDailyStatistics).toHaveBeenCalledWith('2025-01-01');
  });
});
