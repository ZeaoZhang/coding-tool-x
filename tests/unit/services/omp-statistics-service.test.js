const TOOL_TYPE = 'omp';
const MODULE_PATH = '../../../src/server/services/omp-statistics-service';

const mockRecordRequest = vi.fn();
const mockGetStatistics = vi.fn();
const mockGetDailyStatistics = vi.fn();
const mockGetTodayStatistics = vi.fn();
const mockGetAllSessions = vi.fn();
const mockNormalizeUsageTokens = vi.fn((type, tokens = {}) => ({
  input: tokens.input || 0,
  output: tokens.output || 0,
  reasoning: tokens.reasoning || 0,
  cached: tokens.cached || tokens.cacheRead || 0,
  cacheCreation: tokens.cacheCreation || 0,
  cacheRead: tokens.cacheRead || 0,
  total: tokens.total || tokens.input + tokens.output + (tokens.reasoning || 0) + (tokens.cached || tokens.cacheRead || 0)
}));
const mockToNumber = vi.fn((value) => Number(value) || 0);

function loadService() {
  delete require.cache[require.resolve(MODULE_PATH)];
  return require(MODULE_PATH);
}

beforeEach(() => {
  const statsPath = require.resolve('../../../src/server/services/statistics-service');
  require.cache[statsPath] = {
    id: statsPath,
    filename: statsPath,
    loaded: true,
    exports: {
      recordRequest: mockRecordRequest,
      getStatistics: mockGetStatistics,
      getDailyStatistics: mockGetDailyStatistics,
      getTodayStatistics: mockGetTodayStatistics
    }
  };

  const sessionsPath = require.resolve('../../../src/server/services/omp-sessions');
  require.cache[sessionsPath] = {
    id: sessionsPath,
    filename: sessionsPath,
    loaded: true,
    exports: {
      getAllSessions: mockGetAllSessions
    }
  };

  const logPath = require.resolve('../../../src/server/services/proxy-log-helper');
  require.cache[logPath] = {
    id: logPath,
    filename: logPath,
    loaded: true,
    exports: {
      normalizeUsageTokens: mockNormalizeUsageTokens,
      toNumber: mockToNumber
    }
  };

  vi.clearAllMocks();
  mockGetStatistics.mockReturnValue({ lastUpdated: '2026-07-08T00:00:00.000Z', byToolType: {} });
  mockGetDailyStatistics.mockReturnValue({ date: '2026-07-08', byToolType: {} });
  mockGetTodayStatistics.mockReturnValue({ date: '2026-07-08', byToolType: {} });
  mockGetAllSessions.mockReturnValue([]);
  mockNormalizeUsageTokens.mockImplementation((type, tokens = {}) => ({
    input: tokens.input || 0,
    output: tokens.output || 0,
    reasoning: tokens.reasoning || 0,
    cached: tokens.cached || tokens.cacheRead || 0,
    cacheCreation: tokens.cacheCreation || 0,
    cacheRead: tokens.cacheRead || 0,
    total: tokens.total || tokens.input + tokens.output + (tokens.reasoning || 0) + (tokens.cached || tokens.cacheRead || 0)
  }));
  mockToNumber.mockImplementation((value) => Number(value) || 0);
});

afterEach(() => {
  [
    MODULE_PATH,
    '../../../src/server/services/statistics-service',
    '../../../src/server/services/omp-sessions',
    '../../../src/server/services/proxy-log-helper'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('omp-statistics-service', () => {
  test('uses shared OMP statistics when they exist', () => {
    mockGetStatistics.mockReturnValue({
      lastUpdated: '2026-07-08T01:00:00.000Z',
      byToolType: {
        [TOOL_TYPE]: {
          requests: 2,
          tokens: { input: 10, output: 5, total: 15 },
          cost: 0.01,
          channels: {},
          models: {}
        }
      }
    });

    const service = loadService();
    const result = service.getStatistics();

    expect(result.source).toBe('shared-stats');
    expect(result.global.totalRequests).toBe(2);
    expect(result.global.totalTokens).toBe(15);
    expect(mockGetAllSessions).not.toHaveBeenCalled();
  });

  test('falls back to OMP session-derived summary statistics', () => {
    mockGetAllSessions.mockReturnValue([
      {
        sessionId: 's1',
        provider: 'openai',
        model: 'gpt-5',
        mtime: '2026-07-08T02:00:00.000Z',
        usage: { input: 100, output: 50, cached: 10, reasoning: 5, total: 165 }
      },
      {
        sessionId: 's2',
        provider: 'openai',
        model: 'gpt-5-mini',
        mtime: '2026-07-09T02:00:00.000Z',
        usage: { input: 20, output: 10, total: 30 }
      }
    ]);

    const service = loadService();
    const result = service.getStatistics();

    expect(result.source).toBe('sessions');
    expect(result.global.totalRequests).toBe(2);
    expect(result.global.totalTokens).toBe(195);
    expect(result.byChannel.openai).toMatchObject({
      name: 'openai',
      requests: 2,
      tokens: expect.objectContaining({ total: 195 })
    });
    expect(result.byModel['gpt-5'].tokens.total).toBe(165);
    expect(result.byModel['gpt-5-mini'].tokens.total).toBe(30);
  });

  test('falls back to OMP session-derived daily statistics', () => {
    mockGetAllSessions.mockReturnValue([
      {
        sessionId: 's1',
        provider: 'openai',
        model: 'gpt-5',
        mtime: '2026-07-08T02:00:00.000Z',
        usage: { input: 100, output: 50, total: 150 }
      },
      {
        sessionId: 's2',
        provider: 'openai',
        model: 'gpt-5',
        mtime: '2026-07-09T02:00:00.000Z',
        usage: { input: 20, output: 10, total: 30 }
      }
    ]);

    const service = loadService();
    const result = service.getDailyStatistics('2026-07-08');

    expect(result.source).toBe('sessions');
    expect(result.date).toBe('2026-07-08');
    expect(result.summary).toMatchObject({
      requests: 1,
      tokens: 150,
      cost: 0
    });
    expect(result.byModel['gpt-5'].tokens.total).toBe(150);
  });

  test('marks OMP statistics as empty when shared stats and sessions have no usage', () => {
    const service = loadService();

    expect(service.getStatistics()).toMatchObject({
      source: 'empty',
      global: {
        totalRequests: 0,
        totalTokens: 0,
        totalCost: 0
      },
      byChannel: {},
      byModel: {}
    });
    expect(service.getDailyStatistics('2026-07-08')).toMatchObject({
      date: '2026-07-08',
      source: 'empty',
      summary: {
        requests: 0,
        tokens: 0,
        cost: 0
      }
    });
  });

  test('recordRequest delegates to shared statistics with OMP tool type', () => {
    const service = loadService();
    service.recordRequest({ tokens: { input: 1, output: 2, total: 3 } });

    expect(mockRecordRequest).toHaveBeenCalledTimes(1);
    expect(mockRecordRequest.mock.calls[0][0]).toMatchObject({
      toolType: TOOL_TYPE,
      tokens: expect.objectContaining({
        input: 1,
        output: 2,
        total: 3
      })
    });
  });
});
