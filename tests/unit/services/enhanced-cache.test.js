/**
 * Tests for src/server/services/enhanced-cache.js
 *
 * CacheManager is a pure in-memory class with no external dependencies,
 * so no require.cache injection is needed. We instantiate a fresh instance
 * per test to avoid cross-test state pollution.
 */

const { CacheManager, globalCache, CacheKeys } = require('../../../src/server/services/enhanced-cache');

// ─── CacheManager: set / get ──────────────────────────────────────────────────

describe('CacheManager set and get', () => {
  let cache;

  beforeEach(() => {
    cache = new CacheManager({ cleanupInterval: 999999 });
  });

  afterEach(() => {
    cache.stopCleanup();
  });

  it('returns null for a key that was never set', () => {
    expect(cache.get('missing')).toBeNull();
  });

  it('returns the value immediately after set', () => {
    cache.set('k', 'hello');
    expect(cache.get('k')).toBe('hello');
  });

  it('stores objects by reference', () => {
    const obj = { a: 1 };
    cache.set('obj', obj);
    expect(cache.get('obj')).toBe(obj);
  });

  it('stores falsy values correctly (0, false, empty string)', () => {
    cache.set('zero', 0);
    cache.set('false', false);
    cache.set('empty', '');
    // falsy non-null values are returned as-is
    expect(cache.get('zero')).toBe(0);
    expect(cache.get('false')).toBe(false);
    expect(cache.get('empty')).toBe('');
  });

  it('overwrites a previously set value', () => {
    cache.set('k', 'first');
    cache.set('k', 'second');
    expect(cache.get('k')).toBe('second');
  });
});

// ─── CacheManager: delete ─────────────────────────────────────────────────────

describe('CacheManager delete', () => {
  let cache;

  beforeEach(() => {
    cache = new CacheManager({ cleanupInterval: 999999 });
  });

  afterEach(() => {
    cache.stopCleanup();
  });

  it('removing an existing key makes get return null', () => {
    cache.set('k', 'v');
    cache.delete('k');
    expect(cache.get('k')).toBeNull();
  });

  it('deleting a non-existent key does not throw', () => {
    expect(() => cache.delete('no-such-key')).not.toThrow();
  });

  it('does not affect other keys', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.delete('a');
    expect(cache.get('b')).toBe(2);
  });
});

// ─── CacheManager: clear ─────────────────────────────────────────────────────

describe('CacheManager clear', () => {
  let cache;

  beforeEach(() => {
    cache = new CacheManager({ cleanupInterval: 999999 });
  });

  afterEach(() => {
    cache.stopCleanup();
  });

  it('removes all previously set keys', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.clear();
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBeNull();
    expect(cache.get('c')).toBeNull();
  });

  it('leaves the cache in a usable state after clearing', () => {
    cache.set('x', 'before');
    cache.clear();
    cache.set('y', 'after');
    expect(cache.get('y')).toBe('after');
  });

  it('resets getStats().size to 0', () => {
    cache.set('a', 1);
    cache.clear();
    expect(cache.getStats().size).toBe(0);
  });
});

// ─── CacheManager: TTL expiration ────────────────────────────────────────────

describe('CacheManager TTL expiration', () => {
  let cache;

  beforeEach(() => {
    cache = new CacheManager({ cleanupInterval: 999999 });
  });

  afterEach(() => {
    cache.stopCleanup();
    vi.useRealTimers();
  });

  it('returns value before TTL expires', () => {
    vi.useFakeTimers();
    cache.set('k', 'v', 5000);
    vi.advanceTimersByTime(4000);
    expect(cache.get('k')).toBe('v');
  });

  it('returns null after TTL expires', () => {
    vi.useFakeTimers();
    cache.set('k', 'v', 1000);
    vi.advanceTimersByTime(1001);
    expect(cache.get('k')).toBeNull();
  });

  it('expired entry is also removed from internal maps (no memory leak)', () => {
    vi.useFakeTimers();
    cache.set('k', 'v', 100);
    vi.advanceTimersByTime(200);
    cache.get('k'); // triggers lazy delete
    expect(cache.getStats().size).toBe(0);
  });

  it('custom TTL overrides defaultTTL', () => {
    vi.useFakeTimers();
    const shortCache = new CacheManager({ defaultTTL: 60000, cleanupInterval: 999999 });
    shortCache.set('k', 'v', 500); // explicit short TTL
    vi.advanceTimersByTime(501);
    expect(shortCache.get('k')).toBeNull();
    shortCache.stopCleanup();
  });
});

// ─── CacheManager: has ───────────────────────────────────────────────────────

describe('CacheManager has', () => {
  let cache;

  beforeEach(() => {
    cache = new CacheManager({ cleanupInterval: 999999 });
  });

  afterEach(() => {
    cache.stopCleanup();
    vi.useRealTimers();
  });

  it('returns true for a live key', () => {
    cache.set('k', 'v');
    expect(cache.has('k')).toBe(true);
  });

  it('returns false for a missing key', () => {
    expect(cache.has('no')).toBe(false);
  });

  it('returns false after the key expires', () => {
    vi.useFakeTimers();
    cache.set('k', 'v', 100);
    vi.advanceTimersByTime(200);
    expect(cache.has('k')).toBe(false);
  });
});

