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

const snapshots = new Map();
const inflight = new Map();
const deferredQueue = [];
const lastErrors = new Map();
const invalidationVersions = new Map();
let deferredRunning = false;

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
    return snapshots.get(key);
  }
  const persisted = readPersistedSnapshot(key);
  if (persisted) {
    snapshots.set(key, persisted);
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

function getInvalidationVersion(key) {
  return invalidationVersions.get(key) || 0;
}

function bumpInvalidationVersion(key) {
  const nextVersion = getInvalidationVersion(key) + 1;
  invalidationVersions.set(key, nextVersion);
  return nextVersion;
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
  if (deferredRunning) return;
  const task = deferredQueue.shift();
  if (!task) return;

  deferredRunning = true;
  setTimeout(() => {
    Promise.resolve()
      .then(() => task.refresh())
      .then(task.resolve, task.reject)
      .finally(() => {
        deferredRunning = false;
        setTimeout(pumpDeferredQueue, task.gapMs);
      });
  }, task.delayMs);
}

function runDeferredRefresh(refresh, delayMs = DEFAULT_BACKGROUND_DELAY_MS, gapMs = DEFAULT_BACKGROUND_GAP_MS) {
  return new Promise((resolve, reject) => {
    deferredQueue.push({ refresh, resolve, reject, delayMs, gapMs });
    pumpDeferredQueue();
  });
}

function runRefresh(refresh, defer, deferMs) {
  if (!defer) {
    return Promise.resolve().then(() => refresh());
  }
  return runDeferredRefresh(refresh, deferMs);
}

function refreshSnapshot(key, refresh, {
  defer = false,
  deferMs = DEFAULT_BACKGROUND_DELAY_MS,
  bypassInflight = false
} = {}) {
  if (!bypassInflight && inflight.has(key)) {
    return inflight.get(key);
  }

  const startedVersion = bypassInflight ? bumpInvalidationVersion(key) : getInvalidationVersion(key);
  const promise = runRefresh(refresh, defer, deferMs)
    .then((value) => {
      const entry = makeEntry(key, value);
      if (getInvalidationVersion(key) === startedVersion) {
        snapshots.set(key, entry);
        lastErrors.delete(key);
        persistEntry(key, entry);
      }
      return entry;
    })
    .catch((error) => {
      const message = error?.message || String(error);
      const existing = getEntry(key);
      if (existing && getInvalidationVersion(key) === startedVersion) {
        const retained = {
          ...existing,
          lastError: message
        };
        snapshots.set(key, retained);
        lastErrors.set(key, message);
        persistEntry(key, retained);
      } else {
        lastErrors.set(key, message);
      }
      throw error;
    })
    .finally(() => {
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
      refreshPromise = refreshSnapshot(key, refresh, { bypassInflight: force });
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
        entry = await refreshSnapshot(key, refresh, { bypassInflight: force });
        expired = false;
      } catch (error) {
        refreshError = error?.message || String(error);
        entry = getEntry(key);
        if (!entry) throw error;
      }
    } else {
      refreshPromise = refreshSnapshot(key, refresh, { defer: !force, deferMs, bypassInflight: force });
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
  if (!keyOrPrefix) {
    for (const key of inflight.keys()) {
      bumpInvalidationVersion(key);
    }
    snapshots.clear();
    inflight.clear();
    lastErrors.clear();
    return;
  }

  const key = String(keyOrPrefix);
  snapshots.delete(key);
  inflight.delete(key);
  lastErrors.delete(key);
  bumpInvalidationVersion(key);
  for (const existingKey of Array.from(snapshots.keys())) {
    if (existingKey.startsWith(key)) {
      snapshots.delete(existingKey);
      lastErrors.delete(existingKey);
      bumpInvalidationVersion(existingKey);
    }
  }
  for (const existingKey of Array.from(inflight.keys())) {
    if (existingKey.startsWith(key)) {
      inflight.delete(existingKey);
      lastErrors.delete(existingKey);
      bumpInvalidationVersion(existingKey);
    }
  }

  try {
    const dir = getSnapshotDir();
    if (!fs.existsSync(dir)) return;
    const exactFile = getSnapshotPath(key);
    if (fs.existsSync(exactFile)) {
      fs.unlinkSync(exactFile);
    }
    const files = fs.readdirSync(dir).filter(file => file.endsWith('.json'));
    files.forEach((file) => {
      const filePath = path.join(dir, file);
      try {
        const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const persistedKey = typeof payload?.key === 'string' ? payload.key : '';
        if (persistedKey && persistedKey.startsWith(key)) {
          fs.unlinkSync(filePath);
          lastErrors.delete(persistedKey);
          bumpInvalidationVersion(persistedKey);
        }
      } catch {
        // Corrupt non-exact files cannot be matched to a prefix safely.
      }
    });
  } catch {
    // Best-effort invalidation; the in-memory state has already been cleared.
  }
}

function clearSnapshotCache({ deleteFiles = false } = {}) {
  for (const key of inflight.keys()) {
    bumpInvalidationVersion(key);
  }
  snapshots.clear();
  inflight.clear();
  lastErrors.clear();
  deferredQueue.splice(0, deferredQueue.length);
  deferredRunning = false;
  if (!deleteFiles) return;
  try {
    fs.rmSync(getSnapshotDir(), { recursive: true, force: true });
  } catch {
    // ignore cleanup failures in tests
  }
}

module.exports = {
  getSnapshot,
  refreshSnapshot,
  invalidateSnapshot,
  clearSnapshotCache,
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
