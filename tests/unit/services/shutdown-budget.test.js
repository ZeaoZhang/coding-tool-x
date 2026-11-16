'use strict';

const {
  DEFAULT_DRAIN_MS,
  DEFAULT_HARD_STOP_MS,
  DEFAULT_KILL_TIMEOUT_MS,
  resolveShutdownBudget,
  startShutdownWatchdog
} = require('../../../src/server/services/shutdown-budget');

describe('resolveShutdownBudget', () => {
  test('defaults keep drain < hard stop < kill timeout', () => {
    const budget = resolveShutdownBudget({});

    expect(budget).toEqual({
      drainMs: DEFAULT_DRAIN_MS,
      hardStopMs: DEFAULT_HARD_STOP_MS,
      killTimeoutMs: DEFAULT_KILL_TIMEOUT_MS
    });
    expect(budget.drainMs).toBeLessThan(budget.hardStopMs);
    expect(budget.hardStopMs).toBeLessThan(budget.killTimeoutMs);
  });

  test('reads each stage from the environment', () => {
    const budget = resolveShutdownBudget({
      CC_TOOL_STOP_DRAIN_MS: '2000',
      CC_TOOL_STOP_HARD_TIMEOUT_MS: '4000',
      CC_TOOL_STOP_KILL_TIMEOUT_MS: '9000'
    });

    expect(budget).toEqual({ drainMs: 2000, hardStopMs: 4000, killTimeoutMs: 9000 });
  });

  test('falls back to defaults for empty, non-numeric and non-positive values', () => {
    const budget = resolveShutdownBudget({
      CC_TOOL_STOP_DRAIN_MS: '',
      CC_TOOL_STOP_HARD_TIMEOUT_MS: 'abc',
      CC_TOOL_STOP_KILL_TIMEOUT_MS: '0'
    });

    expect(budget).toEqual({
      drainMs: DEFAULT_DRAIN_MS,
      hardStopMs: DEFAULT_HARD_STOP_MS,
      killTimeoutMs: DEFAULT_KILL_TIMEOUT_MS
    });
  });

  test('rejects negative values instead of shrinking the budget', () => {
    const budget = resolveShutdownBudget({
      CC_TOOL_STOP_DRAIN_MS: '-1',
      CC_TOOL_STOP_HARD_TIMEOUT_MS: '-5000'
    });

    expect(budget.drainMs).toBe(DEFAULT_DRAIN_MS);
    expect(budget.hardStopMs).toBe(DEFAULT_HARD_STOP_MS);
  });

  test('never lets the kill timeout overtake the hard stop', () => {
    // 硬上限被调大到超过原 kill_timeout 时，PM2 必须自动后延，否则清理途中就被 SIGKILL。
    const budget = resolveShutdownBudget({
      CC_TOOL_STOP_HARD_TIMEOUT_MS: '60000',
      CC_TOOL_STOP_KILL_TIMEOUT_MS: '1000'
    });

    expect(budget.hardStopMs).toBe(60000);
    expect(budget.killTimeoutMs).toBeGreaterThan(budget.hardStopMs);
  });

  test('never lets the hard stop be shorter than the drain window', () => {
    const budget = resolveShutdownBudget({
      CC_TOOL_STOP_DRAIN_MS: '30000',
      CC_TOOL_STOP_HARD_TIMEOUT_MS: '1000'
    });

    expect(budget.drainMs).toBe(30000);
    expect(budget.hardStopMs).toBeGreaterThanOrEqual(budget.drainMs);
  });
});

describe('startShutdownWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('fires the timeout callback once the budget is spent', () => {
    const onTimeout = vi.fn();
    startShutdownWatchdog(1000, onTimeout);

    vi.advanceTimersByTime(999);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  test('cancel prevents a clean shutdown from being force-exited', () => {
    const onTimeout = vi.fn();
    const watchdog = startShutdownWatchdog(1000, onTimeout);

    watchdog.cancel();
    vi.advanceTimersByTime(5000);

    expect(onTimeout).not.toHaveBeenCalled();
  });
});