// ─── CacheManager: getOrSet ──────────────────────────────────────────────────

describe('CacheManager getOrSet', () => {
  let cache;

  beforeEach(() => {
    cache = new CacheManager({ cleanupInterval: 999999 });
  });

  afterEach(() => {
    cache.stopCleanup();
  });

  it('calls factory and stores result when key is absent', async () => {
    const factory = vi.fn().mockResolvedValue('computed');
    const result = await cache.getOrSet('k', factory);
    expect(factory).toHaveBeenCalledOnce();
    expect(result).toBe('computed');
  });

  it('returns cached value without calling factory on second call', async () => {
    const factory = vi.fn().mockResolvedValue('computed');
    await cache.getOrSet('k', factory);
    const result = await cache.getOrSet('k', factory);
    expect(factory).toHaveBeenCalledOnce();
    expect(result).toBe('computed');
  });

  it('calls factory again after TTL expires', async () => {
    vi.useFakeTimers();
    const factory = vi.fn().mockResolvedValue('value');
    await cache.getOrSet('k', factory, 100);
    vi.advanceTimersByTime(200);
    await cache.getOrSet('k', factory, 100);
    expect(factory).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

// ─── CacheManager: LRU eviction ──────────────────────────────────────────────

describe('CacheManager LRU eviction', () => {
  it('evicts the least-recently-used entry when maxSize is reached', () => {
    const cache = new CacheManager({ maxSize: 3, cleanupInterval: 999999 });

    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    // 'a' was set first, so it is the oldest — a 4th set should evict it
    cache.set('d', 4);

    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);

    cache.stopCleanup();
  });
});

// ─── CacheManager: getStats ──────────────────────────────────────────────────

describe('CacheManager getStats', () => {
  let cache;

  beforeEach(() => {
    cache = new CacheManager({ cleanupInterval: 999999 });
  });

  afterEach(() => {
    cache.stopCleanup();
  });

  it('reports size 0 for an empty cache', () => {
    expect(cache.getStats().size).toBe(0);
  });

  it('reflects the current number of live entries', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.getStats().size).toBe(2);
  });

  it('includes maxSize in stats', () => {
    const c = new CacheManager({ maxSize: 42, cleanupInterval: 999999 });
    expect(c.getStats().maxSize).toBe(42);
    c.stopCleanup();
  });

  it('lists current keys', () => {
    cache.set('x', 1);
    cache.set('y', 2);
    expect(cache.getStats().keys).toEqual(expect.arrayContaining(['x', 'y']));
  });
});

// ─── CacheManager: stopCleanup ───────────────────────────────────────────────

describe('CacheManager stopCleanup', () => {
  it('can be called multiple times without throwing', () => {
    const cache = new CacheManager({ cleanupInterval: 999999 });
    cache.stopCleanup();
    expect(() => cache.stopCleanup()).not.toThrow();
  });
});

// ─── globalCache singleton ───────────────────────────────────────────────────

describe('globalCache singleton', () => {
  afterEach(() => {
    globalCache.clear();
  });

  it('is a CacheManager instance', () => {
    expect(globalCache).toBeInstanceOf(CacheManager);
  });

  it('set / get round-trip works on the singleton', () => {
    globalCache.set('singleton-test', 42);
    expect(globalCache.get('singleton-test')).toBe(42);
  });
});

// ─── CacheKeys constants ─────────────────────────────────────────────────────

describe('CacheKeys', () => {
  it('exports PROJECTS as a non-empty string', () => {
    expect(typeof CacheKeys.PROJECTS).toBe('string');
    expect(CacheKeys.PROJECTS.length).toBeGreaterThan(0);
  });

  it('exports SESSIONS as a non-empty string', () => {
    expect(typeof CacheKeys.SESSIONS).toBe('string');
    expect(CacheKeys.SESSIONS.length).toBeGreaterThan(0);
  });

  it('exports SKILLS as a non-empty string', () => {
    expect(typeof CacheKeys.SKILLS).toBe('string');
    expect(CacheKeys.SKILLS.length).toBeGreaterThan(0);
  });

  it('exports CONFIG_TEMPLATES as a non-empty string', () => {
    expect(typeof CacheKeys.CONFIG_TEMPLATES).toBe('string');
    expect(CacheKeys.CONFIG_TEMPLATES.length).toBeGreaterThan(0);
  });

  it('exports REPOS as a non-empty string', () => {
    expect(typeof CacheKeys.REPOS).toBe('string');
    expect(CacheKeys.REPOS.length).toBeGreaterThan(0);
  });

  it('exports HAS_MESSAGES as a non-empty string', () => {
    expect(typeof CacheKeys.HAS_MESSAGES).toBe('string');
    expect(CacheKeys.HAS_MESSAGES.length).toBeGreaterThan(0);
  });

  it('all keys are distinct', () => {
    const values = Object.values(CacheKeys);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});
