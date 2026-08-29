'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { HOME_DIR } = require('../../../config/paths');
const { getGeminiDir } = require('../gemini-config');

const HASH_RE = /^[a-f0-9]{64}$/;
const SESSION_FILE_RE = /^session-(.*)-([a-f0-9]+)\.(json|jsonl)$/;

/**
 * Extract text content from Gemini message parts.
 */
function extractContentText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map(item => {
        if (typeof item === 'string') return item;
        if (item && item.text) return item.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/**
 * Load storage-name → project root mapping from projects.json.
 */
async function loadProjectRootsByStorageName() {
  const projectsPath = path.join(getGeminiDir(), 'projects.json');
  try {
    const content = await fs.promises.readFile(projectsPath, 'utf8');
    const parsed = JSON.parse(content);
    const projects = parsed && typeof parsed.projects === 'object' ? parsed.projects : {};
    return new Map(
      Object.entries(projects)
        .filter(([, storageName]) => typeof storageName === 'string')
        .map(([projectRoot, storageName]) => [storageName, projectRoot])
    );
  } catch {
    return new Map();
  }
}

/**
 * Compute project hash from path.
 */
function getFilePathHash(filePath) {
  return crypto.createHash('sha256').update(filePath).digest('hex');
}

/**
 * Normalize a Gemini message record.
 */
function normalizeMessageRecord(record, provider = null, model = null) {
  const isUser =
    record.type === 'user' ||
    record.role === 'user' ||
    record.author === 'user' ||
    record.author === 'human';

  const isAssistant =
    record.type === 'assistant' ||
    record.type === 'gemini' ||
    record.role === 'assistant' ||
    record.type === 'ai' ||
    record.author === 'ai' ||
    record.author === 'assistant';

  let role = 'unknown';
  if (isUser) role = 'user';
  else if (isAssistant) role = 'assistant';
  else if (record.type === 'system' || record.role === 'system') role = 'system';
  else role = record.type || record.role || 'unknown';

  const content = extractContentText(record.content || record.message || record.parts || '');
  const subtype = record.subtype || null;

  return {
    messageId: record.id || record.messageId || null,
    role,
    type: record.type || role,
    subtype,
    content: content || '',
    timestamp: record.timestamp || null,
    model: record.model || model || null,
    provider: record.provider || provider || null,
    userMessageNumber: null, // filled later
    usage: record.tokens || record.usage || null,
    extraJson: null
  };
}

/**
 * Parse a Gemini session file (supports both JSON and JSONL formats).
 * @param {string} filePath
 * @param {string} sessionId
 * @returns {{ messages: Array, meta: object }}
 */
function parseSessionContent(filePath, sessionId) {
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) return { messages: [], meta: { sessionId, messages: [] } };

  // Try JSON first
  try {
    const parsed = JSON.parse(raw);
    // Handle $set-style JSONL updates: extract only the latest state
    if (parsed.$set) return parseSessionContentFromState(parsed.$set, sessionId);
    if (parsed.messages) return parseSessionContentFromState(parsed, sessionId);
    return { messages: [], meta: { sessionId, messages: [] } };
  } catch (_) {
    // JSONL format: line-by-line $set/message updates
    return parseJsonlContent(raw, sessionId);
  }
}

function parseSessionContentFromState(state, sessionId) {
  const meta = {
    sessionId: state.sessionId || state.id || sessionId,
    projectHash: state.projectHash || state.project_hash || null,
    projectPath: state.projectPath || state.project_path || null,
    lastUpdated: state.lastUpdated || state.last_updated || null,
    messages: state.messages || []
  };
  const messages = (state.messages || []).map(m => normalizeMessageRecord(m));

  let userNum = 0;
  for (const msg of messages) {
    if (msg.role === 'user') {
      userNum++;
      msg.userMessageNumber = userNum;
    }
  }

  return { messages, meta };
}

function parseJsonlContent(raw, sessionId) {
  const lines = raw.split('\n').filter(l => l.trim());
  const messagesById = new Map();
  const meta = { sessionId, projectHash: null, projectPath: null, lastUpdated: null, messages: [] };

  for (const line of lines) {
    try {
      const record = JSON.parse(line);
      if (record.$set) {
        Object.assign(meta, {
          sessionId: record.$set.sessionId || record.$set.id || meta.sessionId,
          projectHash: record.$set.projectHash || record.$set.project_hash || meta.projectHash,
          projectPath: record.$set.projectPath || record.$set.project_path || meta.projectPath,
          lastUpdated: record.$set.lastUpdated || record.$set.last_updated || meta.lastUpdated
        });
        if (record.$set.messages) meta.messages = record.$set.messages;
      } else if (record.type === 'session') {
        meta.sessionId = record.id || record.sessionId || meta.sessionId;
        meta.projectHash = record.projectHash || record.project_hash || meta.projectHash;
        meta.projectPath = record.projectPath || record.project_path || record.cwd || meta.projectPath;
        meta.lastUpdated = record.lastUpdated || record.last_updated || meta.lastUpdated;
      } else if ((record.sessionId || record.id) && !record.type) {
        meta.sessionId = record.sessionId || record.id || meta.sessionId;
        meta.projectHash = record.projectHash || record.project_hash || meta.projectHash;
        meta.projectPath = record.projectPath || record.project_path || record.cwd || meta.projectPath;
        meta.lastUpdated = record.lastUpdated || record.last_updated || meta.lastUpdated;
      } else if (record.type) {
        const normalized = normalizeMessageRecord(record);
        messagesById.set(normalized.messageId || `line-${messagesById.size}`, normalized);
      }
    } catch (_) {}
  }

  if (messagesById.size === 0 && meta.messages.length > 0) {
    meta.messages.forEach((message, index) => messagesById.set(message.id || `state-${index}`, normalizeMessageRecord(message)));
  }
  const messages = Array.from(messagesById.values());
  let userNum = 0;
  for (const msg of messages) {
    if (msg.role === 'user') {
      userNum++;
      msg.userMessageNumber = userNum;
    }
  }
  return { messages, meta };
}

/**
 * Inventory all Gemini session files.
 * @returns {Promise<Array>}
 */
async function inventory() {
  const descriptors = [];
  const tmpDir = path.join(getGeminiDir(), 'tmp');

  try {
    await fs.promises.stat(tmpDir);
  } catch (_) {
    return descriptors;
  }

  const projectRoots = await loadProjectRootsByStorageName();
  let entries;
  try {
    entries = await fs.promises.readdir(tmpDir, { withFileTypes: true });
  } catch (_) {
    return descriptors;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const hashDir = path.join(tmpDir, entry.name);
    const chatsDir = path.join(hashDir, 'chats');
    try {
      await fs.promises.stat(chatsDir);
    } catch (_) {
      continue;
    }

    let chatFiles;
    try {
      chatFiles = await fs.promises.readdir(chatsDir);
    } catch (_) {
      continue;
    }

    for (const f of chatFiles) {
      const match = f.match(SESSION_FILE_RE);
      if (!match) continue;
      const filePath = path.join(chatsDir, f);
      let stat;
      try {
        stat = await fs.promises.stat(filePath);
      } catch (_) {
        continue;
      }
      let projectRoot = projectRoots.get(entry.name) || null;
      if (!projectRoot) {
        try {
          projectRoot = (await fs.promises.readFile(path.join(hashDir, '.project_root'), 'utf8')).trim() || null;
        } catch (_) {
          projectRoot = null;
        }
      }

      descriptors.push({
        filePath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        sessionId: match[1],
        projectName: projectRoot ? getFilePathHash(projectRoot) : entry.name,
        projectRoot
      });
    }
  }

  return descriptors;
}

/**
 * Parse a Gemini session file.
 */
async function parse(descriptor) {
  const { filePath, size, mtimeMs, sessionId, projectName, projectRoot } = descriptor;

  const { messages, meta } = parseSessionContent(filePath, sessionId);
  const resolvedSessionId = meta.sessionId || sessionId;
  const resolvedProjectName = meta.projectHash || projectName || 'unknown';
  const resolvedProjectPath = meta.projectPath || projectRoot || null;
  const firstUserMsg = messages.find(m => m.role === 'user' && m.content);
  const usage = messages.reduce((total, message) => {
    const value = message.usage || {};
    total.input += Number(value.input || value.inputTokens || 0);
    total.output += Number(value.output || value.outputTokens || 0);
    total.cached += Number(value.cached || value.cachedTokens || 0);
    total.reasoning += Number(value.reasoning || value.reasoningTokens || 0);
    total.total += Number(value.total || value.totalTokens || 0);
    return total;
  }, { input: 0, output: 0, cached: 0, reasoning: 0, total: 0 });
  const lastMsg = messages[messages.length - 1];

  const session = {
    sessionId: resolvedSessionId,
    projectName: resolvedProjectName,
    projectDisplayName: resolvedProjectPath ? path.basename(resolvedProjectPath) : `Project ${resolvedProjectName.substring(0, 8)}`,
    projectFullPath: resolvedProjectPath,
    firstMessage: firstUserMsg ? firstUserMsg.content : null,
    gitBranch: null,
    provider: null,
    model: messages.find(m => m.model)?.model || null,
    startedAt: messages[0] ? messages[0].timestamp : null,
    updatedAt: meta.lastUpdated || (lastMsg ? (lastMsg.timestamp || mtimeMs) : mtimeMs),
    usageJson: JSON.stringify(usage),
    extraJson: JSON.stringify({ projectPath: resolvedProjectPath, storageName: path.basename(path.dirname(path.dirname(filePath))) })
  };

  return { session, messages };
}

module.exports = { inventory, parse, extractContentText, normalizeMessageRecord, parseSessionContent };
