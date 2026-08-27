'use strict';

const fs = require('fs/promises');
const path = require('path');

function failure({ platform, operation, error, root, filePath }) {
  const result = {
    status: 'failed',
    platform,
    capability: 'sessions',
    operation,
    error: error && error.message ? error.message : String(error)
  };
  if (root) result.root = root;
  if (filePath) result.filePath = filePath;
  return result;
}

function getMappedValue(source, mapping, fallback) {
  if (!mapping) return fallback;
  if (mapping === 'basename') return fallback;
  return String(mapping).split('.').reduce((value, key) => (
    value && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined
  ), source);
}

function normalizeMessage(entry, mapping) {
  const role = getMappedValue(entry, mapping.role, entry.role);
  const content = getMappedValue(entry, mapping.content, entry.content);
  const timestamp = getMappedValue(entry, mapping.timestamp, entry.timestamp);
  const model = getMappedValue(entry, mapping.model, entry.model);
  const message = { ...entry };
  if (role !== undefined) message.role = role;
  if (content !== undefined) message.content = content;
  if (timestamp !== undefined) message.timestamp = timestamp;
  if (model !== undefined) message.model = model;
  return message;
}

function compileSessionGlob(sessionGlob) {
  if (!sessionGlob) return {
    matches: name => name.endsWith('.jsonl'),
    sessionIdFromName: name => name.endsWith('.jsonl') ? name.slice(0, -'.jsonl'.length) : name
  };

  const pattern = String(sessionGlob);
  let source = '^';
  for (const char of pattern) {
    if (char === '*') source += '.*';
    else if (char === '?') source += '.';
    else source += char.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
  }
  source += '$';
  const matcher = new RegExp(source);
  const extension = path.extname(pattern);
  return {
    matches: name => matcher.test(name),
    sessionIdFromName: name => extension && name.endsWith(extension) ? name.slice(0, -extension.length) : name
  };
}

function deriveSessionId(basename, mapping, first) {
  if (!mapping.sessionId || mapping.sessionId === 'basename') return basename;
  return getMappedValue(first, mapping.sessionId, basename) || basename;
}

function needsInventoryRead(mapping) {
  return Boolean(
    mapping.sessionId && mapping.sessionId !== 'basename'
      || mapping.projectName && mapping.projectName !== 'basename'
  );
}

async function readFirstJsonLine(fsImpl, filePath) {
  const content = await fsImpl.readFile(filePath, 'utf8');
  const line = String(content).split(/\r?\n/).find(candidate => candidate.trim());
  return line ? JSON.parse(line) : {};
}

function createGenericJsonlDriver({ platform, manifest = {}, fsImpl = fs } = {}) {
  const sessionRoot = manifest.paths && manifest.paths.sessions;
  const mapping = manifest.sessionMapping || {};
  const sessionGlob = compileSessionGlob(manifest.sessionGlob);

  return {
    platform,
    capability: 'sessions',
    async inventory() {
      try {
        const names = await fsImpl.readdir(sessionRoot);
        const descriptors = [];
        const readInventoryFields = needsInventoryRead(mapping);
        for (const name of names) {
          if (!sessionGlob.matches(name)) continue;
          const filePath = path.join(sessionRoot, name);
          const stat = await fsImpl.stat(filePath);
          const basename = sessionGlob.sessionIdFromName(name);
          const first = readInventoryFields ? await readFirstJsonLine(fsImpl, filePath) : {};
          descriptors.push({
            filePath,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            sessionId: deriveSessionId(basename, mapping, first),
            projectHint: getMappedValue(first, mapping.projectName)
          });
        }
        return descriptors;
      } catch (error) {
        return failure({ platform, operation: 'inventory', root: sessionRoot, error });
      }
    },
    async parse(descriptor) {
      const filePath = descriptor && descriptor.filePath;
      try {
        const content = await fsImpl.readFile(filePath, 'utf8');
        const parsedLines = [];
        for (const line of String(content).split(/\r?\n/)) {
          if (!line.trim()) continue;
          parsedLines.push(JSON.parse(line));
        }
        const first = parsedLines[0] || {};
        const mappedMessages = getMappedValue(first, mapping.messages);
        const sourceMessages = Array.isArray(mappedMessages) ? mappedMessages : parsedLines;
        const descriptorSessionId = descriptor.sessionId || sessionGlob.sessionIdFromName(path.basename(filePath));
        const sessionId = descriptor.sessionId || deriveSessionId(descriptorSessionId, mapping, first);
        const projectName = getMappedValue(first, mapping.projectName, descriptor.projectHint);
        return {
          sessionId,
          projectName,
          filePath,
          messages: sourceMessages.map(message => normalizeMessage(message, mapping))
        };
      } catch (error) {
        return failure({ platform, operation: 'parse', filePath, error });
      }
    }
  };
}

module.exports = { createGenericJsonlDriver };
