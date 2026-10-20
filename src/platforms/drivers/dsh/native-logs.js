'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { StringDecoder } = require('string_decoder');
const { resolvePaths } = require('./common');
const { zstdFrameEnd } = require('./sessions');
const {
  normalizeCost,
  normalizeUsage,
  walkFiles,
  usageFieldPaths,
  createSelectiveJsonLineParser,
  createIncrementalJsonlCursor,
  createScannedFileCursor
} = require('../native-log-utils');
const { calculateUsageCost, createUsageCostCalculator } = require('../../../server/services/usage-log-utils');

const SESSION_FILE_PATTERN = /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/;
const MAX_COMPRESSED_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_DECOMPRESSED_FRAME_BYTES = 16 * 1024 * 1024;
const DSH_SELECTED_FIELDS = [
  'type',
  ...['', 'data.', 'message.', 'message.source.', 'data.message.', 'data.message.source.', 'data.source.'].flatMap(prefix => (
    ['id', 'seq', 'time', 'timestamp', 'model', 'provider', 'cost', 'channelId', 'channel'].map(key => `${prefix}${key}`)
  )),
  ...['usage', 'tokens', 'data.usage', 'data.tokens', 'message.usage', 'message.tokens',
    'data.message.usage', 'data.message.tokens', 'data.message.source.usage', 'data.message.source.tokens',
    'message.source.usage', 'message.source.tokens', 'data.source.usage', 'data.source.tokens',
    'data.response.usage', 'data.result.usage'].flatMap(usageFieldPaths)
];

// DSH appends independent zstd frames. Retain one frame and one selective
// JSONL parser, rather than the compressed transcript plus its decoded rows.
function* readCompressedUsage(filePath, fsImpl) {
  const fd = fsImpl.openSync(filePath, 'r');
  const input = Buffer.alloc(64 * 1024);
  const decoder = new StringDecoder('utf8');
  let buffered = Buffer.alloc(0);
  let position = 0;
  let parser = null;
  let lineText = '';
  let lineLength = 0;
  let recordIndex = 0;
  const calculateCost = createUsageCostCalculator('dsh');
  function append(text) {
    lineLength += text.length;
    if (!parser && lineLength > 256 * 1024) {
      parser = createSelectiveJsonLineParser(DSH_SELECTED_FIELDS);
      parser.write(lineText);
      lineText = '';
    }
    if (parser) parser.write(text);
    else lineText += text;
  }
  function* consume(text) {
    let start = 0;
    for (let end = text.indexOf('\n'); end !== -1; end = text.indexOf('\n', start)) {
      const part = text.slice(start, end);
      if (part.trim() || lineLength) {
        append(part);
        const record = parser ? parser.finish() : JSON.parse(lineText);
        if (recordIndex === 0) {
          if (record.type !== 'session' || typeof record.id !== 'string') throw new Error('DSH session log missing a valid header');
        } else {
          const event = normalizeDshEvent(record, filePath, recordIndex - 1, calculateCost);
          if (event) yield event;
        }
        recordIndex += 1;
      }
      parser = null;
      lineText = '';
      lineLength = 0;
      start = end + 1;
    }
    if (start < text.length) {
      append(text.slice(start));
    }
  }
  try {
    for (;;) {
      const count = fsImpl.readSync(fd, input, 0, input.length, position);
      if (!count) break;
      position += count;
      buffered = Buffer.concat([buffered, input.subarray(0, count)]);
      let offset = 0;
      while (offset < buffered.length) {
        const end = zstdFrameEnd(buffered, offset);
        if (end === null) break;
        if (end - offset > MAX_COMPRESSED_FRAME_BYTES) throw new Error('DSH compressed frame exceeds 8 MiB');
        const decoded = zlib.zstdDecompressSync(buffered.subarray(offset, end), {
          maxOutputLength: MAX_DECOMPRESSED_FRAME_BYTES
        });
        // Feed bounded strings even when one frame contains multiple records.
        for (let index = 0; index < decoded.length; index += input.length) {
          yield* consume(decoder.write(decoded.subarray(index, index + input.length)));
        }
        offset = end;
      }
      buffered = Buffer.from(buffered.subarray(offset));
      if (buffered.length > MAX_COMPRESSED_FRAME_BYTES) throw new Error('DSH compressed frame exceeds 8 MiB');
    }
    // A writer can be between appends. The next size change rescans and the
    // checkpoint suppresses complete records already accepted from this pass.
    if (buffered.length) return;
    yield* consume(decoder.end());
    if (lineLength) yield* consume('\n');
    if (!recordIndex) throw new Error('DSH session log missing a valid header');
  } finally { fsImpl.closeSync(fd); }
}

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

