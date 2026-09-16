'use strict';

const fs = require('fs');
const path = require('path');
const { StringDecoder } = require('string_decoder');

const JSONL_READ_CHUNK_BYTES = 64 * 1024;
const CURSOR_ANCHOR_BYTES = 256;
const RECENT_EVENT_LIMIT = 2048;
const JSONL_LONG_LINE_THRESHOLD_BYTES = 256 * 1024;
const JSONL_MAX_PARSE_DEPTH = 128;
const JSONL_MAX_SELECTED_STRING_BYTES = 1024 * 1024;

const USAGE_FIELD_NAMES = [
  'input', 'input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens', 'promptTokenCount',
  'output', 'output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens', 'candidatesTokenCount',
  'reasoning', 'reasoning_tokens', 'reasoningTokens', 'reasoning_output_tokens', 'thoughtsTokenCount',
  'cacheCreation', 'cache_creation', 'cacheWrite', 'cache_write',
  'cache_creation_input_tokens', 'cacheCreationInputTokens', 'cacheWriteInputTokens',
  'cacheRead', 'cache_read', 'cache_read_input_tokens', 'cacheReadInputTokens',
  'cached_input_tokens', 'cachedInputTokens', 'cachedContentTokenCount',
  'cached', 'cached_tokens', 'cachedTokens', 'total', 'total_tokens', 'totalTokens', 'totalTokenCount',
  'cost'
];

function usageFieldPaths(prefix) {
  const paths = USAGE_FIELD_NAMES.map(name => `${prefix}.${name}`);
  [
    'usageMetadata',
    'input_tokens_details', 'inputTokensDetails', 'prompt_tokens_details', 'promptTokensDetails',
    'completion_tokens_details', 'completionTokensDetails', 'output_tokens_details', 'outputTokensDetails',
    'cache'
  ].forEach(container => {
    USAGE_FIELD_NAMES.forEach(name => paths.push(`${prefix}.${container}.${name}`));
  });
  ['total', 'usd', 'amount'].forEach(name => paths.push(`${prefix}.cost.${name}`));
  return paths;
}

function createSelectionTree(paths = []) {
  const root = { children: new Map() };
  for (const rawPath of paths) {
    const parts = Array.isArray(rawPath)
      ? rawPath.map(String).filter(Boolean)
      : String(rawPath || '').split('.').filter(Boolean);
    if (parts.length === 0) continue;
    let node = root;
    for (const part of parts) {
      if (!node.children.has(part)) node.children.set(part, { children: new Map() });
      node = node.children.get(part);
    }
  }
  return root;
}

function selectiveJsonError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Parse a JSON value while retaining only an explicit set of fields.
 * Unselected strings and objects are scanned but never materialized, which
 * keeps large message/tool-output fields out of the heap.
 */
