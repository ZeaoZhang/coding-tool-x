'use strict';

const fs = require('fs');
const path = require('path');
const { getCodexDir } = require('./config');
const { extractSessionMeta, extractMessages, extractTokenUsage, readJSONL } = require('./parser');

/**
 * Scan all Codex session files recursively.
 * @returns {Array<{filePath: string, size: number, mtimeMs: number, sessionId: string}>}
 */
async function scanSessionFiles(projectsDir = null) {
  const results = [];
  const sessionsDir = projectsDir || path.join(getCodexDir(), 'sessions');

  try {
    await fs.promises.stat(sessionsDir);
  } catch (_) {
    return results;
  }

  async function scanDir(dir) {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.isFile() && entry.name.match(/^rollout-.*\.jsonl$/)) {
        try {
          const stat = await fs.promises.stat(fullPath);
          results.push({
            filePath: fullPath,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            sessionId: entry.name.replace(/\.jsonl$/, '')
          });
        } catch (_) {}
      }
    }
  }

  await scanDir(sessionsDir);
  return results;
}

/**
 * Extract project name from Codex session metadata.
 */
function extractCodexProjectName(meta) {
  if (!meta) return 'unknown';
  if (typeof meta.cwd === 'string' && meta.cwd.trim()) {
    // Use last directory of cwd as project name
    const cleaned = meta.cwd.trim().replace(/[/\\]$/, '');
    if (cleaned) {
      const parts = cleaned.split(/[/\\]/);
      const last = parts[parts.length - 1];
      if (last) return last;
    }
  }
  return 'unknown';
}

/**
 * Inventory all Codex session files.
 * @returns {Promise<Array>}
 */
async function inventory({ projectsDir } = {}) {
  const files = await scanSessionFiles(projectsDir);
  return files.map(f => ({
    filePath: f.filePath,
    size: f.size,
    mtimeMs: f.mtimeMs,
    sessionId: f.sessionId,
    projectHint: null // Codex determines project from session content
  }));
}

/**
 * Parse a Codex session file.
 */
async function parse(descriptor) {
  const { filePath, size, mtimeMs, sessionId } = descriptor;
  const lines = readJSONL(filePath);

  const meta = extractSessionMeta(lines);
  const messages = extractMessages(lines);
  const tokenUsage = extractTokenUsage(lines);

  const projectName = extractCodexProjectName(meta);
  const usageJson = tokenUsage ? JSON.stringify(tokenUsage) : null;

  // Build normalized messages
  const normalizedMessages = messages.map((msg, idx) => {
    let content = '';
    if (typeof msg.content === 'string') {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      const parts = [];
      for (const block of msg.content) {
        if (typeof block === 'string') {
          parts.push(block);
        } else if (block.type === 'text' && block.text) {
          parts.push(block.text);
        } else if (block.type === 'tool_use' || block.type === 'tool_call') {
          parts.push(`[调用工具: ${block.name || 'unknown'}]`);
        } else if (block.type === 'tool_result') {
          if (typeof block.content === 'string') {
            parts.push(block.content);
          }
        } else if (block.type === 'thinking' || block.type === 'reasoning') {
          parts.push(block.thinking || block.reasoning || '');
        }
      }
      content = parts.join('\n').trim();
    }

    const isUser = msg.role === 'user' || msg.role === 'human';
    return {
      messageId: msg.id || `codex-${sessionId}-${idx}`,
      role: msg.role || 'unknown',
      type: msg.type || msg.role || 'unknown',
      subtype: msg.subtype || null,
      content,
      timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : null,
      model: msg.model || (meta ? meta.model : null) || null,
      provider: null,
      userMessageNumber: isUser ? (msg.userMessageNumber != null ? msg.userMessageNumber : idx + 1) : null,
      extraJson: null
    };
  });

  const firstUserMsg = normalizedMessages.find(m => m.role === 'user' && m.content);
  const lastMsg = normalizedMessages[normalizedMessages.length - 1];

  const session = {
    sessionId,
    projectName,
    projectDisplayName: projectName,
    projectFullPath: null,
    firstMessage: firstUserMsg ? firstUserMsg.content : null,
    gitBranch: meta ? (meta.gitBranch || null) : null,
    provider: null,
    model: meta ? (meta.model || null) : null,
    startedAt: normalizedMessages[0] ? normalizedMessages[0].timestamp : null,
    updatedAt: lastMsg ? (lastMsg.timestamp || mtimeMs) : mtimeMs,
    usageJson,
    extraJson: JSON.stringify({
      cwd: meta ? meta.cwd : null
    })
  };

  return { session, messages: normalizedMessages };
}

module.exports = { inventory, parse, extractCodexProjectName };
