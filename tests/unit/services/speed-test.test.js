'use strict';

const Module = require('module');
const path = require('path');

// ─── Stub heavy dependencies into require.cache before loading speed-test ────
// speed-test uses top-level require(), so we must pre-populate the cache.

function stubModule(resolvedPath, exports) {
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports,
    parent: null,
    children: [],
    paths: [],
  };
}

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

stubModule(
  path.join(PROJECT_ROOT, 'src/server/services/model-detector.js'),
  { probeModelAvailability: () => Promise.resolve(null) }
);
stubModule(
  path.join(PROJECT_ROOT, 'src/server/services/channels.js'),
  { getEffectiveApiKey: () => null }
);
stubModule(
  path.join(PROJECT_ROOT, 'src/server/services/codex-channels.js'),
  { getEffectiveApiKey: () => null }
);
stubModule(
  path.join(PROJECT_ROOT, 'src/server/services/gemini-channels.js'),
  { getEffectiveApiKey: () => null }
);
stubModule(
  path.join(PROJECT_ROOT, 'src/server/services/opencode-channels.js'),
  { getEffectiveApiKey: () => null }
);
stubModule(
  path.join(PROJECT_ROOT, 'src/server/services/request-logger.js'),
  { loadClaudeRequestTemplate: () => null }
);

const {
  getLatencyLevel,
  sanitizeBatchConcurrency,
  runWithConcurrencyLimit,
} = require('../../../src/server/services/speed-test');

// ─── getLatencyLevel ──────────────────────────────────────────────────────────
describe('getLatencyLevel', () => {
  test('null → "unknown"', () => {
    expect(getLatencyLevel(null)).toBe('unknown');
  });

  test('undefined → "unknown"', () => {
    expect(getLatencyLevel(undefined)).toBe('unknown');
  });

  test('NaN → "unknown"', () => {
    expect(getLatencyLevel(NaN)).toBe('unknown');
  });

  test('Infinity → "unknown"', () => {
    expect(getLatencyLevel(Infinity)).toBe('unknown');
  });

  test('100ms → "excellent"', () => {
    expect(getLatencyLevel(100)).toBe('excellent');
  });

  test('299ms → "excellent" (boundary below 300)', () => {
    expect(getLatencyLevel(299)).toBe('excellent');
  });

  test('300ms → "good" (boundary at 300)', () => {
    expect(getLatencyLevel(300)).toBe('good');
  });

  test('499ms → "good" (boundary below 500)', () => {
    expect(getLatencyLevel(499)).toBe('good');
  });

  test('500ms → "fair" (boundary at 500)', () => {
    expect(getLatencyLevel(500)).toBe('fair');
  });

  test('799ms → "fair" (boundary below 800)', () => {
    expect(getLatencyLevel(799)).toBe('fair');
  });

  test('800ms → "poor" (boundary at 800)', () => {
    expect(getLatencyLevel(800)).toBe('poor');
  });

  test('1500ms → "poor"', () => {
    expect(getLatencyLevel(1500)).toBe('poor');
  });
});

// ─── sanitizeBatchConcurrency ────────────────────────────────────────────────
describe('sanitizeBatchConcurrency', () => {
  test('null → default (2)', () => {
    expect(sanitizeBatchConcurrency(null)).toBe(2);
  });

  test('0 → default (2)', () => {
    expect(sanitizeBatchConcurrency(0)).toBe(2);
  });

  test('negative → default (2)', () => {
    expect(sanitizeBatchConcurrency(-1)).toBe(2);
  });

  test('NaN → default (2)', () => {
    expect(sanitizeBatchConcurrency(NaN)).toBe(2);
  });

  test('valid value 3 → 3', () => {
    expect(sanitizeBatchConcurrency(3)).toBe(3);
  });

  test('value > 5 → clamped to 5', () => {
    expect(sanitizeBatchConcurrency(10)).toBe(5);
  });

  test('float 1.7 → rounded to 2', () => {
    expect(sanitizeBatchConcurrency(1.7)).toBe(2);
  });

  test('custom default value used when invalid', () => {
    expect(sanitizeBatchConcurrency(null, 4)).toBe(4);
  });
});

// ─── runWithConcurrencyLimit ─────────────────────────────────────────────────
describe('runWithConcurrencyLimit', () => {
  test('empty array → []', async () => {
    const result = await runWithConcurrencyLimit([], 2, () => Promise.resolve('x'));
    expect(result).toEqual([]);
  });

  test('non-array items treated as empty → []', async () => {
    const result = await runWithConcurrencyLimit(null, 2, () => Promise.resolve('x'));
    expect(result).toEqual([]);
  });

  test('preserves result order matching input order', async () => {
    const items = [30, 10, 20]; // different simulated delays
    const result = await runWithConcurrencyLimit(items, 3, async (ms) => {
      await new Promise(resolve => setTimeout(resolve, ms));
      return ms;
    });
    expect(result).toEqual([30, 10, 20]);
  });

  test('respects concurrency limit (at most N tasks run in parallel)', async () => {
    let activeCount = 0;
    let maxConcurrent = 0;
    const items = [1, 2, 3, 4, 5, 6];
    const concurrency = 2;

    await runWithConcurrencyLimit(items, concurrency, async (item) => {
      activeCount += 1;
      maxConcurrent = Math.max(maxConcurrent, activeCount);
      await new Promise(resolve => setTimeout(resolve, 10));
      activeCount -= 1;
      return item;
    });

    expect(maxConcurrent).toBeLessThanOrEqual(concurrency);
  });

  test('sequential execution completes all items', async () => {
    const items = ['a', 'b', 'c'];
    const result = await runWithConcurrencyLimit(items, 1, async (item) => item.toUpperCase());
    expect(result).toEqual(['A', 'B', 'C']);
  });
});
