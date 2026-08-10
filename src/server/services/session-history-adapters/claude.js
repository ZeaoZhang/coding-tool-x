'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { NATIVE_PATHS } = require('../../../config/paths');

const CLAUDE_PROJECTS_DIR = NATIVE_PATHS?.claude?.projects || '';

/**
 * Get Claude user-visible text from a message content block.
 * Shared with sessions.js API for display consistency.
 */
function getClaudeUserText(content) {
  if (typeof content === 'string') {
    return content === 'Warmup' ? '' : content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  const parts = [];
  for (const item of content) {
    if (item?.type === 'text' && item.text) {
      parts.push(item.text);
    } else if (item?.type === 'image') {
      parts.push('[图片]');
    }
  }

  return parts.join('\n\n').trim();
}

/**
 * Parse real project path from encoded name.
 */
function parseRealProjectPath(encodedName) {
  const { parseRealProjectPath: fn } = require('../sessions');
  return fn(encodedName);
}

/**
 * Inventory all Claude session files.
 * @returns {Promise<Array<{filePath: string, size: number, mtimeMs: number, sessionId: string, projectHint: string}>>}
 */
async function inventory() {
  const descriptors = [];

  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    return descriptors;
  }

  const projects = await fs.promises.readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
  for (const entry of projects) {
    if (!entry.isDirectory()) continue;
    const projectName = entry.name;
    const projectPath = path.join(CLAUDE_PROJECTS_DIR, projectName);

    let files;
    try {
      files = await fs.promises.readdir(projectPath);
    } catch (_) {
      continue;
    }

    for (const f of files) {
      if (!f.endsWith('.jsonl') || f.startsWith('agent-')) continue;
      const filePath = path.join(projectPath, f);
      let stat;
      try {
        stat = await fs.promises.stat(filePath);
      } catch (_) {
        continue;
      }
      descriptors.push({
        filePath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        sessionId: f.replace(/\.jsonl$/, ''),
        projectHint: projectName
      });
    }
  }

  return descriptors;
}

/**
 * Parse a Claude session file into normalized session + messages.
 * @param {{filePath: string, size: number, mtimeMs: number, sessionId: string, projectHint: string}} descriptor
 * @returns {Promise<{session: object, messages: Array}>}
 */
async function parse(descriptor) {
  const { filePath, size, mtimeMs, sessionId, projectHint } = descriptor;
  const { fullPath, projectName: displayName } = parseRealProjectPath(projectHint);

  const messages = [];
  let firstMessage = null;
  let gitBranch = null;
  let provider = null;
  let model = null;
  let startedAt = null;
  let updatedAt = null;
  let usageJson = null;
  const extra = {};

  let userMessageNumber = 0;

  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let json;
    try {
      json = JSON.parse(line);
    } catch (_) {
      continue;
    }

    // Extract metadata
    if (json.type === 'metadata' || json.type === 'summary') {
      if (json.cwd) extra.cwd = json.cwd;
      if (json.gitBranch) gitBranch = json.gitBranch;
      if (json.timestamp && !startedAt) {
        startedAt = new Date(json.timestamp).getTime();
      }
      if (json.model) {
        model = json.model;
        provider = json.provider || null;
      }
      if (json.usage) usageJson = JSON.stringify(json.usage);
      continue;
    }

    // Determine role
    let role = json.role;
    if (!role) {
      if (json.type === 'user' || json.type === 'human') role = 'user';
      else if (json.type === 'assistant' || json.type === 'ai') role = 'assistant';
      else if (json.type === 'system') role = 'system';
      else role = json.type || 'unknown';
    }

    // Extract message content
    let content = '';
    let subtype = null;

    if (role === 'user') {
      content = getClaudeUserText(json.content || json.message || '');
      if (!content && json.type === 'Warmup') {
        content = ''; // Warmup excluded
      }
    } else if (role === 'assistant') {
      if (Array.isArray(json.content)) {
        const parts = [];
        for (const block of json.content) {
          if (block.type === 'text' && block.text) {
            parts.push(block.text);
          } else if (block.type === 'tool_use') {
            subtype = 'tool_use';
            parts.push(`[调用工具: ${block.name || 'unknown'}]`);
          } else if (block.type === 'tool_result') {
            subtype = subtype || 'tool_result';
            if (typeof block.content === 'string') {
              parts.push(block.content);
            }
          } else if (block.type === 'thinking') {
            subtype = subtype || 'thinking';
            parts.push(block.thinking || '');
          }
        }
        content = parts.join('\n').trim();
      } else if (typeof json.content === 'string') {
        content = json.content;
      }
    } else {
      content = typeof json.content === 'string' ? json.content : (typeof json.message === 'string' ? json.message : '');
    }

    // Build message
    const msg = {
      messageId: json.uuid || json.id || null,
      role,
      type: json.type || role,
      subtype,
      content,
      timestamp: json.timestamp ? new Date(json.timestamp).getTime() : null,
      model: json.model || model || null,
      provider: json.provider || provider || null,
      extraJson: null
    };

    if (role === 'user') {
      userMessageNumber++;
      msg.userMessageNumber = userMessageNumber;
      if (!firstMessage && content) {
        firstMessage = content;
      }
    } else {
      msg.userMessageNumber = null;
    }

    messages.push(msg);
  }

  rl.close();
  stream.destroy();

  if (messages.length > 0) {
    const lastTs = messages[messages.length - 1].timestamp;
    if (lastTs) updatedAt = lastTs;
  }

  const session = {
    sessionId,
    projectName: projectHint,
    projectDisplayName: displayName,
    projectFullPath: fullPath,
    firstMessage: firstMessage || null,
    gitBranch,
    provider,
    model,
    startedAt,
    updatedAt: updatedAt || mtimeMs,
    usageJson,
    extraJson: JSON.stringify(extra)
  };

  return { session, messages: messages.map(m => ({ ...m, extraJson: m.extraJson ? JSON.stringify(m.extraJson) : null })) };
}

module.exports = { inventory, parse, getClaudeUserText };
