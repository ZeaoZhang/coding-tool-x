'use strict';

const fs = require('fs');
const path = require('path');
const { StringDecoder } = require('string_decoder');

const JSONL_READ_CHUNK_BYTES = 64 * 1024;
const CURSOR_ANCHOR_BYTES = 256;
const RECENT_EVENT_LIMIT = 2048;

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : 0;
}

function readNumber(source, keys = []) {
  for (const key of keys) {
    if (source?.[key] === undefined || source?.[key] === null) continue;
    return number(source[key]);
  }
  return 0;
}

function hasAny(source, keys = []) {
  return keys.some(key => source?.[key] !== undefined && source?.[key] !== null);
}

function readNestedNumber(sources = [], keys = []) {
  for (const source of sources) {
    const value = readNumber(source, keys);
    if (value > 0 || hasAny(source, keys)) return value;
  }
  return 0;
}

function normalizeCost(value) {
  if (value && typeof value === 'object') {
    return number(value.total ?? value.usd ?? value.amount);
  }
  return number(value);
}

/**
 * Normalize native provider usage into the shared billing shape.
 * `input` is the uncached billable input; cache reads are kept separately.
 */
function normalizeUsage(usage = {}) {
  const metadata = usage?.usageMetadata && typeof usage.usageMetadata === 'object'
    ? usage.usageMetadata
    : {};
  const source = { ...metadata, ...(usage || {}) };
  const inputKeys = ['input', 'input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens', 'promptTokenCount'];
  const outputKeys = ['output', 'output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens', 'candidatesTokenCount'];
  const reasoningKeys = ['reasoning', 'reasoning_tokens', 'reasoningTokens', 'reasoning_output_tokens', 'thoughtsTokenCount'];
  const cacheCreationKeys = [
    'cacheCreation', 'cache_creation', 'cacheWrite', 'cache_write',
    'cache_creation_input_tokens', 'cacheCreationInputTokens', 'cacheWriteInputTokens'
  ];
  const cacheReadKeys = [
    'cacheRead', 'cache_read', 'cache_read_input_tokens', 'cacheReadInputTokens',
    'cached_input_tokens', 'cachedInputTokens', 'cachedContentTokenCount'
  ];
  const cachedKeys = ['cached', 'cached_tokens', 'cachedTokens', 'cached_input_tokens', 'cachedInputTokens', 'cachedContentTokenCount'];
  const totalKeys = ['total', 'total_tokens', 'totalTokens', 'totalTokenCount'];
  const hasAnthropicCacheFields = hasAny(source, [
    'cache_creation_input_tokens', 'cacheCreationInputTokens',
    'cache_read_input_tokens', 'cacheReadInputTokens'
  ]);
  const hasGeminiUsageFields = hasAny(source, [
    'promptTokenCount', 'candidatesTokenCount', 'totalTokenCount',
    'cachedContentTokenCount', 'thoughtsTokenCount'
  ]);
  const hasOpenAiCachedInput = hasAny(source, [
    'cached_input_tokens', 'cachedInputTokens', 'cached_tokens', 'cachedTokens'
  ]) || Boolean(source.input_tokens_details || source.inputTokensDetails || source.prompt_tokens_details || source.promptTokensDetails
    || source.cache?.read || source.cache?.readTokens);

  const rawInput = readNumber(source, inputKeys);
  const output = readNumber(source, outputKeys);
  const reasoning = readNumber(source, reasoningKeys)
    || readNestedNumber([
      source.completion_tokens_details,
      source.completionTokensDetails,
      source.output_tokens_details,
      source.outputTokensDetails
    ], ['reasoning_tokens', 'reasoningTokens']);
  const cacheCreation = readNumber(source, cacheCreationKeys)
    || readNestedNumber([
      source.prompt_tokens_details,
      source.promptTokensDetails
    ], ['cache_creation_input_tokens', 'cacheCreationInputTokens'])
    || readNumber(source.cache, ['write', 'writeTokens']);
  const cacheRead = readNumber(source, cacheReadKeys)
    || readNestedNumber([
      source.input_tokens_details,
      source.inputTokensDetails,
      source.prompt_tokens_details,
      source.promptTokensDetails
    ], ['cached_tokens', 'cachedTokens'])
    || readNumber(source.cache, ['read', 'readTokens']);
  const cached = readNumber(source, cachedKeys) || cacheRead;
  const inputIncludesCache = hasGeminiUsageFields || hasOpenAiCachedInput;
  const input = Math.max(rawInput - (inputIncludesCache ? cacheRead : 0), 0);
  const reportedTotal = readNumber(source, totalKeys);
  const total = reportedTotal || (
    hasAnthropicCacheFields
      ? rawInput + output + reasoning + cacheCreation + cacheRead
      : hasGeminiUsageFields
        ? rawInput + output + reasoning
        : rawInput + output
  );
  return { input, output, reasoning, cached, cacheCreation, cacheRead, total };
}

