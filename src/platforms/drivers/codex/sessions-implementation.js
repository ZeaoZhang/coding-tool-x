const fs = require('fs');
const path = require('path');
const { getCodexDir } = require('./config');
const { parseSession, parseSessionMeta, extractSessionMeta, readJSONL } = require('./parser');
const { globalCache, CacheKeys } = require('../../../server/services/enhanced-cache');
let sessionHistoryIndex = null;

function configure({ sessionHistoryIndex: index } = {}) {
  sessionHistoryIndex = index || null;
}

function getSessionHistoryIndex(options = {}) {
  if (!sessionHistoryIndex) {
    const { getDefaultDependencies } = require('../../../platforms/runtime');
    sessionHistoryIndex = getDefaultDependencies().sessionHistoryIndex;
    if (!sessionHistoryIndex) {
      const indexModule = require('../../../server/services/session-history-index');
      sessionHistoryIndex = Object.keys(options).length > 0
        ? indexModule.createSessionHistoryIndex({ config: options })
        : indexModule;
    }
  }
  return sessionHistoryIndex;
}

const COUNTS_CACHE_TTL_MS = 30 * 1000;
const SCAN_FILES_CACHE_TTL_MS = 15 * 1000;
const ALL_SESSIONS_CACHE_TTL_MS = 20 * 1000;
const PROJECTS_CACHE_TTL_MS = 300 * 1000;
const PROJECT_SESSIONS_CACHE_TTL_MS = 120 * 1000;
const FAST_META_READ_BYTES = 64 * 1024;
const EMPTY_COUNTS = Object.freeze({ projectCount: 0, sessionCount: 0 });

let countsCache = {
  expiresAt: 0,
  value: EMPTY_COUNTS
};

let scanFilesCache = {
  expiresAt: 0,
  value: []
};

let sessionFileIndexCache = {
  expiresAt: 0,
  value: new Map()
};

let allSessionsCache = {
  expiresAt: 0,
  value: []
};

const CODEX_PROJECTS_CACHE_KEY = `${CacheKeys.PROJECTS}codex`;
const codexSessionCacheKeys = new Set();

function getCodexSessionsCacheKey(projectName) {
  return `${CacheKeys.SESSIONS}codex:${projectName}`;
}

/**
 * 获取会话目录
 */
function getSessionsDir() {
  return path.join(getCodexDir(), 'sessions');
}

/**
 * 递归扫描目录查找所有会话文件
 * @param {string} dir - 目录路径
 * @returns {Array} 会话文件路径数组
 */
