'use strict';

const fs = require('fs');
const path = require('path');
const { NATIVE_PATHS } = require('../../../config/paths');
const { normalizeCost, normalizeUsage, subtractUsage, readJsonLines, walkFiles } = require('../native-log-utils');
const { calculateUsageCost } = require('../../../server/services/usage-log-utils');

function createDriver({ nativeRoot, pathContext, fsImpl = fs } = {}) {
  const resolvedNativeRoot = pathContext?.customized
    ? (pathContext.native?.sessions || nativeRoot || NATIVE_PATHS.codex.sessions)
    : (nativeRoot || NATIVE_PATHS.codex.sessions);
  const createRead = (cursorFs, state) => () => {
    const scanFiles = () => walkFiles(resolvedNativeRoot, name => /^rollout-.*\.jsonl$/.test(name), cursorFs);
    const latest = new Map();
    for (const filePath of scanFiles()) {
      const lines = readJsonLines(filePath, cursorFs);
      const meta = lines.find(line => line.type === 'session_meta')?.payload || {};
      let model = '';
      for (const line of lines) {
        if (line.type === 'turn_context' && line.payload?.model) model = line.payload.model;
      }
      const usageLines = lines.filter(line => line.type === 'event_msg'
        && line.payload?.type === 'token_count'
        && line.payload?.info?.total_token_usage);
      const line = usageLines[usageLines.length - 1];
      if (!line) continue;
      const sessionId = meta.id || path.basename(filePath, '.jsonl');
      const tokens = normalizeUsage(line.payload.info.total_token_usage);
      latest.set(sessionId, {
        id: `${sessionId}:token-count`,
        source: 'codex',
        sessionId,
        timestamp: line.timestamp || meta.timestamp,
        provider: meta.model_provider || '',
        model,
        tokens,
        cost: normalizeCost(line.payload.info.cost ?? line.payload.info.total_token_usage.cost)
          || calculateUsageCost('codex', model, tokens)
      });
    }

    const events = [];
    for (const [sessionId, event] of latest) {
      const previous = state.lastUsage.get(sessionId);
      state.lastUsage.set(sessionId, event.tokens);
      if (!state.initialized) continue;
      const restarted = previous && event.tokens.total < previous.total;
      const tokens = previous && !restarted ? subtractUsage(event.tokens, previous) : event.tokens;
      if (tokens.total > 0) {
        events.push({
          ...event,
          id: `${event.id}:${event.tokens.total}`,
          tokens,
          cost: calculateUsageCost('codex', event.model, tokens)
        });
      }
    }
    state.initialized = true;
    return events;
  };

  return {
    platform: 'codex',
    capability: 'nativeLogs',
    createNativeLogCursor({ fs: cursorFs = fsImpl } = {}) {
      const state = { initialized: false, lastUsage: new Map() };
      const read = createRead(cursorFs, state);
      return {
        initialize() { read(); },
        readNewEvents: read,
        read,
        reset() { state.initialized = false; state.lastUsage = new Map(); },
        close() { state.initialized = false; state.lastUsage.clear(); }
      };
    },
    createCursor(options) { return this.createNativeLogCursor(options); }
  };
}

module.exports = { createDriver };
