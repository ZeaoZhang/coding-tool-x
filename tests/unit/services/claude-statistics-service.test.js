const TOOL_TYPE = 'claude-code';
const MODULE_PATH = '../../../src/platforms/drivers/claude/statistics-implementation';

const mockRecordRequest = vi.fn();
const mockGetStatistics = vi.fn();
const mockGetDailyStatistics = vi.fn();
const mockGetTodayStatistics = vi.fn();
const mockNormalizeUsageTokens = vi.fn((type, tokens) => ({
  input: tokens?.input || 0, output: tokens?.output || 0,
  reasoning: tokens?.reasoning || 0, cached: tokens?.cached || tokens?.cacheRead || 0,
  cacheCreation: tokens?.cacheCreation || 0, cacheRead: tokens?.cacheRead || 0,
  total: tokens?.total || 0
}));
const mockToNumber = vi.fn((v) => Number(v) || 0);

beforeEach(() => {
  const statsPath = require.resolve('../../../src/server/services/statistics-service');
  require.cache[statsPath] = { id: statsPath, filename: statsPath, loaded: true, exports: {
    recordRequest: mockRecordRequest,
    getStatistics: mockGetStatistics,
    getDailyStatistics: mockGetDailyStatistics,
    getTodayStatistics: mockGetTodayStatistics
  }};

  const logPath = require.resolve('../../../src/server/services/proxy-log-helper');
  require.cache[logPath] = { id: logPath, filename: logPath, loaded: true, exports: {
    normalizeUsageTokens: mockNormalizeUsageTokens,
    toNumber: mockToNumber
  }};

  vi.clearAllMocks();

  mockNormalizeUsageTokens.mockImplementation((type, tokens) => ({
    input: tokens?.input || 0, output: tokens?.output || 0,
    reasoning: tokens?.reasoning || 0, cached: tokens?.cached || tokens?.cacheRead || 0,
    cacheCreation: tokens?.cacheCreation || 0, cacheRead: tokens?.cacheRead || 0,
    total: tokens?.total || 0
  }));
  mockToNumber.mockImplementation((v) => Number(v) || 0);

  mockGetStatistics.mockReturnValue({
    lastUpdated: '2025-01-01T00:00:00Z',
    byToolType: {
      [TOOL_TYPE]: {
        requests: 10, tokens: { input: 1000, output: 500, cacheCreation: 20, cacheRead: 10, total: 1530 }, cost: 0.5,
        channels: { 'ch1': { name: 'Claude Channel', requests: 5, tokens: { input: 500, output: 250, total: 750 }, cost: 0.25 } },
        models: { 'claude-3-5-sonnet': { requests: 10, tokens: { input: 1000, output: 500, total: 1500 }, cost: 0.5 } }
      },
      codex: {
        requests: 99, tokens: { input: 9000, output: 9000, total: 18000 }, cost: 9
      }
    }
  });

  const dailyData = {
    date: '2025-01-01',
    summary: { requests: 102, tokens: 18400, cost: 9.1 },
    byToolType: {
      [TOOL_TYPE]: { requests: 3, tokens: { input: 300, output: 100, total: 400 }, cost: 0.1, channels: {}, models: {} },
      codex: { requests: 99, tokens: { total: 18000 }, cost: 9, channels: {}, models: {} }
    }
  };
  mockGetDailyStatistics.mockReturnValue(dailyData);
  mockGetTodayStatistics.mockReturnValue(dailyData);

  delete require.cache[require.resolve(MODULE_PATH)];
});

afterEach(() => {
  [
    MODULE_PATH,
    '../../../src/server/services/statistics-service',
    '../../../src/server/services/proxy-log-helper'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('claude-statistics-service', () => {
  test('getStatistics extracts only claude-code usage from shared stats', () => {
    const service = require(MODULE_PATH);
    const result = service.getStatistics();
    expect(result.global.totalRequests).toBe(10);
    expect(result.global.totalTokens).toBe(1530);
    expect(result.global.totalCost).toBe(0.5);
    expect(result.byModel).toHaveProperty('claude-3-5-sonnet');
  });

  test('getTodayStatistics ignores other tool totals in shared daily summary', () => {
    const service = require(MODULE_PATH);
    const result = service.getTodayStatistics();
    expect(result.summary).toEqual({
      requests: 3,
      tokens: 400,
      cost: 0.1
    });
  });

  test('recordRequest delegates to shared with claude-code tool type', () => {
    const service = require(MODULE_PATH);
    const tokens = { input: 100, output: 50, cacheCreation: 10, cacheRead: 5, total: 165 };
    service.recordRequest({ tokens });

    expect(mockNormalizeUsageTokens).toHaveBeenCalledWith('claude', tokens);
    expect(mockRecordRequest).toHaveBeenCalledTimes(1);
    expect(mockRecordRequest.mock.calls[0][0]).toMatchObject({
      toolType: TOOL_TYPE,
      tokens: {
        input: 100,
        output: 50,
        cacheCreation: 10,
        cacheRead: 5,
        total: 165
      }
    });
  });
});
