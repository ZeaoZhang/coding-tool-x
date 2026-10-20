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
      pending: 0, durable: true
    }));
  });

  test('shutdown reports an undurable backlog and keeps retrying after disk recovery', async () => {
    const mod = loadService();
    mod.recordRequest(makeRequest());
    const append = vi.spyOn(fs.promises, 'appendFile').mockRejectedValue(new Error('disk unavailable'));
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw new Error('spool unavailable'); });
    const result = await mod.shutdownStatistics();
    expect(result.durable).toBe(false);
    expect(mod.getStatisticsQueueDiagnostics().pending).toBe(1);
    append.mockRestore(); write.mockRestore();
    await expect(mod.flushStatistics()).resolves.toMatchObject({ pending: 0 });
    await expect(mod.shutdownStatistics()).resolves.toMatchObject({ durable: true });
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
});


describe('bounded statistics persistence', () => {
  test('bounds pending memory during a stalled writer and preserves overflow on disk', async () => {
    const mod = loadService();
    let release;
    const append = vi.spyOn(fs.promises, 'appendFile').mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    mod.recordRequest(makeRequest({ id: 'active' }));
    const flushing = mod.flushStatistics();
    while (!release) await new Promise(resolve => setImmediate(resolve));
    for (let index = 0; index < 1100; index++) mod.recordRequest(makeRequest({ id: `overflow-${index}` }));
    expect(mod.getStatisticsQueueDiagnostics()).toEqual(expect.objectContaining({ pending: 1000, spooled: 101, active: 1 }));
    expect(mod.getStatisticsQueueDiagnostics().bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(mod.getStatistics().global.totalRequests).toBe(1101);
    release();
    await flushing;
    await mod.shutdownStatistics();
    expect(mod.getStatisticsQueueDiagnostics().pending).toBe(0);
    expect(mod.getStatisticsQueueDiagnostics().spooled).toBe(0);
    expect(append.mock.calls.every(([, text]) => text.trim().split('\n').length <= 500)).toBe(true);
  });
});


describe('statistics pressure recovery', () => {
  test('does not retry successful file groups when a later group fails', async () => {
    const mod = loadService();
    const append = vi.spyOn(fs.promises, 'appendFile').mockResolvedValueOnce().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue();
    mod.recordRequest(makeRequest({ timestamp: '2025-06-15T04:00:00Z' }));
    mod.recordRequest(makeRequest({ timestamp: '2025-06-16T04:00:00Z' }));
    await mod.flushStatistics();
    expect(mod.getStatisticsQueueDiagnostics().blocked).toBe(true);
    await mod.flushStatistics();
    expect(append.mock.calls.map(([file]) => path.basename(file))).toEqual(['15.jsonl', '16.jsonl', '16.jsonl']);
    expect(mod.getStatisticsQueueDiagnostics().blocked).toBe(false);
  });

  test('backs off failed writes instead of spinning through microtasks', async () => {
    const mod = loadService();
    const append = vi.spyOn(fs.promises, 'appendFile').mockRejectedValue(new Error('disk full'));
    mod.recordRequest(makeRequest());
    await mod.flushStatistics();
    for (let index = 0; index < 10; index++) await new Promise(resolve => setImmediate(resolve));
    expect(append).toHaveBeenCalledTimes(1);
    expect(mod.getStatisticsQueueDiagnostics().pending).toBe(1);
    append.mockRestore();
    await mod.flushStatistics();
  });

  test('evicts dirty dates to disk and reloads them without losing counts', async () => {
    const mod = loadService();
    for (let day = 1; day <= 30; day++) {
      mod.recordRequest(makeRequest({ timestamp: `2025-06-${String(day).padStart(2, '0')}T04:00:00Z` }));
    }
    expect(mod.getStatisticsQueueDiagnostics().dailyCacheEntries).toBe(7);
    expect(mod.getDailyStatistics('2025-06-01').summary.requests).toBe(1);
    mod.recordRequest(makeRequest({ timestamp: '2025-06-01T04:00:00Z' }));
    expect(mod.getDailyStatistics('2025-06-01').summary.requests).toBe(2);
    await mod.shutdownStatistics();
    expect(JSON.parse(fs.readFileSync(path.join(dailyStatsDir, '2025-06-01.json'), 'utf8')).summary.requests).toBe(2);
  });

  test('enforces the byte budget even below the entry limit', async () => {
    const mod = loadService();
    const project = 'x'.repeat(1024 * 1024);
    for (let index = 0; index < 12; index++) mod.recordRequest(makeRequest({ id: `large-${index}`, project }));
    const state = mod.getStatisticsQueueDiagnostics();
    expect(state.bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(state.spooled).toBeGreaterThan(0);
    await mod.shutdownStatistics();
    expect(mod.getStatistics().global.totalRequests).toBe(12);
  });

  test('caps trend results and expires them without further reads', async () => {
    vi.useFakeTimers();
    const mod = loadService();
    try {
      for (let index = 0; index < 40; index++) await mod.getTrendStatistics({
        startDate: '2025-06-01', endDate: '2025-06-01', filters: { model: `model-${index}` }
      });
      expect(mod.getStatisticsQueueDiagnostics().trendCacheEntries).toBe(32);
      expect(mod.getStatisticsQueueDiagnostics().trendCacheBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
      await vi.advanceTimersByTimeAsync(30001);
      expect(mod.getStatisticsQueueDiagnostics().trendCacheEntries).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});


describe('statistics restart and admission', () => {
  test('recovers overflow records, daily counters and aggregates from disk', async () => {
    let mod = loadService();
    mod.recordRequest(makeRequest({ id: 'recovered', timestamp: '2025-06-15T04:00:00Z' }));
    const aggregate = mod.getStatistics();
    const daily = mod.getDailyStatistics('2025-06-15');
    await mod.shutdownStatistics();
    const spool = path.join(testDir, 'statistics-pending');
    fs.mkdirSync(path.join(spool, 'daily'), { recursive: true });
    fs.writeFileSync(path.join(spool, 'aggregate.json'), JSON.stringify(aggregate));
    fs.writeFileSync(path.join(spool, 'daily', '2025-06-15.json'), JSON.stringify(daily));
    fs.writeFileSync(path.join(spool, 'recovered.entry'), JSON.stringify({ logEntry: makeRequest({ id: 'recovered', timestamp: '2025-06-15T04:00:00Z' }), date: '2025-06-15', logPersisted: true }));
    const append = vi.spyOn(fs.promises, 'appendFile');
    mod = loadService();
    expect(mod.getStatistics().global.totalRequests).toBe(1);
    await mod.shutdownStatistics();
    expect(append).not.toHaveBeenCalled();
    expect(mod.getStatisticsQueueDiagnostics().spooled).toBe(0);
    expect(mod.getDailyStatistics('2025-06-15').summary.requests).toBe(1);
  });

  test('rejects disk overflow before changing counters when spool writes fail', async () => {
    const mod = loadService();
    for (let index = 0; index < 1000; index++) expect(mod.recordRequest(makeRequest({ id: `before-${index}` }))).toBe(true);
    const write = fs.writeFileSync;
    const failingWrite = vi.spyOn(fs, 'writeFileSync').mockImplementation((file, ...args) => {
      if (String(file).endsWith('.entry.tmp')) throw new Error('disk full');
      return write.call(fs, file, ...args);
    });
    expect(mod.recordRequest(makeRequest({ id: 'rejected' }))).toBe(false);
    expect(mod.getStatistics().global.totalRequests).toBe(1000);
    expect(mod.getStatisticsQueueDiagnostics()).toEqual(expect.objectContaining({ pending: 1000, spooled: 0, blocked: true, dropped: 0, rejected: 1 }));
    failingWrite.mockRestore();
    await mod.shutdownStatistics();
  });

  test('does not double count active or already appended records in trend queries', async () => {
    const mod = loadService();
    let release;
    vi.spyOn(fs.promises, 'appendFile').mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    mod.recordRequest(makeRequest({ timestamp: '2025-06-15T04:00:00Z' }));
    const flushing = mod.flushStatistics();
    while (!release) await new Promise(resolve => setImmediate(resolve));
    const result = await mod.getTrendStatistics({ startDate: '2025-06-15', endDate: '2025-06-15', granularity: 'hour', groupBy: 'model', metric: 'requests' });
    release();
    await flushing;
    expect(result.series[0].data.reduce((sum, value) => sum + value, 0)).toBe(1);
  });
});


describe('atomic overflow aggregate recovery', () => {
  test('recovers aggregate and daily counts when spool commit succeeds but checkpoint writes fail', async () => {
    let mod = loadService();
    mod.recordRequest(makeRequest({ timestamp: '2025-06-15T04:00:00Z' }));
    await mod.flushStatistics();
    const write = fs.writeFileSync;
    const failure = vi.spyOn(fs, 'writeFileSync').mockImplementation((file, ...args) => {
      if (String(file).includes('statistics-pending/daily/') || String(file).endsWith('aggregate.json.tmp')) throw new Error('checkpoint disk failure');
      return write.call(fs, file, ...args);
    });
    for (let index = 0; index < 7; index++) mod.recordRequest(makeRequest({ id: `before-${index}`, project: 'x'.repeat(1024 * 1024), timestamp: '2025-06-15T04:00:00Z' }));
    expect(mod.recordRequest(makeRequest({ id: 'durable-overflow', project: 'x'.repeat(1024 * 1024), timestamp: '2025-06-15T04:00:00Z' }))).toBe(true);
    const spool = path.join(testDir, 'statistics-pending');
    const entryName = fs.readdirSync(spool).find(name => name.endsWith('.entry'));
    const durableRecord = fs.readFileSync(path.join(spool, entryName), 'utf8');
    expect(JSON.parse(durableRecord).recovery.aggregateBefore.global.totalRequests).toBe(8);
    expect(mod.getStatisticsQueueDiagnostics().blocked).toBe(true);
    vi.spyOn(fs.promises, 'appendFile').mockRejectedValue(new Error('destination unavailable'));
    await mod.shutdownStatistics();
    failure.mockRestore();
    vi.restoreAllMocks();
    // Only the atomically committed overflow record survived this crash boundary.
    fs.rmSync(spool, { recursive: true, force: true });
    fs.mkdirSync(spool, { recursive: true });
    fs.writeFileSync(path.join(spool, entryName), durableRecord);
    mod = loadService();
    expect(mod.getStatistics().global.totalRequests).toBe(9);
    expect(mod.getStatistics().global.totalTokens).toBe(1350);
    expect(mod.getDailyStatistics('2025-06-15').summary.requests).toBe(9);
    await mod.shutdownStatistics();
    expect(JSON.parse(fs.readFileSync(summaryFile, 'utf8')).global.totalRequests).toBe(9);
    expect(JSON.parse(fs.readFileSync(path.join(dailyStatsDir, '2025-06-15.json'), 'utf8')).summary.requests).toBe(9);
    mod = loadService();
    expect(mod.getStatistics().global.totalRequests).toBe(9);
  });

  test('truncates huge optional metadata without blocking native consumption or losing token counts', async () => {
    const mod = loadService();
    expect(mod.recordRequest(makeRequest({ project: 'x'.repeat(9 * 1024 * 1024) }))).toBe(true);
    expect(mod.getStatisticsQueueDiagnostics()).toEqual(expect.objectContaining({ blocked: false, pending: 1, spooled: 0 }));
    expect(mod.getStatisticsQueueDiagnostics().bytes).toBeLessThan(20000);
    expect(mod.getStatistics().global.totalTokens).toBe(150);
    await mod.shutdownStatistics();
  });
});


test('keeps atomic recovery state after log append until aggregate persistence succeeds', async () => {
  let mod = loadService();
  const aggregateBefore = mod.getStatistics();
  const dailyBefore = mod.getDailyStatistics('2025-06-15');
  await mod.shutdownStatistics();
  const spool = path.join(testDir, 'statistics-pending');
  fs.mkdirSync(spool, { recursive: true });
  const file = path.join(spool, 'atomic.entry');
  fs.writeFileSync(file, JSON.stringify({ logEntry: makeRequest({ timestamp: '2025-06-15T04:00:00Z' }), date: '2025-06-15', recovery: { aggregateBefore, dailyBefore } }));
  const write = fs.promises.writeFile;
  const failure = vi.spyOn(fs.promises, 'writeFile').mockImplementation((target, ...args) => {
    if (target === summaryFile) return Promise.reject(new Error('aggregate unavailable'));
    return write.call(fs.promises, target, ...args);
  });
  const append = vi.spyOn(fs.promises, 'appendFile');
  mod = loadService();
  await mod.flushStatistics();
  const durable = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(durable.logPersisted).toBe(true);
  expect(durable.recovery.aggregateBefore.global.totalRequests).toBe(0);
  await mod.shutdownStatistics();
  failure.mockRestore();
  fs.rmSync(path.join(spool, 'aggregate.json'), { force: true });
  fs.rmSync(path.join(spool, 'daily'), { recursive: true, force: true });
  mod = loadService();
  await mod.shutdownStatistics();
  expect(mod.getStatistics().global.totalRequests).toBe(1);
  expect(mod.getDailyStatistics('2025-06-15').summary.requests).toBe(1);
  expect(append).toHaveBeenCalledTimes(1);
});


test('a killed process between log append and spool marker does not duplicate the recovered request', async () => {
  let mod = loadService();
  const aggregateBefore = mod.getStatistics();
  const dailyBefore = mod.getDailyStatistics('2025-06-15');
  await mod.shutdownStatistics();
  const spool = path.join(testDir, 'statistics-pending');
  fs.mkdirSync(spool, { recursive: true });
  const spoolFile = path.join(spool, 'crash.entry');
  const writeId = require('crypto').randomUUID();
  fs.writeFileSync(spoolFile, JSON.stringify({ writeId, logEntry: { ...makeRequest({ timestamp: '2025-06-15T04:00:00Z' }), _statisticsWriteId: writeId }, date: '2025-06-15', recovery: { aggregateBefore, dailyBefore } }));
  const pathsModule = require.resolve('../../../src/config/paths');
  const serviceModule = require.resolve('../../../src/server/services/statistics-service');
  const childCode = `
    const fs = require('fs');
    const pathsModule = ${JSON.stringify(pathsModule)};
    require.cache[pathsModule] = { id: pathsModule, filename: pathsModule, loaded: true, exports: { PATHS: { statistics: ${JSON.stringify({ summary: summaryFile, dailyStats: dailyStatsDir, requestLogs: requestLogsDir, proxyLogs: proxyLogsFile })} } } };
    const originalWrite = fs.writeFileSync;
    fs.writeFileSync = function(file, ...args) {
      if (file === ${JSON.stringify(spoolFile + '.tmp')}) process.kill(process.pid, 'SIGKILL');
      return originalWrite.call(fs, file, ...args);
    };
    require(${JSON.stringify(serviceModule)}).flushStatistics().then(() => process.exit(10));
  `;
  const result = require('child_process').spawnSync(process.execPath, ['-e', childCode], { timeout: 10000 });
  expect(result.signal).toBe('SIGKILL');
  expect(JSON.parse(fs.readFileSync(spoolFile, 'utf8')).logPersisted).not.toBe(true);
  const logFile = path.join(requestLogsDir, '2025-06', '15.jsonl');
  expect(fs.readFileSync(logFile, 'utf8').trim().split('\n')).toHaveLength(1);
  const append = vi.spyOn(fs.promises, 'appendFile');
  const readFile = vi.spyOn(fs, 'readFileSync');
  const read = vi.spyOn(fs, 'readSync');
  mod = loadService();
  await mod.shutdownStatistics();
  expect(append).not.toHaveBeenCalled();
  expect(read.mock.calls.every(([, buffer]) => buffer.length <= 64 * 1024)).toBe(true);
  expect(readFile.mock.calls.some(([file]) => file === logFile)).toBe(false);
  expect(mod.getStatistics().global.totalRequests).toBe(1);
  expect(mod.getDailyStatistics('2025-06-15').summary.requests).toBe(1);
  readFile.mockRestore();
  expect(fs.readFileSync(logFile, 'utf8').trim().split('\n')).toHaveLength(1);
});

test('a partial final append is truncated before idempotent replay', async () => {
  let mod = loadService();
  const aggregateBefore = mod.getStatistics();
  const dailyBefore = mod.getDailyStatistics('2025-06-15');
  await mod.shutdownStatistics();
  const spool = path.join(testDir, 'statistics-pending');
  fs.mkdirSync(spool, { recursive: true });
  const writeId = require('crypto').randomUUID();
  const logEntry = { ...makeRequest({ timestamp: '2025-06-15T04:00:00Z' }), _statisticsWriteId: writeId };
  fs.writeFileSync(path.join(spool, 'partial.entry'), JSON.stringify({ writeId, logEntry, date: '2025-06-15', recovery: { aggregateBefore, dailyBefore } }));
  const logFile = path.join(requestLogsDir, '2025-06', '15.jsonl');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, JSON.stringify(logEntry).slice(0, -1));
  mod = loadService();
  await mod.shutdownStatistics();
  const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0])._statisticsWriteId).toBe(writeId);
  expect(mod.getStatistics().global.totalRequests).toBe(1);
});


describe('preserving final JSON without a newline', () => {
  async function prepareTail(makeTail) {
    let mod = loadService();
    const aggregateBefore = mod.getStatistics();
    const dailyBefore = mod.getDailyStatistics('2025-06-15');
    await mod.shutdownStatistics();
    const spool = path.join(testDir, 'statistics-pending');
    fs.mkdirSync(spool, { recursive: true });
    const writeId = require('crypto').randomUUID();
    const logEntry = { ...makeRequest({ timestamp: '2025-06-15T04:00:00Z' }), _statisticsWriteId: writeId };
    fs.writeFileSync(path.join(spool, 'tail.entry'), JSON.stringify({ writeId, logEntry, date: '2025-06-15', recovery: { aggregateBefore, dailyBefore } }));
    const logFile = path.join(requestLogsDir, '2025-06', '15.jsonl');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const tail = makeTail(logEntry, writeId);
    fs.writeFileSync(logFile, tail);
    return { logFile, tail };
  }

  test('preserves a complete large legacy record and appends the recovered request separately', async () => {
    const legacy = { id: 'legacy', project: '中文😀'.repeat(100000) };
    const { logFile } = await prepareTail(() => JSON.stringify(legacy));
    const read = vi.spyOn(fs, 'readSync');
    const mod = loadService();
    await mod.shutdownStatistics();
    const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual(legacy);
    expect(JSON.parse(lines[1]).id).toBe('req-1');
    expect(read.mock.calls.every(([, buffer]) => buffer.length <= 64 * 1024)).toBe(true);
  });

  test('recognizes the committed write id in complete JSON missing only the newline', async () => {
    const { logFile } = await prepareTail((logEntry, writeId) => JSON.stringify({ _statisticsWriteId: writeId, ...logEntry }));
    const append = vi.spyOn(fs.promises, 'appendFile');
    const mod = loadService();
    await mod.shutdownStatistics();
    expect(append).not.toHaveBeenCalled();
    expect(fs.readFileSync(logFile, 'utf8').trim().split('\n')).toHaveLength(1);
    expect(fs.readFileSync(logFile, 'utf8').endsWith('\n')).toBe(true);
    expect(mod.getStatistics().global.totalRequests).toBe(1);
  });

  test('preserves tail bytes and blocks recovery when validation reaches a depth limit', async () => {
    const { logFile, tail } = await prepareTail(() => '{"project":' + '['.repeat(140) + '0' + ']'.repeat(140) + '}');
    const append = vi.spyOn(fs.promises, 'appendFile');
    const mod = loadService();
    await mod.flushStatistics();
    expect(mod.getStatisticsQueueDiagnostics().blocked).toBe(true);
    expect(append).not.toHaveBeenCalled();
    expect(fs.readFileSync(logFile, 'utf8')).toBe(tail);
  });
});