function createSelectiveJsonLineParser(paths, {
  maxDepth = JSONL_MAX_PARSE_DEPTH,
  maxSelectedStringBytes = JSONL_MAX_SELECTED_STRING_BYTES
} = {}) {
  const selection = createSelectionTree(paths);
  let mode = 'struct';
  let rootValue;
  let rootDone = false;
  let stringState = null;
  let numberState = null;
  let literalState = null;
  const stack = [];

  const fail = (code, message) => {
    throw selectiveJsonError(code, message);
  };

  const assignValue = (sink, value) => {
    if (!sink) {
      rootValue = value;
      rootDone = true;
      return;
    }
    const parent = sink.parent;
    parent.phase = 'commaOrEnd';
    if (!parent.selection || value === undefined) return;
    if (parent.kind === 'object') parent.value[sink.key] = value;
    else parent.value.push(value);
  };

  const closeContainer = (closing) => {
    const context = stack[stack.length - 1];
    if (!context || context.close !== closing) fail('ERR_JSON_STRUCTURE', 'Mismatched JSON container');
    stack.pop();
    assignValue(context.sink, context.selection ? context.value : undefined);
  };

  const startValue = (selectionNode, sink, firstChar) => {
    if (firstChar === '{' || firstChar === '[') {
      if (stack.length + 1 > maxDepth) fail('ERR_JSON_MAX_DEPTH', `JSON nesting exceeds ${maxDepth} levels`);
      const kind = firstChar === '{' ? 'object' : 'array';
      stack.push({
        kind,
        close: kind === 'object' ? '}' : ']',
        selection: selectionNode,
        value: selectionNode ? (kind === 'object' ? {} : []) : null,
        sink,
        phase: kind === 'object' ? 'keyOrEnd' : 'valueOrEnd',
        pendingKey: null
      });
      return;
    }
    if (firstChar === '"') {
      stringState = {
        purpose: 'value',
        sink,
        selected: Boolean(selectionNode),
        value: '',
        bytes: 0,
        escaping: false,
        unicodeDigits: 0,
        unicodeValue: 0
      };
      mode = 'string';
      return;
    }
    if (firstChar === '-' || /[0-9]/.test(firstChar)) {
      numberState = { sink, selected: Boolean(selectionNode), text: firstChar, length: 1 };
      mode = 'number';
      return;
    }
    if (firstChar === 't' || firstChar === 'f' || firstChar === 'n') {
      const expected = firstChar === 't' ? 'true' : firstChar === 'f' ? 'false' : 'null';
      literalState = { sink, selected: Boolean(selectionNode), expected, index: 1 };
      mode = 'literal';
      return;
    }
    fail('ERR_JSON_VALUE', `Unexpected JSON value character: ${firstChar}`);
  };

  const completeString = () => {
    const state = stringState;
    stringState = null;
    mode = 'struct';
    if (state.purpose === 'key') {
      const context = stack[stack.length - 1];
      if (!context || context.kind !== 'object') fail('ERR_JSON_STRUCTURE', 'JSON key outside object');
      context.pendingKey = state.value;
      context.phase = 'colon';
      return;
    }
    assignValue(state.sink, state.selected ? state.value : undefined);
  };

  const appendStringChar = (char) => {
    const state = stringState;
    if (!state.selected && state.purpose !== 'key') return;
    const nextBytes = state.bytes + Buffer.byteLength(char, 'utf8');
    const maxBytes = state.purpose === 'key' ? 64 * 1024 : maxSelectedStringBytes;
    if (nextBytes > maxBytes) {
      if (state.purpose === 'key') {
        state.selected = false;
        state.value = '';
        return;
      }
      fail('ERR_JSON_SELECTED_STRING_LIMIT', `Selected JSON string exceeds ${maxBytes} bytes`);
    }
    state.bytes = nextBytes;
    state.value += char;
  };

  const consumeStringChar = (char) => {
    const state = stringState;
    if (state.unicodeDigits > 0) {
      const digit = Number.parseInt(char, 16);
      if (!Number.isInteger(digit)) fail('ERR_JSON_ESCAPE', 'Invalid Unicode escape');
      state.unicodeValue = state.unicodeValue * 16 + digit;
      state.unicodeDigits -= 1;
      if (state.unicodeDigits === 0) appendStringChar(String.fromCharCode(state.unicodeValue));
      return;
    }
    if (state.escaping) {
      state.escaping = false;
      if (char === 'u') {
        state.unicodeDigits = 4;
        state.unicodeValue = 0;
        return;
      }
      const escaped = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }[char];
      if (escaped === undefined) fail('ERR_JSON_ESCAPE', `Invalid JSON escape: \\${char}`);
      appendStringChar(escaped);
      return;
    }
    if (char === '\\') {
      state.escaping = true;
      return;
    }
    if (char === '"') {
      completeString();
      return;
    }
    if (char.charCodeAt(0) <= 0x1f) fail('ERR_JSON_STRING', 'Unescaped control character in JSON string');
    appendStringChar(char);
  };

  const finishNumber = () => {
    const state = numberState;
    numberState = null;
    mode = 'struct';
    if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(state.text)) {
      fail('ERR_JSON_NUMBER', 'Invalid JSON number');
    }
    assignValue(state.sink, state.selected ? Number(state.text) : undefined);
  };

  const finishLiteral = () => {
    const state = literalState;
    if (state.index !== state.expected.length) fail('ERR_JSON_LITERAL', 'Incomplete JSON literal');
    literalState = null;
    mode = 'struct';
    const value = state.expected === 'true' ? true : state.expected === 'false' ? false : null;
    assignValue(state.sink, state.selected ? value : undefined);
  };

  const childSelection = (context) => {
    if (!context?.selection) return null;
    if (context.kind === 'object') return context.selection.children.get(context.pendingKey) || null;
    return context.selection.children.get('*') || null;
  };

  const current = () => stack[stack.length - 1] || null;

  const write = (text) => {
    const source = String(text || '');
    for (let index = 0; index < source.length;) {
      const char = source[index];
      if (mode === 'string') {
        consumeStringChar(char);
        index += 1;
        continue;
      }
      if (mode === 'number') {
        if (/[0-9eE+\-.]/.test(char)) {
          numberState.length += 1;
          if (numberState.length > 256) fail('ERR_JSON_NUMBER_LIMIT', 'JSON number exceeds 256 characters');
          numberState.text += char;
          index += 1;
        } else {
          finishNumber();
        }
        continue;
      }
      if (mode === 'literal') {
        if (literalState.index < literalState.expected.length) {
          if (char !== literalState.expected[literalState.index]) fail('ERR_JSON_LITERAL', 'Invalid JSON literal');
          literalState.index += 1;
          index += 1;
          if (literalState.index === literalState.expected.length) finishLiteral();
        } else {
          finishLiteral();
        }
        continue;
      }

      if (/\s/.test(char)) {
        index += 1;
        continue;
      }
      if (rootDone && stack.length === 0) fail('ERR_JSON_TRAILING', 'Trailing data after JSON value');

      const context = current();
      if (!context) {
        startValue(selection, null, char);
        index += 1;
        continue;
      }

      if (context.kind === 'object') {
        if (context.phase === 'keyOrEnd' || context.phase === 'keyAfterComma') {
          if (char === '}') {
            if (context.phase === 'keyAfterComma') fail('ERR_JSON_OBJECT_KEY', 'Trailing comma in JSON object');
            closeContainer('}');
            index += 1;
          } else if (char === '"') {
            stringState = {
              purpose: 'key', sink: null, selected: true, value: '', bytes: 0,
              escaping: false, unicodeDigits: 0, unicodeValue: 0
            };
            mode = 'string';
            index += 1;
          } else {
            fail('ERR_JSON_OBJECT_KEY', 'Expected JSON object key');
          }
          continue;
        }
        if (context.phase === 'colon') {
          if (char !== ':') fail('ERR_JSON_STRUCTURE', 'Expected colon after JSON object key');
          context.phase = 'valueOrEnd';
          index += 1;
          continue;
        }
        if (context.phase === 'valueOrEnd') {
          startValue(childSelection(context), { parent: context, key: context.pendingKey }, char);
          index += 1;
          continue;
        }
        if (char === ',') {
          context.phase = 'keyAfterComma';
          context.pendingKey = null;
          index += 1;
        } else if (char === '}') {
          closeContainer('}');
          index += 1;
        } else {
          fail('ERR_JSON_STRUCTURE', 'Expected comma or object end');
        }
        continue;
      }

      if (context.phase === 'valueOrEnd') {
        if (char === ']') {
          closeContainer(']');
          index += 1;
        } else {
          startValue(childSelection(context), { parent: context }, char);
          index += 1;
        }
        continue;
      }
      if (context.phase === 'valueAfterComma') {
        if (char === ']') fail('ERR_JSON_VALUE', 'Trailing comma in JSON array');
        startValue(childSelection(context), { parent: context }, char);
        index += 1;
        continue;
      }
      if (char === ',') {
        context.phase = 'valueAfterComma';
        index += 1;
      } else if (char === ']') {
        closeContainer(']');
        index += 1;
      } else {
        fail('ERR_JSON_STRUCTURE', 'Expected comma or array end');
      }
    }
    return parser;
  };

  const finish = () => {
    if (mode === 'number') finishNumber();
    else if (mode === 'literal') finishLiteral();
    else if (mode === 'string') fail('ERR_JSON_STRING', 'Unterminated JSON string');
    if (stack.length > 0 || !rootDone) fail('ERR_JSON_INCOMPLETE', 'Incomplete JSON value');
    return rootValue;
  };

  const parser = { write, finish };
  return parser;
}

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
  const records = [];
  visitJsonLinesForward(filePath, record => {
    records.push(record);
    return true;
  }, { fsImpl, includeTrailingLine: true });
  return records;
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
  try {
    const bytesRead = readInto(fd, buffer, length, offset, fsImpl);
    return { bytesRead, buffer: buffer.subarray(0, bytesRead) };
  } finally {
    fsImpl.closeSync(fd);
  }
}

