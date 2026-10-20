'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { NATIVE_PATHS } = require('../../../config/paths');
const {
  normalizeCost,
  normalizeUsage,
  usageFieldPaths,
  createSelectiveJsonLineParser,
  readJsonLines,
  walkFiles,
  createScannedFileCursor,
  createIncrementalJsonlCursor
} = require('../native-log-utils');
const { calculateUsageCost, createUsageCostCalculator } = require('../../../server/services/usage-log-utils');

const MAX_WHOLE_JSON_BYTES = 16 * 1024 * 1024;
const MIN_WHOLE_JSON_PARSE_INTERVAL_MS = 15 * 1000;

const GEMINI_SELECTED_FIELDS = [
  '$set.sessionId', '$set.provider', '$set.model', '$set.lastUpdated',
  'id', 'messageId', 'uuid', 'model', 'timestamp', 'createdAt', 'provider', 'cost', 'channelId', 'channel',
  'tokens', 'usage',
  'message.id', 'message.messageId', 'message.uuid', 'message.model', 'message.timestamp',
  'message.createdAt', 'message.provider', 'message.cost', 'message.channelId', 'message.channel',
  'message.tokens', 'message.usage',
  ...usageFieldPaths('tokens'),
  ...usageFieldPaths('usage'),
  ...usageFieldPaths('message.tokens'),
  ...usageFieldPaths('message.usage')
];

function parseSession(filePath, fsImpl) {
  let content;
  try { content = fsImpl.readFileSync(filePath, 'utf8').trim(); } catch (_) { return []; }
  if (!content) return [];
  let session;
  try {
    session = JSON.parse(content);
  } catch (_) {
    const records = readJsonLines(filePath, fsImpl);
    const state = {};
    const messages = [];
    for (const record of records) {
      if (record.$set && typeof record.$set === 'object') Object.assign(state, record.$set);
      if (record.type || record.tokens || record.usage) messages.push(record);
    }
    session = { ...state, messages };
  }
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const calculateCost = createUsageCostCalculator('gemini');
  return messages.flatMap(message => {
    const usage = message.tokens || message.usage;
    if (!usage || typeof usage !== 'object') return [];
    const messageId = message.id || message.messageId || message.uuid || crypto.createHash('sha1')
      .update(JSON.stringify(message))
      .digest('hex');
    return [{
      id: `${path.basename(filePath)}:${messageId}`,
      source: 'gemini',
      sessionId: session.sessionId || path.basename(filePath),
      timestamp: message.timestamp || message.createdAt || session.lastUpdated,
      provider: message.provider || session.provider || '',
      model: message.model || session.model || '',
      tokens: normalizeUsage(usage),
      cost: normalizeCost(message.cost ?? usage.cost)
        || calculateCost(message.model || session.model || '', normalizeUsage(usage)),
      channelId: message.channelId,
      channel: message.channel
    }];
  });
}

function parseGeminiJsonlLine(filePath, record, state) {
  if (record?.$set && typeof record.$set === 'object') {
    // The usage cursor must not retain conversation bodies or arbitrary state.
    for (const key of ['sessionId', 'provider', 'model', 'lastUpdated']) {
      if (!Object.prototype.hasOwnProperty.call(record.$set, key)) continue;
      const value = record.$set[key];
      if (value === null) state.metadata[key] = '';
      else if (typeof value === 'string' || (key === 'lastUpdated' && typeof value === 'number' && Number.isFinite(value))) {
        state.metadata[key] = value;
      }
    }
  }
  const message = record?.message && typeof record.message === 'object' ? record.message : record;
  const usage = message?.tokens || message?.usage;
  if (!usage || typeof usage !== 'object') return null;
  const messageId = message.id || message.messageId || message.uuid
    || record?.id || record?.messageId || record?.uuid || `line-${state.entryIndex}`;
  const model = message.model || state.metadata.model || '';
  const sessionId = state.metadata.sessionId || path.basename(filePath);
  return {
    id: `${path.basename(filePath)}:${messageId}`,
    source: 'gemini',
    sessionId,
    timestamp: message.timestamp || message.createdAt || state.metadata.lastUpdated,
    provider: message.provider || state.metadata.provider || '',
    model,
    tokens: normalizeUsage(usage),
    cost: normalizeCost(message.cost ?? usage.cost)
      || calculateUsageCost('gemini', model, normalizeUsage(usage)),
    channelId: message.channelId,
    channel: message.channel
  };
}

