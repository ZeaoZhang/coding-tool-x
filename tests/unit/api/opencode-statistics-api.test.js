const express = require('express');
const http = require('http');

let opencodeStatsService;

function buildApp() {
  delete require.cache[require.resolve('../../../src/server/api/opencode-statistics')];
  const router = require('../../../src/server/api/opencode-statistics');
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
  opencodeStatsService = {
    getStatistics: vi.fn(() => ({ total: 30 })),
    getDailyStatistics: vi.fn((date) => ({ date, total: 5 })),
    getTodayStatistics: vi.fn(() => ({ total: 6 }))
  };

  require.cache[require.resolve('../../../src/platforms/drivers/opencode/statistics-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/opencode/statistics-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/opencode/statistics-implementation'),
    loaded: true,
    exports: opencodeStatsService
  };
});

afterEach(() => {
  [
    '../../../src/server/api/opencode-statistics',
    '../../../src/platforms/drivers/opencode/statistics-implementation'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('opencode-statistics api', () => {
  test('returns summary and today statistics', async () => {
    const app = buildApp();
    expect((await request(app).get('/summary')).body).toEqual({ total: 30 });
    expect((await request(app).get('/today')).body).toEqual({ total: 6 });
  });

  test('validates daily date format', async () => {
    const app = buildApp();
    expect((await request(app).get('/daily/invalid')).status).toBe(400);
    expect((await request(app).get('/daily/2025-01-03')).status).toBe(200);
    expect(opencodeStatsService.getDailyStatistics).toHaveBeenCalledWith('2025-01-03');
  });
});
