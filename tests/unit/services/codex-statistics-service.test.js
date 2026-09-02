const os = require('os');
const fs = require('fs');
const path = require('path');

const TOOL_TYPE = 'codex';
const MODULE_PATH = '../../../src/platforms/drivers/codex/statistics-implementation';

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
        requests: 10, tokens: { input: 1000, output: 500, total: 1500 }, cost: 0.5,
        channels: { 'ch1': { name: 'Test Channel', requests: 5, tokens: { input: 500, output: 250, total: 750 }, cost: 0.25 } },
        models: { 'model-1': { requests: 10, tokens: { input: 1000, output: 500, total: 1500 }, cost: 0.5 } }
      }
    }
  });

  const dailyData = {
    date: '2025-01-01',
    byToolType: {
      [TOOL_TYPE]: { requests: 3, tokens: { input: 300, output: 100, total: 400 }, cost: 0.1, channels: {}, models: {} }
    }
  };
  mockGetDailyStatistics.mockReturnValue(dailyData);
  mockGetTodayStatistics.mockReturnValue(dailyData);

  delete require.cache[require.resolve(MODULE_PATH)];
});

describe('codex-statistics-service', () => {
  test('getStatistics returns structured data with version, global, byChannel, byModel', () => {
    const service = require(MODULE_PATH);
    const result = service.getStatistics();
    expect(result).toHaveProperty('version', '1.0');
    expect(result).toHaveProperty('global');
    expect(result).toHaveProperty('byChannel');
    expect(result).toHaveProperty('byModel');
    expect(result).toHaveProperty('lastUpdated');
  });

  test('getStatistics extracts correct TOOL_TYPE from shared stats', () => {
    const service = require(MODULE_PATH);
    const result = service.getStatistics();
    expect(mockGetStatistics).toHaveBeenCalledTimes(1);
    expect(result.global.totalRequests).toBe(10);
    expect(result.global.totalCost).toBe(0.5);
  });

  test('getStatistics handles empty/missing byToolType', () => {
    mockGetStatistics.mockReturnValue({ lastUpdated: '2025-01-01T00:00:00Z', byToolType: {} });
    const service = require(MODULE_PATH);
    const result = service.getStatistics();
    expect(result.global.totalRequests).toBe(0);
    expect(result.global.totalTokens).toBe(0);
    expect(result.global.totalCost).toBe(0);
    expect(result.byChannel).toEqual({});
    expect(result.byModel).toEqual({});
  });

  test('getTodayStatistics returns daily format with summary', () => {
    const service = require(MODULE_PATH);
    const result = service.getTodayStatistics();
    expect(result).toHaveProperty('date', '2025-01-01');
    expect(result).toHaveProperty('summary');
    expect(result.summary).toHaveProperty('requests');
    expect(result.summary).toHaveProperty('tokens');
    expect(result.summary).toHaveProperty('cost');
  });

  test('getDailyStatistics returns stats for specific date', () => {
    const service = require(MODULE_PATH);
    const result = service.getDailyStatistics('2025-01-01');
    expect(mockGetDailyStatistics).toHaveBeenCalledWith('2025-01-01');
    expect(result.date).toBe('2025-01-01');
    expect(result.summary.requests).toBe(3);
  });

  test('recordRequest delegates to shared with correct toolType', () => {
    const service = require(MODULE_PATH);
    service.recordRequest({ model: 'model-1', cost: 0.01, tokens: { input: 100, output: 50, total: 150 } });
    expect(mockRecordRequest).toHaveBeenCalledTimes(1);
    const callArg = mockRecordRequest.mock.calls[0][0];
    expect(callArg.toolType).toBe(TOOL_TYPE);
  });

  test('recordRequest normalizes tokens via normalizeUsageTokens', () => {
    const service = require(MODULE_PATH);
    const tokens = { input: 100, output: 50, cached: 20, reasoning: 5, total: 150 };
    service.recordRequest({ tokens });
    expect(mockNormalizeUsageTokens).toHaveBeenCalledWith(TOOL_TYPE, tokens);
    const callArg = mockRecordRequest.mock.calls[0][0];
    expect(callArg.tokens).toHaveProperty('input');
    expect(callArg.tokens).toHaveProperty('output');
    expect(callArg.tokens).toHaveProperty('cached', 20);
    expect(callArg.tokens).toHaveProperty('reasoning', 5);
  });

  test('empty shared stats results in graceful defaults with 0 values', () => {
    mockGetStatistics.mockReturnValue({});
    const service = require(MODULE_PATH);
    const result = service.getStatistics();
    expect(result.global.totalRequests).toBe(0);
    expect(result.global.totalTokens).toBe(0);
    expect(result.global.totalCost).toBe(0);
  });

  test('byChannel mapping preserves channel names', () => {
    const service = require(MODULE_PATH);
    const result = service.getStatistics();
    expect(result.byChannel).toHaveProperty('ch1');
    expect(result.byChannel['ch1']).toHaveProperty('name', 'Test Channel');
  });

  test('byModel mapping has correct token structure', () => {
    const service = require(MODULE_PATH);
    const result = service.getStatistics();
    expect(result.byModel).toHaveProperty('model-1');
    const model = result.byModel['model-1'];
    expect(model).toHaveProperty('tokens');
    expect(model.tokens).toHaveProperty('input');
    expect(model.tokens).toHaveProperty('output');
    expect(model.tokens).toHaveProperty('total');
  });
});
