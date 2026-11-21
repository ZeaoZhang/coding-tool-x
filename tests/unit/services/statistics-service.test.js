const os = require('os');
const fs = require('fs');
const path = require('path');

let testDir, summaryFile, dailyStatsDir, requestLogsDir, proxyLogsFile, loadedService;

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
  loadedService = require('../../../src/server/services/statistics-service');
  return loadedService;
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

afterEach(async () => {
  if (loadedService) {
    await loadedService.shutdownStatistics();
  }
  vi.restoreAllMocks();
  fs.rmSync(testDir, { recursive: true, force: true });
  loadedService = null;
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

  test('does not add cached or reasoning detail fields twice when total is absent', () => {
    const mod = loadService();
    mod.recordRequest(makeRequest({
      tokens: { input: 80, output: 20, cached: 20, reasoning: 5 }
    }));

    const stats = mod.getStatistics();
    expect(stats.global.totalTokens).toBe(120);
    expect(stats.byToolType['claude-code'].tokens.total).toBe(120);
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

  test('keeps native usage in aggregate stats without creating an undefined channel', () => {
    const mod = loadService();
    mod.recordRequest(makeRequest({ channel: 'Unknown', channelId: undefined }));

    const stats = mod.getStatistics();
    expect(stats.global.totalRequests).toBe(1);
    expect(stats.byToolType['claude-code'].requests).toBe(1);
    expect(stats.byToolType['claude-code'].channels).not.toHaveProperty('undefined');
    expect(stats.byChannel).not.toHaveProperty('undefined');

    const daily = mod.getTodayStatistics();
    expect(daily.byToolType['claude-code'].channels || {}).not.toHaveProperty('undefined');
    expect(daily.byChannel).not.toHaveProperty('undefined');
  });

  test('updates byModel stats', () => {
    const mod = loadService();
    mod.recordRequest(makeRequest({ model: 'claude-3-5-sonnet' }));

    const stats = mod.getStatistics();
    expect(stats.byModel).toHaveProperty('claude-3-5-sonnet');
    expect(stats.byModel['claude-3-5-sonnet'].requests).toBe(1);
  });

  test('creates daily stats file after the queued flush completes', async () => {
    const mod = loadService();
    mod.recordRequest(makeRequest());
    await mod.flushStatistics();

    expect(fs.existsSync(dailyStatsDir)).toBe(true);
    const files = fs.readdirSync(dailyStatsDir);
    expect(files.length).toBeGreaterThan(0);
  });
});

describe('statistics write queue', () => {
  afterEach(() => vi.restoreAllMocks());
  test('batches request persistence behind one flush promise', async () => {
    const mod = loadService();
    const appendSync = vi.spyOn(fs, 'appendFileSync');
    const appendAsync = vi.spyOn(fs.promises, 'appendFile').mockResolvedValue();
    const writeAsync = vi.spyOn(fs.promises, 'writeFile').mockResolvedValue();

    for (let index = 0; index < 20; index++) {
      mod.recordRequest(makeRequest({ id: `queued-${index}` }));
    }

    expect(appendSync).not.toHaveBeenCalled();
    await expect(mod.flushStatistics()).resolves.toEqual(expect.objectContaining({
      flushed: 20,
      pending: 0
    }));
    expect(appendAsync).toHaveBeenCalledTimes(1);
    expect(writeAsync).toHaveBeenCalled();
  });

  test('retains entries after a failed flush and retries them', async () => {
    const mod = loadService();
    const appendAsync = vi.spyOn(fs.promises, 'appendFile')
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValue();

    mod.recordRequest(makeRequest());
    await expect(mod.flushStatistics()).resolves.toEqual(expect.objectContaining({
      flushed: 0,
      pending: 1
    }));
    await expect(mod.flushStatistics()).resolves.toEqual(expect.objectContaining({
      flushed: 1,
      pending: 0
    }));
    expect(appendAsync).toHaveBeenCalledTimes(2);
  });

  test('shutdown waits for queued entries to flush', async () => {
    const mod = loadService();
    vi.spyOn(fs.promises, 'appendFile').mockResolvedValue();
    vi.spyOn(fs.promises, 'writeFile').mockResolvedValue();
    mod.recordRequest(makeRequest());

    await expect(mod.shutdownStatistics()).resolves.toEqual(expect.objectContaining({
      pending: 0
    }));
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

  test('aggregates OMP and DSH tool types in daily statistics', () => {
    const mod = loadService();
    const ts = new Date('2025-06-16T04:00:00.000Z').toISOString();
    mod.recordRequest(makeRequest({
      toolType: 'omp',
      timestamp: ts,
      tokens: { input: 10, output: 5, total: 15 }
    }));
    mod.recordRequest(makeRequest({
      toolType: 'dsh',
      timestamp: ts,
      tokens: { input: 20, output: 5, total: 25 }
    }));

    const stats = mod.getDailyStatistics('2025-06-16');
    expect(stats.byToolType.omp).toMatchObject({
      requests: 1,
      tokens: expect.objectContaining({ total: 15 })
    });
    expect(stats.byToolType.dsh).toMatchObject({
      requests: 1,
      tokens: expect.objectContaining({ total: 25 })
    });
    expect(stats.byToolType.omp.channels['ch-1']).toMatchObject({ requests: 1 });
    expect(stats.byToolType.omp.models['claude-3-5-sonnet']).toMatchObject({ requests: 1 });
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

  test('uses redirected model as available model filter when parsed model is empty', () => {
    const mod = loadService();
    mod.recordRequest(makeRequest({
      timestamp: new Date('2025-06-15T04:00:00.000Z').toISOString(),
      model: '',
      originalModel: 'gpt-4o',
      redirectedModel: 'gpt-4o-mini'
    }));

    const result = mod.getAvailableFilters('2025-06-15', '2025-06-15');
    expect(result.models).toContain('gpt-4o-mini');
    expect(result.models).not.toContain('gpt-4o');
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

describe('trend statistics', () => {
  test('aggregates the same actual model across tool types in model trends', async () => {
    const mod = loadService();
    const date = '2025-06-15';

    mod.recordRequest(makeRequest({
      timestamp: new Date('2025-06-15T04:00:00.000Z').toISOString(),
      toolType: 'codex',
      model: 'gpt-4o-mini',
      tokens: { input: 100, output: 50, total: 150 }
    }));
    mod.recordRequest(makeRequest({
      timestamp: new Date('2025-06-15T05:00:00.000Z').toISOString(),
      toolType: 'opencode',
      model: 'gpt-4o-mini',
      tokens: { input: 40, output: 10, total: 50 }
    }));

    const result = await mod.getTrendStatistics({
      startDate: date,
      endDate: date,
      granularity: 'day',
      groupBy: 'model',
      metric: 'tokens'
    });

    expect(result.series).toHaveLength(1);
    expect(result.series[0]).toEqual({
      name: 'gpt-4o-mini',
      data: [200]
    });
  });

  test('groups redirected requests under the actual redirected model', async () => {
    const mod = loadService();
    const date = '2025-06-15';

    mod.recordRequest(makeRequest({
      timestamp: new Date('2025-06-15T04:00:00.000Z').toISOString(),
      toolType: 'codex',
      model: '',
      originalModel: 'gpt-4o',
      redirectedModel: 'gpt-4o-mini',
      tokens: { input: 120, output: 30, total: 150 }
    }));

    const result = await mod.getTrendStatistics({
      startDate: date,
      endDate: date,
      granularity: 'day',
      groupBy: 'model',
      metric: 'tokens'
    });

    expect(result.series[0]).toEqual({
      name: 'gpt-4o-mini',
      data: [150]
    });
  });

  test('deduplicates repeated JSONL rows and keeps day/hour totals consistent', async () => {
    const mod = loadService();
    const date = '2025-06-16';
    const logDir = path.join(requestLogsDir, '2025-06');
    fs.mkdirSync(logDir, { recursive: true });

    const ompEntry = makeRequest({
      id: 'dup-omp',
      timestamp: '2025-06-16T04:00:00.000Z',
      toolType: 'omp',
      channel: 'sang for',
      model: 'deepseek-flash',
      tokens: { input: 70, output: 30, total: 100 }
    });
    const codexEntry = makeRequest({
      id: 'dup-codex',
      timestamp: '2025-06-16T13:00:00.000Z',
      toolType: 'codex',
      channel: 'me',
      model: 'gpt-5',
      tokens: { input: 40, output: 10, total: 50 }
    });
    // 历史 flush 重试产生的重复行
    fs.writeFileSync(
      path.join(logDir, '16.jsonl'),
      [ompEntry, ompEntry, codexEntry, ompEntry].map(entry => JSON.stringify(entry)).join('\n') + '\n',
      'utf8'
    );

    const day = await mod.getTrendStatistics({
      startDate: date, endDate: date, granularity: 'day', groupBy: 'toolType', metric: 'tokens'
    });
    const hour = await mod.getTrendStatistics({
      startDate: date, endDate: date, granularity: 'hour', step: 24, groupBy: 'toolType', metric: 'tokens'
    });
    const filtered = await mod.getTrendStatistics({
      startDate: date, endDate: date, granularity: 'day', groupBy: 'toolType', metric: 'tokens',
      filters: { toolType: 'omp' }
    });

    const sum = series => series.series.reduce(
      (total, item) => total + item.data.reduce((acc, value) => acc + value, 0), 0
    );

    expect(sum(day)).toBe(150);
    expect(sum(hour)).toBe(150);
    expect(sum(filtered)).toBe(100);
    expect(sum(filtered)).toBeLessThanOrEqual(sum(day));
  });

  test('reuses deduped JSONL entries across metric queries and invalidates on file change', async () => {
    const mod = loadService();
    const date = '2025-06-18';
    const logDir = path.join(requestLogsDir, '2025-06');
    fs.mkdirSync(logDir, { recursive: true });
    const filePath = path.join(logDir, '18.jsonl');
    const entry = makeRequest({
      id: 'cache-entry',
      timestamp: '2025-06-18T04:00:00.000Z',
      toolType: 'omp',
      model: 'deepseek-flash',
      tokens: { input: 60, output: 40, total: 100 },
      cost: 0.01
    });
    fs.writeFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');

    const query = metric => mod.getTrendStatistics({
      startDate: date, endDate: date, granularity: 'day', groupBy: 'model', metric
    });

    expect((await query('tokens')).series[0].data[0]).toBe(100);
    const readSpy = vi.spyOn(fs, 'readFileSync');
    expect((await query('cost')).series[0].data[0]).toBeCloseTo(0.01);
    expect(readSpy.mock.calls.some(([file]) => file === filePath)).toBe(false);

    fs.appendFileSync(filePath, JSON.stringify({
      ...entry,
      id: 'cache-entry-2',
      tokens: { input: 30, output: 20, total: 50 }
    }) + '\n', 'utf8');
    expect((await query('requests')).series[0].data[0]).toBe(2);
    expect(readSpy.mock.calls.some(([file]) => file === filePath)).toBe(true);
    readSpy.mockRestore();
  });

  test('does not fall back to unfiltered data when combined filters are empty', async () => {
    const mod = loadService();
    const date = '2025-06-19';
    const logDir = path.join(requestLogsDir, '2025-06');
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, '19.jsonl'), [
      makeRequest({ id: 'f-1', timestamp: '2025-06-19T04:00:00.000Z', toolType: 'omp', channel: 'alpha', model: 'm1', tokens: { total: 100 } }),
      makeRequest({ id: 'f-2', timestamp: '2025-06-19T05:00:00.000Z', toolType: 'codex', channel: 'beta', model: 'm1', tokens: { total: 40 } })
    ].map(entry => JSON.stringify(entry)).join('\n') + '\n', 'utf8');

    const total = async filters => {
      const result = await mod.getTrendStatistics({
        startDate: date, endDate: date, granularity: 'day', groupBy: 'model', metric: 'tokens', filters
      });
      return result.series.reduce((sum, item) => sum + item.data.reduce((acc, v) => acc + v, 0), 0);
    };

    expect(await total({ toolType: 'omp' })).toBe(100);
    expect(await total({ channel: 'beta' })).toBe(40);
    expect(await total({ toolType: 'omp', channel: 'beta' })).toBe(0);
  });

  test('falls back to proxy logs when a day has no request log', async () => {
    const mod = loadService();
    const date = '2025-06-17';
    fs.writeFileSync(proxyLogsFile, JSON.stringify([{
      type: 'log',
      source: 'codex',
      timestamp: '2025-06-17T04:00:00.000Z',
      channel: 'me',
      model: 'gpt-5',
      totalTokens: 80,
      cost: 0.02
    }]), 'utf8');

    const hour = await mod.getTrendStatistics({
      startDate: date, endDate: date, granularity: 'hour', step: 24, groupBy: 'toolType', metric: 'tokens'
    });

    const total = hour.series.reduce(
      (acc, item) => acc + item.data.reduce((sum, value) => sum + value, 0), 0
    );
    expect(total).toBe(80);
  });
});
