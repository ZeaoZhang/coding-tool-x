'use strict';

const fs = require('fs');
const path = require('path');

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : 0;
}

function normalizeCost(value) {
  if (value && typeof value === 'object') {
    return number(value.total ?? value.usd ?? value.amount);
  }
  return number(value);
}

function normalizeUsage(usage = {}) {
  const input = number(usage.input ?? usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens ?? usage.promptTokens);
  const output = number(usage.output ?? usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens ?? usage.completionTokens);
  const reasoning = number(usage.reasoning ?? usage.reasoning_tokens ?? usage.reasoningTokens ?? usage.reasoning_output_tokens);
  const cacheCreation = number(usage.cacheCreation ?? usage.cache_creation ?? usage.cacheWrite ?? usage.cache_write
    ?? usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens);
  const cacheRead = number(usage.cacheRead ?? usage.cache_read ?? usage.cache_read_input_tokens ?? usage.cacheReadInputTokens);
  const cached = number(usage.cached ?? usage.cached_tokens ?? usage.cachedTokens ?? cacheRead);
  const total = number(usage.total ?? usage.total_tokens ?? usage.totalTokens) || input + output + reasoning + cacheCreation + cacheRead;
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

function createScannedFileCursor({ scanFiles, parseFile, normalizeEvent, fsImpl = fs }) {
  let seenByFile = new Map();
  let fileStates = new Map();
  let initialized = false;

  const read = () => {
    const events = [];
    const files = scanFiles();
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
      if (!previousState || replaced) {
        seenByFile.set(filePath, new Set());
      }
      fileStates.set(filePath, { dev: stat.dev, ino: stat.ino, size: stat.size });

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