function readInto(fd, buffer, length, offset, fsImpl = fs) {
  let bytesRead = 0;
  while (bytesRead < length) {
    const count = fsImpl.readSync(fd, buffer, bytesRead, length - bytesRead, offset + bytesRead);
    if (!count) break;
    bytesRead += count;
  }
  return bytesRead;
}

function visitJsonLinesReverse(filePath, visitor, {
  fsImpl = fs,
  chunkSize = JSONL_READ_CHUNK_BYTES,
  endOffset = null,
  includeTrailingLine = true,
  createLongLineParser = null,
  longLineThresholdBytes = JSONL_LONG_LINE_THRESHOLD_BYTES,
  stats = null
} = {}) {
  let size;
  try { size = endOffset === null ? fsImpl.statSync(filePath).size : Math.max(0, Number(endOffset)); } catch (_) { return; }
  const fd = fsImpl.openSync(filePath, 'r');
  let position = size;
  let stopped = false;
  let lineEnd = size;
  let sawLineBoundary = false;
  let trailingCandidate = true;
  let hasFinalNewline = false;
  let pendingRanges = [];
  let activeChunkStart = 0;
  let activeChunkEnd = 0;
  const scratch = Buffer.allocUnsafe(Math.max(1, chunkSize));

  const visitRange = (start, end) => {
    const length = end - start;
    if (length <= 0) return true;
    if (stats) stats.maxLineLength = Math.max(stats.maxLineLength || 0, length);
    let value;
    try {
      if (length > longLineThresholdBytes && typeof createLongLineParser === 'function') {
        const parser = createLongLineParser();
        const decoder = new StringDecoder('utf8');
        let offset = start;
        while (offset < end) {
          const requested = Math.min(scratch.length, end - offset);
          const count = readInto(fd, scratch, requested, offset, fsImpl);
          if (stats) stats.bytesRead = (stats.bytesRead || 0) + count;
          if (count !== requested) {
            if (stats) stats.readErrors = (stats.readErrors || 0) + 1;
            return true;
          }
          parser.write(decoder.write(scratch.subarray(0, count)));
          offset += count;
        }
        const trailing = decoder.end();
        if (trailing) parser.write(trailing);
        if (offset !== end) return true;
        value = parser.finish();
      } else {
        let text;
        if (start >= activeChunkStart && end <= activeChunkEnd) {
          text = scratch.subarray(start - activeChunkStart, end - activeChunkStart).toString('utf8');
        } else {
          const decoder = new StringDecoder('utf8');
          text = '';
          let offset = start;
          while (offset < end) {
            const requested = Math.min(scratch.length, end - offset);
            const bytesRead = readInto(fd, scratch, requested, offset, fsImpl);
            if (stats) stats.bytesRead = (stats.bytesRead || 0) + bytesRead;
            if (bytesRead !== requested) {
              if (stats) stats.readErrors = (stats.readErrors || 0) + 1;
              return true;
            }
            text += decoder.write(scratch.subarray(0, bytesRead));
            offset += bytesRead;
          }
          text += decoder.end();
          activeChunkStart = -1;
          activeChunkEnd = -1;
        }
        text = text.replace(/\r$/, '');
        if (!text.trim()) return true;
        value = JSON.parse(text);
      }
    } catch (_) {
      if (stats) stats.parseErrors = (stats.parseErrors || 0) + 1;
      activeChunkStart = -1;
      activeChunkEnd = -1;
      return true;
    }
    activeChunkStart = -1;
    activeChunkEnd = -1;
    if (stats) stats.parsedRecords = (stats.parsedRecords || 0) + 1;
    return visitor(value) !== false;
  };

  try {
    while (position > 0 && !stopped) {
      const start = Math.max(0, position - chunkSize);
      const length = position - start;
      const bytesRead = readInto(fd, scratch, length, start, fsImpl);
      if (stats) stats.bytesRead = (stats.bytesRead || 0) + bytesRead;
      if (bytesRead !== length) {
        if (stats) stats.readErrors = (stats.readErrors || 0) + 1;
        break;
      }
      activeChunkStart = start;
      activeChunkEnd = start + bytesRead;
      for (let index = bytesRead - 1; index >= 0; index -= 1) {
        if (scratch[index] !== 0x0a) continue;
        if (start + index === size - 1) hasFinalNewline = true;
        const lineStart = start + index + 1;
        if (lineEnd > lineStart) {
          const skipUnterminatedTail = !includeTrailingLine && trailingCandidate && !hasFinalNewline;
          if (!skipUnterminatedTail) pendingRanges.push([lineStart, lineEnd]);
          trailingCandidate = false;
        }
        sawLineBoundary = true;
        lineEnd = start + index;
      }
      if (stopped) break;
      for (const [rangeStart, rangeEnd] of pendingRanges) {
        if (!visitRange(rangeStart, rangeEnd)) {
          stopped = true;
          break;
        }
      }
      pendingRanges = [];
      if (stopped) break;
      position = start;
    }
    if (!stopped && lineEnd > 0 && (includeTrailingLine || sawLineBoundary)) {
      visitRange(0, lineEnd);
    }
  } finally {
    fsImpl.closeSync(fd);
  }
}

