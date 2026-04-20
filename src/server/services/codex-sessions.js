const fs = require('fs');
const path = require('path');
const { getCodexDir } = require('./codex-config');
const { parseSession, parseSessionMeta, extractSessionMeta, readJSONL } = require('./codex-parser');
const { globalCache, CacheKeys } = require('./enhanced-cache');

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
function getProjects() {
  const cached = globalCache.get(CODEX_PROJECTS_CACHE_KEY);
  if (cached) {
    return cached;
  }

  const sessions = getAllSessions();
  const projectMap = new Map();

  sessions.forEach(session => {
    const meta = session.meta;

    // 优先使用 Git 仓库名，否则使用 cwd 的最后一级目录
    const projectName = extractCodexProjectNameFromMeta(meta);
    const projectPath = (typeof meta.cwd === 'string' && meta.cwd.trim()) ? meta.cwd.trim() : projectName;
    if (!projectName) return;

    if (!projectMap.has(projectName)) {
      projectMap.set(projectName, {
        name: projectName,
        displayName: projectName,
        fullPath: projectPath,
        path: projectPath,
        gitRepo: meta.git?.repositoryUrl,
        branch: meta.git?.branch,
        sessionCount: 0,
        lastUsed: null,
        source: 'codex'
      });
    }

    const project = projectMap.get(projectName);
    project.sessionCount++;

    // 更新最后活动时间
    const sessionTime = session.mtimeMs || new Date(session.meta.timestamp || 0).getTime() || 0;
    if (!project.lastUsed || sessionTime > project.lastUsed) {
      project.lastUsed = sessionTime;
    }
  });

  // 获取保存的排序
  const savedOrder = getProjectOrder();
  const projects = Array.from(projectMap.values());

  // 应用保存的排序
  if (savedOrder.length > 0) {
    const ordered = [];
    const projectsMap = new Map(projects.map(p => [p.name, p]));

    // 按保存的顺序添加项目
    for (const projectName of savedOrder) {
      if (projectsMap.has(projectName)) {
        ordered.push(projectsMap.get(projectName));
        projectsMap.delete(projectName);
      }
    }

    // 添加剩余的新项目（不在保存顺序中的）
    ordered.push(...projectsMap.values());
    globalCache.set(CODEX_PROJECTS_CACHE_KEY, ordered, PROJECTS_CACHE_TTL_MS);
    return ordered;
  }

  // 默认按最后活动时间排序
  const sorted = projects.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
  globalCache.set(CODEX_PROJECTS_CACHE_KEY, sorted, PROJECTS_CACHE_TTL_MS);
  return sorted;
}

/**
 * 根据项目名获取会话列表（归一化格式）
 * @param {string} projectName - 项目名称
 * @returns {Array} 归一化的会话数组
 */
function getSessionsByProject(projectName) {
  const cacheKey = getCodexSessionsCacheKey(projectName);
  const cached = globalCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const sessions = getAllSessions();

  // 获取 fork 关系
  const { getForkRelations } = require('./sessions');
  const forkRelations = getForkRelations();

  // 获取保存的排序
  const savedOrder = getSessionOrder(projectName);

  // 过滤并归一化会话
  const filteredSessions = sessions
    .filter(session => {
      const sessionProjectName = extractCodexProjectNameFromMeta(session.meta);
      return sessionProjectName === projectName;
    })
    .map(session => {
      const normalized = normalizeSession(session);
      // 添加 fork 关系
      normalized.forkedFrom = forkRelations[normalized.sessionId] || null;
      return normalized;
    });

  // 应用保存的排序
  let orderedSessions = filteredSessions;
  if (savedOrder.length > 0) {
    const orderedFromSaved = [];
    const sessionMap = new Map(filteredSessions.map(s => [s.sessionId, s]));

    for (const sessionId of savedOrder) {
      const session = sessionMap.get(sessionId);
      if (session) {
        orderedFromSaved.push(session);
        sessionMap.delete(sessionId);
      }
    }

    const newSessions = [...sessionMap.values()];
    newSessions.sort((a, b) => {
      return new Date(b.mtime).getTime() - new Date(a.mtime).getTime();
    });

    // 新会话在前，旧会话在后（按保存顺序）
    orderedSessions = [...newSessions, ...orderedFromSaved];
  } else {
    // 默认按时间倒序
    orderedSessions.sort((a, b) => {
      return new Date(b.mtime).getTime() - new Date(a.mtime).getTime();
    });
  }

  globalCache.set(cacheKey, orderedSessions, PROJECT_SESSIONS_CACHE_TTL_MS);
  codexSessionCacheKeys.add(cacheKey);

  return orderedSessions;
}

/**
 * 根据 sessionId 获取会话（归一化格式）
 * @param {string} sessionId - 会话 ID
 * @returns {Object|null} 归一化的会话对象
 */
function getSessionById(sessionId) {
  const file = findSessionFileById(sessionId);

  if (!file) {
    return null;
  }

  const session = parseSession(file.filePath);
  if (!session) {
    return null;
  }

  return {
    ...normalizeSession(session),
    messages: session.messages, // 包含完整消息
    filePath: file.filePath
  };
}

/**
 * 搜索会话（全局）
 * @param {string} keyword - 搜索关键词
 * @returns {Array} 搜索结果
 */