function createDriver({ nativeRoot, pathContext, fsImpl = fs } = {}) {
  const resolvedNativeRoot = pathContext?.customized
    ? (pathContext.native?.tmp || nativeRoot || NATIVE_PATHS.gemini.tmp)
    : (nativeRoot || NATIVE_PATHS.gemini.tmp);
  return {
    platform: 'gemini',
    capability: 'nativeLogs',
    createNativeLogCursor({ fs: cursorFs = fsImpl, skipInitialParse = false, onDiagnostic } = {}) {
      const jsonlFiles = () => walkFiles(resolvedNativeRoot, name => /^session-.*\.jsonl$/.test(name), cursorFs);
      const jsonFiles = () => walkFiles(resolvedNativeRoot, name => /^session-.*\.json$/.test(name), cursorFs);
      const jsonlCursor = createIncrementalJsonlCursor({
        scanFiles: jsonlFiles,
        createFileState: () => ({ metadata: {} }),
        parseLine: parseGeminiJsonlLine,
        fsImpl: cursorFs,
        skipInitialParse,
        createLongLineParser: () => createSelectiveJsonLineParser(GEMINI_SELECTED_FIELDS),
        onDiagnostic,
        onError: (error, filePath) => {
          console.warn('[Gemini Native Logs] Failed to read changed JSONL events:', filePath, error.message);
        }
      });
      let lastWholeJsonParse = new Map();
      let oversizeWarned = new Set();
      let initializedWholeJsonFiles = new Set();
      let forceWholeJsonRead = false;
      const jsonCursor = createScannedFileCursor({
        scanFiles: jsonFiles,
        parseFile: filePath => {
          return parseSession(filePath, cursorFs);
        },
        shouldParseFile: (filePath, stat, { isInitialRead, skipInitialParse, persistenceRetry }) => {
          if (stat.size > MAX_WHOLE_JSON_BYTES) {
            if (!oversizeWarned.has(filePath)) {
              oversizeWarned.add(filePath);
              console.warn(`[Gemini Native Logs] Skipping oversized JSON session (${stat.size} bytes): ${filePath}`);
            }
            return false;
          }
          if (skipInitialParse) {
            return true;
          }
          if (isInitialRead || !initializedWholeJsonFiles.has(filePath)) {
            initializedWholeJsonFiles.add(filePath);
            lastWholeJsonParse.set(filePath, Date.now());
            return true;
          }
          const now = Date.now();
          const allowed = forceWholeJsonRead || persistenceRetry || now - (lastWholeJsonParse.get(filePath) || 0) >= MIN_WHOLE_JSON_PARSE_INTERVAL_MS;
          if (allowed) lastWholeJsonParse.set(filePath, now);
          return allowed;
        },
        normalizeEvent: event => event,
        fsImpl: cursorFs,
        skipInitialParse,
        parseBaseline: true,
        onDiagnostic,
        onFilesRemoved(filePath) {
          lastWholeJsonParse.delete(filePath);
          oversizeWarned.delete(filePath);
          initializedWholeJsonFiles.delete(filePath);
        }
      });
      return {
        initialize() { jsonlCursor.initialize(); jsonCursor.initialize(); },
        readNewEvents({ force = false } = {}) {
          const current = new Set(jsonFiles());
          for (const metadata of [lastWholeJsonParse, oversizeWarned, initializedWholeJsonFiles]) {
            for (const filePath of metadata.keys()) if (!current.has(filePath)) metadata.delete(filePath);
          }
          const events = jsonlCursor.readNewEvents();
          // Drain each source independently while keeping the public batch bounded.
          if (events.length) return events;
          forceWholeJsonRead = force;
          try { return jsonCursor.readNewEvents(); } finally { forceWholeJsonRead = false; }
        },
        diagnostics() {
          const jsonl = jsonlCursor.diagnostics?.() || {};
          const json = jsonCursor.diagnostics?.() || {};
          return { jsonl, json, persistenceBlocked: jsonl.persistenceBlocked || json.persistenceBlocked };
        },
        read() { return this.readNewEvents(); },
        reset() {
          jsonlCursor.reset();
          jsonCursor.reset();
          lastWholeJsonParse = new Map();
          oversizeWarned = new Set();
          initializedWholeJsonFiles = new Set();
        },
        close() {
          jsonlCursor.close();
          jsonCursor.close();
          lastWholeJsonParse.clear();
          oversizeWarned.clear();
          initializedWholeJsonFiles.clear();
        }
      };
    },
    createCursor(options) { return this.createNativeLogCursor(options); }
  };
}

module.exports = { createDriver, parseGeminiJsonlLine };
