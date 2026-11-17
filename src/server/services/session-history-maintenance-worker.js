'use strict';

const fs = require('fs');
const path = require('path');
const { isMainThread, parentPort, workerData } = require('worker_threads');
const { DatabaseSync } = require('node:sqlite');

const MIN_FREE_BYTES = 256 * 1024 * 1024;
const MIN_FREE_RATIO = 0.2;
const PREVIEW_MAX_CHARS = 1024;
const DATA_MIGRATION_VERSION = 2;
const MIGRATION_BATCH_SIZE = 200;
const MIGRATION_YIELD_MS = 25;

const USER_ONLY_FTS_TRIGGERS = `
  DROP TRIGGER IF EXISTS session_message_fts_insert;
  DROP TRIGGER IF EXISTS session_message_fts_delete;
  DROP TRIGGER IF EXISTS session_message_fts_update;
  CREATE TRIGGER session_message_fts_insert AFTER INSERT ON session_message
  WHEN new.role = 'user'
  BEGIN
    INSERT INTO session_message_fts(rowid, content) VALUES (new.rowid, new.content);
  END;
  CREATE TRIGGER session_message_fts_delete AFTER DELETE ON session_message
  WHEN old.role = 'user'
  BEGIN
    INSERT INTO session_message_fts(session_message_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  END;
  CREATE TRIGGER session_message_fts_update AFTER UPDATE ON session_message BEGIN
    INSERT INTO session_message_fts(session_message_fts, rowid, content)
      SELECT 'delete', old.rowid, old.content WHERE old.role = 'user';
    INSERT INTO session_message_fts(rowid, content)
      SELECT new.rowid, new.content WHERE new.role = 'user';
  END;
`;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readPragmaNumber(db, name) {
  return Number(db.prepare(`PRAGMA ${name}`).get()?.[name]) || 0;
}

function inImmediateTransaction(db, work) {
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = work();
    db.exec('COMMIT;');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK;'); } catch (_) {}
    throw error;
  }
}

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(',');
}

async function truncatePreviews(db, table) {
  let changed = 0;
  let lastRowid = 0;
  while (true) {
    // Walk by rowid watermark: re-selecting from rowid 0 after each update
    // rescans every already-truncated row (quadratic on large tables).
    const rows = db.prepare(`
      SELECT rowid FROM ${table}
      WHERE rowid > ? AND first_message IS NOT NULL AND length(first_message) > ?
      ORDER BY rowid
      LIMIT ?
    `).all(lastRowid, PREVIEW_MAX_CHARS, MIGRATION_BATCH_SIZE);
    if (rows.length === 0) break;
    const ids = rows.map(row => row.rowid);
    inImmediateTransaction(db, () => {
      db.prepare(`
        UPDATE ${table}
        SET first_message = substr(first_message, 1, ?)
        WHERE rowid IN (${placeholders(ids.length)})
      `).run(PREVIEW_MAX_CHARS, ...ids);
    });
    lastRowid = ids[ids.length - 1];
    changed += rows.length;
    await sleep(MIGRATION_YIELD_MS);
  }
  return changed;
}

async function deleteOrphanMessages(db) {
  let deleted = 0;
  let lastRowid = 0;
  while (true) {
    const rows = db.prepare(`
      SELECT sm.rowid FROM session_message sm
      WHERE sm.rowid > ?
      AND NOT EXISTS (
        SELECT 1 FROM session_file sf
        WHERE sf.source = sm.source AND sf.session_id = sm.session_id
      )
      ORDER BY sm.rowid
      LIMIT ?
    `).all(lastRowid, MIGRATION_BATCH_SIZE);
    if (rows.length === 0) break;
    const ids = rows.map(row => row.rowid);
    inImmediateTransaction(db, () => {
      db.prepare(`
        DELETE FROM session_message WHERE rowid IN (${placeholders(ids.length)})
      `).run(...ids);
    });
    lastRowid = ids[ids.length - 1];
    deleted += rows.length;
    await sleep(MIGRATION_YIELD_MS);
  }
  return deleted;
}

async function clearAssistantContent(db, hasFts) {
  let cleared = 0;
  let lastRowid = 0;
  while (true) {
    const rows = db.prepare(`
      SELECT rowid, content FROM session_message
      WHERE rowid > ? AND COALESCE(role, '') <> 'user' AND content IS NOT NULL
      ORDER BY rowid
      LIMIT ?
    `).all(lastRowid, MIGRATION_BATCH_SIZE);
    if (rows.length === 0) break;
    inImmediateTransaction(db, () => {
      const deleteFts = hasFts
        ? db.prepare(`
          INSERT INTO session_message_fts(session_message_fts, rowid, content)
          VALUES ('delete', ?, ?)
        `)
        : null;
      const clearContent = db.prepare(
        'UPDATE session_message SET content = NULL WHERE rowid = ?'
      );
      for (const row of rows) {
        if (deleteFts) {
          try {
            deleteFts.run(row.rowid, row.content);
          } catch (_) {
            // A drifted FTS entry is dropped by the next maintenance optimize.
          }
        }
        clearContent.run(row.rowid);
      }
    });
    lastRowid = rows[rows.length - 1].rowid;
    cleared += rows.length;
    await sleep(MIGRATION_YIELD_MS);
  }
  return cleared;
}

