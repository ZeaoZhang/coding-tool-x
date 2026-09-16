'use strict';

const fs = require('fs');
const path = require('path');
const { NATIVE_PATHS } = require('../../../config/paths');
const {
  normalizeCost,
  normalizeUsage,
  subtractUsage,
  readFileRange,
  visitJsonLinesReverse,
  walkFiles,
  createIncrementalJsonlCursor
} = require('../native-log-utils');
const { calculateUsageCost } = require('../../../server/services/usage-log-utils');

const BOOTSTRAP_READ_BYTES = 64 * 1024;

function applyCodexRecord(state, record) {
  if (record?.type === 'session_meta') {
    state.sessionId = record.payload?.id || state.sessionId;
    state.provider = record.payload?.model_provider || state.provider;
    return;
  }
  if (record?.type === 'turn_context') {
    state.model = record.payload?.model || state.model;
    return;
  }
  if (record?.type !== 'event_msg' || record.payload?.type !== 'token_count') return;
  const usage = record.payload?.info?.total_token_usage;
  if (!usage || typeof usage !== 'object') return;
  state.pendingUsage = normalizeUsage(usage);
  state.pendingTimestamp = record.timestamp || state.pendingTimestamp;
  state.pendingCost = normalizeCost(record.payload?.info?.cost ?? usage.cost);
}

function bootstrapCodexFile(filePath, state, stat, fsImpl) {
  const head = readFileRange(filePath, 0, Math.min(stat.size, BOOTSTRAP_READ_BYTES), fsImpl).buffer.toString('utf8');
  head.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) return;
    try { applyCodexRecord(state, JSON.parse(line)); } catch (_) {}
  });

  let latestUsage = null;
  visitJsonLinesReverse(filePath, (record) => {
    if (record?.type === 'event_msg' && record.payload?.type === 'token_count' && !latestUsage) {
      const usage = record.payload?.info?.total_token_usage;
      if (usage && typeof usage === 'object') {
        latestUsage = normalizeUsage(usage);
        state.pendingTimestamp = record.timestamp || state.pendingTimestamp;
        state.pendingCost = normalizeCost(record.payload?.info?.cost ?? usage.cost);
      }
    }
    if (record?.type === 'turn_context' && !state.model) {
      state.model = record.payload?.model || state.model;
    }
    return !(latestUsage && state.model);
  }, { fsImpl });
  if (latestUsage) state.lastUsage = latestUsage;
  state.pendingUsage = null;
}

function createDriver({ nativeRoot, pathContext, fsImpl = fs } = {}) {
  const resolvedNativeRoot = pathContext?.customized
    ? (pathContext.native?.sessions || nativeRoot || NATIVE_PATHS.codex.sessions)
    : (nativeRoot || NATIVE_PATHS.codex.sessions);
  return {
    platform: 'codex',
    capability: 'nativeLogs',
    createNativeLogCursor({ fs: cursorFs = fsImpl, skipInitialParse = false } = {}) {
      const scanFiles = () => walkFiles(resolvedNativeRoot, name => /^rollout-.*\.jsonl$/.test(name), cursorFs);
      return createIncrementalJsonlCursor({
        scanFiles,
        fsImpl: cursorFs,
        skipInitialParse,
        createFileState: (filePath, _stat, previousState) => ({
          sessionId: previousState?.sessionId || path.basename(filePath, '.jsonl'),
          provider: previousState?.provider || '',
          model: previousState?.model || '',
          lastUsage: previousState?.lastUsage || null,
          pendingUsage: null,
          pendingTimestamp: null,
          pendingCost: 0
        }),
        bootstrapFile: (filePath, state, stat) => bootstrapCodexFile(filePath, state, stat, cursorFs),
        parseLine: (_filePath, record, state) => {
          applyCodexRecord(state, record);
          return null;
        },
        afterRead: (_filePath, state) => {
          if (!state.pendingUsage) return null;
          const current = state.pendingUsage;
          const previous = state.lastUsage;
          const restarted = previous && current.total < previous.total;
          const tokens = previous && !restarted ? subtractUsage(current, previous) : current;
          state.lastUsage = current;
          state.pendingUsage = null;
          if (tokens.total <= 0) return null;
          const sessionId = state.sessionId || '';
          const event = {
            id: `${sessionId}:token-count:${current.total}`,
            source: 'codex',
            sessionId,
            timestamp: state.pendingTimestamp,
            provider: state.provider,
            model: state.model,
            tokens,
            cost: state.pendingCost || calculateUsageCost('codex', state.model, tokens)
          };
          state.pendingTimestamp = null;
          state.pendingCost = 0;
          return event;
        },
        onError: (error, filePath) => {
          console.warn('[Codex Native Logs] Failed to read changed usage events:', filePath, error.message);
        }
      });
    },
    createCursor(options) { return this.createNativeLogCursor(options); }
  };
}

module.exports = { createDriver };
