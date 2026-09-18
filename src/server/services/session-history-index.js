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


/** @type {number} Maximum time a cold stale-ok read waits for inventory */
const INDEX_COLD_WAIT_MS = 1500;
/** @type {number} Maximum age for a lock whose owner cannot be inspected */
const INVENTORY_LOCK_STALE_MS = 30 * 60 * 1000;
/** @type {number} Maximum time a competing inventory waits for the database writer */
const INVENTORY_LOCK_WAIT_MS = 30000;
/** @type {number} Number of files parsed before results are released */
const INVENTORY_PARSE_BATCH_SIZE = 8;
/** @type {number} Maximum number of files parsed concurrently */
const INVENTORY_PARSE_CONCURRENCY = 2;
const SUMMARY_REFRESH_CONCURRENCY = 8;
const SUMMARY_VERSION = 1;
const BUILTIN_SESSION_SOURCES = new Set(['claude', 'codex', 'gemini', 'omp']);
// Keep synchronized with the parserVersion exposed by the built-in session drivers.
const BUILTIN_SESSION_PARSER_VERSIONS = Object.freeze({ claude: 2, codex: 2, gemini: 2, omp: 2 });
function _parserVersionForDriver(driver) {
  const version = Number(driver?.parserVersion);
  return Number.isInteger(version) && version >= 1 ? version : 1;
}
function _isUsableRuntime(runtime) {
  return !!runtime && typeof runtime === 'object' && typeof runtime.getDriver === 'function';
}

function _inventoryLockPath(dbPath) {
  return `${path.resolve(String(dbPath))}.inventory.lock`;
}

function _isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === 'EPERM';
  }
}

/**
 * Acquire a durable database-wide inventory lock. The in-memory single-flight
 * map only protects requests inside one Node process; production indexing is
 * deliberately performed in child processes, so it cannot prevent two
 * workers from writing the same database after a parent restart.
 */
function _tryAcquireInventoryLock(dbPath, source) {
  const lockPath = _inventoryLockPath(dbPath);

  for (let attempt = 0; attempt < 2; attempt++) {
    let fd;
    try {
      fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, source, startedAt: Date.now() }), 'utf8');
      return { fd, lockPath };
    } catch (error) {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch (_err) {}
      }
      if (error?.code !== 'EEXIST') throw error;
    }

    let owner = null;
    let ageMs = 0;
    try {
      owner = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      ageMs = Math.max(0, Date.now() - fs.statSync(lockPath).mtimeMs);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
    }

    const ownerPid = Number(owner?.pid);
    if (_isProcessAlive(ownerPid)) {
      return {
        busy: true,
        sameSource: owner?.source && String(owner.source) === String(source)
      };
    }

    if ((!Number.isInteger(ownerPid) || ownerPid <= 0) && ageMs < INVENTORY_LOCK_STALE_MS) {
      return null;
    }

    try {
      fs.unlinkSync(lockPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') return null;
    }
  }

  return null;
}

