'use strict';

const { openDatabase, closeDatabase } = require('./sqlite-connection');

const { PATHS } = require('../../config/paths');
const platformRuntime = require('../../platforms/runtime');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** @type {number} Maximum time a source inventory is considered fresh */
const INDEX_INVENTORY_TTL_MS = 30000;

/** @type {number} Max wait for stale-ok on a cold source */
const COLD_STALE_WAIT_MS = 2500;

/** @type {number} Hard timeout for worker processes */
const WORKER_TIMEOUT_MS = 180000;

const BUILTIN_SESSION_SOURCES = new Set(['claude', 'codex', 'gemini', 'omp']);

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS source_state (
  source            TEXT PRIMARY KEY,
  last_inventory_ms INTEGER,
  last_error        TEXT
);

CREATE TABLE IF NOT EXISTS session_file (
  source               TEXT NOT NULL,
  file_path            TEXT NOT NULL,
  size                 INTEGER NOT NULL DEFAULT 0,
  mtime_ms             INTEGER NOT NULL DEFAULT 0,
  session_id           TEXT NOT NULL,
  project_name         TEXT NOT NULL,
  project_display_name TEXT,
  project_full_path    TEXT,
  first_message        TEXT,
  git_branch           TEXT,
  provider             TEXT,
  model                TEXT,
  started_at           INTEGER,
  updated_at           INTEGER,
  message_count        INTEGER NOT NULL DEFAULT 0,
  usage_json           TEXT,
  extra_json           TEXT,
  PRIMARY KEY (source, file_path),
  UNIQUE (source, session_id)
);