function hasCacheUsage(usage = {}) {
  const aliases = [
    'cached', 'cached_tokens', 'cachedTokens', 'cached_input_tokens', 'cachedInputTokens',
    'cache_read_input_tokens', 'cacheReadInputTokens', 'cacheRead', 'cache_read', 'cachedContentTokenCount'
  ];
  const hasField = source => aliases.some(key => (
    source && Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined && source[key] !== null
  ));
  if (hasField(usage)) return true;

  return [usage.input_tokens_details, usage.inputTokensDetails, usage.prompt_tokens_details, usage.promptTokensDetails, usage.usageMetadata]
    .some(hasField) || Boolean(usage.cache && (usage.cache.read !== undefined || usage.cache.readTokens !== undefined));
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

function normalizeDshEvent(record = {}, filePath = '', index = 0, calculateCost = (model, tokens) => calculateUsageCost('dsh', model, tokens)) {
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
    || calculateCost(model, tokens);

  return {
    id: `dsh:${path.basename(path.dirname(filePath))}:${path.basename(filePath)}:${id}`,
    source: 'dsh',
    sessionId: path.basename(path.dirname(filePath)),
    timestamp,
    provider,
    model,
    tokens,
    cacheUsageAvailable: hasCacheUsage(usage),
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
    createNativeLogCursor({ fs: cursorFs = fsImpl, skipInitialParse = false, onDiagnostic } = {}) {
      let calculateCost;
      const plain = createIncrementalJsonlCursor({
        scanFiles: () => walkFiles(resolvedNativeRoot, name => SESSION_FILE_PATTERN.test(name) && !name.endsWith('.zstd'), cursorFs),
        parseLine: (filePath, record, state, index) => normalizeDshEvent(record, filePath, index, calculateCost),
        createLongLineParser: () => createSelectiveJsonLineParser(DSH_SELECTED_FIELDS),
        fsImpl: cursorFs,
        skipInitialParse,
        onDiagnostic,
        onError: (error, filePath) => console.warn('[DSH Native Logs] Failed to read changed JSONL events:', filePath, error.message)
      });
      const compressed = createScannedFileCursor({
        scanFiles: () => walkFiles(
          resolvedNativeRoot,
          name => SESSION_FILE_PATTERN.test(name) && name.endsWith('.zstd'),
          cursorFs
        ),
        parseFile: filePath => readCompressedUsage(filePath, cursorFs),
        normalizeEvent: event => event,
        fsImpl: cursorFs,
        skipInitialParse,
        parseBaseline: true,
        onDiagnostic
      });
      let nextSource = 0;
      return {
        initialize() { calculateCost = createUsageCostCalculator('dsh'); plain.initialize(); compressed.initialize(); },
        readNewEvents() {
          calculateCost = createUsageCostCalculator('dsh');
          const sources = [plain, compressed];
          const first = nextSource;
          nextSource = 1 - nextSource;
          const events = sources[first].readNewEvents();
          return events.length ? events : sources[1 - first].readNewEvents();
        },
        read() { return this.readNewEvents(); },
        diagnostics() {
          const jsonl = plain.diagnostics();
          const zstd = compressed.diagnostics();
          return { jsonl, zstd, persistenceBlocked: jsonl.persistenceBlocked || zstd.persistenceBlocked };
        },
        reset() { plain.reset(); compressed.reset(); nextSource = 0; },
        close() { plain.close(); compressed.close(); }
      };
    },
    createCursor(options) { return this.createNativeLogCursor(options); }
  };
}

module.exports = { createDriver, extractUsage, hasCacheUsage, normalizeDshEvent };
