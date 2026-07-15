'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVICE_PATH = require.resolve('../../../src/server/services/snapshot-cache');
const PATHS_PATH = require.resolve('../../../src/config/paths');

function sleep(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadService() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-cache-test-'));
  delete require.cache[SERVICE_PATH];
  delete require.cache[PATHS_PATH];
  require.cache[PATHS_PATH] = {
    id: PATHS_PATH,
    filename: PATHS_PATH,
    loaded: true,
    exports: {
      PATHS: {
        storage: tempDir,
        cache: path.join(tempDir, 'cache'),
        snapshotCache: path.join(tempDir, 'cache', 'snapshots')
      }
    }
  };
  return {
    service: require(SERVICE_PATH),
    tempDir
  };
}

describe('snapshot-cache service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete require.cache[SERVICE_PATH];
    delete require.cache[PATHS_PATH];
  });

  test('returns fallback immediately on cold miss and hydrates in the background', async () => {
    const { service } = loadService();
    const refresh = vi.fn(() => ({ count: 1 }));

    const first = await service.getSnapshot('cold', {
      ttlMs: 1000,
      fallbackValue: { count: 0 },
      refresh
    });

    expect(first.value).toEqual({ count: 0 });
    expect(first.meta).toMatchObject({ stale: true, refreshing: true, fallback: true });
    expect(refresh).not.toHaveBeenCalled();

    await sleep(10);
    const second = await service.getSnapshot('cold', {
      ttlMs: 1000,
      fallbackValue: { count: 0 },
      refresh
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(second.value).toEqual({ count: 1 });
    expect(second.meta.stale).toBe(false);
  });

  test('waits briefly for a cold miss when requested', async () => {
    const { service } = loadService();
    const refresh = vi.fn(async () => {
      await sleep(1);
      return { count: 1 };
    });

    const result = await service.getSnapshot('cold-wait', {
      ttlMs: 1000,
      fallbackValue: { count: 0 },
      refresh,
      waitOnMissMs: 50
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result.value).toEqual({ count: 1 });
    expect(result.meta).toMatchObject({ stale: false, refreshing: false, fallback: false });
  });

  test('falls back when the cold miss wait budget is exceeded', async () => {
    const { service } = loadService();
    let resolveRefresh;
    const refresh = vi.fn(() => new Promise(resolve => {
      resolveRefresh = resolve;
    }));

    const first = await service.getSnapshot('cold-wait-timeout', {
      ttlMs: 1000,
      fallbackValue: { count: 0 },
      refresh,
      waitOnMissMs: 5
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(first.value).toEqual({ count: 0 });
    expect(first.meta).toMatchObject({ stale: true, refreshing: true, fallback: true });

    resolveRefresh({ count: 2 });
    await sleep(10);

    const second = await service.getSnapshot('cold-wait-timeout', {
      ttlMs: 1000,
      fallbackValue: { count: 0 },
      refresh
    });

    expect(second.value).toEqual({ count: 2 });
    expect(second.meta).toMatchObject({ stale: false, refreshing: false, fallback: false });
  });

  test('uses TTL hits without refreshing', async () => {
    const { service } = loadService();
    const refresh = vi.fn(() => ({ value: 'fresh' }));

    const first = await service.getSnapshot('ttl-hit', {
      fallbackValue: null,
      refresh,
      backgroundOnMiss: false
    });
    const second = await service.getSnapshot('ttl-hit', {
      ttlMs: 60 * 1000,
      fallbackValue: null,
      refresh
    });

    expect(first.value).toEqual({ value: 'fresh' });
    expect(second.value).toEqual({ value: 'fresh' });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(second.meta.refreshing).toBe(false);
  });

  test('returns stale values while a single background refresh is in flight', async () => {
    const { service } = loadService();
    const refresh = vi.fn()
      .mockReturnValueOnce({ version: 1 })
      .mockReturnValueOnce({ version: 2 });

    await service.getSnapshot('stale', {
      fallbackValue: null,
      refresh,
      backgroundOnMiss: false
    });

    const staleA = await service.getSnapshot('stale', {
      ttlMs: -1,
      fallbackValue: null,
      refresh
    });
    const staleB = await service.getSnapshot('stale', {
      ttlMs: -1,
      fallbackValue: null,
      refresh
    });

    expect(staleA.value).toEqual({ version: 1 });
    expect(staleA.meta).toMatchObject({ stale: true, refreshing: true, fallback: false });
    expect(staleB.value).toEqual({ version: 1 });
    expect(refresh).toHaveBeenCalledTimes(1);

    await sleep(10);
    const fresh = await service.getSnapshot('stale', {
      ttlMs: 1000,
      fallbackValue: null,
      refresh
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(fresh.value).toEqual({ version: 2 });
  });

  test('keeps the previous snapshot when refresh fails', async () => {
    const { service } = loadService();
    const refresh = vi.fn()
      .mockReturnValueOnce({ ok: true })
      .mockImplementationOnce(() => {
        throw new Error('upstream failed');
      });

    await service.getSnapshot('failure', {
      fallbackValue: null,
      refresh,
      backgroundOnMiss: false
    });

    const stale = await service.getSnapshot('failure', {
      ttlMs: -1,
      fallbackValue: null,
      refresh
    });
    expect(stale.value).toEqual({ ok: true });

    await sleep(10);
    const retained = await service.getSnapshot('failure', {
      ttlMs: 1000,
      fallbackValue: null,
      refresh
    });
    expect(retained.value).toEqual({ ok: true });
    expect(retained.meta.error).toBe('upstream failed');
  });

  test('persists snapshots and ignores corrupt files', async () => {
    let loaded = loadService();
    await loaded.service.getSnapshot('persisted', {
      fallbackValue: null,
      refresh: () => ({ value: 42 }),
      backgroundOnMiss: false
    });

    delete require.cache[SERVICE_PATH];
    const reloaded = require(SERVICE_PATH);
    const fromDisk = await reloaded.getSnapshot('persisted', {
      fallbackValue: null
    });
    expect(fromDisk.value).toEqual({ value: 42 });

    const corruptPath = reloaded._test.getSnapshotPath('corrupt');
    fs.mkdirSync(path.dirname(corruptPath), { recursive: true });
    fs.writeFileSync(corruptPath, '{not-json', 'utf8');
    const corrupt = await reloaded.getSnapshot('corrupt', {
      fallbackValue: { empty: true }
    });
    expect(corrupt.value).toEqual({ empty: true });
    expect(corrupt.meta.fallback).toBe(true);
  });

  test('removes persisted snapshots when invalidating a key prefix', async () => {
    const loaded = loadService();
    await loaded.service.getSnapshot('sessions:list:claude:project-a', {
      fallbackValue: null,
      refresh: () => ({ sessions: [{ id: 'old' }] }),
      backgroundOnMiss: false
    });

    loaded.service.invalidateSnapshot('sessions:list:claude:');
    delete require.cache[SERVICE_PATH];
    const reloaded = require(SERVICE_PATH);
    const result = await reloaded.getSnapshot('sessions:list:claude:project-a', {
      fallbackValue: { sessions: [] }
    });

    expect(result.value).toEqual({ sessions: [] });
    expect(result.meta).toMatchObject({ stale: true, fallback: true });
  });

  test('surfaces refresh errors even when a cold miss has no previous snapshot', async () => {
    const { service } = loadService();
    const refresh = vi.fn(() => {
      throw new Error('worker failed');
    });

    const first = await service.getSnapshot('cold-failure', {
      fallbackValue: { items: [] },
      refresh
    });
    expect(first.value).toEqual({ items: [] });
    expect(first.meta).toMatchObject({ stale: true, refreshing: true, fallback: true, error: null });

    await sleep(10);
    const second = await service.getSnapshot('cold-failure', {
      fallbackValue: { items: [] },
      refresh
    });

    expect(second.value).toEqual({ items: [] });
    expect(second.meta).toMatchObject({ stale: true, fallback: true, error: 'worker failed' });
  });
});