/**
 * Visit complete JSONL records in forward order up to a fixed byte watermark.
 * The final unterminated record is deliberately ignored.
 */
function visitJsonLinesForward(filePath, visitor, {
  fsImpl = fs,
  chunkSize = JSONL_READ_CHUNK_BYTES,
  endOffset = null,
  includeTrailingLine = false,
  createLongLineParser = null,
  longLineThresholdBytes = JSONL_LONG_LINE_THRESHOLD_BYTES,
  stats = null
} = {}) {
  let size;
  try { size = endOffset === null ? fsImpl.statSync(filePath).size : Math.max(0, Number(endOffset)); } catch (_) { return; }
  const fd = fsImpl.openSync(filePath, 'r');
  const scratch = Buffer.allocUnsafe(Math.max(1, chunkSize));
  const decoder = new StringDecoder('utf8');
  let position = 0;
  let stopped = false;
  let lineText = '';
  let lineParser = null;
  let lineBytes = 0;
  let lineDiscarded = false;

  const submitLine = () => {
    const length = lineBytes;
    if (stats) stats.maxLineLength = Math.max(stats.maxLineLength || 0, length);
    if (lineDiscarded) {
      lineParser = null;
      lineText = '';
      lineBytes = 0;
      lineDiscarded = false;
      return true;
    }
    let value;
    try {
      if (lineParser) {
        value = lineParser.finish();
      } else {
        const text = lineText.replace(/\r$/, '');
        lineText = '';
        if (!text.trim()) {
          lineBytes = 0;
          return true;
        }
        value = JSON.parse(text);
      }
    } catch (_) {
      if (stats) stats.parseErrors = (stats.parseErrors || 0) + 1;
      lineParser = null;
      lineText = '';
      lineBytes = 0;
      return true;
    }
    lineParser = null;
    lineText = '';
    lineBytes = 0;
    if (stats) stats.parsedRecords = (stats.parsedRecords || 0) + 1;
    return visitor(value) !== false;
  };

  const consumeText = text => {
    const appendSegment = segment => {
      if (!segment) return;
      lineBytes += Buffer.byteLength(segment, 'utf8');
      if (lineDiscarded) return;
      try {
        if (lineParser) {
          lineParser.write(segment);
        } else if (lineBytes > longLineThresholdBytes && typeof createLongLineParser === 'function') {
          lineParser = createLongLineParser();
          lineParser.write(lineText);
          lineParser.write(segment);
          lineText = '';
        } else {
          lineText += segment;
        }
      } catch (_) {
        if (stats) stats.parseErrors = (stats.parseErrors || 0) + 1;
        lineText = '';
        lineParser = null;
        lineDiscarded = true;
      }
    };
    let segmentStart = 0;
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] !== '\n') continue;
      appendSegment(text.slice(segmentStart, index));
      if (!submitLine()) {
        stopped = true;
        return;
      }
      segmentStart = index + 1;
    }
    appendSegment(text.slice(segmentStart));
  };

  try {
    while (position < size && !stopped) {
      const length = Math.min(scratch.length, size - position);
      const bytesRead = readInto(fd, scratch, length, position, fsImpl);
      if (!bytesRead) {
        if (stats) stats.readErrors = (stats.readErrors || 0) + 1;
        break;
      }
      if (bytesRead !== length) {
        if (stats) stats.readErrors = (stats.readErrors || 0) + 1;
        break;
      }
      if (stats) stats.bytesRead = (stats.bytesRead || 0) + bytesRead;
      consumeText(decoder.write(scratch.subarray(0, bytesRead)));
      position += bytesRead;
    }
    if (!stopped && includeTrailingLine && lineBytes > 0) submitLine();
  } finally {
    fsImpl.closeSync(fd);
  }
}

