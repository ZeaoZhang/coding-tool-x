'use strict';

const fs = require('fs');
const path = require('path');

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

function createScannedFileCursor({
  scanFiles,
  parseFile,
  normalizeEvent,
  fsImpl = fs,
  skipInitialParse = false
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
      fileStates.set(filePath, {
        dev: stat.dev,
        ino: stat.ino,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        ctimeMs: stat.ctimeMs
      });

      if (unchanged || (isInitialRead && skipInitialParse)) continue;

      let parsed;
      try { parsed = parseFile(filePath) || []; } catch (_) { continue; }
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
  subtractUsage,
  walkFiles,
  createScannedFileCursor
};
