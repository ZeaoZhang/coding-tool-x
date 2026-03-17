const os = require('os');
const fs = require('fs');
const path = require('path');

let testDir, summaryFile, dailyStatsDir, requestLogsDir, proxyLogsFile;

function setupPathsCache() {
  const pathsModPath = require.resolve('../../../src/config/paths');
  require.cache[pathsModPath] = {
    id: pathsModPath,
    filename: pathsModPath,
    loaded: true,
    exports: {
      PATHS: {
        statistics: {
          summary: summaryFile,
          dailyStats: dailyStatsDir,
          requestLogs: requestLogsDir,
          proxyLogs: proxyLogsFile
        }
      }
    }
  };
}

function loadService() {
  const modPath = require.resolve('../../../src/server/services/statistics-service');
  delete require.cache[modPath];
  return require('../../../src/server/services/statistics-service');
}

function makeRequest(overrides = {}) {
  return {
    id: 'req-1',
    timestamp: new Date().toISOString(),
    toolType: 'claude-code',
    channel: 'default',
    channelId: 'ch-1',
    model: 'claude-3-5-sonnet',
    tokens: { input: 100, output: 50, cacheCreation: 0, cacheRead: 0, total: 150 },
    duration: 1000,
    success: true,
    cost: 0.01,
    session: 'sess-1',
    project: 'proj-1',
    ...overrides
  };
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-'));
  summaryFile = path.join(testDir, 'statistics.json');
  dailyStatsDir = path.join(testDir, 'daily-stats');
  requestLogsDir = path.join(testDir, 'request-logs');
  proxyLogsFile = path.join(testDir, 'proxy-logs.jsonl');

  setupPathsCache();
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

// ─── getStatistics ───────────────────────────────────────────────────────────

describe('getStatistics', () => {
  test('returns default structure when no data file exists', () => {
    const mod = loadService();
    const stats = mod.getStatistics();

    expect(stats).toHaveProperty('global');
    expect(stats.global.totalRequests).toBe(0);
    expect(stats.global.totalTokens).toBe(0);
    expect(stats.global.totalCost).toBe(0);
    expect(stats).toHaveProperty('byToolType');
    expect(stats).toHaveProperty('byChannel');
    expect(stats).toHaveProperty('byModel');
  });

  test('loads and returns existing data file', () => {
    const existing = {
      version: '2.0',
      lastUpdated: new Date().toISOString(),
      global: { totalRequests: 5, totalTokens: 1000, totalCost: 0.05 },
      byToolType: {},
      byChannel: {},
      byModel: {}
    };
    fs.writeFileSync(summaryFile, JSON.stringify(existing), 'utf8');

    const mod = loadService();
    const stats = mod.getStatistics();

    expect(stats.global.totalRequests).toBe(5);
    expect(stats.global.totalTokens).toBe(1000);
    expect(stats.global.totalCost).toBeCloseTo(0.05);
  });

  test('returns default structure when data file is malformed JSON', () => {
    fs.writeFileSync(summaryFile, 'not-json', 'utf8');

    const mod = loadService();
    const stats = mod.getStatistics();

    expect(stats.global.totalRequests).toBe(0);
  });
});

// ─── getTodayStatistics ──────────────────────────────────────────────────────

describe('getTodayStatistics', () => {
  test('returns default structure when no data exists for today', () => {
    const mod = loadService();
    const stats = mod.getTodayStatistics();

    expect(stats).toHaveProperty('date');
    expect(stats).toHaveProperty('summary');
    expect(stats.summary.requests).toBe(0);
    expect(stats.summary.tokens).toBe(0);
    expect(stats.summary.cost).toBe(0);
    expect(stats).toHaveProperty('hourly');
    expect(stats).toHaveProperty('byToolType');
    expect(stats).toHaveProperty('byChannel');
    expect(stats).toHaveProperty('byModel');
  });

  test('returns today stats after recording a request', () => {
    const mod = loadService();
    mod.recordRequest(makeRequest());

    const stats = mod.getTodayStatistics();
    expect(stats.summary.requests).toBe(1);
    expect(stats.summary.tokens).toBe(150);
    expect(stats.summary.cost).toBeCloseTo(0.01);
  });
});

// ─── recordRequest ───────────────────────────────────────────────────────────

describe('recordRequest', () => {
  test('records request and updates global stats', () => {
    const mod = loadService();
    mod.recordRequest(makeRequest());

    const stats = mod.getStatistics();
    expect(stats.global.totalRequests).toBe(1);
    expect(stats.global.totalTokens).toBe(150);
    expect(stats.global.totalCost).toBeCloseTo(0.01);
  });

  test('updates byToolType stats', () => {
    const mod = loadService();
    mod.recordRequest(makeRequest({ toolType: 'claude-code' }));

    const stats = mod.getStatistics();
    expect(stats.byToolType).toHaveProperty('claude-code');
    expect(stats.byToolType['claude-code'].requests).toBe(1);
  });

  test('updates byChannel stats', () => {
    const mod = loadService();
    mod.recordRequest(makeRequest({ channelId: 'ch-test', channel: 'TestChannel' }));

    const stats = mod.getStatistics();
    expect(stats.byChannel).toHaveProperty('ch-test');
    expect(stats.byChannel['ch-test'].requests).toBe(1);
    expect(stats.byChannel['ch-test'].name).toBe('TestChannel');
  });

  test('updates byModel stats', () => {
    const mod = loadService();
    mod.recordRequest(makeRequest({ model: 'claude-3-5-sonnet' }));

    const stats = mod.getStatistics();
    expect(stats.byModel).toHaveProperty('claude-3-5-sonnet');
    expect(stats.byModel['claude-3-5-sonnet'].requests).toBe(1);
  });

  test('creates daily stats file', () => {
    const mod = loadService();
    mod.recordRequest(makeRequest());

    // daily-stats dir should now exist and contain a file
    expect(fs.existsSync(dailyStatsDir)).toBe(true);
    const files = fs.readdirSync(dailyStatsDir);
    expect(files.length).toBeGreaterThan(0);
  });
});

// ─── getDailyStatistics ──────────────────────────────────────────────────────

describe('getDailyStatistics', () => {
  test('returns default structure when no data exists for date', () => {
    const mod = loadService();
    const stats = mod.getDailyStatistics('2025-01-01');

    expect(stats.date).toBe('2025-01-01');
    expect(stats.summary.requests).toBe(0);
    expect(stats.summary.tokens).toBe(0);
    expect(stats.summary.cost).toBe(0);
  });

  test('returns daily stats after recording a request for that date', () => {
    const mod = loadService();

    // Use a fixed past date in CST (UTC+8): set timestamp to noon CST
    const fixedDate = '2025-06-15';
    // noon CST = 04:00 UTC
    const ts = new Date('2025-06-15T04:00:00.000Z').toISOString();
    mod.recordRequest(makeRequest({ timestamp: ts }));

    const stats = mod.getDailyStatistics(fixedDate);
    expect(stats.summary.requests).toBe(1);
    expect(stats.summary.tokens).toBe(150);
  });

  test('handles a date with no data gracefully (no throws)', () => {
    const mod = loadService();
    expect(() => mod.getDailyStatistics('9999-12-31')).not.toThrow();
  });
});

// ─── initStatsObject structure (via recordRequest) ──────────────────────────

describe('stats object structure', () => {
  test('recorded stats have correct token sub-fields', () => {
    const mod = loadService();
    mod.recordRequest(makeRequest({
      tokens: { input: 10, output: 20, cacheCreation: 5, cacheRead: 3, total: 38 }
    }));

    const stats = mod.getStatistics();
    const toolStats = stats.byToolType['claude-code'];
    expect(toolStats).toHaveProperty('requests');
    expect(toolStats).toHaveProperty('tokens');
    expect(toolStats.tokens).toHaveProperty('input');
    expect(toolStats.tokens).toHaveProperty('output');
    expect(toolStats.tokens).toHaveProperty('cacheCreation');
    expect(toolStats.tokens).toHaveProperty('cacheRead');
    expect(toolStats.tokens).toHaveProperty('total');
    expect(toolStats).toHaveProperty('cost');
  });

  test('token fields accumulate correctly', () => {
    const mod = loadService();
    mod.recordRequest(makeRequest({
      tokens: { input: 10, output: 20, cacheCreation: 5, cacheRead: 3, total: 38 }
    }));
    mod.recordRequest(makeRequest({
      tokens: { input: 10, output: 20, cacheCreation: 5, cacheRead: 3, total: 38 }
    }));

    const stats = mod.getStatistics();
    const toolStats = stats.byToolType['claude-code'];
    expect(toolStats.tokens.input).toBe(20);
    expect(toolStats.tokens.output).toBe(40);
    expect(toolStats.tokens.total).toBe(76);
  });
});

// ─── Date handling ───────────────────────────────────────────────────────────

describe('date handling', () => {
  test('getTodayStatistics returns data for the current CST date', () => {
    const mod = loadService();
    mod.recordRequest(makeRequest());

    const today = mod.getTodayStatistics();
    // date field should look like YYYY-MM-DD
    expect(today.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('getDailyStatistics for a specific date returns that date in result', () => {
    const mod = loadService();
    const result = mod.getDailyStatistics('2025-03-10');
    expect(result.date).toBe('2025-03-10');
  });

  test('requests near midnight are stored under the correct CST date', () => {
    const mod = loadService();
    // 23:30 UTC = 07:30 next day CST (UTC+8)
    const ts = new Date('2025-06-14T23:30:00.000Z').toISOString();
    mod.recordRequest(makeRequest({ timestamp: ts }));

    // Should be stored under 2025-06-15 (CST)
    const stats = mod.getDailyStatistics('2025-06-15');
    expect(stats.summary.requests).toBe(1);
  });
});

// ─── getAvailableFilters ─────────────────────────────────────────────────────

describe('getAvailableFilters', () => {
  test('returns structure with toolTypes, channels, models arrays', () => {
    const mod = loadService();
    const result = mod.getAvailableFilters('2025-01-01', '2025-01-07');

    expect(result).toHaveProperty('toolTypes');
    expect(result).toHaveProperty('channels');
    expect(result).toHaveProperty('models');
    expect(Array.isArray(result.toolTypes)).toBe(true);
    expect(Array.isArray(result.channels)).toBe(true);
    expect(Array.isArray(result.models)).toBe(true);
  });

  test('returns empty arrays when no request logs exist', () => {
    const mod = loadService();
    const result = mod.getAvailableFilters('2025-01-01', '2025-01-07');

    expect(result.toolTypes).toHaveLength(0);
    expect(result.channels).toHaveLength(0);
    expect(result.models).toHaveLength(0);
  });
});

// ─── recordRequest token accumulation ───────────────────────────────────────

describe('recordRequest token accumulation', () => {
  test('multiple requests accumulate global tokens correctly', () => {
    const mod = loadService();
    mod.recordRequest(makeRequest({ tokens: { input: 100, output: 50, cacheCreation: 0, cacheRead: 0, total: 150 } }));
    mod.recordRequest(makeRequest({ tokens: { input: 200, output: 100, cacheCreation: 10, cacheRead: 5, total: 315 } }));

    const stats = mod.getStatistics();
    expect(stats.global.totalRequests).toBe(2);
    expect(stats.global.totalTokens).toBe(465);
  });

  test('cost accumulates across multiple requests', () => {
    const mod = loadService();
    mod.recordRequest(makeRequest({ cost: 0.01 }));
    mod.recordRequest(makeRequest({ cost: 0.02 }));
    mod.recordRequest(makeRequest({ cost: 0.03 }));

    const stats = mod.getStatistics();
    expect(stats.global.totalCost).toBeCloseTo(0.06);
  });

  test('different models are tracked separately in byModel', () => {
    const mod = loadService();
    mod.recordRequest(makeRequest({ model: 'claude-3-5-sonnet', tokens: { input: 100, output: 50, cacheCreation: 0, cacheRead: 0, total: 150 } }));
    mod.recordRequest(makeRequest({ model: 'claude-3-opus', tokens: { input: 200, output: 100, cacheCreation: 0, cacheRead: 0, total: 300 } }));

    const stats = mod.getStatistics();
    expect(stats.byModel['claude-3-5-sonnet'].requests).toBe(1);
    expect(stats.byModel['claude-3-5-sonnet'].tokens.total).toBe(150);
    expect(stats.byModel['claude-3-opus'].requests).toBe(1);
    expect(stats.byModel['claude-3-opus'].tokens.total).toBe(300);
  });
});
