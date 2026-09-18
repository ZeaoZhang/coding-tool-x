'use strict';

const fs = require('fs');
const path = require('path');
const { resolvePaths } = require('./common');
const { decodeArtifact } = require('./sessions');
const {
  normalizeCost,
  normalizeUsage,
  walkFiles,
  readJsonLines,
  createScannedFileCursor
} = require('../native-log-utils');
const { calculateUsageCost } = require('../../../server/services/usage-log-utils');

const SESSION_FILE_PATTERN = /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/;

function firstObject(...candidates) {
  return candidates.find(value => value && typeof value === 'object' && !Array.isArray(value)) || null;
}

function extractUsage(record = {}) {
  const data = record.data || {};
  const message = data.message || record.message || {};
  const source = message.source || data.source || {};
  return firstObject(
    record.usage,
    record.tokens,
    data.usage,
    data.tokens,
    message.usage,
    message.tokens,
    source.usage,
    source.tokens,
    data.response?.usage,
    data.result?.usage
  );
}

function normalizeTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1e11) return value;
    if (value > 1e9) return value * 1000;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function normalizeDshEvent(record = {}, filePath = '', index = 0) {
  const usage = extractUsage(record);
  if (!usage) return null;

  const data = record.data || {};
  const message = data.message || record.message || {};
  const source = message.source || data.source || {};
  const model = record.model || data.model || message.model || source.model || '';
  const provider = record.provider || data.provider || message.provider || source.provider || '';
  const tokens = normalizeUsage(usage);
  const id = record.id
    || data.id
    || message.id
    || `${path.basename(filePath)}:${record.seq ?? index}`;
  const timestamp = normalizeTimestamp(record.timestamp || record.time || data.timestamp || message.timestamp);
  const cost = normalizeCost(record.cost ?? data.cost ?? message.cost ?? usage.cost)
    || calculateUsageCost('dsh', model, tokens);

  return {
    id: `dsh:${path.basename(filePath)}:${id}`,
    source: 'dsh',
    sessionId: path.basename(path.dirname(filePath)),
    timestamp,
    provider,
    model,
    tokens,
    cost,
    channelId: record.channelId || data.channelId || message.channelId || source.channelId,
    channel: record.channel || data.channel || message.channel || provider
  };
}

function resolveSessionRoot({ nativeRoot, pathContext, paths } = {}) {
  if (paths?.sessions) return paths.sessions;
  if (pathContext?.customized && pathContext.native?.sessions) return pathContext.native.sessions;
  if (nativeRoot) return nativeRoot;
  return resolvePaths({ pathContext }).sessions;
}

function createDriver({ nativeRoot, pathContext, paths, fsImpl = fs } = {}) {
  const resolvedNativeRoot = resolveSessionRoot({ nativeRoot, pathContext, paths });

  return {
    platform: 'dsh',
    capability: 'nativeLogs',
    createNativeLogCursor({ fs: cursorFs = fsImpl, skipInitialParse = false } = {}) {
      return createScannedFileCursor({
        scanFiles: () => walkFiles(
          resolvedNativeRoot,
          name => SESSION_FILE_PATTERN.test(name),
          cursorFs
        ),
        parseFile: filePath => filePath.endsWith('.zstd')
          ? decodeArtifact(filePath).events
          : readJsonLines(filePath, cursorFs),
        normalizeEvent: normalizeDshEvent,
        fsImpl: cursorFs,
        skipInitialParse
      });
    },
    createCursor(options) { return this.createNativeLogCursor(options); }
  };
}

module.exports = { createDriver, extractUsage, normalizeDshEvent };
