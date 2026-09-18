'use strict';

const fs = require('fs');
const path = require('path');
const { HOME_DIR } = require('../../../config/paths');
const { getOmpPaths } = require('./config');
const { normalizeUsage: normalizeNativeUsage } = require('../native-log-utils');

let ompSessionPathsOverride = null;

function configure({ pathContext } = {}) {
  require('./config').configure?.({ pathContext });
  const native = pathContext?.customized ? (pathContext.native || {}) : {};
  ompSessionPathsOverride = native.sessions
    ? { ...native, agentDir: native.dir || path.dirname(native.sessions) }
    : null;
}

function getOmpSessionPaths() {
  if (ompSessionPathsOverride?.sessions) return ompSessionPathsOverride;
  return getOmpPaths(process.env, { resolveRuntime: false });
}

function encodeProjectName(cwd = '') {
  return `--${String(cwd || '').replace(/\\/g, '/').replace(/\//g, '--')}--`;
}

function getDisplayName(cwd = '') {
  const normalized = String(cwd || '').trim();
  if (!normalized) return 'Unknown';
  return path.basename(normalized) || normalized;
}

function parseOmpSessionId(filePath = '') {
  const base = path.basename(filePath, '.jsonl');
  const match = base.match(/([0-9a-f]{8}-[0-9a-f-]{8,})$/i);
  if (match) return match[1];
  return base;
}

function normalizeTextContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === 'string') return item;
      if (item?.type === 'text') return item.text || '';
      if (item?.text) return item.text;
      return '';
    }).filter(Boolean).join('\n');
  }
  if (content && typeof content === 'object') {
    if (typeof content.text === 'string') return content.text;
    if (typeof content.content === 'string') return content.content;
  }
  return '';
}

function extractMessageText(message = {}) {
  if (typeof message.content === 'string' || Array.isArray(message.content)) {
    return normalizeTextContent(message.content);
  }
  if (Array.isArray(message.parts)) {
    return normalizeTextContent(message.parts);
  }
  if (Array.isArray(message.thinking)) {
    return normalizeTextContent(message.thinking);
  }
  if (message.toolCall && typeof message.toolCall === 'object') {
    return JSON.stringify(message.toolCall, null, 2);
  }
  if (message.toolResult && typeof message.toolResult === 'object') {
    return normalizeTextContent(message.toolResult.content || message.toolResult.output || message.toolResult);
  }
  if (message.bashExecution && typeof message.bashExecution === 'object') {
    return normalizeTextContent(message.bashExecution.output || message.bashExecution.command || message.bashExecution);
  }
  if (typeof message.text === 'string') return message.text;
  if (typeof message.output === 'string') return message.output;
  return '';
}

function parseUsage(usage = {}) {
  const normalized = normalizeNativeUsage(usage);
  const input = normalized.input;
  const output = normalized.output;
  const cacheRead = normalized.cacheRead;
  const cacheWrite = normalized.cacheCreation;
  const reasoning = normalized.reasoning;
  const total = normalized.total;
  const cost = typeof usage.cost === 'number'
    ? usage.cost
    : Number(usage.cost?.total ?? usage.cost?.usd ?? 0) || 0;
  return {
    input, output, cached: normalized.cached, cacheRead, cacheWrite,
    cacheCreation: normalized.cacheCreation, reasoning, total, cost
  };
}

function readJsonLines(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw
      .split(/\r?\n/)
      .filter(line => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { type: 'invalid', raw: line };
        }
      });
  } catch {
    return [];
  }
}

function convertOmpEntry(entry = {}, index = 0) {
  if (!entry || entry.type !== 'message') {
    return null;
  }
  const message = entry.message || {};
  const role = message.role || entry.role;
  const assistantLikeRoles = new Set(['assistant', 'tool', 'toolResult', 'tool_result', 'bashExecution', 'bash_execution', 'custom']);
  if (role !== 'user' && !assistantLikeRoles.has(role)) {
    return null;
  }
  const text = extractMessageText(message);
  const type = role === 'user' ? 'user' : 'assistant';
  const result = {
    id: entry.id || message.id || `msg-${index}`,
    type,
    role,
    content: text || '',
    timestamp: entry.timestamp || message.timestamp || null
  };

  if (type === 'assistant') {
    if (role !== 'assistant') {
      result.subtype = role;
    }
    result.provider = entry.provider || message.provider || '';
    result.model = entry.model || message.model || '';
    result.usage = parseUsage(entry.usage || message.usage || {});
  }

  return result;
}

/**
 * Inventory all OMP session files.
 * @returns {Promise<Array>}
 */
async function inventory({ projectsDir } = {}) {
  const descriptors = [];
  let sessionsDir;
  try {
    sessionsDir = projectsDir || getOmpSessionPaths().sessions;
  } catch (_) {
    return descriptors;
  }
  try {
    await fs.promises.stat(sessionsDir);
  } catch (_) {
    return descriptors;
  }

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        try {
          const stat = await fs.promises.stat(fullPath);
          descriptors.push({
            filePath: fullPath,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            sessionId: parseOmpSessionId(fullPath),
            projectHint: null // OMP determines project from session content
          });
        } catch (_) {}
      }
    }
  }

  await walk(sessionsDir);
  return descriptors;
}

