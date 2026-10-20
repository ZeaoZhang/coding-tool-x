'use strict';

const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { NATIVE_PATHS } = require('../../../config/paths');
const { normalizeCost, normalizeUsage, hasUsage, subtractUsage } = require('../native-log-utils');
const { calculateUsageCost, createUsageCostCalculator } = require('../../../server/services/usage-log-utils');
const { createNativeLogCheckpoints, createPersistenceRetryState } = require('../../../server/services/native-log-checkpoints');

function getDatabasePath(fsImpl = fs, dataDir) {
  const configured = typeof process.env.OPENCODE_DB_PATH === 'string' ? process.env.OPENCODE_DB_PATH.trim() : '';
  if (configured && fsImpl.existsSync(configured)) return configured;
  return require('./sessions-implementation').getOpenCodeDbPath
    ? require('./sessions-implementation').getOpenCodeDbPath(dataDir)
    : require('path').join(NATIVE_PATHS.opencode.data, 'opencode.db');
}

function parseJson(value) {
  try { return JSON.parse(value); } catch (_) { return null; }
}

function usageSignature(event) {
  return JSON.stringify({
    provider: event.provider || '',
    model: event.model || '',
    tokens: event.tokens,
    cost: event.cost || 0
  });
}

function versionedId(id, signature) {
  return `${id}:${crypto.createHash('sha1').update(signature).digest('hex').slice(0, 12)}`;
}

function* readUsageRows(db, rowState) {
  const calculateCost = createUsageCostCalculator('opencode');
  const rows = db.prepare(`
    WITH usage_rows AS (
    SELECT p.id, p.session_id, p.message_id, p.time_created, p.time_updated, p.data,
           CASE WHEN json_valid(m.data) THEN json_object(
             'provider', json_extract(m.data, '$.provider'),
             'providerID', json_extract(m.data, '$.providerID'),
             'model', json_extract(m.data, '$.model'),
             'modelID', json_extract(m.data, '$.modelID')) ELSE NULL END AS message_data
    FROM part p
    LEFT JOIN message m ON m.id = p.message_id
    WHERE CASE WHEN json_valid(p.data) THEN
      json_type(p.data, '$.tokens') IS NOT NULL OR json_type(p.data, '$.usage') IS NOT NULL
      OR json_extract(p.data, '$.type') = 'step-finish' ELSE 0 END
    )
    SELECT p.* FROM usage_rows p
    LEFT JOIN native_checkpoints.states s
      ON s.scope = 'rows' AND s.key = 'opencode:' || p.session_id || ':' || p.id
    WHERE s.key IS NULL OR s.source_data IS NOT p.data OR s.related_data IS NOT p.message_data
    ORDER BY p.time_created ASC
  `).iterate();

  for (const row of rows) {
    const id = `opencode:${row.session_id}:${row.id}`;
    const previous = rowState.get('rows', id);
    const part = parseJson(row.data);
    const message = parseJson(row.message_data) || {};
    const usage = part?.tokens || part?.usage || (part?.type === 'step-finish' ? part : null);
    if (!usage || !hasUsage(usage)) continue;
    yield { previous, source: { data: row.data, relatedData: row.message_data }, event: {
      id,
      source: 'opencode',
      sessionId: row.session_id,
      timestamp: row.time_updated || row.time_created,
      provider: part.provider || part.providerID || message.provider || message.providerID || message.model?.providerID || '',
      model: part.model || part.modelID || message.model || message.modelID || message.model?.modelID || '',
      tokens: normalizeUsage(usage),
      cost: normalizeCost(part.cost ?? usage.cost)
        || calculateCost(part.model || part.modelID || message.model || message.modelID || '', normalizeUsage(usage))
    } };
  }
}

