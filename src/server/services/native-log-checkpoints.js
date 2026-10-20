'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { CC_TOOL_BASE_DIR } = require('../../config/paths');
const cleanedDirectories = new Set();

function cleanAbandonedCheckpoints(root) {
  if (cleanedDirectories.has(root)) return;
  cleanedDirectories.add(root);
  for (const name of fs.readdirSync(root)) {
    const match = /^native-log-checkpoints-(\d+)-[a-f0-9-]+\.sqlite$/.exec(name);
    if (!match || Number(match[1]) === process.pid) continue;
    try { process.kill(Number(match[1]), 0); continue; } catch (error) {
      if (error.code !== 'ESRCH') continue;
    }
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(path.join(root, name + suffix)); } catch (_) {}
    }
  }
}


function createPersistenceRetryState() {
  let failures = 0;
  let nextRetryAt = 0;
  return {
    ready() { return Date.now() >= nextRetryAt; },
    failed() {
      failures += 1;
      nextRetryAt = Date.now() + Math.min(30_000, 1000 * (2 ** Math.min(failures - 1, 5)));
    },
    succeeded() { failures = 0; nextRetryAt = 0; },
    diagnostics() { return { persistenceBlocked: failures > 0, nextRetryAt, persistenceRetries: failures }; }
  };
}

const MAX_HOT_ENTRIES = 1024;
const MAX_HOT_BYTES = 2 * 1024 * 1024;

// Source databases remain read-only. Each cursor owns its scratch checkpoint
// database and deletes it on close; a fresh cursor still skips existing history.
function createNativeLogCheckpoints({ directory, maxEntries = MAX_HOT_ENTRIES, maxBytes = MAX_HOT_BYTES } = {}) {
  const root = directory || process.env.CC_TOOL_NATIVE_CHECKPOINT_DIR
    || (process.env.VITEST ? path.join(os.tmpdir(), 'cc-tool-native-checkpoints') : path.join(CC_TOOL_BASE_DIR, 'storage', 'runtime'));
  fs.mkdirSync(root, { recursive: true });
  cleanAbandonedCheckpoints(root);
  const filename = path.join(root, `native-log-checkpoints-${process.pid}-${crypto.randomUUID()}.sqlite`);
  const db = new DatabaseSync(filename);
  try {
    db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA cache_size = -2048;
      CREATE TABLE states (scope TEXT, key TEXT, value TEXT NOT NULL, source_data TEXT, related_data TEXT, PRIMARY KEY (scope, key));
      CREATE TABLE pending (seq INTEGER PRIMARY KEY, value TEXT NOT NULL);`);
  } catch (error) {
    try { db.close(); } catch (_) {}
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(filename + suffix); } catch (_) {}
    }
    throw error;
  }
  const select = db.prepare('SELECT value FROM states WHERE scope = ? AND key = ?');
  const insert = db.prepare('INSERT INTO states (scope, key, value, source_data, related_data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value, source_data = excluded.source_data, related_data = excluded.related_data');
  const append = db.prepare('INSERT INTO pending (value) VALUES (?)');
  const hot = new Map();
  let hotBytes = 0;
  let pendingCount = 0;
  let pendingBytes = 0;
  let closed = false;
  function remember(id, value) {
    const old = hot.get(id);
    if (old) hotBytes -= old.bytes;
    hot.delete(id);
    const bytes = Buffer.byteLength(id) + Buffer.byteLength(value);
    if (bytes > maxBytes) return;
    hot.set(id, { value, bytes });
    hotBytes += bytes;
    while (hot.size > maxEntries || hotBytes > maxBytes) {
      const first = hot.keys().next().value;
      hotBytes -= hot.get(first).bytes;
      hot.delete(first);
    }
  }
  const store = {
    attachReadOnly(connection) {
      const uri = require('url').pathToFileURL(filename);
      uri.searchParams.set('mode', 'ro');
      connection.prepare('ATTACH DATABASE ? AS native_checkpoints').run(uri.href);
      connection.exec('PRAGMA native_checkpoints.cache_size = -2048');
    },
    transaction(callback) {
      const oldPendingCount = pendingCount;
      const oldPendingBytes = pendingBytes;
      try { db.exec('BEGIN IMMEDIATE'); } catch (error) { error.checkpointPersistenceFailure = true; throw error; }
      try {
        const result = callback();
        try { db.exec('COMMIT'); } catch (error) { error.checkpointPersistenceFailure = true; throw error; }
        return result;
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch (_) {}
        hot.clear(); hotBytes = 0;
        pendingCount = oldPendingCount; pendingBytes = oldPendingBytes;
        throw error;
      }
    },
    get(scope, key) {
      const id = JSON.stringify([scope, key]);
      const value = hot.get(id)?.value ?? select.get(scope, key)?.value;
      if (value === undefined) return undefined;
      remember(id, value);
      return JSON.parse(value);
    },
    set(scope, key, value, source = {}) {
      const serialized = JSON.stringify(value);
      insert.run(scope, key, serialized, source.data ?? null, source.relatedData ?? null);
      remember(JSON.stringify([scope, key]), serialized);
    },
    deleteScope(scope) {
      db.prepare('DELETE FROM states WHERE scope = ?').run(scope);
      for (const id of hot.keys()) {
        if (JSON.parse(id)[0] !== scope) continue;
        hotBytes -= hot.get(id).bytes;
        hot.delete(id);
      }
    },
    enqueue(event) {
      const value = JSON.stringify(event);
      append.run(value);
      pendingCount += 1;
      pendingBytes += Buffer.byteLength(value);
    },
    drain(limit = 500) {
      const rows = db.prepare('SELECT seq, value FROM pending ORDER BY seq LIMIT ?').all(limit);
      if (!rows.length) return [];
      db.prepare('DELETE FROM pending WHERE seq <= ?').run(rows.at(-1).seq);
      pendingCount -= rows.length;
      for (const row of rows) pendingBytes -= Buffer.byteLength(row.value);
      return rows.map(row => JSON.parse(row.value));
    },
    diagnostics() { return { hotEntries: hot.size, hotBytes, pendingEvents: pendingCount, pendingBytes }; },
    reset() {
      db.exec('DELETE FROM states; DELETE FROM pending;');
      hot.clear(); hotBytes = 0; pendingCount = 0; pendingBytes = 0;
    },
    close() {
      if (closed) return;
      closed = true;
      db.close(); hot.clear(); hotBytes = 0; pendingCount = 0; pendingBytes = 0;
      for (const suffix of ['', '-wal', '-shm']) {
        try { fs.unlinkSync(filename + suffix); } catch (_) {}
      }
    }
  };
  for (const method of ['attachReadOnly', 'get', 'set', 'deleteScope', 'enqueue', 'drain', 'reset']) {
    const original = store[method];
    store[method] = (...args) => {
      try { return original(...args); } catch (error) {
        error.checkpointPersistenceFailure = true;
        throw error;
      }
    };
  }
  return store;
}

module.exports = { createNativeLogCheckpoints, createPersistenceRetryState, MAX_HOT_ENTRIES, MAX_HOT_BYTES };
