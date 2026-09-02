'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { NATIVE_PATHS } = require('../../../config/paths');

const CLAUDE_PROJECTS_DIR = NATIVE_PATHS?.claude?.projects || '';

function _asContentBlocks(content) {
  if (Array.isArray(content)) return content;
  return content && typeof content === 'object' ? [content] : [];
}

function _formatJsonBlock(value, fallback = '') {
  if (typeof value === 'string') return value;
  try {
    const serialized = JSON.stringify(value, null, 2);
    return serialized === undefined ? fallback : serialized;
  } catch (_) {
    return fallback;
  }
}

/**
 * Get Claude user-visible text from a message content block.
 * Shared with sessions.js API for display consistency.
 */
function getClaudeUserText(content) {
  if (typeof content === 'string') {
    return content === 'Warmup' ? '' : content;
  }

  const parts = [];
  for (const item of _asContentBlocks(content)) {
    if (item?.type === 'text' && item.text) {
      parts.push(item.text);
    } else if (item?.type === 'image') {
      parts.push('[图片]');
    }
  }

  return parts.join('\n\n').trim();
}

function getClaudeToolResultText(content) {
  const parts = [];
  for (const item of _asContentBlocks(content)) {
    if (item?.type !== 'tool_result') continue;
    const resultContent = _formatJsonBlock(item.content, '');
    if (resultContent) {
      parts.push(`**[工具结果]**\n\`\`\`\n${resultContent}\n\`\`\``);
    }
  }
  return parts.join('\n\n').trim();
}

function getClaudeAssistantText(content) {
  if (typeof content === 'string') {
    return content === 'Warmup' ? '' : content;
  }

  const parts = [];
  let subtype = null;
  for (const item of _asContentBlocks(content)) {
    if (item?.type === 'text' && item.text) {
      parts.push(item.text);
    } else if (item?.type === 'image') {
      parts.push('[图片]');
    } else if (item?.type === 'tool_use') {
      subtype = 'tool_use';
      const input = _formatJsonBlock(item.input, '{}');
      parts.push(`**[调用工具: ${item.name || 'unknown'}]**\n\`\`\`json\n${input}\n\`\`\``);
    } else if (item?.type === 'tool_result') {
      subtype = subtype || 'tool_result';
      const resultContent = _formatJsonBlock(item.content, '');
      if (resultContent) {
        parts.push(`**[工具结果]**\n\`\`\`\n${resultContent}\n\`\`\``);
      }
    } else if (item?.type === 'thinking') {
      subtype = subtype || 'thinking';
      if (item.thinking) parts.push(`**[思考]**\n${item.thinking}`);
    }
  }

  return { content: parts.join('\n\n').trim(), subtype };
}

/**
 * Parse real project path from encoded name.
 */
function parseRealProjectPath(encodedName) {
  const { parseRealProjectPath: fn } = require('./sessions-implementation');
  return fn(encodedName);
}

/**
 * Inventory all Claude session files.
 * @returns {Promise<Array<{filePath: string, size: number, mtimeMs: number, sessionId: string, projectHint: string}>>}
 */
async function inventory() {
  const descriptors = [];

  try {
    await fs.promises.stat(CLAUDE_PROJECTS_DIR);
  } catch (_) {
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

    const messagePayload = json.message && typeof json.message === 'object' && !Array.isArray(json.message)
      ? json.message
      : {};
    const recordTimestamp = json.timestamp || messagePayload.timestamp || null;
    const timestampValue = recordTimestamp ? new Date(recordTimestamp).getTime() : null;
    const timestamp = Number.isFinite(timestampValue) ? timestampValue : null;
    const recordModel = json.model || messagePayload.model || null;
    const recordProvider = json.provider || messagePayload.provider || null;
    const recordUsage = json.usage || messagePayload.usage || null;

    if (json.type === 'metadata' || json.type === 'summary') {
      if (json.cwd || messagePayload.cwd) extra.cwd = json.cwd || messagePayload.cwd;
      if (json.gitBranch || messagePayload.gitBranch) {
        gitBranch = json.gitBranch || messagePayload.gitBranch;
      }
      if (json.summary) extra.summary = json.summary;
      if (timestamp !== null && startedAt === null) startedAt = timestamp;
      if (recordModel) model = recordModel;
      if (recordProvider) provider = recordProvider;
      if (recordUsage) usageJson = JSON.stringify(recordUsage);
      continue;
    }

    const role = json.role
      || messagePayload.role
      || (json.type === 'user' || json.type === 'human'
        ? 'user'
        : json.type === 'assistant' || json.type === 'ai'
          ? 'assistant'
          : null);
    if (role !== 'user' && role !== 'assistant') continue;

    const rawContent = json.content !== undefined && json.content !== null && json.content !== ''
      ? json.content
      : messagePayload.content !== undefined
        ? messagePayload.content
        : typeof json.message === 'string' ? json.message : '';
    const messageId = messagePayload.id || json.uuid || json.id || null;

    if (timestamp !== null) {
      if (startedAt === null) startedAt = timestamp;
      updatedAt = timestamp;
    }
    if (recordModel) model = recordModel;
    if (recordProvider) provider = recordProvider;
    if (recordUsage) usageJson = JSON.stringify(recordUsage);

    if (role === 'user') {
      const content = getClaudeUserText(rawContent);
      if (content) {
        userMessageNumber++;
        if (!firstMessage) firstMessage = content;
        messages.push({
          messageId,
          role,
          type: json.type || role,
          subtype: null,
          content,
          timestamp,
          model: recordModel || model || null,
          provider: recordProvider || provider || null,
          userMessageNumber,
          extraJson: null
        });
      }

      const toolResultContent = getClaudeToolResultText(rawContent);
      if (toolResultContent) {
        messages.push({
          messageId: messageId ? `${messageId}-tool-result` : null,
          role: 'assistant',
          type: 'assistant',
          subtype: 'tool_result',
          content: toolResultContent,
          timestamp,
          model: recordModel || model || null,
          provider: recordProvider || provider || null,
          userMessageNumber: null,
          extraJson: null
        });
      }
      continue;
    }

    const assistant = getClaudeAssistantText(rawContent);
    if (!assistant.content) continue;
    messages.push({
      messageId,
      role,
      type: json.type || role,
      subtype: assistant.subtype,
      content: assistant.content,
      timestamp,
      model: recordModel || model || null,
      provider: recordProvider || provider || null,
      userMessageNumber: null,
      extraJson: null
    });
  }

  rl.close();
  stream.destroy();

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

  return {
    session,
    messages: messages.map((message) => ({
      ...message,
      extraJson: message.extraJson ? JSON.stringify(message.extraJson) : null
    }))
  };
}

module.exports = { inventory, parse, getClaudeUserText };