function scanDirectoryRecursive(dir) {
  const results = [];

  if (!fs.existsSync(dir)) {
    return results;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // 递归扫描子目录
      results.push(...scanDirectoryRecursive(fullPath));
    } else if (entry.isFile() && entry.name.match(/^rollout-.*\.jsonl$/)) {
      // 匹配会话文件
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * 扫描所有会话文件
 * @returns {Array} 会话文件路径数组
 */
function scanSessionFiles() {
  const now = Date.now();
  if (scanFilesCache.expiresAt > now) {
    return scanFilesCache.value;
  }

  const sessionsDir = getSessionsDir();
  const files = scanDirectoryRecursive(sessionsDir);

  const parsed = files.map(filePath => {
    const filename = path.basename(filePath);
    // Codex 文件名格式：rollout-YYYY-MM-DDTHH-MM-SS-uuid.jsonl
    // 时间戳：19个字符（2025-11-22T12-34-56）
    const match = filename.match(/rollout-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-([\w-]+)\.jsonl/);

    if (!match) return null;

    let size = 0;
    let mtime = null;
    let mtimeMs = 0;
    try {
      const stats = fs.statSync(filePath);
      size = stats.size;
      mtime = stats.mtime.toISOString();
      mtimeMs = stats.mtime.getTime();
    } catch (err) {
      // ignore stat errors
    }

    return {
      filePath,
      timestamp: match[1],
      sessionId: match[2],
      date: match[1].split('T')[0],
      size,
      mtime,
      mtimeMs
    };
  }).filter(Boolean);

  const expiresAt = now + SCAN_FILES_CACHE_TTL_MS;
  scanFilesCache = {
    expiresAt,
    value: parsed
  };
  sessionFileIndexCache = {
    expiresAt,
    value: new Map(parsed.map(file => [file.sessionId, file]))
  };

  return parsed;
}

/**
 * 获取所有会话（轻量级，仅元数据）
 * @returns {Array} 会话对象数组
 */
function getAllSessions() {
  const now = Date.now();
  if (allSessionsCache.expiresAt > now) {
    return allSessionsCache.value;
  }

  const files = scanSessionFiles();

  const parsed = files.map(file => {
    const fastSummary = readSessionMetaSummaryFast(file.filePath);
    let session = null;

    if (fastSummary && fastSummary.payload) {
      session = {
        filePath: file.filePath,
        meta: normalizeSessionMetaFromPayload(fastSummary.payload, file.timestamp),
        tokens: null,
        messageCount: 0,
        preview: fastSummary.preview || '',
        size: file.size || 0,
        mtime: file.mtime || null,
        mtimeMs: file.mtimeMs || 0
      };
    } else {
      // 回退完整解析，保证兼容性
      session = parseSessionMeta(file.filePath);
      if (session) {
        session.size = file.size || 0;
        session.mtime = file.mtime || null;
        session.mtimeMs = file.mtimeMs || 0;
      }
    }

    if (!session) return null;

    return {
      ...session,
      sessionId: file.sessionId,
      date: file.date
    };
  }).filter(Boolean);

  allSessionsCache = {
    expiresAt: now + ALL_SESSIONS_CACHE_TTL_MS,
    value: parsed
  };

  return parsed;
}

/**
 * 归一化会话数据为 Claude Code 格式
 * @param {Object} codexSession - Codex 会话对象
 * @returns {Object} 归一化后的会话对象
 */
function normalizeSession(codexSession) {
  const { meta, sessionId, preview, filePath } = codexSession;

  // 获取文件大小和修改时间
  let size = Number.isFinite(codexSession.size) ? codexSession.size : 0;
  let mtime = codexSession.mtime || meta.timestamp || null;
  if ((!size || !mtime) && filePath) {
    try {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        size = size || stats.size;
        mtime = mtime || stats.mtime.toISOString();
      }
    } catch (err) {
      // 忽略错误
    }
  }

  return {
    sessionId,
    mtime,
    size,
    filePath: filePath || '',
    gitBranch: meta.git?.branch || null,
    firstMessage: preview || null,
    forkedFrom: null, // Codex 不支持 fork

    // 额外的 Codex 特有字段（前端可能需要）
    source: 'codex'
  };
}

/**
 * 聚合项目列表
 * @returns {Array} 项目对象数组
 */
async function getProjects(options = {}) {
  if (!fs.existsSync(getSessionsDir())) return [];
  const projects = await getSessionHistoryIndex({ ...options, projectsDir: getSessionsDir() }).listProjects('codex', options);
  const savedOrder = getProjectOrder();
  if (savedOrder.length === 0) return projects;

  const byName = new Map(projects.map(project => [project.name, project]));
  const ordered = savedOrder.flatMap(name => byName.has(name) ? [byName.get(name)] : []);
  savedOrder.forEach(name => byName.delete(name));
  return [...ordered, ...byName.values()];
}

/**
 * 根据项目名获取会话列表（归一化格式）
 * @param {string} projectName - 项目名称
 * @returns {Array} 归一化的会话数组
 */
async function getSessionsByProject(projectName, options = {}) {
  const indexed = await getSessionHistoryIndex().listSessions('codex', projectName, options);
  const forkRelations = require('../claude/sessions-implementation').getForkRelations();
  const aliases = require('../../../server/services/alias').loadAliases();
  const sessions = indexed.map(session => ({
    ...session,
    mtime: new Date(session.mtime).toISOString(),
    forkedFrom: forkRelations[session.sessionId] || null,
    alias: aliases[session.sessionId] || null
  }));
  const savedOrder = getSessionOrder(projectName);
  if (savedOrder.length === 0) return sessions;

  const byId = new Map(sessions.map(session => [session.sessionId, session]));
  const ordered = savedOrder.flatMap(id => byId.has(id) ? [byId.get(id)] : []);
  savedOrder.forEach(id => byId.delete(id));
  return [...byId.values(), ...ordered];
}

/**
 * 根据 sessionId 获取会话（归一化格式）
 * @param {string} sessionId - 会话 ID
 * @returns {Object|null} 归一化的会话对象
 */
async function getSessionById(sessionId) {
  const status = await getSessionHistoryIndex().getSessionStatus('codex', sessionId);
  if (!status) return null;
  const session = parseSession(status.filePath);
  if (!session) return null;
  return { ...normalizeSession(session), messages: session.messages, filePath: status.filePath };
}

/**
 * 搜索会话（全局）
 * @param {string} keyword - 搜索关键词
 * @returns {Array} 搜索结果
 */
async function searchSessions(keyword) {
  return getSessionHistoryIndex().searchSessions('codex', keyword);
}

/**
 * 删除项目（删除项目下所有会话）
 * @param {string} projectName - 项目名称
 * @returns {Object} 删除结果 { success: true, deletedCount: number }
 */
function deleteProject(projectName) {
  const sessions = getAllSessions();

  // 找到该项目下的所有会话
  const projectSessions = sessions.filter(session => {
    const sessionProjectName = extractCodexProjectNameFromMeta(session.meta);
    return sessionProjectName === projectName;
  });

  if (projectSessions.length === 0) {
    throw new Error('Project not found or has no sessions');
  }

  // 删除所有会话文件
  let deletedCount = 0;
  const { getForkRelations, saveForkRelations } = require('../claude/sessions-implementation');
  const { deleteAlias } = require('../../../server/services/alias');
  const forkRelations = getForkRelations();
  let forkRelationsModified = false;

  projectSessions.forEach(session => {
    try {
      // 删除会话文件
      if (fs.existsSync(session.filePath)) {
        fs.unlinkSync(session.filePath);
        deletedCount++;
      }

      // 清理 fork 关系
      if (forkRelations[session.sessionId]) {
        delete forkRelations[session.sessionId];
        forkRelationsModified = true;
      }

      // 清理指向该会话的 fork 关系
      Object.keys(forkRelations).forEach(key => {
        if (forkRelations[key] === session.sessionId) {
          delete forkRelations[key];
          forkRelationsModified = true;
        }
      });

      // 清理别名
      try {
        deleteAlias(session.sessionId);
      } catch (err) {
        // 忽略别名不存在的错误
      }
    } catch (err) {
      console.error(`[Codex] Failed to delete session ${session.sessionId}:`, err.message);
    }
  });

  // 保存清理后的 fork 关系
  if (forkRelationsModified) {
    saveForkRelations(forkRelations);
  }

  // 清理项目排序配置
  try {
    const currentOrder = getProjectOrder();
    const newOrder = currentOrder.filter(name => name !== projectName);
    if (newOrder.length !== currentOrder.length) {
      saveProjectOrder(newOrder);
    }
  } catch (err) {
    console.error('[Codex] Failed to clean project order:', err.message);
  }

  // 清理会话排序配置
  try {
    saveSessionOrder(projectName, []);
  } catch (err) {
    console.error('[Codex] Failed to clean session order:', err.message);
  }

  invalidateProjectAndSessionCountsCache();
  invalidateCodexSessionCaches();
  return { success: true, deletedCount };
}

/**
 * 获取最近的会话（跨项目）
 * @param {number} limit - 返回数量限制，默认 5
 * @returns {Array} 最近会话数组
 */
async function getRecentSessions(limit = 5) {
  const indexed = await getSessionHistoryIndex().getRecentSessions('codex', limit);
  const forkRelations = require('../claude/sessions-implementation').getForkRelations();
  const aliases = require('../../../server/services/alias').loadAliases();
  return indexed.map(session => ({
    ...session,
    mtime: new Date(session.mtime).toISOString(),
    forkedFrom: forkRelations[session.sessionId] || null,
    alias: aliases[session.sessionId] || null
  }));
}

/**
 * 删除一个会话
 * @param {string} sessionId - 会话 ID
 * @returns {Object} 删除结果 { success: true }
 */
function deleteSession(sessionId) {
  const targetFile = findSessionFileById(sessionId);

  if (!targetFile) {
    throw new Error('Session not found');
  }

  // 删除会话文件
  fs.unlinkSync(targetFile.filePath);

  // 清理 fork 关系
  const { getForkRelations, saveForkRelations } = require('../claude/sessions-implementation');
  const forkRelations = getForkRelations();

  // 删除作为源的 fork 关系
  delete forkRelations[sessionId];

  // 删除所有指向该会话的 fork 关系
  Object.keys(forkRelations).forEach(key => {
    if (forkRelations[key] === sessionId) {
      delete forkRelations[key];
    }
  });

  saveForkRelations(forkRelations);

  // 清理别名
  const { deleteAlias } = require('../../../server/services/alias');
  try {
    deleteAlias(sessionId);
  } catch (err) {
    // 忽略别名不存在的错误
  }

  invalidateProjectAndSessionCountsCache();
  invalidateCodexSessionCaches();
  return { success: true };
}

/**
 * Fork 一个会话（创建副本）
 * @param {string} sessionId - 原会话 ID
 * @returns {Object} Fork 结果 { newSessionId, forkedFrom }
 */
function forkSession(sessionId, options = {}) {
  const sourceFile = findSessionFileById(sessionId);

  if (!sourceFile) {
    throw new Error('Session not found');
  }

  // 读取原会话文件内容
  const originalContent = fs.readFileSync(sourceFile.filePath, 'utf8');
  const content = sliceCodexContentByUserMessage(
    originalContent,
    options.afterUserMessageNumber
  );

  // 生成新的 session ID (使用 crypto.randomUUID 生成 v4 UUID)
  const crypto = require('crypto');
  const newSessionId = crypto.randomUUID();

  // 生成新的时间戳（Codex 格式：YYYY-MM-DDTHH-MM-SS）
  const now = new Date();
  const timestamp = now.toISOString()
    .replace(/\.\d{3}Z$/, '')  // 移除毫秒和 Z
    .replace(/:/g, '-');        // 将冒号替换为破折号

  // 生成新文件路径（按当前日期组织）
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  const targetDir = path.join(getSessionsDir(), String(year), month, day);

  // 确保目标目录存在
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const newFileName = `rollout-${timestamp}-${newSessionId}.jsonl`;
  const newFilePath = path.join(targetDir, newFileName);

  // 写入新文件
  fs.writeFileSync(newFilePath, content, 'utf8');

  // 保存 fork 关系（复用 Claude Code 的 fork 关系存储）
  const { getForkRelations, saveForkRelations } = require('../claude/sessions-implementation');
  const forkRelations = getForkRelations();
  forkRelations[newSessionId] = sessionId;
  saveForkRelations(forkRelations);
  if (options.alias) {
    const { setAlias } = require('../../../server/services/alias');
    setAlias(newSessionId, options.alias);
  }

  invalidateProjectAndSessionCountsCache();
  invalidateCodexSessionCaches();
  return {
    newSessionId,
    forkedFrom: sessionId,
    newFilePath,
    alias: options.alias || null,
    afterUserMessageNumber: options.afterUserMessageNumber || null
  };
}

/**
 * 获取会话排序（按项目）
 * @param {string} projectName - 项目名称
 * @returns {Array} 会话 ID 数组
 */
function getSessionOrder(projectName) {
  const { getSessionOrder: getClaudeSessionOrder } = require('../claude/sessions-implementation');
  // 复用 Claude Code 的排序存储，使用 "codex-" 前缀区分
  return getClaudeSessionOrder(`codex-${projectName}`);
}

/**
 * 保存会话排序
 * @param {string} projectName - 项目名称
 * @param {Array} order - 会话 ID 数组
 */
function saveSessionOrder(projectName, order) {
  const { saveSessionOrder: saveClaudeSessionOrder } = require('../claude/sessions-implementation');
  // 复用 Claude Code 的排序存储，使用 "codex-" 前缀区分
  saveClaudeSessionOrder(`codex-${projectName}`, order);
  const cacheKey = getCodexSessionsCacheKey(projectName);
  globalCache.delete(cacheKey);
  codexSessionCacheKeys.delete(cacheKey);
}

/**
 * 获取项目排序
 * @returns {Array} 项目名称数组
 */
function getProjectOrder() {
  const { getProjectOrder: getClaudeProjectOrder } = require('../claude/sessions-implementation');
  const { getCodexDir } = require('./config');
  // 复用 Claude Code 的排序存储，使用特殊的配置对象标识 Codex
  return getClaudeProjectOrder({ projectsDir: getCodexDir() });
}

/**
 * 保存项目排序
 * @param {Array} order - 项目名称数组
 */
function saveProjectOrder(order) {
  const { saveProjectOrder: saveClaudeProjectOrder } = require('../claude/sessions-implementation');
  const { getCodexDir } = require('./config');
  // 复用 Claude Code 的排序存储
  saveClaudeProjectOrder({ projectsDir: getCodexDir() }, order);
  globalCache.delete(CODEX_PROJECTS_CACHE_KEY);
}

function invalidateProjectAndSessionCountsCache() {
  countsCache.expiresAt = 0;
}

function invalidateCodexSessionCaches(options = {}) {
  scanFilesCache.expiresAt = 0;
  sessionFileIndexCache.expiresAt = 0;
  allSessionsCache.expiresAt = 0;
  globalCache.delete(CODEX_PROJECTS_CACHE_KEY);

  if (options.projectName) {
    const cacheKey = getCodexSessionsCacheKey(options.projectName);
    globalCache.delete(cacheKey);
    codexSessionCacheKeys.delete(cacheKey);
    return;
  }

  for (const key of codexSessionCacheKeys) {
    globalCache.delete(key);
  }
  codexSessionCacheKeys.clear();
}

function extractCodexProjectNameFromMeta(metaPayload = {}) {
  const repoUrl = metaPayload?.git?.repository_url || metaPayload?.git?.repositoryUrl;
  if (typeof repoUrl === 'string' && repoUrl.trim()) {
    const parsedName = repoUrl.split('/').pop();
    if (parsedName) {
      const normalized = parsedName.replace(/\.git$/i, '').trim();
      if (normalized) return normalized;
    }
  }

  const cwd = metaPayload?.cwd;
  if (typeof cwd === 'string' && cwd.trim()) {
    return path.basename(cwd.trim());
  }

  return '';
}

function normalizeSessionMetaFromPayload(payload = {}, fallbackTimestamp = null) {
  return {
    sessionId: payload.id,
    timestamp: payload.timestamp || normalizeTimestampFromFilename(fallbackTimestamp),
    cwd: payload.cwd,
    cliVersion: payload.cli_version,
    provider: payload.model_provider,
    git: payload.git ? {
      branch: payload.git.branch,
      commitHash: payload.git.commit_hash || payload.git.commitHash,
      repositoryUrl: payload.git.repository_url || payload.git.repositoryUrl
    } : null
  };
}

function normalizeTimestampFromFilename(raw = '') {
  if (!raw || typeof raw !== 'string') return null;
  const [date, timePart] = raw.split('T');
  if (!date || !timePart) return null;
  return `${date}T${timePart.replace(/-/g, ':')}Z`;
}

function extractCodexPreviewFromResponseItem(payload = {}) {
  if (payload?.type !== 'message' || payload?.role !== 'user') {
    return '';
  }

  const contentParts = Array.isArray(payload.content) ? payload.content : [];
  const text = contentParts
    .map(item => item?.text || item?.input_text || '')
    .join('\n')
    .trim();

  if (!text || text === 'Warmup' || text.startsWith('<environment_context>')) {
    return '';
  }

  return text.substring(0, 100);
}

function splitTextPreserveEol(content) {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const hasTrailingEol = content.endsWith('\r\n') || content.endsWith('\n');
  return {
    lines: content.split(/\r?\n/),
    eol,
    hasTrailingEol
  };
}

function joinTextPreserveEol(lines, eol, hasTrailingEol) {
  const text = lines.join(eol);
  return hasTrailingEol ? `${text}${eol}` : text;
}

function sliceCodexContentByUserMessage(content, afterUserMessageNumber) {
  if (!Number.isInteger(afterUserMessageNumber) || afterUserMessageNumber <= 0) {
    return content;
  }

  const { lines, eol, hasTrailingEol } = splitTextPreserveEol(content);
  const keptLines = [];
  let matchedUserMessages = 0;
  let targetUserReached = false;

  for (const line of lines) {
    if (!line.trim()) {
      keptLines.push(line);
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      keptLines.push(line);
      continue;
    }

    if (parsed?.type !== 'response_item' || !parsed?.payload) {
      keptLines.push(line);
      continue;
    }

    const preview = extractCodexPreviewFromResponseItem(parsed.payload);
    if (!preview) {
      keptLines.push(line);
      continue;
    }

    if (targetUserReached) {
      return joinTextPreserveEol(keptLines, eol, hasTrailingEol);
    }

    matchedUserMessages += 1;
    keptLines.push(line);
    if (matchedUserMessages >= afterUserMessageNumber) {
      targetUserReached = true;
    }
  }

  if (targetUserReached) {
    return joinTextPreserveEol(keptLines, eol, hasTrailingEol);
  }

  throw new Error(`afterUserMessageNumber ${afterUserMessageNumber} exceeds available user messages (${matchedUserMessages})`);
}

function readSessionMetaSummaryFast(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(FAST_META_READ_BYTES);
    const bytesRead = fs.readSync(fd, buffer, 0, FAST_META_READ_BYTES, 0);
    if (bytesRead <= 0) return null;

    const chunk = buffer.toString('utf8', 0, bytesRead);
    const lines = chunk.split('\n');

    let payload = null;
    let preview = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch (err) {
        continue;
      }

      if (!payload && parsed?.type === 'session_meta' && parsed?.payload && typeof parsed.payload === 'object') {
        payload = parsed.payload;
      }

      if (!preview && parsed?.type === 'response_item' && parsed?.payload) {
        preview = extractCodexPreviewFromResponseItem(parsed.payload) || preview;
      }

      if (payload && preview) {
        break;
      }
    }

    if (!payload) return null;
    return { payload, preview };
  } catch (err) {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch (err) {
        // ignore close errors
      }
    }
  }
}

