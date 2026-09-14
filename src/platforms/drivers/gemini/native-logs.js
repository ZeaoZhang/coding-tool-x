'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { NATIVE_PATHS } = require('../../../config/paths');
const { normalizeCost, normalizeUsage, readJsonLines, walkFiles, createScannedFileCursor } = require('../native-log-utils');
const { calculateUsageCost } = require('../../../server/services/usage-log-utils');

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
        || calculateUsageCost('gemini', message.model || session.model || '', normalizeUsage(usage)),
      channelId: message.channelId,
      channel: message.channel
    }];
  });
}

function createDriver({ nativeRoot = NATIVE_PATHS.gemini.tmp, fsImpl = fs } = {}) {
  return {
    platform: 'gemini',
    capability: 'nativeLogs',
    createNativeLogCursor({ fs: cursorFs = fsImpl } = {}) {
      const scanFiles = () => walkFiles(nativeRoot, name => /^session-.*\.(json|jsonl)$/.test(name), cursorFs);
      return createScannedFileCursor({
        scanFiles,
        parseFile: filePath => parseSession(filePath, cursorFs),
        normalizeEvent: event => event,
        fsImpl: cursorFs
      });
    },
    createCursor(options) { return this.createNativeLogCursor(options); }
  };
}

module.exports = { createDriver };