async function _acquireInventoryLock(dbPath, source, waitMs = INVENTORY_LOCK_WAIT_MS) {
  const deadline = Date.now() + Math.max(0, Number(waitMs) || 0);
  while (true) {
    const lock = _tryAcquireInventoryLock(dbPath, source);
    if (lock?.busy) {
      if (lock.sameSource) return null;
    } else if (lock) {
      return lock;
    }
    if (Date.now() >= deadline) return null;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

function _hasActiveInventoryLock(dbPath) {
  const lockPath = _inventoryLockPath(dbPath);
  try {
    const owner = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const ageMs = Math.max(0, Date.now() - fs.statSync(lockPath).mtimeMs);
    const ownerPid = Number(owner?.pid);
    return _isProcessAlive(ownerPid) || (
      (!Number.isInteger(ownerPid) || ownerPid <= 0)
      && ageMs < INVENTORY_LOCK_STALE_MS
    );
  } catch (_) {
    return false;
  }
}

function _releaseInventoryLock(lock) {
  if (!lock) return;
  try { fs.closeSync(lock.fd); } catch (_err) {}
  try { fs.unlinkSync(lock.lockPath); } catch (_err) {}
}

/**
 * Remove inventory locks left by workers that are no longer alive.
 *
 * A normal worker releases its lock in `_runInventory`'s finally block. This
 * fallback is needed for `ctx stop` when a worker is terminated before that
 * block can run. Locks owned by a live PID are intentionally retained.
 *
 * @param {string} [dbPath]
 * @returns {{ removed: string[], retained: string[] }}
 */
function cleanupStaleInventoryLocks(dbPath = PATHS?.sessionHistoryIndex) {
  const targetPath = dbPath ? path.resolve(String(dbPath)) : '';
  if (!targetPath) return { removed: [], retained: [] };

  const directory = path.dirname(targetPath);
  const prefix = `${path.basename(targetPath)}.`;
  let entries;
  try {
    entries = fs.readdirSync(directory);
  } catch (_) {
    return { removed: [], retained: [] };
  }

  const removed = [];
  const retained = [];
  for (const entry of entries) {
    if (!entry.startsWith(prefix) || !entry.endsWith('.inventory.lock')) continue;
    const lockPath = path.join(directory, entry);
    let owner = null;
    let ageMs = 0;
    try {
      ageMs = Math.max(0, Date.now() - fs.statSync(lockPath).mtimeMs);
    } catch (_) {
      retained.push(lockPath);
      continue;
    }
    try {
      owner = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    } catch (_) {
      // Keep malformed young locks; an old one is handled by the stale rule.
    }

    const ownerPid = Number(owner?.pid);
    if (_isProcessAlive(ownerPid)) {
      retained.push(lockPath);
      continue;
    }

    // A valid but dead owner can be cleaned immediately. Unreadable lock
    // files remain protected by the normal acquisition path's stale check.
    if ((Number.isInteger(ownerPid) && ownerPid > 0) || ageMs >= INVENTORY_LOCK_STALE_MS) {
      try {
        fs.unlinkSync(lockPath);
        removed.push(lockPath);
      } catch (_) {
        retained.push(lockPath);
      }
    } else {
      retained.push(lockPath);
    }
  }

  return { removed, retained };
}


// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS source_state (
  source            TEXT PRIMARY KEY,
  last_inventory_ms INTEGER,
  last_error        TEXT,
  summary_inventory_ms INTEGER,
  summary_error        TEXT
);

CREATE TABLE IF NOT EXISTS session_summary (
  source               TEXT NOT NULL,
  file_path            TEXT NOT NULL,
  session_id           TEXT NOT NULL,
  project_name         TEXT NOT NULL,
  project_display_name TEXT,
  project_full_path    TEXT,
  first_message        TEXT,
  git_branch           TEXT,
  provider             TEXT,
  model                TEXT,
  size                 INTEGER NOT NULL DEFAULT 0,
  mtime_ms             INTEGER NOT NULL DEFAULT 0,
  started_at           INTEGER,
  updated_at           INTEGER,
  summary_version      INTEGER NOT NULL DEFAULT 1,
  extra_json           TEXT,
  PRIMARY KEY (source, file_path),
  UNIQUE (source, session_id)
);

CREATE INDEX IF NOT EXISTS idx_session_summary_project
  ON session_summary(source, project_name, updated_at DESC, session_id ASC);

CREATE INDEX IF NOT EXISTS idx_session_summary_updated
  ON session_summary(source, updated_at DESC, session_id ASC);

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
  parser_version       INTEGER NOT NULL DEFAULT 0,
  content_indexed      INTEGER NOT NULL DEFAULT 1,
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

CREATE INDEX IF NOT EXISTS idx_session_message_user_number
  ON session_message(source, session_id, user_message_number, ordinal);
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
 * Normalize the bounded list pagination contract. Project/session lists are
 * intentionally capped at 100 even when a caller supplies a larger limit.
 */
function _normalizeListOpts(options = {}) {
  const page = Math.max(1, Number.parseInt(options.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, Number.parseInt(options.limit, 10) || 20));
  const query = String(options.q ?? options.search ?? '').trim();
  return { page, limit, query };
}

/**
 * Double embedded quotes in a string for FTS5 MATCH.
 * @param {string} s
 * @returns {string}
 */
function _ftsQuote(s) {
  return '"' + String(s).replace(/"/g, '""') + '"';
}

function _timestampValue(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function _normalizeTypedSessionsResult(result, defaultOperation = 'resolve-driver') {
  if (!result || typeof result !== 'object') {
    return null;
  }
  if (result.status !== 'failed' && result.status !== 'unsupported') {
    return null;
  }
  if (typeof result.platform !== 'string' || typeof result.capability !== 'string') {
    return null;
  }
  return {
    ...result,
    operation: typeof result.operation === 'string' ? result.operation : defaultOperation
  };
}

function _isTypedSessionsResult(result) {
  return !!_normalizeTypedSessionsResult(result);
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

function _getRuntimeSessionsDriver(runtime, source, config = {}) {
  if (!runtime || typeof runtime.getDriver !== 'function') {
    return null;
  }

  try {
    const driver = runtime.getDriver(source, 'sessions', { config });
    const typedResult = _normalizeTypedSessionsResult(driver);
    if (typedResult) {
      return typedResult;
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

function _safeParseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function _safeParseObject(value) {
  const parsed = _safeParseJson(value, {});
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  return parsed;
}


function _normalizeRuntimeParseResult(result, descriptor = {}, { preservePayloadUpdatedAt = false } = {}) {
  if (!result || typeof result !== 'object') {
    return result;
  }

  if (result.session && Array.isArray(result.messages)) {
    const sessionExtra = _safeParseObject(result.session.extraJson);
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
        updatedAt: preservePayloadUpdatedAt ? (result.session.updatedAt ?? descriptor.mtimeMs ?? null) : descriptor.mtimeMs ?? null,
        extraJson
      }
    };
  }

  if (result.sessionId) {
    const projectHint = descriptor.projectHint || result.projectHint || result.projectName || '';
    const projectName = result.projectName || projectHint || '';
    const projectDisplayName = result.projectDisplayName || result.projectName || projectHint || '';
    const resultExtra = _safeParseObject(result.extraJson);
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
  const unwrap = result => result && result.status === 'ok' ? result.data : result;
  return {
    parserVersion: driver.parserVersion,
    inventory: async (...args) => unwrap(await driver.inventory(...args)),
    parse: async (descriptor, ...args) => _normalizeRuntimeParseResult(
      await unwrap(await driver.parse(descriptor, ...args)),
      descriptor,
      { preservePayloadUpdatedAt: driver.preservePayloadUpdatedAt === true }
    ),
    summarize: typeof driver.summarize === 'function'
      ? async (descriptor, ...args) => _normalizeRuntimeSummaryResult(
        await unwrap(await driver.summarize(descriptor, ...args)),
        descriptor
      )
      : null
  };
}

function _normalizeRuntimeSummaryResult(result, descriptor = {}) {
  if (!result || typeof result !== 'object') return null;
  const source = result.session && typeof result.session === 'object' ? result.session : result;
  if (!source.sessionId && !descriptor.sessionId) return null;
  const projectHint = descriptor.projectHint || source.projectHint || source.projectName || '';
  const projectName = source.projectName || projectHint || 'unknown';
  const extra = _safeParseObject(source.extraJson);
  return {
    sessionId: String(source.sessionId || descriptor.sessionId),
    projectName,
    projectDisplayName: source.projectDisplayName || projectName,
    projectFullPath: source.projectFullPath || source.projectPath || null,
    firstMessage: source.firstMessage || null,
    gitBranch: source.gitBranch || null,
    provider: source.provider || null,
    model: source.model || null,
    startedAt: source.startedAt || null,
    updatedAt: source.updatedAt ?? descriptor.mtimeMs ?? null,
    extraJson: JSON.stringify({
      ...extra,
      projectHint: projectHint || null,
      mtimeMs: descriptor.mtimeMs ?? null
    })
  };
}
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
  const explicitProjectsDir = opts.projectsDir;
  const indexConfig = opts.config || (opts.projectsDir ? { projectsDir: opts.projectsDir } : {});
  const explicitAdapters = opts.adapterRegistry || null;
  const adapters = explicitAdapters || {};
  const runtimeProvided = !explicitAdapters && process.env.NODE_ENV === 'test' && _isUsableRuntime(opts.runtime);
  const runtime = explicitAdapters ? null : (runtimeProvided ? opts.runtime : platformRuntime.getPlatformRuntime());
  const workerRunner = opts.workerRunner || _defaultWorkerRunner;
  const ftsEnabled = opts.ftsEnabledOverride !== undefined
    ? opts.ftsEnabledOverride
    : null;
  const shouldUseWorker = process.env.NODE_ENV !== 'test' && process.env.CC_TOOL_SESSION_HISTORY_CHILD !== '1';
  let _db = null;
  /** @type {Map<string, {size: number, mtimeMs: number, checkedAt: number, filePath: string}>} */
  const fileVersions = new Map();
  const fileChecks = new Map();
  const sourceFreshness = new Map();
  let _ftsAvailable = null;
  /** @type {Map<string, Promise<void>>} */
  const _inflight = new Map();
  /** @type {Map<string, Promise<void>>} */
  const _summaryInflight = new Map();
  /** @type {Map<string, Promise<void>>} */
  const _contentInflight = new Map();

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
  function _parserVersionForSource(source, adapter = null) {
    if (adapter) return _parserVersionForDriver(adapter);
    if (explicitAdapters) return _parserVersionForDriver(adapters[source]);
    const runtimeDriver = _getRuntimeSessionsDriver(runtime, source, indexConfig);
    return _parserVersionForDriver(runtimeDriver);
  }

  function _resolveSessionsAdapter(source, config = indexConfig) {
    let adapter = null;
    if (explicitAdapters) {
      adapter = adapters[source];
    } else {
      const runtimeDriver = _getRuntimeSessionsDriver(runtime, source, config);
      if (_isTypedSessionsResult(runtimeDriver)) {
        throw _typedFailureToError(runtimeDriver);
      }
      if (runtimeDriver) {
        adapter = _adaptRuntimeSessionsDriver(runtimeDriver);
      } else if (BUILTIN_SESSION_SOURCES.has(source) && adapters[source]) {
        adapter = adapters[source];
      } else {
        throw _typedFailureToError(_typedSessionsUnsupported(
          source,
          new Error(`unsupported sessions source: ${source}`)
        ));
      }
    }
    return adapter;
  }

  /**
   * Check only the persisted inventory timestamp. Inventory owns file checks.
   *
   * @param {string} source
   * @returns {boolean}
   */
  function _isSourceFresh(source) {
    return _isSourceFreshForScope(source, null);
  }

  function _isSourceFreshForScope(source, projectName = null) {
    const row = _getDb().prepare(
      'SELECT last_inventory_ms FROM source_state WHERE source = ?'
    ).get(source);
    const migrationPending = _hasKnownParserMigrationPending(source)
      || (explicitAdapters && _hasParserMigrationPending(source));
    const baseFresh = Boolean(
      row?.last_inventory_ms
      && Date.now() - Number(row.last_inventory_ms) < INDEX_INVENTORY_TTL_MS
      && !migrationPending
    );

    const scope = projectName
      ? sourceFreshness.get(`${source}:${projectName}`)
      : sourceFreshness.get(source);
    if (projectName) {
      // A complete source inventory also covers project-scoped searches. A
      // project-only refresh has no persisted source timestamp, so rely on
      // its in-process scope marker until the normal inventory TTL expires.
      if (baseFresh && scope?.kind === 'source') return true;
      return scope?.kind === 'project'
        && scope.projectName === projectName
        && Date.now() - scope.at < INDEX_INVENTORY_TTL_MS;
    }
    if (!baseFresh) return false;
    // A project-scoped refresh deliberately does not make the complete source
    // fresh. Otherwise a later workspace search could reuse a partial index.
    return !scope || scope.kind === 'source';
  }

  function _hasKnownParserMigrationPending(source) {
    if (explicitAdapters || runtimeProvided) return false;
    const parserVersion = BUILTIN_SESSION_PARSER_VERSIONS[source];
    if (!parserVersion) return false;
    const row = _getDb().prepare(
      'SELECT 1 AS pending FROM session_file WHERE source = ? AND parser_version <> ? LIMIT 1'
    ).get(source, parserVersion);
    return Boolean(row);
  }

  function _hasParserMigrationPending(source) {
    const row = _getDb().prepare(
      'SELECT 1 AS pending FROM session_file WHERE source = ? AND parser_version <> ? LIMIT 1'
    ).get(source, _parserVersionForSource(source));
    return Boolean(row);
  }

  function _hasIndexedData(source) {
    const row = _getDb().prepare(
      'SELECT 1 AS indexed FROM session_file WHERE source = ? LIMIT 1'
    ).get(source);
    return Boolean(row);
  }

  function _hasUsableIndexedData(source) {
    return _hasIndexedData(source)
      && !_hasKnownParserMigrationPending(source)
      && (!explicitAdapters || !_hasParserMigrationPending(source));
  }

  function _initSchema(db) {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec(SCHEMA_SQL);
    const ensureColumn = (table, name, definition) => {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all();
      if (!columns.some((column) => column.name === name)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
      }
    };
    ensureColumn('source_state', 'summary_inventory_ms', 'INTEGER');
    ensureColumn('source_state', 'summary_error', 'TEXT');
    ensureColumn('session_file', 'parser_version', 'INTEGER NOT NULL DEFAULT 0');
    ensureColumn('session_file', 'content_indexed', 'INTEGER NOT NULL DEFAULT 1');

    // The first migration is deliberately a metadata-only copy. It reuses
    // rows already present in session_file and never touches JSONL files or
    // the message/FTS tables.
    db.exec(`
      INSERT OR IGNORE INTO session_summary(
        source, file_path, session_id, project_name, project_display_name,
        project_full_path, first_message, git_branch, provider, model,
        size, mtime_ms, started_at, updated_at, summary_version, extra_json
      )
      SELECT source, file_path, session_id, project_name, project_display_name,
             project_full_path, first_message, git_branch, provider, model,
             size, mtime_ms, started_at, updated_at, ${SUMMARY_VERSION}, extra_json
      FROM session_file
    `);
  }

  function _initFts(db) {
    try {
      db.exec(FTS_SETUP_SQL);
    } catch (_err) {
      _ftsAvailable = false;
    }
  }

  function _isSummaryFresh(source) {
    const row = _getDb().prepare(
      'SELECT summary_inventory_ms FROM source_state WHERE source = ?'
    ).get(source);
    return Boolean(
      row?.summary_inventory_ms
      && Date.now() - Number(row.summary_inventory_ms) < INDEX_INVENTORY_TTL_MS
    );
  }

  function _hasSummaryData(source) {
    return Boolean(_getDb().prepare(
      'SELECT 1 AS indexed FROM session_summary WHERE source = ? LIMIT 1'
    ).get(source));
  }

  function _summaryFromDescriptor(descriptor = {}) {
    const projectName = descriptor.projectHint || descriptor.projectName || 'unknown';
    return {
      sessionId: String(descriptor.sessionId || ''),
      projectName,
      projectDisplayName: descriptor.projectDisplayName || projectName,
      projectFullPath: descriptor.projectFullPath || descriptor.projectPath || null,
      firstMessage: descriptor.firstMessage || null,
      gitBranch: descriptor.gitBranch || null,
      provider: descriptor.provider || null,
      model: descriptor.model || null,
      startedAt: descriptor.startedAt || null,
      updatedAt: descriptor.updatedAt ?? descriptor.mtimeMs ?? null,
      extraJson: JSON.stringify({ projectHint: descriptor.projectHint || null, mtimeMs: descriptor.mtimeMs ?? null })
    };
  }

  async function _summarizeDescriptor(adapter, descriptor) {
    if (typeof adapter?.summarize !== 'function') {
      return _summaryFromDescriptor(descriptor);
    }
    const result = await adapter.summarize({ ...descriptor, projectsDir: explicitProjectsDir });
    if (_isTypedFailureResult(result)) throw _typedFailureToError(result);
    const summary = _normalizeRuntimeSummaryResult(result, descriptor) || _summaryFromDescriptor(descriptor);
    if (!summary.sessionId) summary.sessionId = String(descriptor.sessionId || '');
    return summary;
  }

  function _recordSummaryState(db, source, inventoryMs, error) {
    db.prepare(`
      INSERT INTO source_state(source, summary_inventory_ms, summary_error)
      VALUES(?, ?, ?)
      ON CONFLICT(source) DO UPDATE SET
        summary_inventory_ms = excluded.summary_inventory_ms,
        summary_error = excluded.summary_error
    `).run(source, inventoryMs, error || null);
  }

  function _upsertSummary(db, source, descriptor, summary) {
    const sessionId = String(summary.sessionId || descriptor.sessionId || '');
    if (!sessionId) return;
    db.prepare(
      'DELETE FROM session_summary WHERE source = ? AND session_id = ? AND file_path <> ?'
    ).run(source, sessionId, descriptor.filePath);
    db.prepare(`
      INSERT INTO session_summary(
        source, file_path, session_id, project_name, project_display_name,
        project_full_path, first_message, git_branch, provider, model,
        size, mtime_ms, started_at, updated_at, summary_version, extra_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, file_path) DO UPDATE SET
        session_id = excluded.session_id,
        project_name = excluded.project_name,
        project_display_name = excluded.project_display_name,
        project_full_path = excluded.project_full_path,
        first_message = excluded.first_message,
        git_branch = excluded.git_branch,
        provider = excluded.provider,
        model = excluded.model,
        size = excluded.size,
        mtime_ms = excluded.mtime_ms,
        started_at = excluded.started_at,
        updated_at = excluded.updated_at,
        summary_version = excluded.summary_version,
        extra_json = excluded.extra_json
    `).run(
      source,
      descriptor.filePath,
      sessionId,
      summary.projectName || 'unknown',
      summary.projectDisplayName || summary.projectName || 'unknown',
      summary.projectFullPath || null,
      summary.firstMessage || null,
      summary.gitBranch || null,
      summary.provider || null,
      summary.model || null,
      Number(descriptor.size) || 0,
      Number(descriptor.mtimeMs) || 0,
      summary.startedAt || null,
      summary.updatedAt ?? descriptor.mtimeMs ?? null,
      SUMMARY_VERSION,
      summary.extraJson || null
    );
  }

  async function _runSummaryInventory(source, { force = false, config = indexConfig } = {}) {
    // A list request must never wait behind the expensive full-content
    // inventory lock. It can serve the previous summaries and expose the
    // refreshing/stale state instead.
    const inventoryLock = await _acquireInventoryLock(dbPath, source, 100);
    if (!inventoryLock) return;
    let db = null;
    let errorMsg = null;
    let stateToRecord = null;
    try {
      db = _getDb();
      if (!force && _isSummaryFresh(source)) return;
      const adapter = _resolveSessionsAdapter(source, config);
      const inventoryResult = await adapter.inventory({
        projectsDir: source === 'claude' ? config.projectsDir : explicitProjectsDir
      });
      if (_isTypedFailureResult(inventoryResult)) throw _typedFailureToError(inventoryResult);

      const winners = new Map();
      for (const descriptor of Array.isArray(inventoryResult) ? inventoryResult : []) {
        if (!descriptor?.filePath) continue;
        const current = winners.get(descriptor.sessionId || descriptor.filePath);
        if (!current
          || Number(descriptor.mtimeMs) > Number(current.mtimeMs)
          || (Number(descriptor.mtimeMs) === Number(current.mtimeMs) && descriptor.filePath < current.filePath)) {
          winners.set(descriptor.sessionId || descriptor.filePath, descriptor);
        }
      }

      const indexed = new Map(db.prepare(`
        SELECT file_path, size, mtime_ms, summary_version, session_id
        FROM session_summary WHERE source = ?
      `).all(source).map(row => [row.file_path, row]));
      const activePaths = new Set();
      const changed = [];
      for (const descriptor of winners.values()) {
        activePaths.add(descriptor.filePath);
        const row = indexed.get(descriptor.filePath);
        if (!row
          || Number(row.size) !== Number(descriptor.size)
          || Number(row.mtime_ms) !== Number(descriptor.mtimeMs)
          || Number(row.summary_version) !== SUMMARY_VERSION) {
          changed.push(descriptor);
        }
      }

      const summaries = new Array(changed.length);
      let next = 0;
      const summarizeWorker = async () => {
        while (true) {
          const index = next++;
          if (index >= changed.length) return;
          const descriptor = changed[index];
          try {
            summaries[index] = { descriptor, value: await _summarizeDescriptor(adapter, descriptor) };
          } catch (error) {
            summaries[index] = { descriptor, error };
          }
        }
      };
      await Promise.all(Array.from({
        length: Math.min(SUMMARY_REFRESH_CONCURRENCY, changed.length)
      }, summarizeWorker));

      db.exec('BEGIN IMMEDIATE');
      try {
        for (const row of indexed.values()) {
          if (!activePaths.has(row.file_path)) {
            db.prepare('DELETE FROM session_summary WHERE source = ? AND file_path = ?')
              .run(source, row.file_path);
          }
        }
        for (const item of summaries) {
          if (item?.error) {
            const detail = `${item.descriptor.filePath}: ${item.error.message}`;
            errorMsg = errorMsg ? `${errorMsg}; ${detail}` : detail;
            continue;
          }
          if (item?.value) _upsertSummary(db, source, item.descriptor, item.value);
        }
        db.exec('COMMIT');
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch (_) {}
        throw error;
      }
      stateToRecord = { inventoryMs: Date.now(), error: errorMsg };
    } catch (error) {
      errorMsg = error?.message || String(error);
      stateToRecord = { inventoryMs: null, error: errorMsg };
      // Summary refresh is best-effort. Keep the previous lightweight rows
      // available when a directory changes underneath inventory (or SQLite
      // is temporarily busy); callers can inspect source meta for stale/error
      // state and retry on the next refresh.
      return null;
    } finally {
      if (stateToRecord && db) {
        try { _recordSummaryState(db, source, stateToRecord.inventoryMs, stateToRecord.error); } catch (_) {}
      }
      _releaseInventoryLock(inventoryLock);
    }
  }

  async function ensureSummaryIndexed(source, options = {}) {
    const consistency = options.consistency || 'stale-ok';
    const force = options.force === true;
    const key = `summary:${source}`;
    if (!force && _isSummaryFresh(source)) return;
    if (_summaryInflight.has(key)) {
      if (consistency === 'complete' || !_hasSummaryData(source)) return _summaryInflight.get(key);
      return;
    }
    const promise = _runSummaryInventory(source, {
      force,
      config: options.config || indexConfig
    });
    _summaryInflight.set(key, promise);
    promise.finally(() => {
      if (_summaryInflight.get(key) === promise) _summaryInflight.delete(key);
    }).catch(() => {});
    if (consistency === 'complete') return promise;
    if (_hasSummaryData(source)) return;
    await Promise.race([
      promise,
      new Promise(resolve => setTimeout(resolve, INDEX_COLD_WAIT_MS))
    ]);
  }

  /**
   * @param {string} source
   * @param {{ force?: boolean, consistency?: string, allowStaleData?: boolean }} [options]
   * @returns {Promise<void>}
   */
  async function ensureSourceIndexed(source, options = {}) {
    const consistency = options.consistency || 'stale-ok';
    const force = options.force === true;
    const allowStaleData = options.allowStaleData === true;
    const projectName = typeof options.projectName === 'string' && options.projectName.trim()
      ? options.projectName.trim()
      : null;
    const key = `ensure:${source}:${projectName || '*'}`;

    if (!force && _isSourceFreshForScope(source, projectName)) {
      return;
    }

    if (_inflight.has(key)) {
      if (consistency === 'complete') {
        return _inflight.get(key);
      }
      // The project directory can safely use the previous rows while a
      // parser migration or inventory refresh is running. Session reads
      // retain their existing behavior and wait for migration completion.
      if (allowStaleData ? _hasIndexedData(source) : _hasUsableIndexedData(source)) {
        return;
      }
      return _inflight.get(key);
    }

    const useWorker = shouldUseWorker && !runtimeProvided && !explicitAdapters;
    const workerOptions = { force };
    if (projectName) workerOptions.projectName = projectName;
    const workerProjectsDir = source === 'claude'
      ? (options.config?.projectsDir || explicitProjectsDir)
      : explicitProjectsDir;
    if (workerProjectsDir) workerOptions.projectsDir = workerProjectsDir;
    const promise = useWorker
      ? workerRunner(source, dbPath, workerOptions).then(() => {
        sourceFreshness.set(projectName ? `${source}:${projectName}` : source, projectName
          ? { kind: 'project', projectName, at: Date.now() }
          : { kind: 'source', at: Date.now() });
        return undefined;
      })
      : _runInventory(source, {
        force,
        projectName,
        config: options.config || indexConfig
      });
    _inflight.set(key, promise);
    promise.finally(() => {
      if (_inflight.get(key) === promise) {
        _inflight.delete(key);
      }
    }).catch(() => {});

    if (consistency === 'stale-ok' && (allowStaleData ? _hasIndexedData(source) : _hasUsableIndexedData(source))) {
      return;
    }

    if (consistency === 'stale-ok') {
      await Promise.race([
        promise,
        new Promise(resolve => setTimeout(resolve, INDEX_COLD_WAIT_MS))
      ]);
      return;
    }

    await promise;
  }
  function _isTypedFailureResult(result) {
    return _isTypedSessionsResult(result);
  }
  function _typedFailureToError(result) {
    const fallbackMessage = result.status === 'unsupported'
      ? `unsupported ${result.capability}`
      : 'inventory failed';
    const cause = result.cause || (result.error instanceof Error ? result.error : new Error(String(result.error || fallbackMessage)));
    const error = new Error(`Runtime ${result.capability} ${result.operation} ${result.status} on ${result.platform}: ${cause.message}`);
    error.status = result.status;
    error.platform = result.platform;
    error.capability = result.capability;
    error.operation = result.operation;
    error.context = result;
    error.cause = cause;
    error.failure = result;
    return error;
  }

  function _recordSourceState(db, source, lastInventoryMs, lastError) {
    db.prepare(
      'INSERT INTO source_state(source, last_inventory_ms, last_error) VALUES(?, ?, ?) ON CONFLICT(source) DO UPDATE SET last_inventory_ms = excluded.last_inventory_ms, last_error = excluded.last_error'
    ).run(source, lastInventoryMs, lastError);
  }

  async function _runInventory(source, { force = false, projectName = null, config = indexConfig } = {}) {
    // SQLite's writer lock is database-wide, so source-specific lock files do
    // not prevent two different sources from entering BEGIN IMMEDIATE at the
    // same time. Acquire one lock for the whole index before opening/schema
    // initializing the writer connection.
    const inventoryLock = await _acquireInventoryLock(dbPath, source);
    if (!inventoryLock) {
      // Another process is already doing the expensive work. Existing rows
      // remain readable, and the next scheduled inventory will observe the
      // new source_state timestamp once that worker finishes.
      return;
    }
    let db = null;
    let errorMsg = null;
    let stateToRecord = null;

    try {
      db = _getDb();
      if (!force && _isSourceFreshForScope(source, projectName)) {
        return;
      }
      let adapter = null;

      if (explicitAdapters) {
        adapter = adapters[source];
      } else {
        const runtimeDriver = _getRuntimeSessionsDriver(runtime, source, config);
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
      const parserVersion = _parserVersionForSource(source, adapter);
      const inventoryResult = await adapter.inventory({
        projectsDir: source === 'claude' ? config.projectsDir : explicitProjectsDir
      });
      if (_isTypedFailureResult(inventoryResult)) {
        throw _typedFailureToError(inventoryResult);
      }

      const indexedFiles = new Map();
      for (const row of db.prepare('SELECT file_path, size, mtime_ms, session_id, project_name, parser_version FROM session_file WHERE source = ?').all(source)) {
        indexedFiles.set(row.file_path, {
          size: row.size,
          mtime_ms: row.mtime_ms,
          sessionId: row.session_id,
          projectName: row.project_name,
          parserVersion: row.parser_version
        });
      }

      const winnersBySessionId = new Map();
      const scopedInventory = projectName
        ? inventoryResult.filter(descriptor => descriptor?.projectHint === projectName)
        : inventoryResult;
      for (const descriptor of scopedInventory) {
        const current = winnersBySessionId.get(descriptor.sessionId);
        if (!current
          || descriptor.mtimeMs > current.mtimeMs
          || (descriptor.mtimeMs === current.mtimeMs && descriptor.filePath < current.filePath)) {
          winnersBySessionId.set(descriptor.sessionId, descriptor);
        }
      }

      const toParse = [];
      const activePaths = new Set();
      // Inventory adapters may return directory order. Parse changed files in
      // recency order so a bounded search warms the newest conversations
      // first, matching the result ordering used by the query layer.
      const orderedDescriptors = [...winnersBySessionId.values()].sort((left, right) =>
        Number(right.mtimeMs || 0) - Number(left.mtimeMs || 0)
        || String(left.filePath).localeCompare(String(right.filePath))
      );
      for (const d of orderedDescriptors) {
        activePaths.add(d.filePath);
        const idx = indexedFiles.get(d.filePath);
        if (!idx
          || idx.size !== d.size
          || idx.mtime_ms !== d.mtimeMs
          || idx.parserVersion !== parserVersion) {
          toParse.push(d);
        }
      }
      const parseDescriptor = async (d) => {
        const preFingerprint = { size: d.size, mtimeMs: d.mtimeMs };
        const parseResult = await adapter.parse({ ...d, projectsDir: config.projectsDir });
        if (_isTypedFailureResult(parseResult)) throw _typedFailureToError(parseResult);
        if (!parseResult || typeof parseResult !== 'object' || !parseResult.session || typeof parseResult.session !== 'object' || typeof parseResult.session.sessionId !== 'string' || !parseResult.session.sessionId.trim() || !Array.isArray(parseResult.messages)) {
          throw new Error('invalid parsed session result');
        }

        let postStat;
        try {
          postStat = await fs.promises.stat(d.filePath);
        } catch (_) {
          return null;
        }
        if (postStat.size === preFingerprint.size && postStat.mtimeMs === preFingerprint.mtimeMs) {
          return { descriptor: d, parseResult };
        }
        const retryDescriptor = { ...d, size: postStat.size, mtimeMs: postStat.mtimeMs };
        const retryResult = await adapter.parse(retryDescriptor);
        if (_isTypedFailureResult(retryResult)) {
          throw _typedFailureToError(retryResult);
        }
        if (!retryResult || typeof retryResult !== 'object' || !retryResult.session || typeof retryResult.session !== 'object' || typeof retryResult.session.sessionId !== 'string' || !retryResult.session.sessionId.trim() || !Array.isArray(retryResult.messages)) {
          throw new Error('invalid parsed session result');
        }
        let retryStat;
        try {
          retryStat = await fs.promises.stat(d.filePath);
        } catch (_) {
          return null;
        }
        if (retryStat.size !== postStat.size || retryStat.mtimeMs !== postStat.mtimeMs) {
          return null;
        }
        return {
          descriptor: { ...retryDescriptor, size: retryStat.size, mtimeMs: retryStat.mtimeMs },
          parseResult: retryResult
        };
      };

      const deletePath = db.prepare('DELETE FROM session_file WHERE source = ? AND file_path = ?');
      const deleteSession = db.prepare('DELETE FROM session_file WHERE source = ? AND session_id = ?');
      const insertFile = db.prepare(`
        INSERT INTO session_file(
          source, file_path, size, mtime_ms, session_id,
          project_name, project_display_name, project_full_path,
          first_message, git_branch, provider, model,
          started_at, updated_at, message_count, usage_json, extra_json,
          parser_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertMessage = db.prepare(`
        INSERT INTO session_message(
          source, session_id, ordinal, message_id, role, type, subtype,
          content, timestamp, model, provider, user_message_number, extra_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const statements = { deletePath, deleteSession, insertFile, insertMessage, db };

      db.exec('BEGIN IMMEDIATE');
      try {
        for (const [filePath, row] of indexedFiles.entries()) {
          if ((!projectName || row.projectName === projectName) && !activePaths.has(filePath)) {
            deletePath.run(source, filePath);
            db.prepare('DELETE FROM session_summary WHERE source = ? AND file_path = ?').run(source, filePath);
          }
        }
        db.exec('COMMIT');
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch (_) {}
        throw error;
      }

      const recordParseError = (descriptor, error) => {
        const detail = `${descriptor.filePath}: ${error.message}`;
        errorMsg = errorMsg ? `${errorMsg}; ${detail}` : detail;
      };

      for (let batchStart = 0; batchStart < toParse.length; batchStart += INVENTORY_PARSE_BATCH_SIZE) {
        const batch = toParse.slice(batchStart, batchStart + INVENTORY_PARSE_BATCH_SIZE);
        const parsed = new Array(batch.length);
        let next = 0;
        const parseWorker = async () => {
          while (true) {
            const index = next++;
            if (index >= batch.length) return;
            const descriptor = batch[index];
            try {
              parsed[index] = { descriptor, value: await parseDescriptor(descriptor) };
            } catch (error) {
              parsed[index] = { descriptor, error };
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(INVENTORY_PARSE_CONCURRENCY, batch.length) }, parseWorker));

        for (const item of parsed) {
          if (item?.error) recordParseError(item.descriptor, item.error);
        }

        db.exec('BEGIN IMMEDIATE');
        try {
          for (const item of parsed) {
            if (item?.value) {
              const { descriptor, parseResult } = item.value;
              _insertSession(statements, source, descriptor, parseResult.session, parseResult.messages, parserVersion);
            }
          }
          db.exec('COMMIT');
        } catch (error) {
          try { db.exec('ROLLBACK'); } catch (_) {}
          throw error;
        }
        // Drop the batch references before parsing the next group. This is
        // the key difference from the old whole-inventory array: large
        // session payloads no longer accumulate until the final COMMIT.
      }

      stateToRecord = {
        lastInventoryMs: projectName ? null : Date.now(),
        lastError: errorMsg
      };
      sourceFreshness.set(projectName ? `${source}:${projectName}` : source, projectName
        ? { kind: 'project', projectName, at: Date.now() }
        : { kind: 'source', at: Date.now() });
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
          if (db && !projectName) {
            _recordSourceState(db, source, stateToRecord.lastInventoryMs, stateToRecord.lastError);
          }
        } catch (_err) {}
      }
      _releaseInventoryLock(inventoryLock);
    }
  }


  function _insertSession(statements, source, descriptor, session, messages, parserVersion) {
    const { deletePath, deleteSession, insertFile, insertMessage } = statements;
    deletePath.run(source, descriptor.filePath);
    deleteSession.run(source, session.sessionId);
    insertFile.run(
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
      session.extraJson || null,
      parserVersion
    );
    _upsertSummary(statements.db || _getDb(), source, descriptor, session);

    let ordinal = 0;
    for (const msg of messages) {
      insertMessage.run(
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



  // ---- Public query methods ----

  function _projectRowsToPayload(rows, source, page, limit, total) {
    return {
      projects: rows.map(r => ({
        name: r.project_name,
        displayName: r.project_display_name || r.project_name,
        fullPath: r.project_full_path || '',
        path: r.project_full_path || '',
        sessionCount: Number(r.session_count) || 0,
        lastUsed: r.last_used,
        latestSession: r.latest_session,
        source
      })),
      currentProject: null,
      pagination: {
        page,
        limit,
        total,
        hasMore: page * limit < total
      }
    };
  }

  function _sessionRowToSummary(r) {
    const extra = _safeParseObject(r.extra_json);
    return {
      sessionId: r.session_id,
      filePath: r.file_path,
      size: Number(r.size) || 0,
      mtime: r.mtime_ms,
      firstMessage: r.first_message,
      gitBranch: r.git_branch,
      provider: r.provider,
      model: r.model,
      messageCount: r.message_count == null ? null : Number(r.message_count),
      tokens: _safeParseJson(r.usage_json, null),
      extra,
      source: r.source,
      projectName: r.project_name,
      projectHint: extra.projectHint || r.project_name,
      projectDisplayName: r.project_display_name,
      projectFullPath: r.project_full_path,
      startedAt: r.started_at,
      updatedAt: r.updated_at
    };
  }

  async function listProjectsPage(source, options = {}) {
    await ensureSummaryIndexed(source, {
      force: options.force === true,
      consistency: options.consistency || 'stale-ok',
      config: options.config
    });
    const db = _getDb();
    const { page, limit, query } = _normalizeListOpts(options);
    const pattern = `%${query.replace(/[%_]/g, ch => `\\${ch}`)}%`;
    const queryClause = query
      ? `AND (project_name LIKE ? ESCAPE '\\' OR project_display_name LIKE ? ESCAPE '\\' OR project_full_path LIKE ? ESCAPE '\\')`
      : '';
    const queryParams = query ? [pattern, pattern, pattern] : [];
    const total = Number(db.prepare(`
      SELECT COUNT(*) AS total FROM (
        SELECT project_name FROM session_summary
        WHERE source = ? ${queryClause}
        GROUP BY project_name
      )
    `).get(source, ...queryParams)?.total) || 0;
    const rows = db.prepare(`
      SELECT project_name, MAX(project_display_name) AS project_display_name,
             MAX(project_full_path) AS project_full_path,
             COUNT(*) AS session_count,
             MAX(updated_at) AS last_used,
             (SELECT session_id FROM session_summary sf2
              WHERE sf2.source = ? AND sf2.project_name = sf.project_name
              ORDER BY updated_at DESC, session_id ASC LIMIT 1) AS latest_session
      FROM session_summary sf
      WHERE source = ? ${queryClause}
      GROUP BY project_name
      ORDER BY last_used DESC, project_name ASC
      LIMIT ? OFFSET ?
    `).all(source, source, ...queryParams, limit, (page - 1) * limit);
    return _projectRowsToPayload(rows, source, page, limit, total);
  }

  async function getAllProjects(source, options = {}) {
    const projects = [];
    let page = 1;
    const limit = 100;
    while (true) {
      const payload = await listProjectsPage(source, {
        ...options,
        page,
        limit,
        // A forced refresh is only needed once. Repeating it for every page
        // would serialize needless metadata scans.
        force: page === 1 ? options.force === true : false
      });
      projects.push(...(Array.isArray(payload.projects) ? payload.projects : []));
      if (!payload.pagination?.hasMore) break;
      page += 1;
    }
    return projects;
  }

  async function listProjects(source, options = {}) {
    return getAllProjects(source, options);
  }

  async function listSessionsPage(source, projectName, options = {}) {
    await ensureSummaryIndexed(source, {
      force: options.force === true,
      consistency: options.consistency || 'stale-ok',
      config: options.config
    });
    const db = _getDb();
    const { page, limit, query } = _normalizeListOpts(options);
    const pattern = `%${query.replace(/[%_]/g, ch => `\\${ch}`)}%`;
    const queryClause = query
      ? `AND (session_id LIKE ? ESCAPE '\\' OR first_message LIKE ? ESCAPE '\\' OR git_branch LIKE ? ESCAPE '\\')`
      : '';
    const queryParams = query ? [pattern, pattern, pattern] : [];
    const countRow = db.prepare(`
      SELECT COUNT(*) AS total, COALESCE(SUM(size), 0) AS total_size
      FROM session_summary
      WHERE source = ? AND project_name = ? ${queryClause}
    `).get(source, projectName, ...queryParams);
    const total = Number(countRow?.total) || 0;
    const totalSize = Number(countRow?.total_size) || 0;
    const rows = db.prepare(`
      SELECT s.*,
             f.message_count AS content_message_count,
             f.usage_json AS content_usage_json,
             f.extra_json AS content_extra_json
      FROM session_summary s
      LEFT JOIN session_file f ON f.source = s.source AND f.session_id = s.session_id
      WHERE s.source = ? AND s.project_name = ? ${queryClause}
      ORDER BY s.updated_at DESC, s.session_id ASC
      LIMIT ? OFFSET ?
    `).all(source, projectName, ...queryParams, limit, (page - 1) * limit);
    const sessions = rows.map(r => _sessionRowToSummary({
      ...r,
      session_id: r.session_id,
      file_path: r.file_path,
      size: r.size,
      mtime_ms: r.mtime_ms,
      first_message: r.first_message,
      git_branch: r.git_branch,
      provider: r.provider,
      model: r.model,
      project_name: r.project_name,
      project_display_name: r.project_display_name,
      project_full_path: r.project_full_path,
      started_at: r.started_at,
      updated_at: r.updated_at,
      source: r.source,
      extra_json: r.content_extra_json || r.extra_json,
      message_count: r.content_message_count,
      usage_json: r.content_usage_json
    }));
    return {
      sessions,
      totalSize,
      projectInfo: { sessionCount: total, totalSize },
      pagination: { page, limit, total, hasMore: page * limit < total }
    };
  }

  async function listSessions(source, projectName, options = {}) {
    // Keep the historical internal API stable for commands and callers that
    // explicitly request the complete index. HTTP list routes use
    // listSessionsPage above and therefore never enter this path.
    await ensureSourceIndexed(source, {
      force: options.force === true,
      consistency: options.consistency || 'stale-ok',
      config: options.config
    });
    const db = _getDb();
    const rows = db.prepare(`
      SELECT * FROM session_file
      WHERE source = ? AND project_name = ?
      ORDER BY updated_at DESC, session_id ASC
    `).all(source, projectName);
    return rows.map(_sessionRowToSummary);
  }

  async function _parseSingleSessionContent(source, summaryRow, config = indexConfig) {
    const adapter = _resolveSessionsAdapter(source, config);
    const descriptor = {
      filePath: summaryRow.file_path,
      size: Number(summaryRow.size) || 0,
      mtimeMs: Number(summaryRow.mtime_ms) || 0,
      sessionId: summaryRow.session_id,
      projectHint: summaryRow.project_name,
      projectsDir: source === 'claude' ? config.projectsDir : explicitProjectsDir
    };
    const parseResult = await adapter.parse(descriptor);
    if (_isTypedFailureResult(parseResult)) throw _typedFailureToError(parseResult);
    if (!parseResult?.session || typeof parseResult.session !== 'object'
      || typeof parseResult.session.sessionId !== 'string'
      || !parseResult.session.sessionId.trim()
      || !Array.isArray(parseResult.messages)) {
      throw new Error('invalid parsed session result');
    }
    return { descriptor, parseResult };
  }

  /**
   * Parse and index exactly one file for detail requests. This map is shared
   * by outline, messages, and status callers so opening a session while the
   * drawer fires concurrent requests cannot duplicate the expensive parse.
   */
  async function ensureSessionContentIndexed(source, sessionId, options = {}) {
    const key = `content:${source}:${sessionId}`;
    if (_contentInflight.has(key)) return _contentInflight.get(key);
    const promise = (async () => {
      await ensureSummaryIndexed(source, {
        force: options.force === true,
        consistency: 'complete',
        config: options.config || indexConfig
      });
      const db = _getDb();
      const summaryRow = db.prepare(
        'SELECT * FROM session_summary WHERE source = ? AND session_id = ?'
      ).get(source, sessionId);
      if (!summaryRow) return null;

      let stat;
      try {
        stat = await fs.promises.stat(summaryRow.file_path);
      } catch (_) {
        db.prepare('DELETE FROM session_summary WHERE source = ? AND file_path = ?')
          .run(source, summaryRow.file_path);
        db.prepare('DELETE FROM session_file WHERE source = ? AND file_path = ?')
          .run(source, summaryRow.file_path);
        return null;
      }

      const current = db.prepare(`
        SELECT * FROM session_file
        WHERE source = ? AND session_id = ? AND file_path = ?
      `).get(source, sessionId, summaryRow.file_path);
      if (current
        && Number(current.size) === Number(stat.size)
        && Number(current.mtime_ms) === Number(stat.mtimeMs)
        && Number(current.content_indexed ?? 1) === 1) {
        return current;
      }

      const parsed = await _parseSingleSessionContent(source, {
        ...summaryRow,
        size: stat.size,
        mtime_ms: stat.mtimeMs
      }, options.config || indexConfig);
      let afterStat;
      try {
        afterStat = await fs.promises.stat(summaryRow.file_path);
      } catch (_) {
        return null;
      }
      if (afterStat.size !== stat.size || afterStat.mtimeMs !== stat.mtimeMs) {
        // A growing session is left as a stale summary. The next detail
        // request retries it after the writer has produced a stable file.
        return null;
      }

      const deletePath = db.prepare('DELETE FROM session_file WHERE source = ? AND file_path = ?');
      const deleteSession = db.prepare('DELETE FROM session_file WHERE source = ? AND session_id = ?');
      const insertFile = db.prepare(`
        INSERT INTO session_file(
          source, file_path, size, mtime_ms, session_id,
          project_name, project_display_name, project_full_path,
          first_message, git_branch, provider, model,
          started_at, updated_at, message_count, usage_json, extra_json,
          parser_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertMessage = db.prepare(`
        INSERT INTO session_message(
          source, session_id, ordinal, message_id, role, type, subtype,
          content, timestamp, model, provider, user_message_number, extra_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      db.exec('BEGIN IMMEDIATE');
      try {
        _insertSession(
          { deletePath, deleteSession, insertFile, insertMessage, db },
          source,
          { ...parsed.descriptor, size: afterStat.size, mtimeMs: afterStat.mtimeMs },
          parsed.parseResult.session,
          parsed.parseResult.messages,
          _parserVersionForSource(source, _resolveSessionsAdapter(source, options.config || indexConfig))
        );
        db.exec('COMMIT');
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch (_) {}
        throw error;
      }
      return db.prepare(
        'SELECT * FROM session_file WHERE source = ? AND session_id = ?'
      ).get(source, parsed.parseResult.session.sessionId);
    })();
    _contentInflight.set(key, promise);
    promise.finally(() => {
      if (_contentInflight.get(key) === promise) _contentInflight.delete(key);
    }).catch(() => {});
    return promise;
  }

  /**
   * @param {string} source
   * @param {string} sessionId
   * @param {object} [options]
   * @returns {Promise<{sessionId, lastModified, size, filePath}|null>}
   */
  async function getSessionStatus(source, sessionId, options = {}) {
    await _ensureSessionCurrent(source, sessionId, options);
    const db = _getDb();
    const row = db.prepare(
      'SELECT session_id, mtime_ms, size, file_path FROM session_summary WHERE source = ? AND session_id = ?'
    ).get(source, sessionId);
    if (!row) return null;

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
    await ensureSessionContentIndexed(source, sessionId, options);
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
    await ensureSessionContentIndexed(source, sessionId, options);
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
        extra: _safeParseObject(r.extra_json)
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
    await ensureSummaryIndexed(source, {
      force: options.force === true,
      consistency: options.consistency || 'stale-ok',
      config: options.config
    });
    const db = _getDb();

    const rows = db.prepare(`
      SELECT s.*,
             f.message_count AS content_message_count,
             f.usage_json AS content_usage_json,
             f.extra_json AS content_extra_json
      FROM session_summary s
      LEFT JOIN session_file f ON f.source = s.source AND f.session_id = s.session_id
      WHERE s.source = ?
      ORDER BY s.updated_at DESC, s.session_id ASC
      LIMIT ?
    `).all(source, Math.max(1, Math.min(limit, 100)));

    return rows.map(r => _sessionRowToSummary({
      ...r,
      message_count: r.content_message_count,
      usage_json: r.content_usage_json,
      extra_json: r.content_extra_json || r.extra_json
    }));
  }

  /**
   * @param {string} source
   * @param {string} keyword
   * @param {object} [options]
   * @returns {Promise<Array>}
   */
  async function searchSessions(source, keyword, options = {}) {
    if (!String(keyword || '').trim()) return [];
    const projectName = typeof options.projectName === 'string' && options.projectName.trim()
      ? options.projectName.trim()
      : null;
    const resultLimit = Math.max(1, Math.min(200, Number.parseInt(options.limit, 10) || 100));
    await ensureSourceIndexed(source, {
      force: options.force === true,
      consistency: options.consistency || 'complete',
      projectName,
      config: options.config
    });
    const db = _getDb();
    const contextLength = Math.max(1, Math.min(200, Number(options.contextLength) || 35));

    // Build candidate query
    let candidates;
    if (_ftsAvailable) {
      // FTS5 trigram search for needles >= 3 chars
      const needle = String(keyword);
      if ([...needle].length >= 3) {
        const ftsRows = db.prepare(`
          WITH matched_sessions AS (
            SELECT sm.source, sm.session_id, MAX(sf.updated_at) AS updated_at
            FROM session_message_fts fts
            JOIN session_message sm ON sm.rowid = fts.rowid
            JOIN session_file sf ON sf.source = sm.source AND sf.session_id = sm.session_id
            WHERE sm.source = ? AND session_message_fts MATCH ?
            ${projectName ? 'AND sf.project_name = ?' : ''}
            GROUP BY sm.source, sm.session_id
            ORDER BY updated_at DESC, sm.session_id ASC
            LIMIT ?
          )
          SELECT sm.source, sm.session_id, sm.ordinal, sm.content, sm.role, sm.type, sm.timestamp,
                 sf.project_name, sf.project_display_name, sf.project_full_path,
                 sf.file_path, sf.first_message, sf.updated_at
          FROM session_message_fts fts
          JOIN session_message sm ON sm.rowid = fts.rowid
          JOIN matched_sessions ms ON ms.source = sm.source AND ms.session_id = sm.session_id
          JOIN session_file sf ON sf.source = sm.source AND sf.session_id = sm.session_id
          WHERE session_message_fts MATCH ?
          ORDER BY ms.updated_at DESC, sm.ordinal ASC, sm.rowid ASC
        `);
        const params = [source, _ftsQuote(needle)];
        if (projectName) params.push(projectName);
        params.push(resultLimit);
        params.push(_ftsQuote(needle));
        candidates = ftsRows.all(...params);
      } else {
        // Short needle: scan all messages for this source
        candidates = _scanMessagesRelational(db, source, keyword, projectName, resultLimit);
      }
    } else {
      candidates = _scanMessagesRelational(db, source, keyword, projectName, resultLimit);
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
      let entry = matchMap.get(c.session_id);
      if (!entry) {
        entry = {
          session: {
            source: c.source,
            session_id: c.session_id,
            project_name: c.project_name,
            project_display_name: c.project_display_name,
            project_full_path: c.project_full_path,
            file_path: c.file_path,
            first_message: c.first_message,
            updated_at: c.updated_at
          },
          matchCount: 0,
          messages: []
        };
        matchMap.set(c.session_id, entry);
      }

      entry.matchCount += source === 'claude' ? count : 1;
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

    // Search is a recency browser: matchCount remains useful metadata, but
    // should not push older conversations above newer ones.
    results.sort((a, b) => {
      const aRow = matchMap.get(a.sessionId);
      const bRow = matchMap.get(b.sessionId);
      const au = _timestampValue(aRow && aRow.session.updated_at);
      const bu = _timestampValue(bRow && bRow.session.updated_at);
      return bu - au || a.sessionId.localeCompare(b.sessionId);
    });

    return results.slice(0, resultLimit);
  }

  function _scanMessagesRelational(db, source, keyword, projectName = null, resultLimit = 100) {
    const useSqlMatch = /^[\x00-\x7F]*$/.test(String(keyword));
    const select = `
      SELECT sm.source, sm.session_id, sm.ordinal, sm.content, sm.role, sm.type, sm.timestamp,
             sf.project_name, sf.project_display_name, sf.project_full_path,
             sf.file_path, sf.first_message, sf.updated_at
      FROM session_message sm
      JOIN session_file sf ON sf.source = sm.source AND sf.session_id = sm.session_id
      WHERE sm.source = ?
      ${projectName ? 'AND sf.project_name = ?' : ''}
    `;

    if (useSqlMatch) {
      const sql = `
        WITH matched_messages AS (
          SELECT sm.source, sm.session_id, sm.ordinal, sm.rowid AS message_rowid,
                 sm.content, sm.role, sm.type, sm.timestamp,
                 sf.project_name, sf.project_display_name, sf.project_full_path,
                 sf.file_path, sf.first_message, sf.updated_at
          FROM session_message sm
          JOIN session_file sf ON sf.source = sm.source AND sf.session_id = sm.session_id
          WHERE sm.source = ?
          ${projectName ? 'AND sf.project_name = ?' : ''}
          AND instr(lower(sm.content), lower(?)) > 0
        ),
        matched_sessions AS (
          SELECT source, session_id, MAX(updated_at) AS updated_at
          FROM matched_messages
          GROUP BY source, session_id
          ORDER BY updated_at DESC, session_id ASC
          LIMIT ?
        )
        SELECT mm.source, mm.session_id, mm.ordinal, mm.content, mm.role, mm.type, mm.timestamp,
               mm.project_name, mm.project_display_name, mm.project_full_path,
               mm.file_path, mm.first_message, mm.updated_at
        FROM matched_messages mm
        JOIN matched_sessions ms ON ms.source = mm.source AND ms.session_id = mm.session_id
        ORDER BY ms.updated_at DESC, mm.ordinal ASC, mm.message_rowid ASC`;
      const params = [source];
      if (projectName) params.push(projectName);
      params.push(keyword, Math.max(1, resultLimit));
      return db.prepare(sql).all(...params);
    }

    // SQLite's lower() is ASCII-oriented. Page the broad joined query and
    // apply the same locale-aware JavaScript matcher used by searchSessions,
    // collecting at most the 500 matching candidates (not 500 raw rows).
    const candidates = [];
    const matchedSessionIds = new Set();
    const pageSize = 500;
    let offset = 0;
    let stop = false;
    while (!stop) {
      const params = [source];
      if (projectName) params.push(projectName);
      params.push(pageSize, offset);
      const batch = db.prepare(`${select}\nORDER BY sf.updated_at DESC, sm.ordinal ASC, sm.rowid ASC\nLIMIT ? OFFSET ?`).all(...params);
      if (batch.length === 0) break;
      for (const row of batch) {
        if (!_containsLocaleMatch(row.content, keyword)) continue;
        if (!matchedSessionIds.has(row.session_id)) {
          if (matchedSessionIds.size >= resultLimit) {
            stop = true;
            break;
          }
          matchedSessionIds.add(row.session_id);
        }
        candidates.push(row);
      }
      if (batch.length < pageSize) break;
      offset += batch.length;
    }
    return candidates;
  }

  function _containsLocaleMatch(content, keyword) {
    const lowerKeyword = String(keyword).toLocaleLowerCase();
    return String(content || '').toLocaleLowerCase().indexOf(lowerKeyword) !== -1;
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
      usage: _safeParseObject(sf.usage_json),
      extra: _safeParseObject(sf.extra_json)
    };
  }

  /**
   * Ensure the indexed data for a session is current by checking file mtime.
   */
  async function _ensureSessionCurrent(source, sessionId, options = {}) {
    const db = _getDb();
    let row = db.prepare(
      'SELECT file_path, size, mtime_ms FROM session_summary WHERE source = ? AND session_id = ?'
    ).get(source, sessionId);
    if (!row) {
      const fullState = db.prepare(
        'SELECT last_inventory_ms FROM source_state WHERE source = ?'
      ).get(source);
      const fullIndexIsFresh = fullState?.last_inventory_ms
        && Date.now() - Number(fullState.last_inventory_ms) < INDEX_INVENTORY_TTL_MS;
      // A completed legacy inventory with no matching session row is a
      // definitive miss (including malformed files). Do not start a second
      // summary scan merely because this status probe is lightweight.
      if (fullIndexIsFresh && options.force !== true) return;
      await ensureSummaryIndexed(source, {
        force: options.force === true,
        consistency: 'complete',
        config: options.config || indexConfig
      });
      row = db.prepare(
        'SELECT file_path, size, mtime_ms FROM session_summary WHERE source = ? AND session_id = ?'
      ).get(source, sessionId);
    }
    if (!row) return;

    const fileKey = `${source}:${row.file_path}`;
    const now = Date.now();
    const cached = fileVersions.get(fileKey);
    if (cached && now - cached.checkedAt < INDEX_INVENTORY_TTL_MS) return;

    const activeCheck = fileChecks.get(fileKey);
    if (activeCheck) {
      await activeCheck;
      return;
    }

    const check = (async () => {
      let currentStat;
      try {
        currentStat = await fs.promises.stat(row.file_path);
      } catch (_) {
        fileVersions.set(fileKey, { size: -1, mtimeMs: -1, checkedAt: Date.now(), missing: true });
        db.prepare('DELETE FROM session_summary WHERE source = ? AND file_path = ?').run(source, row.file_path);
        db.prepare('DELETE FROM session_file WHERE source = ? AND file_path = ?').run(source, row.file_path);
        return;
      }

      fileVersions.set(fileKey, {
        size: currentStat.size,
        mtimeMs: currentStat.mtimeMs,
        checkedAt: Date.now()
      });
      if (currentStat.size !== row.size || currentStat.mtimeMs !== row.mtime_ms) {
        await ensureSummaryIndexed(source, {
          force: true,
          consistency: 'complete',
          config: options.config || indexConfig
        });
      }
    })();
    fileChecks.set(fileKey, check);
    try {
      await check;
    } finally {
      if (fileChecks.get(fileKey) === check) fileChecks.delete(fileKey);
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
      db.prepare('DELETE FROM session_summary WHERE source = ? AND session_id = ?').run(source, options.sessionId);
    }
    if (options.projectName) {
      db.prepare('DELETE FROM session_file WHERE source = ? AND project_name = ?').run(source, options.projectName);
      db.prepare('DELETE FROM session_summary WHERE source = ? AND project_name = ?').run(source, options.projectName);
    }

    // Mark state as stale
    db.prepare(
      'UPDATE source_state SET last_inventory_ms = NULL WHERE source = ?'
    ).run(source);
    db.prepare(
      'UPDATE source_state SET summary_inventory_ms = NULL, summary_error = NULL WHERE source = ?'
    ).run(source);
    for (const key of fileVersions.keys()) {
      if (key.startsWith(`${source}:`)) fileVersions.delete(key);
    }
    for (const key of sourceFreshness.keys()) {
      if (key === source || key.startsWith(`${source}:`)) sourceFreshness.delete(key);
    }
  }
  function getSourceIndexMeta(source) {
    const row = _getDb().prepare(
      'SELECT last_inventory_ms, last_error, summary_inventory_ms, summary_error FROM source_state WHERE source = ?'
    ).get(source);
    const generatedAt = row?.summary_inventory_ms
      ? Number(row.summary_inventory_ms)
      : (row?.last_inventory_ms ? Number(row.last_inventory_ms) : null);
    const error = row?.summary_error || row?.last_error || null;
    const stale = Boolean(error) || !generatedAt || Date.now() - generatedAt >= INDEX_INVENTORY_TTL_MS;
    const refreshing = _summaryInflight.has(`summary:${source}`)
      || [..._inflight.keys()].some(key => key === `ensure:${source}:*` || key.startsWith(`ensure:${source}:`))
      || _hasActiveInventoryLock(dbPath);
    return {
      generatedAt,
      stale,
      refreshing,
      fallback: Boolean(error && !_hasSummaryData(source)),
      error
    };
  }
  function closeSessionHistoryIndex() {
    closeDatabase(dbPath);
    _db = null;
    fileVersions.clear();
    fileChecks.clear();
    _summaryInflight.clear();
    _contentInflight.clear();
    sourceFreshness.clear();
  }

  // Build the API object
  const api = {
    ensureSourceIndexed,
    ensureSummaryIndexed,
    ensureSessionContentIndexed,
    getAllProjects,
    listProjects,
    listProjectsPage,
    listSessions,
    listSessionsPage,
    getSessionStatus,
    getSessionOutline,
    getMessagePage,
    getRecentSessions,
    searchSessions,
    invalidateSource,
    getSourceIndexMeta,
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

function _getDefaultIndex(options = {}) {
  if (!_defaultIndex) {
    _defaultIndex = Object.keys(options).length > 0
      ? createSessionHistoryIndex({ config: options })
      : createSessionHistoryIndex();
  }
  return _defaultIndex;
}

async function ensureSourceIndexed(source, options) {
  return _getDefaultIndex().ensureSourceIndexed(source, options);
}

async function listProjects(source, options) {
  return _getDefaultIndex(options).listProjects(source, options);
}

async function ensureSummaryIndexed(source, options) {
  return _getDefaultIndex(options).ensureSummaryIndexed(source, options);
}

async function ensureSessionContentIndexed(source, sessionId, options) {
  return _getDefaultIndex(options).ensureSessionContentIndexed(source, sessionId, options);
}

async function listProjectsPage(source, options) {
  return _getDefaultIndex(options).listProjectsPage(source, options);
}

async function getAllProjects(source, options) {
  return _getDefaultIndex(options).getAllProjects(source, options);
}

async function listSessions(source, projectName, options) {
  return _getDefaultIndex().listSessions(source, projectName, options);
}

async function listSessionsPage(source, projectName, options) {
  return _getDefaultIndex().listSessionsPage(source, projectName, options);
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

function getSourceIndexMeta(source) {
  return _getDefaultIndex().getSourceIndexMeta(source);
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
  ensureSummaryIndexed,
  ensureSessionContentIndexed,
  getAllProjects,
  listProjects,
  listProjectsPage,
  listSessions,
  listSessionsPage,
  getSessionStatus,
  getSessionOutline,
  getMessagePage,
  getRecentSessions,
  searchSessions,
  invalidateSource,
  getSourceIndexMeta,
  closeSessionHistoryIndex,
  cleanupStaleInventoryLocks,
};