function readSessionMetaPayloadFast(filePath) {
  const summary = readSessionMetaSummaryFast(filePath);
  return summary?.payload || null;
}

function findSessionFileById(sessionId) {
  const now = Date.now();
  if (sessionFileIndexCache.expiresAt > now) {
    return sessionFileIndexCache.value.get(sessionId) || null;
  }

  scanSessionFiles();
  if (sessionFileIndexCache.expiresAt > Date.now()) {
    return sessionFileIndexCache.value.get(sessionId) || null;
  }
  return null;
}


/**
 * 获取 Codex 项目与会话数量（用于仪表盘轻量统计）
 */
async function getProjectAndSessionCounts(options = {}) {
  if (!fs.existsSync(getSessionsDir())) {
    return { projectCount: 0, sessionCount: 0 };
  }
  const projects = await getSessionHistoryIndex({ ...options, projectsDir: getSessionsDir() }).listProjects('codex', options);
  return {
    projectCount: projects.length,
    sessionCount: projects.reduce((sum, project) => sum + (project.sessionCount || 0), 0)
  };
}

module.exports = {
  configure,
  getSessionsDir,
  scanSessionFiles,
  getAllSessions,
  getProjects,
  getSessionsByProject,
  getSessionById,
  searchSessions,
  normalizeSession,
  forkSession,
  deleteSession,
  deleteProject,
  getRecentSessions,
  getSessionOrder,
  saveSessionOrder,
  getProjectOrder,
  saveProjectOrder,
  getProjectAndSessionCounts
};