function searchSessions(keyword) {
  const files = scanSessionFiles();
  const results = [];

  files.forEach(file => {
    // 使用完整解析获取消息内容
    const session = parseSession(file.filePath);

    if (!session || !session.messages || !Array.isArray(session.messages)) {
      return;
    }

    session.messages.forEach((message, index) => {
      if (message.role !== 'user' && message.role !== 'assistant') {
        return;
      }

      const content = (message.content || '').toLowerCase();
      const keywordLower = keyword.toLowerCase();

      if (content.includes(keywordLower)) {
        // 提取上下文
        const startIndex = Math.max(0, content.indexOf(keywordLower) - 50);
        const endIndex = Math.min(content.length, content.indexOf(keywordLower) + keyword.length + 50);
        const context = content.substring(startIndex, endIndex);

        // 确定项目名
        let projectName;
        if (session.meta?.git?.repositoryUrl) {
          projectName = session.meta.git.repositoryUrl.split('/').pop().replace('.git', '');
        } else if (session.meta?.cwd) {
          projectName = path.basename(session.meta.cwd);
        } else {
          projectName = 'Unknown';
        }

        results.push({
          sessionId: file.sessionId,
          projectName,
          messageIndex: index,
          role: message.role,
          context: (startIndex > 0 ? '...' : '') + context + (endIndex < content.length ? '...' : ''),
          timestamp: message.timestamp,
          source: 'codex'
        });
      }
    });
  });

  return results;
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
  const { getForkRelations, saveForkRelations } = require('./sessions');
  const { deleteAlias } = require('./alias');
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
function getRecentSessions(limit = 5) {
  const sessions = getAllSessions();

  // 获取 fork 关系和别名
  const { getForkRelations } = require('./sessions');
  const { loadAliases } = require('./alias');
  const forkRelations = getForkRelations();
  const aliases = loadAliases();

  // 归一化所有会话
  const allNormalizedSessions = sessions.map(session => {
    const normalized = normalizeSession(session);

    // 添加项目信息
    const projectName = extractCodexProjectNameFromMeta(session.meta) || 'Unknown';
    const projectPath = (typeof session.meta.cwd === 'string' && session.meta.cwd.trim())
      ? session.meta.cwd
      : projectName;

    return {
      ...normalized,
      forkedFrom: forkRelations[normalized.sessionId] || null,
      alias: aliases[normalized.sessionId] || null,
      projectName: projectName,
      projectDisplayName: projectName,
      projectFullPath: projectPath
    };
  });

  // 按 mtime 倒序排序，取前 N 个
  return allNormalizedSessions
    .sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime())
    .slice(0, limit);
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
  const { getForkRelations, saveForkRelations } = require('./sessions');
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
  const { deleteAlias } = require('./alias');
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
  const { getForkRelations, saveForkRelations } = require('./sessions');
  const forkRelations = getForkRelations();
  forkRelations[newSessionId] = sessionId;
  saveForkRelations(forkRelations);
  if (options.alias) {
    const { setAlias } = require('./alias');
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
  const { getSessionOrder: getClaudeSessionOrder } = require('./sessions');
  // 复用 Claude Code 的排序存储，使用 "codex-" 前缀区分
  return getClaudeSessionOrder(`codex-${projectName}`);
}

/**
 * 保存会话排序
 * @param {string} projectName - 项目名称
 * @param {Array} order - 会话 ID 数组
 */
function saveSessionOrder(projectName, order) {
  const { saveSessionOrder: saveClaudeSessionOrder } = require('./sessions');
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
  const { getProjectOrder: getClaudeProjectOrder } = require('./sessions');
  const { getCodexDir } = require('./codex-config');
  // 复用 Claude Code 的排序存储，使用特殊的配置对象标识 Codex
  return getClaudeProjectOrder({ projectsDir: getCodexDir() });
}

/**
 * 保存项目排序
 * @param {Array} order - 项目名称数组
 */
function saveProjectOrder(order) {
  const { saveProjectOrder: saveClaudeProjectOrder } = require('./sessions');
  const { getCodexDir } = require('./codex-config');
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

    keptLines.push(line);

    if (parsed?.type !== 'response_item' || !parsed?.payload) {
      continue;
    }

    const preview = extractCodexPreviewFromResponseItem(parsed.payload);
    if (!preview) {
      continue;
    }

    matchedUserMessages += 1;
    if (matchedUserMessages >= afterUserMessageNumber) {
      return joinTextPreserveEol(keptLines, eol, hasTrailingEol);
    }
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

function calculateProjectAndSessionCounts() {
  const sessions = scanSessionFiles();
  if (sessions.length === 0) {
    return EMPTY_COUNTS;
  }

  const projectNames = new Set();
  sessions.forEach((session) => {
    const payload = readSessionMetaPayloadFast(session.filePath);
    const projectName = extractCodexProjectNameFromMeta(payload || {});
    if (projectName) {
      projectNames.add(projectName);
    }
  });

  return {
    projectCount: projectNames.size,
    sessionCount: sessions.length
  };
}

/**
 * 获取 Codex 项目与会话数量（用于仪表盘轻量统计）
 */
function getProjectAndSessionCounts() {
  const now = Date.now();
  if (countsCache.expiresAt > now) {
    return countsCache.value;
  }

  try {
    const counts = calculateProjectAndSessionCounts();
    countsCache = {
      value: counts,
      expiresAt: now + COUNTS_CACHE_TTL_MS
    };
    return counts;
  } catch (err) {
    return countsCache.value || EMPTY_COUNTS;
  }
}

module.exports = {
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
