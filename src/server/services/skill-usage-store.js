'use strict';

/**
 * Skill usage ledger.
 *
 * Append-only by contract: events are never deleted or rewritten, so a count
 * cannot go down when transcripts are pruned or the index cache is cleared.
 * The database lives under storage/, not cache/.
 */

const { openDatabase } = require('./sqlite-connection');
const { PATHS } = require('../../config/paths');

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS usage_event (
  event_key         TEXT PRIMARY KEY,
  platform          TEXT NOT NULL,
  session_id        TEXT NOT NULL,
  turn_key          TEXT,
  call_id           TEXT,
  extractor_version INTEGER NOT NULL DEFAULT 1,
  raw_name          TEXT,
  normalized_name   TEXT NOT NULL,
  base_name         TEXT,
  raw_target        TEXT,
  skill_root        TEXT,
  session_cwd       TEXT,
  occurred_at       INTEGER,
  inserted_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS usage_event_skill
  ON usage_event(platform, normalized_name, occurred_at);

CREATE TABLE IF NOT EXISTS skill_observation (
  platform        TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  first_seen_at   INTEGER NOT NULL,
  PRIMARY KEY (platform, normalized_name)
);

CREATE TABLE IF NOT EXISTS usage_scan_state (
  platform                TEXT PRIMARY KEY,
  coverage_start          INTEGER,
  coverage_end            INTEGER,
  status                  TEXT NOT NULL DEFAULT 'idle',
  parse_failures          INTEGER NOT NULL DEFAULT 0,
  non_skill_calls         INTEGER NOT NULL DEFAULT 0,
  unresolved_skill_reads  INTEGER NOT NULL DEFAULT 0,
  skill_events            INTEGER NOT NULL DEFAULT 0,
  calibration_positive_at INTEGER,
  updated_at              INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_cursor (
  platform       TEXT NOT NULL,
  session_id     TEXT NOT NULL,
  size           INTEGER NOT NULL DEFAULT 0,
  mtime_ms       INTEGER NOT NULL DEFAULT 0,
  parser_version INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'pending',
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (platform, session_id)
);
`;

function createSkillUsageStore(options = {}) {
  const dbPath = options.dbPath || PATHS.skillUsageIndex;
  const db = openDatabase(dbPath);
  db.exec(SCHEMA_SQL);
  try {
    const row = db.prepare('PRAGMA user_version').get();
    const version = Number(row?.user_version || 0);
    if (version < SCHEMA_VERSION) {
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }
  } catch (_) {
    // user_version is best effort
  }

  const insertEventStmt = db.prepare(`
    INSERT OR IGNORE INTO usage_event (
      event_key, platform, session_id, turn_key, call_id, extractor_version,
      raw_name, normalized_name, base_name, raw_target, skill_root,
      session_cwd, occurred_at, inserted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const selectByNamesSql = `SELECT platform, normalized_name, turn_key, call_id, occurred_at, skill_root
    FROM usage_event WHERE normalized_name IN (__NAMES__)`;

  const cursorStmt = db.prepare(
    'SELECT size, mtime_ms, parser_version, status FROM usage_cursor WHERE platform = ? AND session_id = ?'
  );
  const upsertCursorStmt = db.prepare(`
    INSERT INTO usage_cursor (platform, session_id, size, mtime_ms, parser_version, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(platform, session_id) DO UPDATE SET
      size = excluded.size,
      mtime_ms = excluded.mtime_ms,
      parser_version = excluded.parser_version,
      status = excluded.status,
      updated_at = excluded.updated_at
  `);

  const scanStateStmt = db.prepare('SELECT * FROM usage_scan_state WHERE platform = ?');
  const upsertScanStateStmt = db.prepare(`
    INSERT INTO usage_scan_state (
      platform, coverage_start, coverage_end, status, parse_failures,
      non_skill_calls, unresolved_skill_reads, skill_events,
      calibration_positive_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(platform) DO UPDATE SET
      coverage_start = excluded.coverage_start,
      coverage_end = excluded.coverage_end,
      status = excluded.status,
      parse_failures = excluded.parse_failures,
      non_skill_calls = excluded.non_skill_calls,
      unresolved_skill_reads = excluded.unresolved_skill_reads,
      skill_events = excluded.skill_events,
      calibration_positive_at = excluded.calibration_positive_at,
      updated_at = excluded.updated_at
  `);

  const insertObservationStmt = db.prepare(`
    INSERT OR IGNORE INTO skill_observation (platform, normalized_name, first_seen_at)
    VALUES (?, ?, ?)
  `);

  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
  }

  function insertEvents(events = []) {
    if (!Array.isArray(events) || events.length === 0) return 0;
    return transaction(() => {
      let inserted = 0;
      for (const event of events) {
        const occurredAt = Number.isFinite(event.occurredAt) ? event.occurredAt : null;
        const result = insertEventStmt.run(
          event.eventKey,
          event.platform,
          event.sessionId,
          event.turnKey || null,
          event.callId || null,
          Number.isInteger(event.extractorVersion) ? event.extractorVersion : 1,
          event.rawName || null,
          event.normalizedName,
          event.baseName || null,
          event.rawTarget || null,
          event.skillRoot || null,
          event.sessionCwd || null,
          occurredAt,
          Date.now()
        );
        inserted += Number(result.changes || 0);
      }
      return inserted;
    });
  }

  function queryUsage({ names = [] } = {}) {
    const unique = [...new Set(names.filter(Boolean))];
    if (unique.length === 0) return [];
    const placeholders = unique.map(() => '?').join(', ');
    const sql = selectByNamesSql.replace('__NAMES__', placeholders);
    return db.prepare(sql).all(...unique);
  }

  function getCursor(platform, sessionId) {
    const row = cursorStmt.get(platform, sessionId);
    if (!row) return null;
    return {
      size: Number(row.size) || 0,
      mtimeMs: Number(row.mtime_ms) || 0,
      parserVersion: Number(row.parser_version) || 0,
      status: row.status
    };
  }

  function upsertCursor(platform, sessionId, patch = {}) {
    upsertCursorStmt.run(
      platform,
      sessionId,
      Number(patch.size) || 0,
      Number(patch.mtimeMs) || 0,
      Number(patch.parserVersion) || 0,
      patch.status || 'pending',
      Date.now()
    );
  }

  function getCursorStats(platform) {
    const row = db.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
      FROM usage_cursor WHERE platform = ?
    `).get(platform);
    return {
      totalSessions: Number(row?.total) || 0,
      doneSessions: Number(row?.done) || 0
    };
  }

  function getDoneSessionIds(platform) {
    const rows = db.prepare(
      "SELECT session_id FROM usage_cursor WHERE platform = ? AND status = 'done'"
    ).all(platform);
    return rows.map(row => row.session_id);
  }

  function getScanState(platform) {
    const row = scanStateStmt.get(platform);
    if (!row) return null;
    return {
      platform: row.platform,
      coverageStart: row.coverage_start != null ? Number(row.coverage_start) : null,
      coverageEnd: row.coverage_end != null ? Number(row.coverage_end) : null,
      status: row.status,
      parseFailures: Number(row.parse_failures) || 0,
      nonSkillCalls: Number(row.non_skill_calls) || 0,
      unresolvedSkillReads: Number(row.unresolved_skill_reads) || 0,
      skillEvents: Number(row.skill_events) || 0,
      calibrationPositiveAt: row.calibration_positive_at != null
        ? Number(row.calibration_positive_at)
        : null,
      updatedAt: row.updated_at != null ? Number(row.updated_at) : null
    };
  }

  function upsertScanState(platform, patch = {}) {
    const current = getScanState(platform) || {
      coverageStart: null,
      coverageEnd: null,
      status: 'idle',
      parseFailures: 0,
      nonSkillCalls: 0,
      unresolvedSkillReads: 0,
      skillEvents: 0,
      calibrationPositiveAt: null
    };
    upsertScanStateStmt.run(
      platform,
      patch.coverageStart !== undefined ? patch.coverageStart : current.coverageStart,
      patch.coverageEnd !== undefined ? patch.coverageEnd : current.coverageEnd,
      patch.status || current.status,
      patch.parseFailures !== undefined ? patch.parseFailures : current.parseFailures,
      patch.nonSkillCalls !== undefined ? patch.nonSkillCalls : current.nonSkillCalls,
      patch.unresolvedSkillReads !== undefined ? patch.unresolvedSkillReads : current.unresolvedSkillReads,
      patch.skillEvents !== undefined ? patch.skillEvents : current.skillEvents,
      patch.calibrationPositiveAt !== undefined ? patch.calibrationPositiveAt : current.calibrationPositiveAt,
      Date.now()
    );
  }

  function insertObservation(platform, normalizedName, firstSeenAt) {
    insertObservationStmt.run(platform, normalizedName, firstSeenAt);
  }

  function getObservations(platform, names = []) {
    const unique = [...new Set(names.filter(Boolean))];
    if (unique.length === 0) return new Map();
    const placeholders = unique.map(() => '?').join(', ');
    const sql = `SELECT normalized_name, first_seen_at FROM skill_observation
      WHERE platform = ? AND normalized_name IN (${placeholders})`;
    const rows = db.prepare(sql).all(platform, ...unique);
    return new Map(rows.map(row => [row.normalized_name, Number(row.first_seen_at)]));
  }

  return {
    dbPath,
    db,
    insertEvents,
    queryUsage,
    getCursor,
    upsertCursor,
    getCursorStats,
    getDoneSessionIds,
    getScanState,
    upsertScanState,
    insertObservation,
    getObservations
  };
}

module.exports = { createSkillUsageStore, SCHEMA_VERSION };