async function summarize(descriptor) {
  let entries = [];
  let fd;
  try {
    fd = fs.openSync(descriptor.filePath, 'r');
    const buffer = Buffer.alloc(64 * 1024);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    entries = buffer.subarray(0, bytesRead).toString('utf8')
      .split(/\r?\n/).filter(line => line.trim()).map(line => {
        try { return JSON.parse(line); } catch (_) { return null; }
      }).filter(Boolean);
  } catch (_) {
    entries = [];
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
  const header = entries.find(entry => entry?.type === 'session') || {};
  const messages = entries.map(convertOmpEntry).filter(Boolean);
  const firstUser = messages.find(message => message.type === 'user' && message.content);
  const modelChange = [...entries].reverse().find(entry => entry?.type === 'model_change');
  const cwd = header.cwd || header.project?.cwd || '';
  const sessionId = header.id || descriptor.sessionId || parseOmpSessionId(descriptor.filePath);
  return {
    session: {
      sessionId,
      projectName: cwd ? encodeProjectName(cwd) : 'unknown',
      projectDisplayName: getDisplayName(cwd),
      projectFullPath: cwd || null,
      firstMessage: firstUser?.content || null,
      gitBranch: header.gitBranch || null,
      provider: modelChange?.provider || messages.find(message => message.provider)?.provider || null,
      model: modelChange?.modelId || modelChange?.model || messages.find(message => message.model)?.model || null,
      startedAt: header.timestamp ? new Date(header.timestamp).getTime() : null,
      updatedAt: descriptor.mtimeMs,
      extraJson: JSON.stringify({ cwd: cwd || null })
    }
  };
}

/**
 * Parse an OMP session file.
 */
async function parse(descriptor) {
  const { filePath, size, mtimeMs } = descriptor;
  const entries = readJsonLines(filePath);
  const header = entries.find(entry => entry?.type === 'session') || {};
  const cwd = header.cwd
    || header.project?.cwd
    || entries.find(entry => typeof entry?.cwd === 'string')?.cwd
    || entries.find(entry => typeof entry?.message?.cwd === 'string')?.message.cwd
    || '';
  const sessionId = header.id || parseOmpSessionId(filePath) || descriptor.sessionId;

  const parsedMessages = entries.map((entry, idx) => convertOmpEntry(entry, idx)).filter(Boolean);

  // Find model change
  const modelChange = [...entries].reverse().find(entry => entry?.type === 'model_change');
  const model = modelChange?.modelId || modelChange?.model || parsedMessages.find(m => m.type === 'assistant' && m.model)?.model || null;
  const provider = modelChange?.provider || parsedMessages.find(m => m.type === 'assistant' && m.provider)?.provider || null;

  // Aggregate usage
  const usage = parsedMessages
    .filter(m => m.type === 'assistant')
    .reduce((acc, m) => {
      const u = parseUsage(m.usage || {});
      acc.input += u.input;
      acc.output += u.output;
      acc.cached += u.cached;
      acc.reasoning += u.reasoning;
      acc.total += u.total;
      acc.cost += u.cost || 0;
      return acc;
    }, { input: 0, output: 0, cached: 0, reasoning: 0, total: 0, cost: 0 });

  const usageJson = JSON.stringify(usage);

  // Normalize messages
  const messages = [];
  let userMessageNumber = 0;
  for (const pm of parsedMessages) {
    const msg = {
      messageId: pm.id || null,
      role: pm.type === 'user' ? 'user' : 'assistant',
      type: pm.type,
      subtype: pm.subtype || null,
      content: typeof pm.content === 'string' ? pm.content : '',
      timestamp: pm.timestamp ? (typeof pm.timestamp === 'number' ? pm.timestamp : new Date(pm.timestamp).getTime()) : null,
      model: pm.model || model || null,
      provider: pm.provider || provider || null,
      userMessageNumber: null,
      extraJson: null
    };
    if (msg.role === 'user') {
      userMessageNumber++;
      msg.userMessageNumber = userMessageNumber;
    }
    messages.push(msg);
  }

  const firstUserMsg = messages.find(m => m.role === 'user' && m.content);
  const lastMsg = messages[messages.length - 1];
  const projectName = cwd ? encodeProjectName(cwd) : 'unknown';
  const displayName = getDisplayName(cwd);

  const session = {
    sessionId,
    projectName,
    projectDisplayName: displayName,
    projectFullPath: cwd || null,
    firstMessage: firstUserMsg ? firstUserMsg.content : null,
    gitBranch: header.gitBranch || null,
    provider,
    model,
    startedAt: messages[0] ? messages[0].timestamp : null,
    updatedAt: lastMsg ? (lastMsg.timestamp || mtimeMs) : mtimeMs,
    usageJson,
    extraJson: JSON.stringify({ cwd })
  };

  return { session, messages };
}

module.exports = { configure, inventory, summarize, parse, convertOmpEntry, parseUsage, encodeProjectName: encodeProjectName, getDisplayName, readJsonLines, extractMessageText, normalizeTextContent };