CREATE INDEX IF NOT EXISTS idx_session_file_project
  ON session_file(source, project_name, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_session_file_sid
  ON session_file(source, session_id);

CREATE TABLE IF NOT EXISTS session_message (
  source              TEXT NOT NULL,
  session_id          TEXT NOT NULL,
  ordinal             INTEGER NOT NULL,
  message_id          TEXT,
  role                TEXT,
  type                TEXT,
  subtype             TEXT,
  content             TEXT,
  timestamp           INTEGER,
  model               TEXT,
  provider            TEXT,
  user_message_number INTEGER,
  extra_json          TEXT,
  PRIMARY KEY (source, session_id, ordinal),
  FOREIGN KEY (source, session_id) REFERENCES session_file(source, session_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_message_sid_ord
  ON session_message(source, session_id, ordinal);
`;

const FTS_SETUP_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS session_message_fts USING fts5(
  content,
  content='session_message',
  content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS session_message_fts_insert AFTER INSERT ON session_message BEGIN
  INSERT INTO session_message_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS session_message_fts_delete AFTER DELETE ON session_message BEGIN
  INSERT INTO session_message_fts(session_message_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS session_message_fts_update AFTER UPDATE ON session_message BEGIN
  INSERT INTO session_message_fts(session_message_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO session_message_fts(rowid, content) VALUES (new.rowid, new.content);
END;
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * @returns {boolean}
 */
function _detectFts5(db) {
  try {
    const rows = db.prepare('SELECT 1 FROM pragma_compile_options WHERE compile_options = ?').all('ENABLE_FTS5');
    return rows.length > 0;
  } catch (_err) {
    return false;
  }
}

/**
 * Normalize page/limit/order defaults matching current route behavior.
 * @param {{ page?: number, limit?: number, order?: string }} options
 * @returns {{ page: number, limit: number, order: 'ASC'|'DESC' }}
 */
function _normalizePageOpts(options = {}) {
  let page = Number(options.page) || 1;
  let limit = Number(options.limit) || 20;
  const order = options.order === 'asc' ? 'ASC' : 'DESC';
  if (page < 1) page = 1;
  if (limit < 1) limit = 1;
  if (limit > 200) limit = 200;
  return { page, limit, order };
}

/**
 * Double embedded quotes in a string for FTS5 MATCH.
 * @param {string} s
 * @returns {string}
 */
function _ftsQuote(s) {
  return '"' + String(s).replace(/"/g, '""') + '"';
}

function _isTypedSessionsResult(result) {
  return !!result && typeof result === 'object'
    && (result.status === 'failed' || result.status === 'unsupported')
    && typeof result.platform === 'string'
    && typeof result.capability === 'string'
    && typeof result.operation === 'string';
}

function _typedSessionsFailure(source, error, operation = 'resolve-driver') {
  const result = {
    status: 'failed',
    platform: source,
    capability: 'sessions',
    operation,
    error: error && error.message ? error.message : String(error)
  };
  if (error) {
    Object.defineProperty(result, 'cause', { value: error, enumerable: false });
  }
  return result;
}

function _typedSessionsUnsupported(source, error, operation = 'resolve-driver') {
  const result = {
    status: 'unsupported',
    platform: source,
    capability: 'sessions',
    operation,
    error: error && error.message ? error.message : String(error)
  };
  if (error) {
    Object.defineProperty(result, 'cause', { value: error, enumerable: false });
  }
  return result;
}

function _getRuntimeSessionsDriver(runtime, source) {
  if (!runtime || typeof runtime.getDriver !== 'function') {
    return null;
  }

  try {
    const driver = runtime.getDriver(source, 'sessions');
    if (_isTypedSessionsResult(driver)) {
      return driver;
    }
    if (!driver || typeof driver !== 'object') {
      return null;
    }
    if (typeof driver.inventory !== 'function' || typeof driver.parse !== 'function') {
      return null;
    }
    return driver;
  } catch (error) {
    return _typedSessionsFailure(source, error);
  }
}

function _normalizeRuntimeParseResult(result, descriptor = {}) {
  if (!result || typeof result !== 'object') {
    return result;
  }

  if (result.session && Array.isArray(result.messages)) {
    const sessionExtra = result.session.extraJson ? JSON.parse(result.session.extraJson) : {};
    const extraJson = JSON.stringify({
      ...sessionExtra,
      projectHint: result.session.projectHint || descriptor.projectHint || null,
      mtimeMs: descriptor.mtimeMs ?? sessionExtra.mtimeMs ?? null
    });
    return {
      ...result,
      session: {
        ...result.session,
        projectHint: result.session.projectHint || descriptor.projectHint || '',
        projectName: result.session.projectName || result.session.projectHint || descriptor.projectHint || '',
        projectDisplayName: result.session.projectDisplayName || result.session.projectName || result.session.projectHint || descriptor.projectHint || '',
        projectFullPath: result.session.projectFullPath || result.session.projectPath || '',
        updatedAt: descriptor.mtimeMs ?? result.session.updatedAt ?? null,
        extraJson
      }
    };
  }

  if (result.sessionId) {
    const projectHint = result.projectHint || result.projectName || descriptor.projectHint || '';
    const projectName = result.projectName || projectHint || '';
    const projectDisplayName = result.projectDisplayName || result.projectName || projectHint || '';
    const resultExtra = result.extraJson ? JSON.parse(result.extraJson) : {};
    const descriptorMtime = descriptor.mtimeMs ?? null;

    return {
      session: {
        sessionId: result.sessionId,
        projectHint,
        projectName,
        projectDisplayName,
        projectFullPath: result.projectFullPath || result.projectPath || '',
        firstMessage: result.firstMessage || null,
        gitBranch: result.gitBranch || null,
        provider: result.provider || null,
        model: result.model || null,
        startedAt: result.startedAt || null,
        updatedAt: descriptorMtime ?? result.updatedAt ?? null,
        usageJson: result.usageJson || null,
        extraJson: JSON.stringify({
          ...resultExtra,
          projectHint: projectHint || null,
          mtimeMs: descriptor.mtimeMs ?? resultExtra.mtimeMs ?? null
        })
      },
      messages: Array.isArray(result.messages) ? result.messages : []
    };
  }

  return result;
}

function _adaptRuntimeSessionsDriver(driver) {
  if (!driver) return null;
  return {
    inventory: (...args) => driver.inventory(...args),
    parse: async (descriptor, ...args) => _normalizeRuntimeParseResult(await driver.parse(descriptor, ...args), descriptor)
  };
}


// Core: createSessionHistoryIndex
// ---------------------------------------------------------------------------

/**
 * @param {object} [opts]
 * @param {string} [opts.dbPath]
 * @param {object} [opts.adapterRegistry] - source → { inventory, parse }
 * @param {object} [opts.runtime] - runtime with getDriver(source, capability)
 * @param {Function} [opts.workerRunner] - (source, indexDbPath) => Promise<void>
 * @param {boolean|null} [opts.ftsEnabledOverride] - override FTS detection for tests
 * @returns {object} index API
 */
function createSessionHistoryIndex(opts = {}) {
  const dbPath = opts.dbPath || PATHS?.sessionHistoryIndex || path.join(PATHS?.base || process.cwd(), 'session-history.sqlite');
  const explicitAdapters = opts.adapterRegistry || null;
  const adapters = explicitAdapters || require('./session-history-adapters');
  const runtimeProvided = !explicitAdapters && !!opts.runtime && typeof opts.runtime === 'object';
  const runtime = explicitAdapters ? null : (runtimeProvided ? opts.runtime : platformRuntime.getPlatformRuntime());
  const workerRunner = opts.workerRunner || _defaultWorkerRunner;
  const ftsEnabled = opts.ftsEnabledOverride !== undefined
    ? opts.ftsEnabledOverride
    : null;
  const shouldUseWorker = process.env.NODE_ENV !== 'test' && process.env.CC_TOOL_SESSION_HISTORY_CHILD !== '1';
  let _db = null;
  let _ftsAvailable = null;
  /** @type {Map<string, Promise<void>>} */
  const _inflight = new Map();

  function _getDb() {
    if (_db) return _db;
    _db = openDatabase(dbPath);
    _initSchema(_db);
    if (ftsEnabled !== null) {
      _ftsAvailable = ftsEnabled;
    } else if (_ftsAvailable === null) {
      _ftsAvailable = _detectFts5(_db);
    }
    if (_ftsAvailable && ftsEnabled !== false) {
      _initFts(_db);
    }
    return _db;
  }

  function _initSchema(db) {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec(SCHEMA_SQL);
  }

  function _initFts(db) {
    try {
      db.exec(FTS_SETUP_SQL);
    } catch (_err) {
      _ftsAvailable = false;
    }
  }

  /**
   * @param {string} source
   * @param {{ force?: boolean, consistency?: string }} [options]
   * @returns {Promise<void>}
   */
  async function ensureSourceIndexed(source, options = {}) {
    const consistency = options.consistency || 'stale-ok';
    const force = options.force === true;
    const key = `ensure:${source}`;

    if (_inflight.has(key)) {
      if (consistency === 'complete') {
        return _inflight.get(key);
      }
      const inflight = _inflight.get(key);
      const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), COLD_STALE_WAIT_MS));
      const result = await Promise.race([inflight, timeout]);
      if (result === 'timeout') return;
      return result;
    }

    const useWorker = shouldUseWorker && !runtimeProvided && !explicitAdapters;
    const promise = useWorker
      ? workerRunner(source, dbPath, { force })
      : _runInventory(source, { force });
    _inflight.set(key, promise);
    promise.finally(() => {
      if (_inflight.get(key) === promise) {
        _inflight.delete(key);
      }
    }).catch(() => {});

    if (consistency === 'stale-ok') {
      const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), COLD_STALE_WAIT_MS));
      const result = await Promise.race([promise, timeout]);
      if (result === 'timeout') {
        return;
      }
    }

    await promise;
  }

  function _isTypedFailureResult(result) {
    return _isTypedSessionsResult(result);
  }

  function _typedFailureToError(result) {
    const cause = result.cause || (result.error instanceof Error ? result.error : new Error(String(result.error || 'inventory failed')));
    const error = new Error(`Runtime ${result.capability} ${result.operation} failed on ${result.platform}: ${cause.message}`);
    error.platform = result.platform;
    error.capability = result.capability;
    error.operation = result.operation;
    error.cause = cause;
    error.failure = result;
    return error;
  }

  function _recordSourceState(db, source, lastInventoryMs, lastError) {
    db.prepare(
      'INSERT INTO source_state(source, last_inventory_ms, last_error) VALUES(?, ?, ?) ON CONFLICT(source) DO UPDATE SET last_inventory_ms = excluded.last_inventory_ms, last_error = excluded.last_error'
    ).run(source, lastInventoryMs, lastError);
  }

  async function _runInventory(source, { force = false } = {}) {
    const db = _getDb();
    let errorMsg = null;
    let stateToRecord = null;

    try {
      let adapter = null;

      if (explicitAdapters) {
        adapter = adapters[source];
      } else {
        const runtimeDriver = _getRuntimeSessionsDriver(runtime, source);
        if (_isTypedFailureResult(runtimeDriver)) {
          throw _typedFailureToError(runtimeDriver);
        }

        if (runtimeDriver) {
          adapter = _adaptRuntimeSessionsDriver(runtimeDriver);
        } else if (BUILTIN_SESSION_SOURCES.has(source) && adapters[source]) {
          adapter = adapters[source];
        } else {
          throw _typedFailureToError(_typedSessionsUnsupported(source, new Error(`unsupported sessions source: ${source}`)));
        }
      }

      if (!adapter || typeof adapter.inventory !== 'function' || typeof adapter.parse !== 'function') {
        if (explicitAdapters) {
          return;
        }
        throw _typedFailureToError(_typedSessionsUnsupported(source, new Error(`unsupported sessions source: ${source}`)));
      }

      if (!force) {
        const row = db.prepare('SELECT last_inventory_ms FROM source_state WHERE source = ?').get(source);
        if (row && row.last_inventory_ms && (Date.now() - row.last_inventory_ms) < INDEX_INVENTORY_TTL_MS) {
          return;
        }
      }

      const descriptors = await adapter.inventory();
      if (_isTypedFailureResult(descriptors)) {
        throw _typedFailureToError(descriptors);
      }
      if (!Array.isArray(descriptors)) {
        return;
      }

      const seen = new Map();
      for (const d of descriptors) {
        const prev = seen.get(d.sessionId);
        if (!prev || d.mtimeMs > prev.mtimeMs || (d.mtimeMs === prev.mtimeMs && d.filePath < prev.filePath)) {
          seen.set(d.sessionId, d);
        }
      }

      const indexedFiles = new Map();
      const indexedRows = db.prepare('SELECT file_path, size, mtime_ms FROM session_file WHERE source = ?').all(source);
      for (const r of indexedRows) {
        indexedFiles.set(r.file_path, r);
      }

      const toParse = [];
      const activePaths = new Set();
      for (const d of seen.values()) {
        activePaths.add(d.filePath);
        const idx = indexedFiles.get(d.filePath);
        if (!idx || idx.size !== d.size || idx.mtime_ms !== d.mtimeMs) {
          toParse.push(d);
        }
      }

      for (const filePath of indexedFiles.keys()) {
        if (!activePaths.has(filePath)) {
          db.prepare('DELETE FROM session_file WHERE source = ? AND file_path = ?').run(source, filePath);
        }
      }

      for (const d of toParse) {
        try {
          const preStat = { size: d.size, mtimeMs: d.mtimeMs };
          const parseResult = await adapter.parse(d);
          if (_isTypedFailureResult(parseResult)) {
            throw _typedFailureToError(parseResult);
          }
          const { session, messages } = parseResult;

          try {
            const postStat = fs.statSync(d.filePath);
            if (postStat.size !== preStat.size || postStat.mtimeMs !== preStat.mtimeMs) {
              const retry = await adapter.parse(d);
              if (_isTypedFailureResult(retry)) {
                throw _typedFailureToError(retry);
              }
              const retryStat = fs.statSync(d.filePath);
              if (retryStat.size !== postStat.size || retryStat.mtimeMs !== postStat.mtimeMs) {
                const existing = db.prepare('SELECT 1 FROM session_file WHERE source = ? AND file_path = ?').get(source, d.filePath);
                if (existing) continue;
                continue;
              }
              _upsertSession(db, source, d, retry.session, retry.messages);
              continue;
            }
          } catch (_statErr) {
            if (_statErr && _isTypedFailureResult(_statErr.failure)) {
              throw _statErr;
            }
            continue;
          }

          _upsertSession(db, source, d, session, messages);
        } catch (err) {
          if (err && _isTypedFailureResult(err.failure)) {
            throw err;
          }
          errorMsg = errorMsg ? `${errorMsg}; ${d.filePath}: ${err.message}` : `${d.filePath}: ${err.message}`;
        }
      }

      stateToRecord = {
        lastInventoryMs: Date.now(),
        lastError: errorMsg
      };
    } catch (err) {
      errorMsg = err && err.message ? err.message : String(err);
      stateToRecord = {
        lastInventoryMs: null,
        lastError: errorMsg
      };
      throw err;
    } finally {
      if (stateToRecord) {
        try {
          _recordSourceState(db, source, stateToRecord.lastInventoryMs, stateToRecord.lastError);
        } catch (_err) {}
      }
    }
  }


  function _upsertSession(db, source, descriptor, session, messages) {
    try {
      db.exec('BEGIN IMMEDIATE');
      db.prepare('DELETE FROM session_file WHERE source = ? AND session_id = ?').run(source, session.sessionId);

      db.prepare(`
        INSERT INTO session_file(
          source, file_path, size, mtime_ms, session_id,
          project_name, project_display_name, project_full_path,
          first_message, git_branch, provider, model,
          started_at, updated_at, message_count, usage_json, extra_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        source,
        descriptor.filePath,
        descriptor.size,
        descriptor.mtimeMs,
        session.sessionId,
        session.projectName || '',
        session.projectDisplayName || null,
        session.projectFullPath || null,
        session.firstMessage || null,
        session.gitBranch || null,
        session.provider || null,
        session.model || null,
        session.startedAt || null,
        session.updatedAt || null,
        messages.length,
        session.usageJson || null,
        session.extraJson || null
      );

      if (messages.length > 0) {
        const stmt = db.prepare(`
          INSERT INTO session_message(
            source, session_id, ordinal, message_id, role, type, subtype,
            content, timestamp, model, provider, user_message_number, extra_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        let ordinal = 0;
        for (const msg of messages) {
          stmt.run(
            source,
            session.sessionId,
            ordinal,
            msg.messageId || null,
            msg.role || null,
            msg.type || null,
            msg.subtype || null,
            msg.content || null,
            msg.timestamp || null,
            msg.model || null,
            msg.provider || null,
            msg.userMessageNumber != null ? msg.userMessageNumber : null,
            msg.extraJson || null
          );
          ordinal++;
        }
      }

      db.exec('COMMIT');
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw err;
    }
  }



  // ---- Public query methods ----

  /**
   * @param {string} source
   * @param {object} [options]
   * @returns {Promise<Array<{name, displayName, fullPath, path, sessionCount, lastUsed, latestSession, source}>>}
   */
  async function listProjects(source, options = {}) {
    await ensureSourceIndexed(source, { consistency: options.consistency || 'stale-ok' });
    const db = _getDb();

    const rows = db.prepare(`
      SELECT project_name, project_display_name, project_full_path,
             COUNT(*) AS session_count,
             MAX(updated_at) AS last_used,
             (SELECT session_id FROM session_file sf2
              WHERE sf2.source = ? AND sf2.project_name = sf.project_name
              ORDER BY updated_at DESC LIMIT 1) AS latest_session
      FROM session_file sf
      WHERE source = ?
      GROUP BY project_name
      ORDER BY last_used DESC
    `).all(source, source);

    return rows.map(r => ({
      name: r.project_name,
      displayName: r.project_display_name || r.project_name,
      fullPath: r.project_full_path || '',
      path: r.project_full_path || '',
      sessionCount: r.session_count,
      lastUsed: r.last_used,
      latestSession: r.latest_session,
      source
    }));
  }

  /**
   * @param {string} source
   * @param {string} projectName
   * @param {object} [options]
   * @returns {Promise<Array>}
   */
  async function listSessions(source, projectName, options = {}) {
    await ensureSourceIndexed(source, { consistency: 'stale-ok' });

    const db = _getDb();
    const rows = db.prepare(`
      SELECT * FROM session_file
      WHERE source = ? AND project_name = ?
      ORDER BY updated_at DESC
    `).all(source, projectName);

    return rows.map(r => ({
      sessionId: r.session_id,
      filePath: r.file_path,
      size: r.size,
      mtime: r.mtime_ms,
      firstMessage: r.first_message,
      gitBranch: r.git_branch,
      provider: r.provider,
      model: r.model,
      messageCount: r.message_count,
      tokens: r.usage_json ? JSON.parse(r.usage_json) : null,
      extra: r.extra_json ? JSON.parse(r.extra_json) : {},
      source: r.source,
      projectName: r.project_name,
      projectHint: r.project_name,
      projectDisplayName: r.project_display_name,
      projectFullPath: r.project_full_path,
      startedAt: r.started_at,
      updatedAt: r.updated_at
    }));
  }

  /**
   * @param {string} source
   * @param {string} sessionId
   * @param {object} [options]
   * @returns {Promise<{sessionId, lastModified, size, filePath}|null>}
   */
  async function getSessionStatus(source, sessionId, options = {}) {
    await ensureSourceIndexed(source, { consistency: 'stale-ok' });
    const db = _getDb();
    const row = db.prepare(
      'SELECT session_id, mtime_ms, size, file_path FROM session_file WHERE source = ? AND session_id = ?'
    ).get(source, sessionId);

    if (!row) return null;

    // Verify file still exists
    try {
      await fs.promises.stat(row.file_path);
    } catch (_) {
      // File gone - invalidate and return null
      db.prepare('DELETE FROM session_file WHERE source = ? AND session_id = ?').run(source, sessionId);
      return null;
    }

    return {
      sessionId: row.session_id,
      lastModified: row.mtime_ms,
      size: row.size,
      filePath: row.file_path
    };
  }

  /**
   * @param {string} source
   * @param {string} sessionId
   * @param {object} [options]
   * @returns {Promise<{sessionId, items: Array}|null>}
   */
  async function getSessionOutline(source, sessionId, options = {}) {
    await _ensureSessionCurrent(source, sessionId);
    const db = _getDb();

    const rows = db.prepare(`
      SELECT user_message_number, content, timestamp
      FROM session_message
      WHERE source = ? AND session_id = ? AND user_message_number IS NOT NULL
      ORDER BY ordinal ASC
    `).all(source, sessionId);

    if (rows.length === 0) {
      // Check session exists at all
      const sf = db.prepare('SELECT 1 FROM session_file WHERE source = ? AND session_id = ?').get(source, sessionId);
      if (!sf) return null;
      return { sessionId, items: [] };
    }

    return {
      sessionId,
      items: rows.map(r => ({
        userMessageNumber: r.user_message_number,
        preview: _buildPreview(r.content),
        timestamp: r.timestamp
      }))
    };
  }

  /**
   * @param {string} source
   * @param {string} sessionId
   * @param {object} [options]
   * @returns {Promise<{messages: Array, metadata: object, pagination: object}|null>}
   */
  async function getMessagePage(source, sessionId, options = {}) {
    await _ensureSessionCurrent(source, sessionId);
    const db = _getDb();
    const { page, limit, order } = _normalizePageOpts(options);

    // Check session exists
    const sf = db.prepare('SELECT * FROM session_file WHERE source = ? AND session_id = ?').get(source, sessionId);
    if (!sf) return null;

    const total = Number(sf.message_count);
    if (total === 0) {
      return {
        messages: [],
        metadata: _buildMessageMetadata(sf),
        pagination: { page, limit, total: 0, hasMore: false }
      };
    }

    const offset = (page - 1) * limit;
    const rows = db.prepare(`
      SELECT * FROM session_message
      WHERE source = ? AND session_id = ?
      ORDER BY ordinal ${order}
      LIMIT ? OFFSET ?
    `).all(source, sessionId, limit, offset);

    return {
      messages: rows.map(r => ({
        messageId: r.message_id,
        role: r.role,
        type: r.type,
        subtype: r.subtype,
        content: r.content,
        timestamp: r.timestamp,
        model: r.model,
        provider: r.provider,
        userMessageNumber: r.user_message_number,
        extra: r.extra_json ? JSON.parse(r.extra_json) : {}
      })),
      metadata: _buildMessageMetadata(sf),
      pagination: {
        page,
        limit,
        total,
        hasMore: offset + limit < total
      }
    };
  }

  /**
   * @param {string} source
   * @param {number} [limit=5]
   * @param {object} [options]
   * @returns {Promise<Array>}
   */
  async function getRecentSessions(source, limit = 5, options = {}) {
    await ensureSourceIndexed(source, { consistency: 'stale-ok' });
    const db = _getDb();

    const rows = db.prepare(`
      SELECT * FROM session_file
      WHERE source = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(source, Math.max(1, Math.min(limit, 100)));

    return rows.map(r => ({
      sessionId: r.session_id,
      filePath: r.file_path,
      size: r.size,
      mtime: r.mtime_ms,
      firstMessage: r.first_message,
      gitBranch: r.git_branch,
      provider: r.provider,
      model: r.model,
      messageCount: r.message_count,
      projectName: r.project_name,
      projectDisplayName: r.project_display_name,
      projectFullPath: r.project_full_path,
      source: r.source,
      updatedAt: r.updated_at
    }));
  }

  /**
   * @param {string} source
   * @param {string} keyword
   * @param {object} [options]
   * @returns {Promise<Array>}
   */
  async function searchSessions(source, keyword, options = {}) {
    await ensureSourceIndexed(source, { consistency: options.consistency || 'complete' });
    const db = _getDb();
    const contextLength = options.contextLength || 35;
    const projectName = options.projectName || null;

    // Build candidate query
    let candidates;
    if (_ftsAvailable) {
      // FTS5 trigram search for needles >= 3 chars
      const needle = String(keyword);
      if ([...needle].length >= 3) {
        const ftsRows = db.prepare(`
          SELECT sm.source, sm.session_id, sm.ordinal, sm.content, sm.role, sm.type, sm.timestamp
          FROM session_message_fts fts
          JOIN session_message sm ON sm.rowid = fts.rowid
          JOIN session_file sf ON sf.source = sm.source AND sf.session_id = sm.session_id
          WHERE sm.source = ? AND session_message_fts MATCH ?
          ${projectName ? 'AND sf.project_name = ?' : ''}
          ORDER BY sf.updated_at DESC
          LIMIT 500
        `);
        const params = [source, _ftsQuote(needle)];
        if (projectName) params.push(projectName);
        candidates = ftsRows.all(...params);
      } else {
        // Short needle: scan all messages for this source
        candidates = _scanMessagesRelational(db, source, keyword, projectName);
      }
    } else {
      candidates = _scanMessagesRelational(db, source, keyword, projectName);
    }

    if (candidates.length === 0) return [];

    // Final matching with JS toLowerCase/indexOf (preserves CJK, Unicode case)
    const lowerKeyword = String(keyword).toLocaleLowerCase();
    const matched = [];
    const matchMap = new Map(); // sessionId → { session, matches[] }

    for (const c of candidates) {
      const content = c.content || '';
      const lowerContent = content.toLocaleLowerCase();
      let idx = 0;
      let count = 0;
      const positions = [];
      while ((idx = lowerContent.indexOf(lowerKeyword, idx)) !== -1) {
        positions.push(idx);
        count++;
        idx += lowerKeyword.length;
      }
      if (count === 0) continue;

      if (!matchMap.has(c.session_id)) {
        const sf = db.prepare('SELECT * FROM session_file WHERE source = ? AND session_id = ?').get(source, c.session_id);
        if (!sf) continue;
        matchMap.set(c.session_id, {
          session: sf,
          matchCount: 0,
          messages: []
        });
      }

      const entry = matchMap.get(c.session_id);
      // Claude: count every occurrence; Codex/Gemini/OMP: at most 1 per message
      entry.matchCount += (source === 'claude') ? count : 1;
      entry.messages.push({
        ordinal: c.ordinal,
        content,
        positions,
        role: c.role || 'unknown',
        type: c.type || c.role || 'unknown',
        timestamp: c.timestamp,
        context: _extractContext(content, positions[0], contextLength, lowerKeyword.length)
      });
    }

    // Flatten to results
    const results = [];
    for (const [_sid, entry] of matchMap) {
      results.push({
        sessionId: entry.session.session_id,
        projectName: entry.session.project_name,
        projectDisplayName: entry.session.project_display_name,
        projectFullPath: entry.session.project_full_path,
        filePath: entry.session.file_path,
        firstMessage: entry.session.first_message,
        updatedAt: entry.session.updated_at,
        matchCount: entry.matchCount,
        source: entry.session.source,
        matches: entry.messages.slice(0, 5)
      });
    }

    // Sort: matchCount DESC, then updated_at DESC
    results.sort((a, b) => {
      const cm = b.matchCount - a.matchCount;
      if (cm !== 0) return cm;
      const aRow = matchMap.get(a.sessionId);
      const bRow = matchMap.get(b.sessionId);
      const au = (aRow && aRow.session.updated_at) || 0;
      const bu = (bRow && bRow.session.updated_at) || 0;
      return bu - au;
    });

    return results;
  }

  function _scanMessagesRelational(db, source, keyword, projectName = null) {
    const lowerKeyword = String(keyword).toLocaleLowerCase();
    // Use instr for case-insensitive substring matching
    let sql = `
      SELECT sm.source, sm.session_id, sm.ordinal, sm.content, sm.role, sm.type, sm.timestamp
      FROM session_message sm
      JOIN session_file sf ON sf.source = sm.source AND sf.session_id = sm.session_id
      WHERE sm.source = ? AND instr(lower(sm.content), lower(?)) > 0
      ${projectName ? 'AND sf.project_name = ?' : ''}
      ORDER BY sf.updated_at DESC
      LIMIT 500
    `;
    const params = [source, keyword];
    if (projectName) params.push(projectName);
    return db.prepare(sql).all(...params);
  }

  function _extractContext(content, position, contextLength, keywordLength) {
    const start = Math.max(0, position - contextLength);
    const end = Math.min(content.length, position + keywordLength + contextLength);
    let ctx = content.slice(start, end);
    if (start > 0) ctx = '...' + ctx;
    if (end < content.length) ctx = ctx + '...';
    return ctx;
  }

  function _buildPreview(content) {
    if (!content) return '（空消息）';
    const firstLine = String(content)
      .split('\n')
      .map(l => l.trim())
      .find(Boolean) || '（空消息）';
    return firstLine.length > 42 ? firstLine.slice(0, 42) + '...' : firstLine;
  }

  function _buildMessageMetadata(sf) {
    return {
      sessionId: sf.session_id,
      gitBranch: sf.git_branch,
      provider: sf.provider,
      model: sf.model,
      messageCount: sf.message_count,
      usage: sf.usage_json ? JSON.parse(sf.usage_json) : null,
      extra: sf.extra_json ? JSON.parse(sf.extra_json) : {}
    };
  }

  /**
   * Ensure the indexed data for a session is current by checking file mtime.
   */
  async function _ensureSessionCurrent(source, sessionId) {
    await ensureSourceIndexed(source, { consistency: 'stale-ok' });
    const db = _getDb();
    const row = db.prepare(
      'SELECT file_path, size, mtime_ms FROM session_file WHERE source = ? AND session_id = ?'
    ).get(source, sessionId);
    if (!row) return;

    let currentStat;
    try {
      currentStat = await fs.promises.stat(row.file_path);
    } catch (_) {
      // File gone, session stays indexed as-is
      return;
    }

    if (currentStat.size !== row.size || currentStat.mtimeMs !== row.mtime_ms) {
      // File changed; force re-index
      await ensureSourceIndexed(source, { force: true, consistency: 'complete' });
    }
  }

  /**
   * @param {string} source
   * @param {object} [options]
   */
  function invalidateSource(source, options = {}) {
    const db = _getDb ? _getDb() : null;
    if (!db) return;

    if (options.deleted && options.sessionId) {
      db.prepare('DELETE FROM session_file WHERE source = ? AND session_id = ?').run(source, options.sessionId);
    }

    // Mark state as stale
    db.prepare(
      'UPDATE source_state SET last_inventory_ms = NULL WHERE source = ?'
    ).run(source);
  }

  function closeSessionHistoryIndex() {
    closeDatabase(dbPath);
    _db = null;
  }

  // Build the API object
  const api = {
    ensureSourceIndexed,
    listProjects,
    listSessions,
    getSessionStatus,
    getSessionOutline,
    getMessagePage,
    getRecentSessions,
    searchSessions,
    invalidateSource,
    closeSessionHistoryIndex,
  };

  // Lazy-init helpers used internally
  api._getDb = _getDb;
  api._initSchema = _initSchema;

  return api;
}

// ---------------------------------------------------------------------------
// Default singleton
// ---------------------------------------------------------------------------

let _defaultIndex = null;

function _getDefaultIndex() {
  if (!_defaultIndex) {
    _defaultIndex = createSessionHistoryIndex();
  }
  return _defaultIndex;
}

async function ensureSourceIndexed(source, options) {
  return _getDefaultIndex().ensureSourceIndexed(source, options);
}

async function listProjects(source, options) {
  return _getDefaultIndex().listProjects(source, options);
}

async function listSessions(source, projectName, options) {
  return _getDefaultIndex().listSessions(source, projectName, options);
}

async function getSessionStatus(source, sessionId, options) {
  return _getDefaultIndex().getSessionStatus(source, sessionId, options);
}

async function getSessionOutline(source, sessionId, options) {
  return _getDefaultIndex().getSessionOutline(source, sessionId, options);
}

async function getMessagePage(source, sessionId, options) {
  return _getDefaultIndex().getMessagePage(source, sessionId, options);
}

async function getRecentSessions(source, limit, options) {
  return _getDefaultIndex().getRecentSessions(source, limit, options);
}

async function searchSessions(source, keyword, options) {
  return _getDefaultIndex().searchSessions(source, keyword, options);
}

function invalidateSource(source, options) {
  _getDefaultIndex().invalidateSource(source, options);
}

function closeSessionHistoryIndex() {
  if (_defaultIndex) {
    _defaultIndex.closeSessionHistoryIndex();
    _defaultIndex = null;
  }
}

// ---------------------------------------------------------------------------
// Default worker runner uses a child process in production.
async function _defaultWorkerRunner(source, indexDbPath, options = {}) {
  const { runInventoryWorker } = require('./session-history-worker');
  return runInventoryWorker(source, indexDbPath, options);
}

module.exports = {
  createSessionHistoryIndex,
  ensureSourceIndexed,
  listProjects,
  listSessions,
  getSessionStatus,
  getSessionOutline,
  getMessagePage,
  getRecentSessions,
  searchSessions,
  invalidateSource,
  closeSessionHistoryIndex
};
