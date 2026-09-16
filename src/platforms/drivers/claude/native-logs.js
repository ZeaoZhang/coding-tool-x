'use strict';

const fs = require('fs');
const path = require('path');
const { NATIVE_PATHS } = require('../../../config/paths');
const {
  normalizeUsage,
  normalizeCost,
  readJsonLines,
  walkFiles,
  createScannedFileCursor
} = require('../native-log-utils');
const { calculateUsageCost } = require('../../../server/services/usage-log-utils');

function createDriver({ nativeRoot, pathContext, fsImpl = fs } = {}) {
  const resolvedNativeRoot = pathContext?.customized
    ? (pathContext.native?.projects || nativeRoot || NATIVE_PATHS.claude.projects)
    : (nativeRoot || NATIVE_PATHS.claude.projects);
  return {
    platform: 'claude',
    capability: 'nativeLogs',
    createNativeLogCursor({ fs: cursorFs = fsImpl, skipInitialParse = false } = {}) {
      const scanFiles = () => walkFiles(resolvedNativeRoot, name => name.endsWith('.jsonl') && !name.startsWith('agent-'), cursorFs);
      const parseFile = filePath => readJsonLines(filePath, cursorFs).flatMap(record => {
        const message = record.message && typeof record.message === 'object' ? record.message : {};
        const role = record.role || message.role || (record.type === 'assistant' ? 'assistant' : null);
        if (role !== 'assistant') return [];
        const usage = record.usage || message.usage;
        const messageId = record.uuid || record.id || message.id;
        if (!usage || typeof usage !== 'object' || !messageId) return [];
        const tokens = normalizeUsage(usage);
        const model = record.model || message.model || '';
        return [{
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
        }];
      });
      return createScannedFileCursor({
        scanFiles,
        parseFile,
        normalizeEvent: event => event,
        fsImpl: cursorFs,
        skipInitialParse
      });
    },
    createCursor(options) { return this.createNativeLogCursor(options); }
  };
}

module.exports = { createDriver };
