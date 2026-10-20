'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { PATHS } = require('../../config/paths');

const DEFAULT_TTL_MS = 60 * 1000;
const SNAPSHOT_VERSION = 1;
const DEFAULT_BACKGROUND_DELAY_MS = process.env.NODE_ENV === 'test' ? 0 : 750;
const DEFAULT_BACKGROUND_GAP_MS = process.env.NODE_ENV === 'test' ? 0 : 100;
const WAIT_TIMEOUT = Symbol('snapshot-wait-timeout');
const MAX_SNAPSHOTS = 64;
const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;
const MAX_REFRESHES = 64;

const snapshots = new Map();
const snapshotSizes = new WeakMap();
const inflight = new Map();
const deferredQueue = [];
const lastErrors = new Map();
// Tokens remain alive only for their refresh, including invalidated generations.
const activeRefreshes = new Set();
let snapshotBytes = 0;
let activeDeferredTask = null;
let deferredTimer = null;

function getSnapshotDir() {
  return PATHS.snapshotCache
    || path.join(PATHS.cache || path.join(PATHS.storage || os.tmpdir(), 'cache'), 'snapshots');
}

function cloneJson(value) {
  if (value === undefined) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function encodeKey(key) {
  return Buffer.from(String(key)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function getSnapshotPath(key) {
  return path.join(getSnapshotDir(), `${encodeKey(key)}.json`);
}

function normalizeEntry(key, payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (!Object.prototype.hasOwnProperty.call(payload, 'value')) return null;
  const updatedAtMs = Number(payload.updatedAtMs || Date.parse(payload.generatedAt || ''));
  return {
    key,
    value: cloneJson(payload.value),
    generatedAt: payload.generatedAt || (Number.isFinite(updatedAtMs) ? new Date(updatedAtMs).toISOString() : null),
    updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : 0,
    lastError: typeof payload.lastError === 'string' ? payload.lastError : null
  };
}

function readPersistedSnapshot(key) {
  try {
    const filePath = getSnapshotPath(key);
    if (!fs.existsSync(filePath)) return null;
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return normalizeEntry(key, payload);
  } catch {
    return null;
  }
}

function getEntry(key) {
  if (snapshots.has(key)) {
    const entry = snapshots.get(key);
    snapshots.delete(key);
    snapshots.set(key, entry);
    return entry;
  }
  const persisted = readPersistedSnapshot(key);
  if (persisted) {
    cacheEntry(key, persisted);
  }
  return persisted;
}

function persistEntry(key, entry) {
  try {
    const filePath = getSnapshotPath(key);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify({
      version: SNAPSHOT_VERSION,
      key,
      value: entry.value,
      generatedAt: entry.generatedAt,
      updatedAtMs: entry.updatedAtMs,
      lastError: entry.lastError || null
    }, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch {
    // Persistence is an optimization; in-memory snapshots still protect the request path.
  }
}

function deleteCachedEntry(key) {
  const entry = snapshots.get(key);
  if (!entry) return;
  snapshotBytes -= snapshotSizes.get(entry) || 0;
  snapshots.delete(key);
}

function cacheEntry(key, entry) {
  deleteCachedEntry(key);
  const bytes = Buffer.byteLength(JSON.stringify(entry), 'utf8');
  if (bytes > MAX_SNAPSHOT_BYTES) return;
  snapshotSizes.set(entry, bytes);
  snapshots.set(key, entry);
  snapshotBytes += bytes;
  while (snapshots.size > MAX_SNAPSHOTS || snapshotBytes > MAX_SNAPSHOT_BYTES) {
    const oldest = snapshots.keys().next().value;
    deleteCachedEntry(oldest);
    lastErrors.delete(oldest);
  }
}

function rememberError(key, message) {
  lastErrors.delete(key);
  lastErrors.set(key, String(message).slice(0, 2048));
  while (lastErrors.size > MAX_SNAPSHOTS) lastErrors.delete(lastErrors.keys().next().value);
}

function cancelRefreshes(matches) {
  for (const token of activeRefreshes) {
    if (!matches(token.key)) continue;
    token.invalidated = true;
    token.cancel?.();
  }
}

function makeEntry(key, value, nowMs = Date.now()) {
  return {
    key,
    value: cloneJson(value),
    generatedAt: new Date(nowMs).toISOString(),
    updatedAtMs: nowMs,
    lastError: null
  };
}

function pumpDeferredQueue() {
  if (activeDeferredTask) return;
  const task = deferredQueue.shift();
  if (!task) return;
  activeDeferredTask = task;
  deferredTimer = setTimeout(() => {
    deferredTimer = null;
    task.started = true;
    Promise.resolve()
      .then(task.refresh)
      .then(task.resolve, task.reject)
      .finally(() => {
        activeDeferredTask = null;
        setTimeout(pumpDeferredQueue, task.gapMs);
      });
  }, task.delayMs);
}

function runRefresh(refresh, defer, deferMs, token) {
  if (!defer) return Promise.resolve().then(refresh);
  return new Promise((resolve, reject) => {
    const task = { refresh, resolve, reject, delayMs: deferMs, gapMs: DEFAULT_BACKGROUND_GAP_MS, started: false };
    token.cancel = () => {
      if (task.started) return;
      const index = deferredQueue.indexOf(task);
      if (index >= 0) deferredQueue.splice(index, 1);
      if (activeDeferredTask === task) {
        clearTimeout(deferredTimer);
        deferredTimer = null;
        activeDeferredTask = null;
      }
      reject(new Error('Snapshot refresh cancelled'));
      pumpDeferredQueue();
    };
    deferredQueue.push(task);
    pumpDeferredQueue();
  });
}

function refreshSnapshot(key, refresh, {
  defer = false,
  deferMs = DEFAULT_BACKGROUND_DELAY_MS
} = {}) {
  if (inflight.has(key)) {
    return inflight.get(key);
  }

  if (activeRefreshes.size >= MAX_REFRESHES) {
    const error = new Error('Snapshot refresh capacity reached');
    rememberError(key, error.message);
    const rejected = Promise.reject(error);
    rejected.catch(() => {});
    return rejected;
  }
  const token = { key, invalidated: false };
  activeRefreshes.add(token);
  const promise = runRefresh(refresh, defer, deferMs, token)
    .then((value) => {
      let nextValue = value;
      const existing = token.invalidated ? null : getEntry(key);
      if (value && Array.isArray(value.__errors) && existing?.value && typeof existing.value === 'object') {
        nextValue = { ...existing.value, ...value };
        for (const failure of value.__errors) {
          const capability = failure?.capability === 'statistics' ? 'todayStats' : failure?.capability;
          if (capability && Object.prototype.hasOwnProperty.call(existing.value, capability)) {
            nextValue[capability] = existing.value[capability];
          }
        }
      }
      const entry = makeEntry(key, nextValue);
      if (!token.invalidated) {
        cacheEntry(key, entry);
        lastErrors.delete(key);
        persistEntry(key, entry);
      }
      return entry;
    })
    .catch((error) => {
      const message = String(error?.message || error).slice(0, 2048);
      const existing = token.invalidated ? null : getEntry(key);
      if (existing && !token.invalidated) {
        const retained = {
          ...existing,
          lastError: message
        };
        cacheEntry(key, retained);
        rememberError(key, message);
        persistEntry(key, retained);
      } else if (!token.invalidated) {
        rememberError(key, message);
      }
      throw error;
    })
    .finally(() => {
      activeRefreshes.delete(token);
      if (inflight.get(key) === promise) {
        inflight.delete(key);
      }
    });

  inflight.set(key, promise);
  promise.catch(() => {});
  return promise;
}

function isExpired(entry, ttlMs, nowMs) {
  if (!entry) return true;
  return nowMs - Number(entry.updatedAtMs || 0) >= ttlMs;
}

async function waitForRefresh(promise, waitMs) {
  const timeoutMs = Number(waitMs) || 0;
  if (timeoutMs <= 0) return { skipped: true };

  let timer = null;
  const result = await Promise.race([
    promise
      .then(entry => ({ entry }))
      .catch(error => ({ error })),
    new Promise(resolve => {
      timer = setTimeout(() => resolve(WAIT_TIMEOUT), timeoutMs);
    })
  ]);
  if (timer) {
    clearTimeout(timer);
  }
  if (result === WAIT_TIMEOUT) {
    return { timedOut: true };
  }
  return result;
}

function makeMeta(entry, {
  key,
  stale,
  refreshing,
  fallback,
  error
}) {
  return {
    generatedAt: entry?.generatedAt || null,
    stale: Boolean(stale),
    refreshing: Boolean(refreshing),
    fallback: Boolean(fallback),
    error: error || entry?.lastError || lastErrors.get(entry?.key || key) || null
  };
}

async function getSnapshot(key, {
  ttlMs = DEFAULT_TTL_MS,
  fallbackValue = null,
  refresh,
  backgroundOnMiss = true,
  force = false,
  staleWhileForce = false,
  nowMs = Date.now(),
  deferMs = DEFAULT_BACKGROUND_DELAY_MS,
  waitOnMissMs = 0,
  waitOnForceMs = 0
} = {}) {
  if (typeof refresh !== 'function') {
    const entry = getEntry(key);
    return {
      value: cloneJson(entry ? entry.value : fallbackValue),
      meta: makeMeta(entry, {
        key,
        stale: !entry,
        refreshing: false,
        fallback: !entry
      })
    };
  }

  let entry = force && !staleWhileForce ? null : getEntry(key);
  let expired = force || isExpired(entry, ttlMs, nowMs);
  let refreshPromise = null;
  let refreshError = null;

  if (expired) {
    const coldWaitMs = !entry
      ? (force ? (waitOnForceMs || waitOnMissMs) : waitOnMissMs)
      : 0;

    if (!entry && Number(coldWaitMs) > 0) {
      refreshPromise = refreshSnapshot(key, refresh);
      const waitResult = await waitForRefresh(refreshPromise, coldWaitMs);
      if (waitResult.entry) {
        entry = waitResult.entry;
        expired = false;
        refreshPromise = null;
      } else if (waitResult.error) {
        refreshError = waitResult.error?.message || String(waitResult.error);
        entry = getEntry(key);
        if (entry) {
          expired = isExpired(entry, ttlMs, nowMs);
        }
        refreshPromise = null;
      }
    } else if (!entry && backgroundOnMiss === false) {
      try {
        entry = await refreshSnapshot(key, refresh);
        expired = false;
      } catch (error) {
        refreshError = error?.message || String(error);
        entry = getEntry(key);
        if (!entry) throw error;
      }
    } else {
      refreshPromise = refreshSnapshot(key, refresh, { defer: !force, deferMs });
    }
  }

  const hasEntry = Boolean(entry);
  return {
    value: cloneJson(hasEntry ? entry.value : fallbackValue),
    meta: makeMeta(entry, {
      key,
      stale: !hasEntry || expired,
      refreshing: Boolean(refreshPromise || inflight.has(key)),
      fallback: !hasEntry,
      error: refreshError
    })
  };
}

function invalidateSnapshot(keyOrPrefix) {
  const prefix = keyOrPrefix ? String(keyOrPrefix) : null;
  const matches = key => !prefix || key.startsWith(prefix);
  cancelRefreshes(matches);
  for (const key of snapshots.keys()) if (matches(key)) deleteCachedEntry(key);
  for (const key of inflight.keys()) if (matches(key)) inflight.delete(key);
  for (const key of lastErrors.keys()) if (matches(key)) lastErrors.delete(key);

  try {
    const dir = getSnapshotDir();
    if (!fs.existsSync(dir)) return;
    // Encoded filenames already carry the key; never load large snapshots just to invalidate them.
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const persistedKey = Buffer.from(file.slice(0, -5).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
      if (matches(persistedKey)) fs.unlinkSync(path.join(dir, file));
    }
  } catch {
    // Best-effort invalidation; the in-memory state has already been cleared.
  }
}

function dashboardSourceKey(source) {
  return `dashboard:source:${source}`;
}

function invalidateDashboardSourceSnapshot(source) {
  if (source) {
    invalidateSnapshot(dashboardSourceKey(source));
  }
}

function clearSnapshotCache({ deleteFiles = false } = {}) {
  cancelRefreshes(() => true);
  snapshots.clear();
  snapshotBytes = 0;
  inflight.clear();
  lastErrors.clear();
  if (!deleteFiles) return;
  try {
    fs.rmSync(getSnapshotDir(), { recursive: true, force: true });
  } catch {
    // ignore cleanup failures in tests
  }
}

function getSnapshotCacheDiagnostics() {
  return {
    entries: snapshots.size,
    bytes: snapshotBytes,
    errors: lastErrors.size,
    activeRefreshes: activeRefreshes.size,
    queuedRefreshes: deferredQueue.length + (activeDeferredTask && !activeDeferredTask.started ? 1 : 0)
  };
}

module.exports = {
  getSnapshot,
  getSnapshotCacheDiagnostics,
  refreshSnapshot,
  invalidateSnapshot,
  clearSnapshotCache,
  dashboardSourceKey,
  invalidateDashboardSourceSnapshot,
  _test: {
    getSnapshotDir,
    getSnapshotPath,
    encodeKey,
    readPersistedSnapshot,
    getEntry,
    inflight,
    snapshots,
    deferredQueue
  }
};
