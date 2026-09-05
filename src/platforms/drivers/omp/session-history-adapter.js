'use strict';

const fs = require('fs');
const path = require('path');
const { HOME_DIR } = require('../../../config/paths');
const { getOmpPaths } = require('./config');

function getOmpSessionPaths() {
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
  const input = Number(usage.input ?? usage.inputTokens ?? usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokens ?? 0) || 0;
  const output = Number(usage.output ?? usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens ?? usage.completionTokens ?? 0) || 0;
  const cacheRead = Number(usage.cacheRead ?? usage.cache_read ?? usage.cachedTokens ?? usage.cached_tokens ?? usage.cache_read_input_tokens ?? 0) || 0;
  const cacheWrite = Number(usage.cacheWrite ?? usage.cache_write ?? usage.cacheCreation ?? usage.cache_creation ?? usage.cache_creation_input_tokens ?? 0) || 0;
  const reasoning = Number(usage.reasoningTokens ?? usage.reasoning_tokens ?? 0) || 0;
  const total = Number(usage.totalTokens ?? usage.total_tokens ?? (input + output + cacheRead + cacheWrite + reasoning)) || 0;
  const cost = typeof usage.cost === 'number'
    ? usage.cost
    : Number(usage.cost?.total ?? usage.cost?.usd ?? 0) || 0;
  return { input, output, cached: cacheRead, cacheRead, cacheWrite, reasoning, total, cost };
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

module.exports = { inventory, parse, convertOmpEntry, parseUsage, encodeProjectName: encodeProjectName, getDisplayName, readJsonLines, extractMessageText, normalizeTextContent };
