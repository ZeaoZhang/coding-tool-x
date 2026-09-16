'use strict';

const fs = require('fs');
const path = require('path');
const { NATIVE_PATHS } = require('../../../config/paths');
const {
  normalizeUsage,
  normalizeCost,
  usageFieldPaths,
  createSelectiveJsonLineParser,
  walkFiles,
  createIncrementalJsonlCursor
} = require('../native-log-utils');
const { calculateUsageCost } = require('../../../server/services/usage-log-utils');

const CLAUDE_SELECTED_FIELDS = [
  'type', 'role', 'uuid', 'id', 'model', 'timestamp', 'provider', 'cost', 'channelId', 'channel',
  'message.role', 'message.id', 'message.uuid', 'message.model', 'message.timestamp',
  'message.provider', 'message.cost', 'message.channelId', 'message.channel',
  ...usageFieldPaths('usage'),
  ...usageFieldPaths('message.usage')
];

function createDriver({ nativeRoot, pathContext, fsImpl = fs } = {}) {
  const resolvedNativeRoot = pathContext?.customized
    ? (pathContext.native?.projects || nativeRoot || NATIVE_PATHS.claude.projects)
    : (nativeRoot || NATIVE_PATHS.claude.projects);
  return {
    platform: 'claude',
    capability: 'nativeLogs',
    createNativeLogCursor({ fs: cursorFs = fsImpl, skipInitialParse = false, onDiagnostic } = {}) {
      const scanFiles = () => walkFiles(resolvedNativeRoot, name => name.endsWith('.jsonl') && !name.startsWith('agent-'), cursorFs);
      const parseLine = (filePath, record) => {
        const message = record.message && typeof record.message === 'object' ? record.message : {};
        const role = record.role || message.role || (record.type === 'assistant' ? 'assistant' : null);
        if (role !== 'assistant') return null;
        const usage = record.usage || message.usage;
        const messageId = record.uuid || record.id || message.id;
        if (!usage || typeof usage !== 'object' || !messageId) return null;
        const tokens = normalizeUsage(usage);
        const model = record.model || message.model || '';
        return {
          id: `${path.basename(filePath)}:${messageId}`,
          source: 'claude',
          sessionId: path.basename(filePath, '.jsonl'),
          timestamp: record.timestamp || message.timestamp,
          provider: record.provider || message.provider || '',
          model,
          tokens,
          cost: normalizeCost(record.cost ?? message.cost ?? usage.cost)
            || calculateUsageCost('claude', model, tokens),
          channelId: record.channelId || message.channelId,
          channel: record.channel || message.channel
        };
      };
      return createIncrementalJsonlCursor({
        scanFiles,
        parseLine,
        fsImpl: cursorFs,
        skipInitialParse,
        createLongLineParser: () => createSelectiveJsonLineParser(CLAUDE_SELECTED_FIELDS),
        onDiagnostic,
        onError: (error, filePath) => {
          console.warn('[Claude Native Logs] Failed to read changed usage events:', filePath, error.message);
        }
      });
    },
    createCursor(options) { return this.createNativeLogCursor(options); }
  };
}

module.exports = { createDriver };
