const os = require('os');
const fs = require('fs');
const path = require('path');

let testDir;
let testCacheFile;
let mod;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-cache-'));
  testCacheFile = path.join(testDir, 'has-messages.json');

  // Inject PATHS mock before loading module
  const pathsModPath = require.resolve('../../../src/config/paths');
  require.cache[pathsModPath] = {
    id: pathsModPath,
    filename: pathsModPath,
    loaded: true,
    exports: { PATHS: { sessionHasCache: testCacheFile } }
  };

  // Clear and re-require
  delete require.cache[require.resolve('../../../src/server/services/session-cache')];
  mod = require('../../../src/server/services/session-cache');
});

afterEach(() => {
  // Clear any pending timers to avoid test leaks
  vi.useRealTimers();

  fs.rmSync(testDir, { recursive: true, force: true });
  delete require.cache[require.resolve('../../../src/server/services/session-cache')];
  delete require.cache[require.resolve('../../../src/config/paths')];
});

// ---------------------------------------------------------------------------
// getCachedProjects / setCachedProjects
// ---------------------------------------------------------------------------

describe('getCachedProjects / setCachedProjects', () => {
  test('returns null when no cache entry exists', () => {
    const result = mod.getCachedProjects({ projectsDir: '/some/dir' });
    expect(result).toBeNull();
  });

  test('returns data immediately after set', () => {
    const config = { projectsDir: '/test/dir' };
    const data = [{ name: 'proj1' }, { name: 'proj2' }];

    mod.setCachedProjects(config, data);
    const result = mod.getCachedProjects(config);

    expect(result).toEqual(data);
  });

  test('different config keys use separate cache entries', () => {
    const config1 = { projectsDir: '/dir/one' };
    const config2 = { projectsDir: '/dir/two' };
    const data1 = [{ name: 'a' }];
    const data2 = [{ name: 'b' }];

    mod.setCachedProjects(config1, data1);
    mod.setCachedProjects(config2, data2);

    expect(mod.getCachedProjects(config1)).toEqual(data1);
    expect(mod.getCachedProjects(config2)).toEqual(data2);
  });

  test('returns null after TTL (30s) has elapsed', () => {
    vi.useFakeTimers();
    const config = { projectsDir: '/ttl/dir' };

    mod.setCachedProjects(config, [{ name: 'proj' }]);
    expect(mod.getCachedProjects(config)).not.toBeNull();

    vi.advanceTimersByTime(31000);

    expect(mod.getCachedProjects(config)).toBeNull();
  });

  test('set overwrites previous value for the same key', () => {
    const config = { projectsDir: '/overwrite/dir' };
    const first = [{ name: 'first' }];
    const second = [{ name: 'second' }];

    mod.setCachedProjects(config, first);
    mod.setCachedProjects(config, second);

    expect(mod.getCachedProjects(config)).toEqual(second);
  });
});

// ---------------------------------------------------------------------------
// invalidateProjectsCache
// ---------------------------------------------------------------------------

describe('invalidateProjectsCache', () => {
  test('invalidating a specific key makes that key return null while others remain', () => {
    const config1 = { projectsDir: '/keep/this' };
    const config2 = { projectsDir: '/remove/this' };

    mod.setCachedProjects(config1, [{ name: 'keep' }]);
    mod.setCachedProjects(config2, [{ name: 'remove' }]);

    mod.invalidateProjectsCache(config2);

    expect(mod.getCachedProjects(config1)).toEqual([{ name: 'keep' }]);
    expect(mod.getCachedProjects(config2)).toBeNull();
  });

  test('passing null clears all cached entries', () => {
    const config1 = { projectsDir: '/clear/one' };
    const config2 = { projectsDir: '/clear/two' };

    mod.setCachedProjects(config1, [1]);
    mod.setCachedProjects(config2, [2]);

    mod.invalidateProjectsCache(null);

    expect(mod.getCachedProjects(config1)).toBeNull();
    expect(mod.getCachedProjects(config2)).toBeNull();
  });

  test('invalidating by string key removes the matching entry', () => {
    const config = { projectsDir: '/string/key' };
    mod.setCachedProjects(config, [{ name: 'data' }]);

    // The key is config.projectsDir when config is an object
    mod.invalidateProjectsCache('/string/key');

    expect(mod.getCachedProjects(config)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// checkHasMessagesCache / rememberHasMessages
// ---------------------------------------------------------------------------

describe('checkHasMessagesCache / rememberHasMessages', () => {
  const makeStats = (size, mtimeMs) => ({ size, mtimeMs });

  test('returns undefined when nothing has been cached', () => {
    const result = mod.checkHasMessagesCache('/some/file.jsonl', makeStats(100, 1000));
    expect(result).toBeUndefined();
  });

  test('returns the stored value after rememberHasMessages', () => {
    const filePath = '/test/session.jsonl';
    const stats = makeStats(512, 9999);

    mod.rememberHasMessages(filePath, stats, true);

    expect(mod.checkHasMessagesCache(filePath, stats)).toBe(true);
  });

  test('different filePath uses a separate cache entry', () => {
    const stats = makeStats(100, 200);

    mod.rememberHasMessages('/file/a.jsonl', stats, true);
    mod.rememberHasMessages('/file/b.jsonl', stats, false);

    expect(mod.checkHasMessagesCache('/file/a.jsonl', stats)).toBe(true);
    expect(mod.checkHasMessagesCache('/file/b.jsonl', stats)).toBe(false);
  });

  test('different stats (size or mtimeMs) are treated as separate cache entries', () => {
    const filePath = '/test/file.jsonl';

    mod.rememberHasMessages(filePath, makeStats(100, 1000), true);
    mod.rememberHasMessages(filePath, makeStats(200, 1000), false);
    mod.rememberHasMessages(filePath, makeStats(100, 2000), false);

    expect(mod.checkHasMessagesCache(filePath, makeStats(100, 1000))).toBe(true);
    expect(mod.checkHasMessagesCache(filePath, makeStats(200, 1000))).toBe(false);
    expect(mod.checkHasMessagesCache(filePath, makeStats(100, 2000))).toBe(false);
  });

  test('null filePath returns undefined from checkHasMessagesCache', () => {
    const result = mod.checkHasMessagesCache(null, makeStats(100, 1000));
    expect(result).toBeUndefined();
  });

  test('null filePath is a no-op for rememberHasMessages', () => {
    // Should not throw and subsequent check on null still returns undefined
    expect(() => {
      mod.rememberHasMessages(null, makeStats(100, 1000), true);
    }).not.toThrow();

    expect(mod.checkHasMessagesCache(null, makeStats(100, 1000))).toBeUndefined();
  });
});