function findTrailingLineOffset(filePath, size, fsImpl = fs, stats = null) {
  if (size <= 0) return 0;
  const fd = fsImpl.openSync(filePath, 'r');
  let position = size;
  const scratch = Buffer.allocUnsafe(JSONL_READ_CHUNK_BYTES);
  try {
    while (position > 0) {
      const start = Math.max(0, position - scratch.length);
      const requested = position - start;
      const bytesRead = readInto(fd, scratch, requested, start, fsImpl);
      if (stats) stats.bytesRead = (stats.bytesRead || 0) + bytesRead;
      if (bytesRead !== requested) {
        if (stats) stats.readErrors = (stats.readErrors || 0) + 1;
        break;
      }
      for (let index = bytesRead - 1; index >= 0; index -= 1) {
        if (scratch[index] !== 0x0a) continue;
        const absolute = start + index + 1;
        return absolute === size ? size : absolute;
      }
      position = start;
    }
  } finally {
    fsImpl.closeSync(fd);
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
  createLongLineParser = null,
  longLineThresholdBytes = JSONL_LONG_LINE_THRESHOLD_BYTES,
  onDiagnostic = () => {},
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
      lineText: '',
      lineParser: null,
      lineBytes: 0,
      lineDiscarded: false,
      decoder: new StringDecoder('utf8'),
      prefixBytes: Buffer.alloc(0),
      tailBytes: Buffer.alloc(0),
      baselineReady: false,
      entryIndex: Number.isInteger(customState.entryIndex) ? customState.entryIndex : 0
    };
  };

  const setAnchors = (filePath, state, offset, stats = null) => {
    const prefix = readFileRange(
      filePath,
      0,
      Math.min(offset, CURSOR_ANCHOR_BYTES),
      fsImpl
    );
    const tailLength = Math.min(offset, CURSOR_ANCHOR_BYTES);
    const tail = readFileRange(filePath, Math.max(0, offset - tailLength), tailLength, fsImpl);
    if (prefix.bytesRead !== Math.min(offset, CURSOR_ANCHOR_BYTES) || tail.bytesRead !== tailLength) {
      throw new Error('Native log anchor read was incomplete');
    }
    if (stats) stats.bytesRead = (stats.bytesRead || 0) + prefix.bytesRead + tail.bytesRead;
    state.prefixBytes = Buffer.from(prefix.buffer);
    state.tailBytes = Buffer.from(tail.buffer);
  };

  const readAnchorSnapshot = (filePath, endOffset, stats = null) => {
    const prefixLength = Math.min(endOffset, CURSOR_ANCHOR_BYTES);
    const tailLength = Math.min(endOffset, CURSOR_ANCHOR_BYTES);
    const prefix = readFileRange(filePath, 0, prefixLength, fsImpl);
    const tail = readFileRange(filePath, Math.max(0, endOffset - tailLength), tailLength, fsImpl);
    if (stats) stats.bytesRead = (stats.bytesRead || 0) + prefix.bytesRead + tail.bytesRead;
    if (prefix.bytesRead !== prefixLength || tail.bytesRead !== tailLength) {
      throw new Error('Native log anchor snapshot was incomplete');
    }
    return { prefix: Buffer.from(prefix.buffer), tail: Buffer.from(tail.buffer) };
  };

  const updateAnchors = (state, buffer) => {
    if (!buffer.length) return;
    if (state.prefixBytes.length < CURSOR_ANCHOR_BYTES) {
      const needed = CURSOR_ANCHOR_BYTES - state.prefixBytes.length;
      const copied = Math.min(needed, buffer.length);
      const nextPrefix = Buffer.allocUnsafe(state.prefixBytes.length + copied);
      state.prefixBytes.copy(nextPrefix);
      buffer.copy(nextPrefix, state.prefixBytes.length, 0, copied);
      state.prefixBytes = nextPrefix;
    }
    const tailLength = Math.min(CURSOR_ANCHOR_BYTES, state.tailBytes.length + buffer.length);
    const nextTail = Buffer.allocUnsafe(tailLength);
    const fromOld = Math.max(0, tailLength - buffer.length);
    const oldStart = Math.max(0, state.tailBytes.length - fromOld);
    const oldLength = Math.min(fromOld, state.tailBytes.length - oldStart);
    if (oldLength) state.tailBytes.copy(nextTail, 0, oldStart, oldStart + oldLength);
    buffer.copy(nextTail, oldLength, Math.max(0, buffer.length - (tailLength - oldLength)));
    state.tailBytes = nextTail;
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

  const appendLineText = (state, text) => {
    if (!text) return;
    state.lineBytes += Buffer.byteLength(text, 'utf8');
    if (state.lineDiscarded) return;
    if (state.lineParser) {
      state.lineParser.write(text);
      return;
    }
    if (state.lineBytes > longLineThresholdBytes && typeof createLongLineParser === 'function') {
      state.lineParser = createLongLineParser();
      if (state.lineText) state.lineParser.write(state.lineText);
      state.lineParser.write(text);
      state.lineText = '';
      return;
    }
    state.lineText += text;
  };

  const submitLine = (filePath, state, events, shouldEmit, stats) => {
    if (state.lineBytes === 0) return;
    stats.maxLineLength = Math.max(stats.maxLineLength, state.lineBytes);
    if (state.lineDiscarded) {
      state.lineText = '';
      state.lineParser = null;
      state.lineBytes = 0;
      state.lineDiscarded = false;
      state.entryIndex += 1;
      return;
    }
    let record;
    try {
      if (state.lineParser) {
        record = state.lineParser.finish();
      } else {
        const line = state.lineText.replace(/\r$/, '');
        if (!line.trim()) {
          state.lineText = '';
          state.lineBytes = 0;
          return;
        }
        record = JSON.parse(line);
      }
      stats.parsedRecords += 1;
    } catch (error) {
      stats.parseErrors += 1;
      onError(error, filePath);
      state.lineText = '';
      state.lineParser = null;
      state.lineBytes = 0;
      state.lineDiscarded = false;
      state.entryIndex += 1;
      return;
    }
    try {
      const parsed = parseLine(filePath, record, state, state.entryIndex);
      const parsedEvents = Array.isArray(parsed) ? parsed : [parsed];
      parsedEvents.forEach(event => collectEvent(event, filePath, events, shouldEmit));
    } catch (error) {
      stats.parseErrors += 1;
      onError(error, filePath);
    }
    state.lineText = '';
    state.lineParser = null;
    state.lineBytes = 0;
    state.lineDiscarded = false;
    state.entryIndex += 1;
  };

  const consumeText = (filePath, state, text, events, shouldEmit, stats) => {
    const appendSegment = segment => {
      if (!segment) return;
      try {
        appendLineText(state, segment);
      } catch (error) {
        stats.parseErrors += 1;
        onError(error, filePath);
        state.lineText = '';
        state.lineParser = null;
        state.lineDiscarded = true;
      }
    };
    let segmentStart = 0;
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] !== '\n') continue;
      appendSegment(text.slice(segmentStart, index));
      submitLine(filePath, state, events, shouldEmit, stats);
      segmentStart = index + 1;
    }
    appendSegment(text.slice(segmentStart));
  };

  const readChangedBytes = (filePath, state, stat, events, shouldEmit, stats) => {
    if (stat.size <= state.offset) return true;
    const fd = fsImpl.openSync(filePath, 'r');
    const scratch = Buffer.allocUnsafe(JSONL_READ_CHUNK_BYTES);
    let complete = true;
    try {
      while (state.offset < stat.size) {
        const length = Math.min(scratch.length, stat.size - state.offset);
        const bytesRead = fsImpl.readSync(fd, scratch, 0, length, state.offset);
        if (!bytesRead) {
          complete = false;
          stats.readErrors += 1;
          break;
        }
        if (bytesRead !== length) {
          complete = false;
          stats.readErrors += 1;
        }
        const chunk = scratch.subarray(0, bytesRead);
        stats.bytesRead += bytesRead;
        consumeText(filePath, state, state.decoder.write(chunk), events, shouldEmit, stats);
        state.offset += bytesRead;
        updateAnchors(state, chunk);
        if (!complete) break;
      }
    } finally {
      fsImpl.closeSync(fd);
    }
    return complete && state.offset >= stat.size;
  };

  const read = () => {
    const events = [];
    const files = scanFiles();
    const currentFiles = new Set(files);
    const isInitialRead = !initialized;
    const stats = {
      files: files.length,
      bytesRead: 0,
      parsedRecords: 0,
      maxLineLength: 0,
      parseErrors: 0,
      readErrors: 0
    };
    let baselineReady = true;
    for (const filePath of fileStates.keys()) {
      if (!currentFiles.has(filePath)) fileStates.delete(filePath);
    }

    for (const filePath of files) {
      let stat;
      try { stat = fsImpl.statSync(filePath); } catch (_) {
        stats.readErrors += 1;
        if (skipInitialParse && isInitialRead) baselineReady = false;
        continue;
      }
      let state = fileStates.get(filePath);
      const replaced = state && isReplaced(filePath, state, stat);
      if (!state || replaced) {
        state = makeState(filePath, stat, state, Boolean(replaced));
        fileStates.set(filePath, state);
      }

      if (skipInitialParse && !state.baselineReady) {
        const baselineSize = stat.size;
        const readErrorsBefore = stats.readErrors;
        let bootstrapResult = true;
        let baselineAnchors;
        try {
          baselineAnchors = readAnchorSnapshot(filePath, baselineSize, stats);
          bootstrapResult = bootstrapFile ? bootstrapFile(filePath, state, stat, stats) : true;
          if (bootstrapResult && typeof bootstrapResult === 'object') bootstrapResult = bootstrapResult.ok !== false;
        } catch (error) {
          stats.parseErrors += 1;
          onError(error, filePath);
          bootstrapResult = false;
        }
        let currentStat;
        let currentAnchors;
        try { currentStat = fsImpl.statSync(filePath); } catch (_) { currentStat = null; }
        try { currentAnchors = readAnchorSnapshot(filePath, baselineSize, stats); } catch (_) { currentAnchors = null; }
        if (!bootstrapResult || !currentStat
          || stats.readErrors > readErrorsBefore
          || currentStat.dev !== stat.dev || currentStat.ino !== stat.ino || currentStat.size < baselineSize
          || !currentAnchors
          || !currentAnchors.prefix.equals(baselineAnchors?.prefix || Buffer.alloc(0))
          || !currentAnchors.tail.equals(baselineAnchors?.tail || Buffer.alloc(0))) {
          baselineReady = false;
          stats.parseErrors += 1;
          onError(new Error('Native log baseline did not reach a stable file watermark'), filePath);
          continue;
        }
        state.offset = findTrailingLineOffset(filePath, baselineSize, fsImpl, stats);
        state.size = stat.size;
        state.dev = stat.dev;
        state.ino = stat.ino;
        state.mtimeMs = stat.mtimeMs;
        state.ctimeMs = stat.ctimeMs;
        setAnchors(filePath, state, state.offset, stats);
        state.baselineReady = true;
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
        if (!readChangedBytes(filePath, state, stat, events, shouldEmit, stats)) {
          throw new Error('Native log read ended before the requested file range');
        }
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
      state.baselineReady = true;
    }
    for (const state of fileStates.values()) {
      if (skipInitialParse && !state.baselineReady) baselineReady = false;
    }
    initialized = baselineReady;
    try { onDiagnostic({ ...stats, initialized }); } catch (_) {}
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
  createSelectiveJsonLineParser,
  usageFieldPaths,
  visitJsonLinesForward,
  visitJsonLinesReverse,
  subtractUsage,
  walkFiles,
  createIncrementalJsonlCursor,
  createScannedFileCursor
};
