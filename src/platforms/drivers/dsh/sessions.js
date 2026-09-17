'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { resolvePaths } = require('./common');

const GENERATION_PATTERN = /^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/;
const ZSTD_MAGIC = 0xFD2FB528;

function projectNameFor(cwd) {
  if (!cwd) return '__no-cwd__';
  const encoded = Buffer.from(String(cwd), 'utf8').toString('base64url');
  return `dsh-${encoded}`;
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(item => {
    if (!item || typeof item !== 'object') return '';
    if (item.type === 'text') return item.text || '';
    if (item.type === 'image') return '[图片]';
    return '';
  }).filter(Boolean).join('\n\n').trim();
}

function decompressZstdFrames(input) {
  const chunks = [];
  let offset = 0;
  while (offset < input.length) {
    const start = offset;
    if (input.length - offset < 5 || input.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error('DSH session log contains an invalid Zstandard frame');
    }
    offset += 4;
    const descriptor = input[offset++];
    if ((descriptor & 0x18) !== 0) throw new Error('DSH session log contains a reserved Zstandard frame flag');
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 0x20) !== 0;
    const checksum = (descriptor & 0x04) !== 0;
    const dictionaryFlag = descriptor & 0x03;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0
      ? (singleSegment ? 1 : 0)
      : 1 << contentSizeFlag;
    const headerBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (input.length - offset < headerBytes) throw new Error('DSH session log has a truncated Zstandard frame header');
    offset += headerBytes;

    let lastBlock = false;
    while (!lastBlock) {
      if (input.length - offset < 3) throw new Error('DSH session log has a truncated Zstandard block');
      const blockHeader = input.readUIntLE(offset, 3);
      offset += 3;
      lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 0x03;
      const blockSize = blockHeader >>> 3;
      if (blockType === 0x03) throw new Error('DSH session log contains a reserved Zstandard block type');
      offset += blockType === 0x01 ? 1 : blockSize;
      if (offset > input.length) throw new Error('DSH session log has a truncated Zstandard block payload');
    }
    if (checksum) {
      if (input.length - offset < 4) throw new Error('DSH session log has a truncated Zstandard checksum');
      offset += 4;
    }
    chunks.push(zlib.zstdDecompressSync(input.subarray(start, offset)));
  }
  return Buffer.concat(chunks);
}

function eventText(event) {
  const data = event?.data || {};
  if (event?.type === 'user/message' || event?.type === 'assistant/message') {
    return textFromContent(event.type === 'user/message' ? data.content : data.message?.content);
  }
  if (event?.type === 'tool/result') return textFromContent(data.message?.content || data.content || data.result);
  if (event?.type === 'tool/call') return textFromContent(data.arguments || data.input || data.message?.content);
  return '';
}

function decodeArtifact(filePath) {
  let bytes = fs.readFileSync(filePath);
  if (filePath.endsWith('.zstd')) {
    if (typeof zlib.zstdDecompressSync !== 'function') {
      const error = new Error('当前 Node.js 不支持读取 DSH zstd session logs');
      error.code = 'DSH_ZSTD_UNSUPPORTED';
      throw error;
    }
    bytes = decompressZstdFrames(bytes);
  }
  const records = [];
  for (const line of bytes.toString('utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      const wrapped = new Error(`无法解析 DSH session log: ${path.basename(filePath)}`);
      wrapped.code = 'DSH_SESSION_CORRUPT';
      wrapped.cause = error;
      throw wrapped;
    }
  }
  const header = records[0];
  if (!header || header.type !== 'session' || typeof header.id !== 'string') {
    const error = new Error(`DSH session log 缺少有效 header: ${path.basename(filePath)}`);
    error.code = 'DSH_SESSION_INVALID_HEADER';
    throw error;
  }
  return { header, events: records.slice(1) };
}

function selectArtifact(sessionDir) {
  let entries;
  try {
    entries = fs.readdirSync(sessionDir, { withFileTypes: true });
  } catch (_) {
    return null;
  }
  const candidates = entries.map(entry => {
    if (!entry.isFile()) return null;
    const match = GENERATION_PATTERN.exec(entry.name);
    if (!match) return null;
    return {
      path: path.join(sessionDir, entry.name),
      version: match[1] ? Number(match[1]) : 0,
      compressed: Boolean(match[2])
    };
  }).filter(Boolean);
  candidates.sort((left, right) => right.version - left.version || Number(right.compressed) - Number(left.compressed));
  return candidates[0] || null;
}