function createDriver({ fsImpl = fs, pathContext } = {}) {
  const dataDir = pathContext?.customized ? pathContext.native?.data : undefined;
  if (pathContext?.customized) {
    require('./sessions-implementation').configure?.({ pathContext });
  }
  return {
    platform: 'opencode',
    capability: 'nativeLogs',
    createNativeLogCursor({ fs: cursorFs = fsImpl, onDiagnostic } = {}) {
      const rowState = createNativeLogCheckpoints();
      const persistence = createPersistenceRetryState();
      let databaseIdentity = null;
      let lastDatabaseStamp = null;
      let initialized = false;

      const read = () => {
        if (!persistence.ready()) return [];
        const dbPath = getDatabasePath(cursorFs, dataDir);
        const stats = { files: 0, bytesRead: 0, parsedRecords: 0, maxLineLength: 0 };
        if (!dbPath || !cursorFs.existsSync(dbPath)) {
          if (databaseIdentity) {
            try { rowState.reset(); } catch (error) {
              persistence.failed();
              console.warn('[OpenCode Native Logs] Checkpoint persistence failed:', error.message);
              return [];
            }
          }
          persistence.succeeded();
          databaseIdentity = null; lastDatabaseStamp = null; initialized = false;
          try { onDiagnostic?.(stats); } catch (_) {}
          return [];
        }
        stats.files = 1;
        let databaseStamp = null;
        try {
          const stat = cursorFs.statSync(dbPath);
          stats.bytesRead = stat.size;
          const identity = `${dbPath}:${stat.dev}:${stat.ino}`;
          if (databaseIdentity && databaseIdentity !== identity) {
            rowState.reset();
            initialized = false;
            lastDatabaseStamp = null;
          }
          const stamps = [stat];
          try { stamps.push(cursorFs.statSync(`${dbPath}-wal`)); } catch (_) {}
          databaseStamp = JSON.stringify(stamps.map(value => [value.size, value.mtimeMs, value.ctimeMs]));
          databaseIdentity = identity;
        } catch (error) {
          if (error.checkpointPersistenceFailure) {
            persistence.failed();
            console.warn('[OpenCode Native Logs] Checkpoint persistence failed:', error.message);
            return [];
          }
        }
        if (initialized && databaseStamp && databaseStamp === lastDatabaseStamp) return [];
        let db;
        try {
          db = new DatabaseSync(dbPath, { readOnly: true, timeout: 1000 });
          db.exec('PRAGMA cache_size = -2048; PRAGMA temp_store = FILE;');
          rowState.attachReadOnly(db);
          const events = rowState.transaction(() => {
            const events = [];
            for (const { event, previous, source } of readUsageRows(db, rowState)) {
              stats.parsedRecords += 1;
              const signature = usageSignature(event);
              if (!previous) {
                rowState.set('rows', event.id, { signature, tokens: event.tokens }, source);
                if (initialized) events.push(event);
                if (events.length >= 500) break;
                continue;
              }
              if (previous.signature === signature) {
                rowState.set('rows', event.id, { signature, tokens: event.tokens }, source);
                continue;
              }

              const delta = subtractUsage(event.tokens, previous.tokens);
              rowState.set('rows', event.id, { signature, tokens: event.tokens }, source);
              if (initialized && hasUsage(delta)) {
                events.push({
                  ...event,
                  id: versionedId(event.id, signature),
                  tokens: delta,
                  cost: calculateUsageCost('opencode', event.model, delta)
                });
                if (events.length >= 500) break;
              }
            }
            return events;
          });
          initialized = true;
          persistence.succeeded();
          if (events.length < 500) lastDatabaseStamp = databaseStamp;
          try { onDiagnostic?.({ ...stats, initialized, ...rowState.diagnostics() }); } catch (_) {}
          return events;
        } catch (error) {
          if (error.checkpointPersistenceFailure) {
            persistence.failed();
            console.warn('[OpenCode Native Logs] Checkpoint persistence failed:', error.message);
          }
          try { onDiagnostic?.({ ...stats, parseErrors: 1, initialized, ...persistence.diagnostics() }); } catch (_) {}
          return [];
        } finally {
          try { db?.close(); } catch (_) {}
        }
      };

      return {
        initialize() { read(); },
        readNewEvents: read,
        read,
        diagnostics() { return { ...rowState.diagnostics(), ...persistence.diagnostics() }; },
        reset() { rowState.reset(); persistence.succeeded(); initialized = false; databaseIdentity = null; lastDatabaseStamp = null; },
        close() { rowState.close(); persistence.succeeded(); initialized = false; }
      };
    },
    createCursor(options) { return this.createNativeLogCursor(options); }
  };
}

module.exports = { createDriver };