/**
 * Background migration. Each batch is its own short transaction so normal
 * request writes can interleave; no global VACUUM is performed unless
 * CC_TOOL_SESSION_INDEX_VACUUM=1.
 */
async function migrateStoredData(db) {
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version) || 0;
  if (version >= DATA_MIGRATION_VERSION) {
    return { changed: 0, orphans: 0, cleared: 0, alreadyDone: true };
  }
  let changed = 0;
  let orphans = 0;
  let cleared = 0;

  if (version < 1) {
    changed += await truncatePreviews(db, 'session_summary');
    changed += await truncatePreviews(db, 'session_file');
    orphans = await deleteOrphanMessages(db);
  }

  if (version < 2) {
    const hasFts = db.prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'session_message_fts'"
    ).get();
    if (hasFts) {
      inImmediateTransaction(db, () => db.exec(USER_ONLY_FTS_TRIGGERS));
    }
    cleared = await clearAssistantContent(db, Boolean(hasFts));
    // FTS assistant entries were removed in the same batches as their content.
    // A full rebuild/optimize is deliberately deferred to avoid a long lock.
  }

  db.exec(`PRAGMA user_version = ${DATA_MIGRATION_VERSION};`);
  return { changed, orphans, cleared, alreadyDone: false };
}

function inspectDatabase(dbPath, db) {
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA cache_size = -16384;');
  const pageSize = readPragmaNumber(db, 'page_size');
  const pageCount = readPragmaNumber(db, 'page_count');
  const freePageCount = readPragmaNumber(db, 'freelist_count');
  const fileBytes = fs.statSync(dbPath).size;
  const freeBytes = pageSize * freePageCount;
  const pageBytes = pageSize * pageCount;

  if (freeBytes < MIN_FREE_BYTES || freeBytes < pageBytes * MIN_FREE_RATIO) {
    return { status: 'below-threshold', beforeBytes: fileBytes, freeBytes };
  }

  const disk = fs.statfsSync(path.dirname(dbPath));
  const availableBytes = Number(disk.bavail) * Number(disk.bsize);
  if (!Number.isFinite(availableBytes) || availableBytes < fileBytes) {
    return { status: 'insufficient-space', beforeBytes: fileBytes, freeBytes };
  }

  const checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  if (Number(checkpoint?.busy) > 0) {
    return { status: 'database-busy', beforeBytes: fileBytes, freeBytes };
  }

  return { status: 'ready', beforeBytes: fileBytes, freeBytes };
}

async function compactDatabase(dbPath) {
  if (!dbPath || !fs.existsSync(dbPath)) return { status: 'missing' };
  const db = new DatabaseSync(dbPath, { timeout: 5000 });
  try {
    const migration = await migrateStoredData(db);
    const beforeBytes = fs.statSync(dbPath).size;

    if (process.env.CC_TOOL_SESSION_INDEX_VACUUM !== '1') {
      return {
        status: 'migrated',
        beforeBytes,
        migration,
        vacuumSkipped: true
      };
    }

    const hasFts = db.prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'session_message_fts'"
    ).get();
    if (hasFts) {
      try {
        db.exec("INSERT INTO session_message_fts(session_message_fts) VALUES('optimize')");
      } catch (_) {
        // The vacuum below still reclaims content pages.
      }
    }

    const inspection = inspectDatabase(dbPath, db);
    if (inspection.status !== 'ready') return { ...inspection, migration };

    db.exec('VACUUM;');
    const checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    const afterBytes = fs.statSync(dbPath).size;
    return {
      status: 'compacted',
      beforeBytes: inspection.beforeBytes,
      afterBytes,
      reclaimedBytes: Math.max(0, inspection.beforeBytes - afterBytes),
      checkpointBusy: Number(checkpoint?.busy) > 0,
      migration
    };
  } finally {
    db.close();
  }
}

if (!isMainThread) {
  compactDatabase(workerData?.dbPath)
    .then(result => parentPort.postMessage({ type: 'done', result }))
    .catch(error => parentPort.postMessage({ type: 'error', error: error?.message || String(error) }))
    .finally(() => parentPort.close());
}

module.exports = {
  compactDatabase,
  migrateStoredData,
  clearAssistantContent,
  deleteOrphanMessages,
  truncatePreviews,
  PREVIEW_MAX_CHARS,
  DATA_MIGRATION_VERSION
};