function listArtifacts(context = {}) {
  const root = resolvePaths(context).sessions;
  if (!fs.existsSync(root)) return [];
  const artifacts = [];
  for (const projectEntry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!projectEntry.isDirectory() || projectEntry.isSymbolicLink()) continue;
    const projectDir = path.join(root, projectEntry.name);
    for (const sessionEntry of fs.readdirSync(projectDir, { withFileTypes: true })) {
      if (!sessionEntry.isDirectory() || sessionEntry.isSymbolicLink()) continue;
      const sessionDir = path.join(projectDir, sessionEntry.name);
      const artifact = selectArtifact(sessionDir);
      if (!artifact) continue;
      try {
        const stat = fs.statSync(artifact.path);
        const parsed = decodeArtifact(artifact.path);
        const cwd = typeof parsed.header.cwd === 'string' ? parsed.header.cwd : null;
        const events = parsed.events;
        const user = events.find(event => event.type === 'user/message' && event.data?.content);
        artifacts.push({
          ...artifact,
          projectDir: projectEntry.name,
          sessionDir,
          filePath: artifact.path,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          header: parsed.header,
          events,
          cwd,
          projectName: projectNameFor(cwd),
          firstMessage: textFromContent(user?.data?.content) || null
        });
      } catch (error) {
        artifacts.push({
          ...artifact,
          projectDir: projectEntry.name,
          sessionDir,
          filePath: artifact.path,
          size: 0,
          mtimeMs: 0,
          cwd: null,
          projectName: '__invalid__',
          error: error.message,
          errorCode: error.code || 'DSH_SESSION_READ_FAILED'
        });
      }
    }
  }
  return artifacts;
}

function displayName(cwd) {
  if (!cwd) return '未指定工作目录';
  return path.basename(cwd) || cwd;
}

function summary(artifact) {
  const header = artifact.header || {};
  return {
    sessionId: header.id || null,
    projectName: artifact.projectName,
    projectDisplayName: displayName(artifact.cwd),
    projectFullPath: artifact.cwd,
    cwd: artifact.cwd,
    parentSession: header.parentSession || null,
    origin: header.origin || null,
    createdAt: header.createdAt || null,
    updatedAt: artifact.mtimeMs,
    mtime: artifact.mtimeMs,
    size: artifact.size,
    filePath: artifact.filePath,
    firstMessage: artifact.firstMessage,
    readOnly: true,
    running: null,
    error: artifact.error || null,
    errorCode: artifact.errorCode || null
  };
}

function normalizeMessage(event, sessionId, index, userMessageNumber) {
  const data = event?.data || {};
  let type = null;
  let content = '';
  let role = null;
  let model = data.message?.source?.model || data.model || null;
  let provider = data.message?.source?.provider || data.provider || null;
  if (event.type === 'user/message') {
    type = 'user';
    role = 'user';
    content = data.content;
  } else if (event.type === 'assistant/message') {
    type = 'assistant';
    role = 'assistant';
    content = textFromContent(data.message?.content);
  } else if (event.type === 'tool/result') {
    type = 'assistant';
    role = 'assistant';
    content = `**[工具结果]**\n\`\`\`\n${textFromContent(data.content || data.result || data.message?.content)}\n\`\`\``;
  } else {
    return null;
  }
  if (!content || (typeof content === 'string' && !content.trim())) return null;
  const timestamp = Number.isFinite(event.time) ? event.time : null;
  const message = {
    messageId: data.message?.id || data.id || `${sessionId}:${event.seq ?? index}`,
    role,
    type,
    subtype: event.type === 'tool/result' ? 'tool_result' : null,
    content,
    timestamp,
    model,
    provider,
    userMessageNumber: type === 'user' ? userMessageNumber + 1 : null,
    extra: { dshEventType: event.type, seq: event.seq ?? index }
  };
  return message;
}

