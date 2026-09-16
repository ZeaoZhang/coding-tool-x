'use strict';

const fs = require('fs');
const path = require('path');
const { NATIVE_PATHS } = require('../../../config/paths');
const {
  normalizeCost,
  normalizeUsage,
  subtractUsage,
  usageFieldPaths,
  createSelectiveJsonLineParser,
  visitJsonLinesForward,
  visitJsonLinesReverse,
  walkFiles,
  createIncrementalJsonlCursor
} = require('../native-log-utils');
const { calculateUsageCost } = require('../../../server/services/usage-log-utils');

const CODEX_SELECTED_FIELDS = [
  'type',
  'timestamp',
  'payload.type',
  'payload.id',
  'payload.model_provider',
  'payload.model',
  'payload.info.cost.total',
  'payload.info.cost.usd',
  'payload.info.cost.amount',
  ...usageFieldPaths('payload.info.total_token_usage')
];

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

function bootstrapCodexFile(filePath, state, stat, fsImpl, stats) {
  const endOffset = stat.size;
  state.sessionId = path.basename(filePath, '.jsonl');
  state.provider = '';
  state.model = '';
  state.lastUsage = null;
  state.pendingUsage = null;
  state.pendingTimestamp = null;
  state.pendingCost = 0;
  visitJsonLinesForward(filePath, (record) => {
    if (record?.type === 'session_meta') {
      state.sessionId = record.payload?.id || state.sessionId;
      state.provider = record.payload?.model_provider || state.provider;
      return false;
    }
    return true;
  }, {
    fsImpl,
    endOffset,
    createLongLineParser: () => createSelectiveJsonLineParser(CODEX_SELECTED_FIELDS),
    stats
  });

  let latestUsage = null;
  let foundLatestModel = false;
  visitJsonLinesReverse(filePath, (record) => {
    if (record?.type === 'event_msg' && record.payload?.type === 'token_count' && !latestUsage) {
      const usage = record.payload?.info?.total_token_usage;
      if (usage && typeof usage === 'object') {
        latestUsage = normalizeUsage(usage);
        state.pendingTimestamp = record.timestamp || state.pendingTimestamp;
        state.pendingCost = normalizeCost(record.payload?.info?.cost ?? usage.cost);
      }
    }
    if (record?.type === 'turn_context' && !foundLatestModel) {
      const model = record.payload?.model;
      if (model) {
        state.model = model;
        foundLatestModel = true;
      }
    }
    return !(latestUsage && foundLatestModel);
  }, {
    fsImpl,
    endOffset,
    includeTrailingLine: false,
    createLongLineParser: () => createSelectiveJsonLineParser(CODEX_SELECTED_FIELDS),
    stats
  });
  if (latestUsage) state.lastUsage = latestUsage;
  state.pendingUsage = null;
  return { ok: true };
}

function createDriver({ nativeRoot, pathContext, fsImpl = fs } = {}) {
  const resolvedNativeRoot = pathContext?.customized
    ? (pathContext.native?.sessions || nativeRoot || NATIVE_PATHS.codex.sessions)
    : (nativeRoot || NATIVE_PATHS.codex.sessions);
  return {
    platform: 'codex',
    capability: 'nativeLogs',
    createNativeLogCursor({ fs: cursorFs = fsImpl, skipInitialParse = false, onDiagnostic } = {}) {
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
        bootstrapFile: (filePath, state, stat, stats) => bootstrapCodexFile(filePath, state, stat, cursorFs, stats),
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
        createLongLineParser: () => createSelectiveJsonLineParser(CODEX_SELECTED_FIELDS),
        onDiagnostic,
        onError: (error, filePath) => {
          console.warn('[Codex Native Logs] Failed to read changed usage events:', filePath, error.message);
        }
      });
    },
    createCursor(options) { return this.createNativeLogCursor(options); }
  };
}

module.exports = { createDriver };