function subtractUsage(current, previous = {}) {
  const next = normalizeUsage(current);
  const before = normalizeUsage(previous);
  const delta = Object.fromEntries(Object.keys(next).map(key => [key, Math.max(0, next[key] - before[key])]));
  delta.total = delta.total || Object.entries(delta)
    .filter(([key]) => key !== 'total')
    .reduce((sum, [, value]) => sum + value, 0);
  return delta;
}

function hasUsage(usage = {}) {
  return normalizeUsage(usage).total > 0;
}

function readJsonLines(filePath, fsImpl = fs) {
  try {
    return fsImpl.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .filter(line => line.trim())
      .map(line => {
        try { return JSON.parse(line); } catch (_) { return null; }
      })
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

function walkFiles(rootDir, predicate, fsImpl = fs) {
  const files = [];
  const walk = directory => {
    let entries;
    try { entries = fsImpl.readdirSync(directory, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(filePath);
      else if (entry.isFile() && predicate(entry.name, filePath)) files.push(filePath);
    }
  };
  walk(rootDir);
  return files;
}

function readFileRange(filePath, offset, length, fsImpl = fs) {
  if (length <= 0) return { bytesRead: 0, buffer: Buffer.alloc(0) };

  const fd = fsImpl.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(length);
  let bytesRead = 0;
  try {
    while (bytesRead < length) {
      const count = fsImpl.readSync(fd, buffer, bytesRead, length - bytesRead, offset + bytesRead);
      if (!count) break;
      bytesRead += count;
    }
  } finally {
    fsImpl.closeSync(fd);
  }
  return { bytesRead, buffer: buffer.subarray(0, bytesRead) };
}

function visitJsonLinesReverse(filePath, visitor, { fsImpl = fs, chunkSize = JSONL_READ_CHUNK_BYTES } = {}) {
  let size;
  try { size = fsImpl.statSync(filePath).size; } catch (_) { return; }
  const fd = fsImpl.openSync(filePath, 'r');
  let position = size;
  let carry = Buffer.alloc(0);
  let stopped = false;

  const visitBuffer = (buffer) => {
    const text = buffer.toString('utf8').replace(/\r$/, '');
    if (!text.trim()) return true;
    let value;
    try { value = JSON.parse(text); } catch (_) { return true; }
    return visitor(value) !== false;
  };

  try {
    while (position > 0 && !stopped) {
      const start = Math.max(0, position - chunkSize);
      const length = position - start;
      const buffer = Buffer.allocUnsafe(length);
      let bytesRead = 0;
      while (bytesRead < length) {
        const count = fsImpl.readSync(fd, buffer, bytesRead, length - bytesRead, start + bytesRead);
        if (!count) break;
        bytesRead += count;
      }
      const combined = carry.length > 0
        ? Buffer.concat([buffer.subarray(0, bytesRead), carry])
        : buffer.subarray(0, bytesRead);
      let lineEnd = combined.length;
      for (let index = combined.length - 1; index >= 0; index -= 1) {
        if (combined[index] !== 0x0a) continue;
        if (lineEnd > index + 1 && !visitBuffer(combined.subarray(index + 1, lineEnd))) {
          stopped = true;
          break;
        }
        lineEnd = index;
      }
      if (stopped) break;
      carry = combined.subarray(0, lineEnd);
      position = start;
      if (position === 0 && carry.length > 0) visitBuffer(carry);
    }
  } finally {
    fsImpl.closeSync(fd);
  }
}

function findTrailingLineOffset(filePath, size, fsImpl = fs) {
  if (size <= 0) return 0;
  let position = size;
  while (position > 0) {
    const start = Math.max(0, position - JSONL_READ_CHUNK_BYTES);
    const { buffer } = readFileRange(filePath, start, position - start, fsImpl);
    for (let index = buffer.length - 1; index >= 0; index -= 1) {
      if (buffer[index] === 0x0a) {
        const absolute = start + index + 1;
        return absolute === size ? size : absolute;
      }
    }
    position = start;
  }
  return 0;
}

function createIncrementalJsonlCursor({
  scanFiles,
  parseLine,
  createFileState = () => ({}),
  bootstrapFile,
  afterRead,
  normalizeEvent = event => event,
  acceptEvent = () => true,
  fsImpl = fs,
  skipInitialParse = false,
  onError = () => {}
}) {
  let fileStates = new Map();
  let recentEventIds = new Map();
  let initialized = false;

  const rememberEvent = (eventId) => {
    if (!eventId) return true;
    if (recentEventIds.has(eventId)) {
      // Refresh insertion order so the bounded map behaves as an LRU.
      recentEventIds.delete(eventId);
      recentEventIds.set(eventId, true);
      return false;
    }
    recentEventIds.set(eventId, true);
    if (recentEventIds.size > RECENT_EVENT_LIMIT) {
      recentEventIds.delete(recentEventIds.keys().next().value);
    }
    return true;
  };

  const makeState = (filePath, stat, previousState = null, replaced = false) => {
    const customState = createFileState(filePath, stat, previousState, replaced) || {};
    return {
      ...customState,
      dev: stat.dev,
      ino: stat.ino,
      size: 0,
      offset: 0,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      remainder: '',
      decoder: new StringDecoder('utf8'),
      prefixBytes: Buffer.alloc(0),
      tailBytes: Buffer.alloc(0),
      entryIndex: Number.isInteger(customState.entryIndex) ? customState.entryIndex : 0
    };
  };

  const setAnchors = (filePath, state, offset) => {
    state.prefixBytes = readFileRange(
      filePath,
      0,
      Math.min(offset, CURSOR_ANCHOR_BYTES),
      fsImpl
    ).buffer;
    const tailLength = Math.min(offset, CURSOR_ANCHOR_BYTES);
    state.tailBytes = readFileRange(filePath, Math.max(0, offset - tailLength), tailLength, fsImpl).buffer;
  };

  const updateAnchors = (state, buffer) => {
    if (!buffer.length) return;
    if (state.prefixBytes.length < CURSOR_ANCHOR_BYTES) {
      const needed = CURSOR_ANCHOR_BYTES - state.prefixBytes.length;
      state.prefixBytes = Buffer.concat([state.prefixBytes, buffer.subarray(0, needed)]);
    }
    state.tailBytes = Buffer.concat([state.tailBytes, buffer]);
    if (state.tailBytes.length > CURSOR_ANCHOR_BYTES) {
      state.tailBytes = state.tailBytes.subarray(-CURSOR_ANCHOR_BYTES);
    }
  };

  const isReplaced = (filePath, state, stat) => {
    if (state.dev !== stat.dev || state.ino !== stat.ino || stat.size < state.offset) return true;
    const metadataChanged = state.mtimeMs !== stat.mtimeMs || state.ctimeMs !== stat.ctimeMs;
    if (stat.size === state.size && metadataChanged) return true;
    if (!metadataChanged || stat.size <= state.offset) return false;
    try {
      if (state.prefixBytes.length > 0
        && !readFileRange(filePath, 0, state.prefixBytes.length, fsImpl).buffer.equals(state.prefixBytes)) {
        return true;
      }
      if (state.tailBytes.length > 0
        && !readFileRange(
          filePath,
          state.offset - state.tailBytes.length,
          state.tailBytes.length,
          fsImpl
        ).buffer.equals(state.tailBytes)) {
        return true;
      }
    } catch (_) {
      return true;
    }
    return false;
  };

  const collectEvent = (rawEvent, filePath, events, shouldEmit) => {
    if (!rawEvent) return;
    const event = normalizeEvent(rawEvent, filePath);
    if (!event || !event.id || !acceptEvent(event)) return;
    if (!rememberEvent(event.id)) return;
    if (shouldEmit) events.push(event);
  };

  const consumeText = (filePath, state, text, events, shouldEmit) => {
    const combined = `${state.remainder}${text}`;
    const lines = combined.split(/\r?\n/);
    state.remainder = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch (_) {
        state.entryIndex += 1;
        continue;
      }
      try {
        const parsed = parseLine(filePath, record, state, state.entryIndex);
        const parsedEvents = Array.isArray(parsed) ? parsed : [parsed];
        parsedEvents.forEach(event => collectEvent(event, filePath, events, shouldEmit));
      } catch (error) {
        onError(error, filePath);
      }
      state.entryIndex += 1;
    }
  };

  const readChangedBytes = (filePath, state, stat, events, shouldEmit) => {
    if (stat.size <= state.offset) return;
    const fd = fsImpl.openSync(filePath, 'r');
    try {
      while (state.offset < stat.size) {
        const length = Math.min(JSONL_READ_CHUNK_BYTES, stat.size - state.offset);
        const buffer = Buffer.allocUnsafe(length);
        const bytesRead = fsImpl.readSync(fd, buffer, 0, length, state.offset);
        if (!bytesRead) break;
        const chunk = buffer.subarray(0, bytesRead);
        consumeText(filePath, state, state.decoder.write(chunk), events, shouldEmit);
        state.offset += bytesRead;
        updateAnchors(state, chunk);
      }
    } finally {
      fsImpl.closeSync(fd);
    }
  };

  const read = () => {
    const events = [];
    const files = scanFiles();
    const currentFiles = new Set(files);
    const isInitialRead = !initialized;
    for (const filePath of fileStates.keys()) {
      if (!currentFiles.has(filePath)) fileStates.delete(filePath);
    }

    for (const filePath of files) {
      let stat;
      try { stat = fsImpl.statSync(filePath); } catch (_) { continue; }
      let state = fileStates.get(filePath);
      const replaced = state && isReplaced(filePath, state, stat);
      if (!state || replaced) {
        state = makeState(filePath, stat, state, Boolean(replaced));
        fileStates.set(filePath, state);
      }

      if (isInitialRead && skipInitialParse) {
        try { bootstrapFile?.(filePath, state, stat); } catch (error) { onError(error, filePath); }
        state.offset = findTrailingLineOffset(filePath, stat.size, fsImpl);
        state.size = stat.size;
        state.dev = stat.dev;
        state.ino = stat.ino;
        state.mtimeMs = stat.mtimeMs;
        state.ctimeMs = stat.ctimeMs;
        setAnchors(filePath, state, state.offset);
        continue;
      }

      const unchanged = !replaced
        && state.size === stat.size
        && state.mtimeMs === stat.mtimeMs
        && state.ctimeMs === stat.ctimeMs;
      if (unchanged) continue;

      const shouldEmit = initialized;
      let readCompleted = false;
      try {
        readChangedBytes(filePath, state, stat, events, shouldEmit);
        const trailing = afterRead?.(filePath, state, { initialized, replaced: Boolean(replaced) });
        const trailingEvents = Array.isArray(trailing) ? trailing : [trailing];
        trailingEvents.forEach(event => collectEvent(event, filePath, events, shouldEmit));
        readCompleted = true;
      } catch (error) {
        onError(error, filePath);
      }
      if (!readCompleted) continue;
      state.size = stat.size;
      state.dev = stat.dev;
      state.ino = stat.ino;
      state.mtimeMs = stat.mtimeMs;
      state.ctimeMs = stat.ctimeMs;
    }
    initialized = true;
    return events;
  };

  return {
    initialize() { read(); },
    readNewEvents: read,
    read,
    reset() { fileStates = new Map(); recentEventIds = new Map(); initialized = false; },
    close() { fileStates.clear(); recentEventIds.clear(); initialized = false; }
  };
}

function createScannedFileCursor({
  scanFiles,
  parseFile,
  normalizeEvent,
  fsImpl = fs,
  skipInitialParse = false,
  shouldParseFile = () => true
}) {
  let seenByFile = new Map();
  let fileStates = new Map();
  let initialized = false;

  const read = () => {
    const events = [];
    const files = scanFiles();
    const isInitialRead = !initialized;
    const currentFiles = new Set(files);
    for (const filePath of fileStates.keys()) {
      if (!currentFiles.has(filePath)) {
        fileStates.delete(filePath);
        seenByFile.delete(filePath);
      }
    }

    for (const filePath of files) {
      let stat;
      try { stat = fsImpl.statSync(filePath); } catch (_) { continue; }
      const previousState = fileStates.get(filePath);
      const replaced = previousState
        && (previousState.dev !== stat.dev
          || previousState.ino !== stat.ino
          || stat.size < previousState.size);
      const changed = !previousState
        || replaced
        || previousState.size !== stat.size
        || previousState.mtimeMs !== stat.mtimeMs
        || previousState.ctimeMs !== stat.ctimeMs;
      const unchanged = previousState && !changed;
      if (!previousState || replaced) {
        seenByFile.set(filePath, new Set());
      }
      if (unchanged) continue;
      if (isInitialRead && skipInitialParse) {
        try {
          shouldParseFile(filePath, stat, { isInitialRead, previousState, skipInitialParse: true });
        } catch (_) {
          // Baseline setup must remain non-blocking; the next file change will retry.
        }
        fileStates.set(filePath, {
          dev: stat.dev,
          ino: stat.ino,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          ctimeMs: stat.ctimeMs
        });
        continue;
      }
      if (!shouldParseFile(filePath, stat, { isInitialRead, previousState, skipInitialParse: false })) continue;

      let parsed;
      try { parsed = parseFile(filePath) || []; } catch (_) { continue; }
      fileStates.set(filePath, {
        dev: stat.dev,
        ino: stat.ino,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        ctimeMs: stat.ctimeMs
      });
      const seen = seenByFile.get(filePath) || new Set();
      seenByFile.set(filePath, seen);
      for (const raw of parsed) {
        const event = normalizeEvent(raw, filePath);
        if (!event || !event.id || !hasUsage(event.tokens)) continue;
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        if (initialized) events.push(event);
      }
    }
    initialized = true;
    return events;
  };

  return {
    initialize() { read(); },
    readNewEvents: read,
    read,
    reset() { seenByFile = new Map(); fileStates = new Map(); initialized = false; },
    close() { seenByFile.clear(); fileStates.clear(); initialized = false; }
  };
}

module.exports = {
  hasUsage,
  normalizeCost,
  normalizeUsage,
  number,
  readJsonLines,
  readFileRange,
  visitJsonLinesReverse,
  subtractUsage,
  walkFiles,
  createIncrementalJsonlCursor,
  createScannedFileCursor
};
