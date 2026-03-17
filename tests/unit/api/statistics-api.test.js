const express = require('express');
const http = require('http');

let statisticsService;

function buildApp() {
  delete require.cache[require.resolve('../../../src/server/api/statistics')];
  const router = require('../../../src/server/api/statistics');
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
            resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers, text: data });
          } catch {
            resolve({ status: res.statusCode, body: data, headers: res.headers, text: data });
          }
        });
      });

      req.on('error', (error) => {
        server.close();
        reject(error);
      });

      req.end();
    });
  });
}

beforeEach(() => {
  statisticsService = {
    getStatistics: vi.fn(() => ({ totalRequests: 10 })),
    getDailyStatistics: vi.fn((date) => ({ date, requests: 3 })),
    getTodayStatistics: vi.fn(() => ({ requests: 2 })),
    getTrendStatistics: vi.fn(async () => ({
      labels: ['2025-01-01', '2025-01-02'],
      series: [
        { name: 'gpt-4o', data: [10, 20] },
        { name: 'claude-3', data: [5, 15] }
      ]
    })),
    getAvailableFilters: vi.fn(() => ({
      models: ['gpt-4o'],
      channels: ['default']
    }))
  };

  const servicePath = require.resolve('../../../src/server/services/statistics-service');
  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: statisticsService
  };
});

afterEach(() => {
  [
    '../../../src/server/api/statistics',
    '../../../src/server/services/statistics-service'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('statistics api summary and daily routes', () => {
  test('returns summary and today stats', async () => {
    const app = buildApp();

    const summary = await request(app).get('/summary');
    const today = await request(app).get('/today');

    expect(summary.status).toBe(200);
    expect(summary.body.totalRequests).toBe(10);
    expect(today.status).toBe(200);
    expect(today.body.requests).toBe(2);
  });

  test('validates daily date format and recent day bounds', async () => {
    const app = buildApp();

    const invalidDaily = await request(app).get('/daily/not-a-date');
    const invalidRecent = await request(app).get('/recent?days=91');
    const recent = await request(app).get('/recent?days=2');

    expect(invalidDaily.status).toBe(400);
    expect(invalidRecent.status).toBe(400);
    expect(recent.status).toBe(200);
    expect(recent.body).toHaveLength(2);
    expect(statisticsService.getDailyStatistics).toHaveBeenCalledTimes(2);
  });
});

describe('statistics api filters and trend routes', () => {
  test('validates filter query parameters and returns filter options', async () => {
    const app = buildApp();

    const missing = await request(app).get('/filters');
    const invalid = await request(app).get('/filters?startDate=2025-01-01&endDate=bad');
    const ok = await request(app).get('/filters?startDate=2025-01-01&endDate=2025-01-02');

    expect(missing.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(ok.status).toBe(200);
    expect(statisticsService.getAvailableFilters).toHaveBeenCalledWith('2025-01-01', '2025-01-02');
  });

  test('validates trend ranges and passes filters through to service', async () => {
    const app = buildApp();

    const invalidRange = await request(app).get('/trend?startDate=2025-01-03&endDate=2025-01-01');
    const invalidHour = await request(app).get('/trend?startDate=2025-01-01&endDate=2025-01-10&granularity=hour');
    const ok = await request(app).get('/trend?startDate=2025-01-01&endDate=2025-01-03&granularity=day&step=2&groupBy=channel&metric=cost&filterToolType=claude&filterChannel=default&filterModel=gpt-4o');

    expect(invalidRange.status).toBe(400);
    expect(invalidHour.status).toBe(400);
    expect(ok.status).toBe(200);
    expect(statisticsService.getTrendStatistics).toHaveBeenCalledWith({
      startDate: '2025-01-01',
      endDate: '2025-01-03',
      granularity: 'day',
      step: '2',
      groupBy: 'channel',
      metric: 'cost',
      filters: {
        toolType: 'claude',
        channel: 'default',
        model: 'gpt-4o'
      }
    });
  });

  test('exports trend data as json or csv', async () => {
    const app = buildApp();

    const jsonRes = await request(app).get('/trend/export?startDate=2025-01-01&endDate=2025-01-02&format=json');
    const csvRes = await request(app).get('/trend/export?startDate=2025-01-01&endDate=2025-01-02&groupBy=model&metric=tokens');

    expect(jsonRes.status).toBe(200);
    expect(jsonRes.headers['content-type']).toMatch(/application\/json/);
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers['content-type']).toMatch(/text\/csv/);
    expect(csvRes.text).toContain('Date/Time,gpt-4o,claude-3,Total');
    expect(csvRes.text).toContain('2025-01-01,10,5,15');
  });
});