function createDriver(context = {}) {
  const read = () => listArtifacts(context).filter(artifact => artifact.projectName !== '__invalid__');
  const getById = sessionId => read().find(artifact => artifact.header?.id === sessionId) || null;
  const readProject = projectName => read().filter(artifact => artifact.projectName === projectName);
  const listProjects = () => {
    const map = new Map();
    for (const artifact of read()) {
      const current = map.get(artifact.projectName) || {
        name: artifact.projectName,
        displayName: displayName(artifact.cwd),
        fullPath: artifact.cwd,
        path: artifact.cwd,
        sessionCount: 0,
        lastModified: 0,
        readOnly: true
      };
      current.sessionCount += 1;
      current.lastModified = Math.max(current.lastModified, artifact.mtimeMs || 0);
      map.set(artifact.projectName, current);
    }
    return [...map.values()].sort((left, right) => right.lastModified - left.lastModified || left.displayName.localeCompare(right.displayName));
  };
  const requestOptions = (value, fallback = {}) => value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : (fallback || {});
  const listSessionsForProject = projectName => readProject(projectName).map(summary).sort((left, right) => right.updatedAt - left.updatedAt);
  const recentSessions = (limit = 5) => read().map(summary).sort((left, right) => right.updatedAt - left.updatedAt).slice(0, Math.max(1, limit));
  const searchProject = (projectName, keyword, contextLength = 15) => {
    const needle = String(keyword || '').toLowerCase();
    return readProject(projectName).flatMap(artifact => {
      const matches = artifact.events.map((event, index) => ({ event, index, text: eventText(event) }))
        .filter(entry => entry.text && entry.text.toLowerCase().includes(needle))
        .map(entry => ({ line: entry.index + 2, text: entry.text.slice(0, Math.max(20, contextLength * 20)) }));
      return matches.length ? [{ ...summary(artifact), matchCount: matches.length, matches }] : [];
    });
  };
  const searchAllProjects = (keyword, limit = 35) => {
    const all = read().flatMap(artifact => {
      const matches = artifact.events.map((event, index) => ({ event, index, text: eventText(event) }))
        .filter(entry => entry.text && entry.text.toLowerCase().includes(String(keyword || '').toLowerCase()))
        .map(entry => ({ line: entry.index + 2, text: entry.text.slice(0, Math.max(20, Number(limit) || 35) * 20) }));
      return matches.length ? [{ ...summary(artifact), matchCount: matches.length, matches }] : [];
    });
    return all.sort((left, right) => right.matchCount - left.matchCount).slice(0, Math.max(1, Number(limit) || 35));
  };
  const messagesForSession = (sessionId, options = {}) => {
    const artifact = getById(sessionId);
    if (!artifact) return null;
    const mapped = [];
    let userCount = 0;
    for (const [index, event] of artifact.events.entries()) {
      const message = normalizeMessage(event, sessionId, index, userCount);
      if (!message) continue;
      if (message.type === 'user') userCount += 1;
      mapped.push(message);
    }
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.max(1, Math.min(200, Number(options.limit) || 50));
    const order = options.order === 'asc' ? 'asc' : 'desc';
    const ordered = order === 'desc' ? [...mapped].reverse() : mapped;
    const offset = (page - 1) * limit;
    return {
      messages: ordered.slice(offset, offset + limit),
      metadata: {
        sessionId,
        projectName: artifact.projectName,
        projectFullPath: artifact.cwd,
        createdAt: artifact.header.createdAt,
        readOnly: true
      },
      pagination: { page, limit, total: ordered.length, hasMore: offset + limit < ordered.length }
    };
  };
  const outlineForSession = sessionId => {
    const artifact = getById(sessionId);
    if (!artifact) return null;
    let userMessageNumber = 0;
    const items = [];
    for (const [index, event] of artifact.events.entries()) {
      if (event.type !== 'user/message') continue;
      userMessageNumber += 1;
      const preview = textFromContent(event.data?.content);
      items.push({ userMessageNumber, preview: preview.slice(0, 200), timestamp: Number.isFinite(event.time) ? event.time : null, index });
    }
    return { sessionId, items };
  };
  const statusForSession = sessionId => {
    const artifact = getById(sessionId);
    if (!artifact) return null;
    return { sessionId, running: null, readOnly: true, lastModified: artifact.mtimeMs, size: artifact.size };
  };
  const unsupported = operation => () => ({
    status: 'unsupported',
    platform: 'dsh',
    capability: 'sessions',
    operation
  });

  return {
    platform: 'dsh',
    capability: 'sessions',
    listSessions(requestOrProjectName, options = {}) {
      const request = requestOptions(requestOrProjectName, options);
      const projectName = request.params?.projectName || (typeof requestOrProjectName === 'string' ? requestOrProjectName : '');
      return listSessionsForProject(projectName);
    },
    recent(requestOrLimit, options = {}) {
      const request = requestOptions(requestOrLimit, options);
      const limit = request.query?.limit || (typeof requestOrLimit === 'number' ? requestOrLimit : 5);
      return recentSessions(limit);
    },
    search(requestOrProjectName, keyword, contextLength = 15, options = {}) {
      if (requestOrProjectName && typeof requestOrProjectName === 'object') {
        const request = requestOrProjectName;
        return searchProject(request.params?.projectName, request.query?.keyword || request.query?.q || '', Number(request.query?.context) || 15);
      }
      return searchProject(requestOrProjectName, keyword, contextLength);
    },
    searchAcrossProjects(requestOrKeyword, limit = 35, options = {}) {
      if (requestOrKeyword && typeof requestOrKeyword === 'object') {
        const request = requestOrKeyword;
        return searchAllProjects(request.query?.keyword || request.query?.q || '', Number(request.query?.limit) || 35);
      }
      return searchAllProjects(requestOrKeyword, limit);
    },
    messages(requestOrSessionId, options = {}) {
      if (requestOrSessionId && typeof requestOrSessionId === 'object') {
        const request = requestOrSessionId;
        return messagesForSession(request.params?.sessionId, {
          ...request.query,
          page: request.query?.page,
          limit: request.query?.limit,
          order: request.query?.order
        });
      }
      return messagesForSession(requestOrSessionId, options);
    },
    outline(requestOrSessionId) {
      const sessionId = requestOrSessionId && typeof requestOrSessionId === 'object'
        ? requestOrSessionId.params?.sessionId
        : requestOrSessionId;
      return outlineForSession(sessionId);
    },
    status(requestOrSessionId) {
      const sessionId = requestOrSessionId && typeof requestOrSessionId === 'object'
        ? requestOrSessionId.params?.sessionId
        : requestOrSessionId;
      return statusForSession(sessionId);
    },
    listProjects,
    delete: unsupported('delete'),
    batchDelete: unsupported('batchDelete'),
    fork: unsupported('fork'),
    saveSessionOrder: unsupported('saveSessionOrder'),
    launch: unsupported('launch')
  };
}

module.exports = { createDriver, projectNameFor, decodeArtifact, listArtifacts, textFromContent };
