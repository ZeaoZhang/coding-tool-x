'use strict';

const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { NATIVE_PATHS } = require('../../../config/paths');
const { normalizeCost, normalizeUsage, hasUsage, subtractUsage } = require('../native-log-utils');
const { calculateUsageCost } = require('../../../server/services/usage-log-utils');

function getDatabasePath(fsImpl = fs) {
  const configured = typeof process.env.OPENCODE_DB_PATH === 'string' ? process.env.OPENCODE_DB_PATH.trim() : '';
  if (configured && fsImpl.existsSync(configured)) return configured;
  return require('./sessions-implementation').getOpenCodeDbPath
    ? require('./sessions-implementation').getOpenCodeDbPath()
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

function readUsageRows(db) {
  const rows = db.prepare(`
    SELECT p.id, p.session_id, p.message_id, p.time_created, p.time_updated, p.data,
           m.data AS message_data
    FROM part p
    LEFT JOIN message m ON m.id = p.message_id
    ORDER BY p.time_created ASC
  `).all();

  return rows.flatMap(row => {
    const part = parseJson(row.data);
    const message = parseJson(row.message_data) || {};
    const usage = part?.tokens || part?.usage || (part?.type === 'step-finish' ? part : null);
    if (!usage || !hasUsage(usage)) return [];
    return [{
      id: `opencode:${row.session_id}:${row.id}`,
      source: 'opencode',
      sessionId: row.session_id,
      timestamp: row.time_updated || row.time_created,
      provider: part.provider || part.providerID || message.provider || message.providerID || message.model?.providerID || '',
      model: part.model || part.modelID || message.model || message.modelID || message.model?.modelID || '',
      tokens: normalizeUsage(usage),
      cost: normalizeCost(part.cost ?? usage.cost)
        || calculateUsageCost('opencode', part.model || part.modelID || message.model || message.modelID || '', normalizeUsage(usage))
    }];
  });
}

function createDriver({ fsImpl = fs } = {}) {
  return {
    platform: 'opencode',
    capability: 'nativeLogs',
    createNativeLogCursor({ fs: cursorFs = fsImpl } = {}) {
      let rowState = new Map();
      let initialized = false;

      const read = () => {
        const dbPath = getDatabasePath(cursorFs);
        if (!dbPath || !cursorFs.existsSync(dbPath)) return [];
        let db;
        try {
          db = new DatabaseSync(dbPath, { readOnly: true, timeout: 1000 });
          const rows = readUsageRows(db);
          const events = [];
          for (const event of rows) {
            const signature = usageSignature(event);
            const previous = rowState.get(event.id);
            if (!previous) {
              rowState.set(event.id, { signature, tokens: event.tokens });
              if (initialized) events.push(event);
              continue;
            }
            if (previous.signature === signature) continue;

            const delta = subtractUsage(event.tokens, previous.tokens);
            rowState.set(event.id, { signature, tokens: event.tokens });
            if (initialized && hasUsage(delta)) {
              events.push({
                ...event,
                id: versionedId(event.id, signature),
                tokens: delta,
                cost: calculateUsageCost('opencode', event.model, delta)
              });
            }
          }
          initialized = true;
          return events;
        } catch (_) {
          return [];
        } finally {
          try { db?.close(); } catch (_) {}
        }
      };

      return {
        initialize() { read(); },
        readNewEvents: read,
        read,
        reset() { rowState = new Map(); initialized = false; },
        close() { rowState.clear(); initialized = false; }
      };
    },
    createCursor(options) { return this.createNativeLogCursor(options); }
  };
}

module.exports = { createDriver };
