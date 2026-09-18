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

function zstdFrameEnd(input, start) {
  if (input.length - start < 5) return null;
  if (input.readUInt32LE(start) !== ZSTD_MAGIC) {
    throw new Error('DSH session log contains an invalid Zstandard frame');
  }

  let offset = start + 4;
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
  if (input.length - offset < headerBytes) return null;
  offset += headerBytes;

  let lastBlock = false;
  while (!lastBlock) {
    if (input.length - offset < 3) return null;
    const blockHeader = input.readUIntLE(offset, 3);
    offset += 3;
    lastBlock = (blockHeader & 1) !== 0;
    const blockType = (blockHeader >>> 1) & 0x03;
    const blockSize = blockHeader >>> 3;
    if (blockType === 0x03) throw new Error('DSH session log contains a reserved Zstandard block type');
    const payloadBytes = blockType === 0x01 ? 1 : blockSize;
    if (input.length - offset < payloadBytes) return null;
    offset += payloadBytes;
  }
  if (checksum) {
    if (input.length - offset < 4) return null;
    offset += 4;
  }
  return offset;
}

function decompressZstdFrames(input) {
  const chunks = [];
  let offset = 0;
  while (offset < input.length) {
    const end = zstdFrameEnd(input, offset);
    if (end === null) throw new Error('DSH session log has a truncated Zstandard frame');
    chunks.push(zlib.zstdDecompressSync(input.subarray(offset, end)));
    offset = end;
  }
  return Buffer.concat(chunks);
}

/**
 * Read only the beginning of a framed zstd log. DSH normally emits one
 * frame per JSONL record, so decoding complete frames until the first 64 KiB
 * is enough for a list summary without materializing the whole transcript.
 */
function readZstdPrefix(filePath, maxOutput = 64 * 1024, maxInput = 4 * 1024 * 1024) {
  if (typeof zlib.zstdDecompressSync !== 'function') {
    const error = new Error('当前 Node.js 不支持读取 DSH zstd session logs');
    error.code = 'DSH_ZSTD_UNSUPPORTED';
    throw error;
  }

  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const chunks = [];
    let buffered = Buffer.alloc(0);
    let outputSize = 0;
    let inputSize = 0;
    const chunkSize = 64 * 1024;
    const outputChunks = [];
    let eof = false;

    while (!eof && inputSize < maxInput && outputSize < maxOutput) {
      const readSize = Math.min(chunkSize, maxInput - inputSize);
      const buffer = Buffer.alloc(readSize);
      const bytesRead = fs.readSync(fd, buffer, 0, readSize, inputSize);
      if (bytesRead === 0) {
        eof = true;
      } else {
        inputSize += bytesRead;
        chunks.push(buffer.subarray(0, bytesRead));
        buffered = Buffer.concat(chunks);
      }

      let offset = 0;
      while (offset < buffered.length && outputSize < maxOutput) {
        const end = zstdFrameEnd(buffered, offset);
        if (end === null) break;
        const decoded = zlib.zstdDecompressSync(buffered.subarray(offset, end));
        outputChunks.push(decoded);
        outputSize += decoded.length;
        offset = end;
      }

      if (offset > 0) {
        // Keep only the incomplete trailing frame before reading more input.
        const remainder = buffered.subarray(offset);
        chunks.length = 0;
        if (remainder.length > 0) chunks.push(remainder);
        buffered = remainder;
      }
      if (bytesRead < readSize) eof = true;
    }

    return Buffer.concat(outputChunks).subarray(0, maxOutput);
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
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

function decodeArtifactHeaderBytes(bytes) {
  const lines = bytes.toString('utf8').split(/\r?\n/);
  const header = JSON.parse(lines.shift() || '');
  if (!header || header.type !== 'session' || typeof header.id !== 'string') {
    throw new Error('DSH session log missing a valid header');
  }
  let firstMessage = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === 'user/message' && event.data?.content) {
        firstMessage = textFromContent(event.data.content) || null;
        if (firstMessage) break;
      }
    } catch (_) {
      // The bounded prefix can end in the middle of a JSON record.
    }
  }
  return { header, events: [], firstMessage };
}

