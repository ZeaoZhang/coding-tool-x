const { EventEmitter } = require('events');

describe('shared proxy memory admission', () => {
  let pressure;
  let rss;
  let persistenceBlocked;
  let nativeBlocked;
  const statisticsPath = require.resolve('../../../src/server/services/statistics-service');
  const observerPath = require.resolve('../../../src/server/services/native-log-observer');
  let previousStatistics;
  let previousObserver;

  beforeEach(() => {
    vi.useFakeTimers();
    rss = 200 * 1024 * 1024;
    persistenceBlocked = false;
    nativeBlocked = false;
    vi.spyOn(process, 'memoryUsage').mockImplementation(() => ({ rss }));
    previousStatistics = require.cache[statisticsPath];
    previousObserver = require.cache[observerPath];
    require.cache[statisticsPath] = { exports: { getStatisticsQueueDiagnostics: () => ({ blocked: persistenceBlocked }) } };
    require.cache[observerPath] = { exports: { getNativeLogDiagnostics: () => ({ persistenceBlocked: nativeBlocked }) } };
    delete require.cache[require.resolve('../../../src/server/services/memory-pressure')];
    pressure = require('../../../src/server/services/memory-pressure');
  });

  afterEach(() => {
    pressure.stopMemoryPressureMonitor();
    if (previousStatistics) require.cache[statisticsPath] = previousStatistics;
    else delete require.cache[statisticsPath];
    if (previousObserver) require.cache[observerPath] = previousObserver;
    else delete require.cache[observerPath];
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function response() {
    return Object.assign(new EventEmitter(), { setHeader: vi.fn(), end: vi.fn() });
  }

  it('rejects before parsing at380MiB and recovers only after two low periodic checks', () => {
    const next = vi.fn();
    rss = 380 * 1024 * 1024;
    const res = response();
    pressure.memoryPressureMiddleware({ proxyPlatform: 'claude' }, res, next);
    expect(res.statusCode).toBe(503);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '5');
    expect(JSON.parse(res.end.mock.calls[0][0]).error.type).toBe('overloaded_error');
    expect(next).not.toHaveBeenCalled();
    rss = 329 * 1024 * 1024;
    pressure.memoryPressureMiddleware({}, response(), next);
    pressure.memoryPressureMiddleware({}, response(), next);
    expect(next).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    pressure.memoryPressureMiddleware({}, response(), next);
    expect(next).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    pressure.memoryPressureMiddleware({}, response(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('resets recovery hysteresis if RSS reaches330MiB or persistence is blocked', () => {
    persistenceBlocked = true;
    pressure.memoryPressureMiddleware({}, response(), vi.fn());
    persistenceBlocked = false;
    vi.advanceTimersByTime(5000);
    rss = 330 * 1024 * 1024;
    vi.advanceTimersByTime(5000);
    expect(pressure.getMemoryPressureDiagnostics().paused).toBe(true);
    rss = 200 * 1024 * 1024;
    vi.advanceTimersByTime(10000);
    expect(pressure.getMemoryPressureDiagnostics().paused).toBe(false);
  });

  it('leaves already admitted streams untouched while rejecting later requests and upgrades', () => {
    const stream = response();
    const next = vi.fn();
    pressure.memoryPressureMiddleware({}, stream, next);
    rss = 400 * 1024 * 1024;
    pressure.memoryPressureMiddleware({ proxyPlatform: 'gemini' }, response(), vi.fn());
    expect(stream.end).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    const socket = { end: vi.fn() };
    expect(pressure.rejectUpgradeUnderPressure({}, socket)).toBe(true);
    expect(socket.end.mock.calls[0][0]).toContain('Retry-After: 5');
  });

  it('protects admission while native checkpoint storage is blocked', () => {
    nativeBlocked = true;
    const res = response();
    pressure.memoryPressureMiddleware({}, res, vi.fn());
    expect(res.statusCode).toBe(503);
    nativeBlocked = false;
    vi.advanceTimersByTime(10000);
    expect(pressure.getMemoryPressureDiagnostics().paused).toBe(false);
  });
});