function decodeArtifactHeader(filePath) {
  if (filePath.endsWith('.zstd')) {
    return decodeArtifactHeaderBytes(readZstdPrefix(filePath));
  }
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(64 * 1024);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return decodeArtifactHeaderBytes(buffer.subarray(0, bytesRead));
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
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

function listArtifacts(context = {}, { includeEvents = true } = {}) {
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
        const parsed = includeEvents
          ? decodeArtifact(artifact.path)
          : decodeArtifactHeader(artifact.path);
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
          firstMessage: parsed.firstMessage || textFromContent(user?.data?.content) || null
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
  const read = () => listArtifacts(context, { includeEvents: false }).filter(artifact => artifact.projectName !== '__invalid__');
  const readFull = () => listArtifacts(context, { includeEvents: true }).filter(artifact => artifact.projectName !== '__invalid__');
  const fullSessionCache = new Map();
  const getById = sessionId => {
    const summaryArtifact = read().find(artifact => artifact.header?.id === sessionId);
    if (!summaryArtifact) {
      fullSessionCache.delete(sessionId);
      return null;
    }
    const cached = fullSessionCache.get(sessionId);
    if (cached
      && cached.filePath === summaryArtifact.filePath
      && cached.size === summaryArtifact.size
      && cached.mtimeMs === summaryArtifact.mtimeMs) {
      return cached;
    }
    const parsed = decodeArtifact(summaryArtifact.filePath);
    const artifact = {
      ...summaryArtifact,
      header: parsed.header,
      events: parsed.events
    };
    fullSessionCache.set(sessionId, artifact);
    return artifact;
  };
  const readProject = projectName => read().filter(artifact => artifact.projectName === projectName);
  const readFullProject = projectName => readFull().filter(artifact => artifact.projectName === projectName);
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
  const listProjectsPage = (options = {}) => {
    const page = Math.max(1, Number.parseInt(options.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, Number.parseInt(options.limit, 10) || 20));
    const query = String(options.q || options.search || '').trim().toLowerCase();
    const all = listProjects().filter(project => !query
      || project.name.toLowerCase().includes(query)
      || project.displayName.toLowerCase().includes(query)
      || String(project.fullPath || '').toLowerCase().includes(query));
    const projects = all
      .sort((left, right) => right.lastModified - left.lastModified || left.name.localeCompare(right.name))
      .slice((page - 1) * limit, page * limit);
    return {
      projects,
      currentProject: null,
      pagination: { page, limit, total: all.length, hasMore: page * limit < all.length }
    };
  };
  const requestOptions = (value, fallback = {}) => value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : (fallback || {});
  const listSessionsForProject = projectName => readProject(projectName).map(summary).sort((left, right) => right.updatedAt - left.updatedAt || left.sessionId.localeCompare(right.sessionId));
  const listSessionsPage = (projectNameOrRequest, options = {}) => {
    const request = requestOptions(projectNameOrRequest, options);
    const projectName = request.params?.projectName || (typeof projectNameOrRequest === 'string' ? projectNameOrRequest : '');
    const page = Math.max(1, Number.parseInt(request.query?.page ?? request.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, Number.parseInt(request.query?.limit ?? request.limit, 10) || 20));
    const query = String(request.query?.q ?? request.q ?? '').trim().toLowerCase();
    const all = listSessionsForProject(projectName).filter(session => !query
      || session.sessionId.toLowerCase().includes(query)
      || String(session.firstMessage || '').toLowerCase().includes(query)
      || String(session.projectFullPath || '').toLowerCase().includes(query));
    const sessions = all.slice((page - 1) * limit, page * limit);
    return {
      sessions,
      totalSize: all.reduce((sum, session) => sum + (Number(session.size) || 0), 0),
      projectInfo: { sessionCount: all.length, totalSize: all.reduce((sum, session) => sum + (Number(session.size) || 0), 0) },
      pagination: { page, limit, total: all.length, hasMore: page * limit < all.length }
    };
  };
  const recentSessions = (limit = 5) => read().map(summary).sort((left, right) => right.updatedAt - left.updatedAt).slice(0, Math.max(1, limit));
  const searchProject = (projectName, keyword, contextLength = 15) => {
    const needle = String(keyword || '').toLowerCase();
    return readFullProject(projectName).flatMap(artifact => {
      const matches = artifact.events.map((event, index) => ({ event, index, text: eventText(event) }))
        .filter(entry => entry.text && entry.text.toLowerCase().includes(needle))
        .map(entry => ({ line: entry.index + 2, text: entry.text.slice(0, Math.max(20, contextLength * 20)) }));
      return matches.length ? [{ ...summary(artifact), matchCount: matches.length, matches }] : [];
    });
  };
  const searchAllProjects = (keyword, limit = 35) => {
    const all = readFull().flatMap(artifact => {
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
    const limit = Math.max(1, Math.min(200, Number(options.limit) || 20));
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
    const artifact = read().find(item => item.header?.id === sessionId) || null;
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
    listSessionsPage,
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
    listProjectsPage,
    delete: unsupported('delete'),
    batchDelete: unsupported('batchDelete'),
    fork: unsupported('fork'),
    saveSessionOrder: unsupported('saveSessionOrder'),
    launch: unsupported('launch')
  };
}

module.exports = { createDriver, projectNameFor, decodeArtifact, listArtifacts, textFromContent };
