const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { NATIVE_PATHS, PATHS } = require('../../config/paths');

/**
 * OpenCode 会话服务
 * 读取 OpenCode CLI 的原生会话数据
 */

const PROJECT_ORDER_FILE = path.join(PATHS.base, 'opencode-project-order.json');
const SESSION_ORDER_FILE = path.join(PATHS.base, 'opencode-session-order.json');

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJsonSafe(filePath, fallback) {
  if (!filePath || !fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return fallback;
  }
}

function writeJsonSafe(filePath, data) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function copyDirectoryRecursive(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) {
    return;
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryRecursive(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function sortByOrder(items, order, fallbackCompare) {
  const fallbackSorted = [...items].sort(fallbackCompare);
  if (!Array.isArray(order) || order.length === 0) {
    return fallbackSorted;
  }

  const orderMap = new Map(order.map((name, idx) => [name, idx]));
  return fallbackSorted.sort((a, b) => {
    const aIndex = orderMap.has(a.name) ? orderMap.get(a.name) : Number.MAX_SAFE_INTEGER;
    const bIndex = orderMap.has(b.name) ? orderMap.get(b.name) : Number.MAX_SAFE_INTEGER;
    if (aIndex === bIndex) {
      return fallbackCompare(a, b);
    }
    return aIndex - bIndex;
  });
}

function extractTextContent(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter(item => item && item.type === 'text' && typeof item.text === 'string')
      .map(item => item.text)
      .join('\n')
      .trim();
  }
  return '';
}

function buildContext(text, keyword, contextLength = 35) {
  if (!text || !keyword) {
    return null;
  }

  const parsedContextLength = Number(contextLength);
  const safeContextLength = Number.isFinite(parsedContextLength) && parsedContextLength >= 0
    ? parsedContextLength
    : 35;

  const lowerText = text.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  const index = lowerText.indexOf(lowerKeyword);
  if (index === -1) {
    return null;
  }

  const start = Math.max(0, index - safeContextLength);
  const end = Math.min(text.length, index + keyword.length + safeContextLength);
  let context = text.slice(start, end);
  if (start > 0) context = `...${context}`;
  if (end < text.length) context = `${context}...`;
  return context;
}

// 检查 OpenCode 是否安装
function isOpenCodeInstalled() {
  return fs.existsSync(NATIVE_PATHS.opencode.data);
}

// 获取 OpenCode 数据目录
function getOpenCodeDataDir() {
  return NATIVE_PATHS.opencode.data;
}

// 获取会话存储目录
function getSessionsDir() {
  return path.join(getOpenCodeDataDir(), 'storage', 'session');
}

// 获取项目存储目录
function getProjectsDir() {
  return path.join(getOpenCodeDataDir(), 'storage', 'project');
}

// 获取消息存储目录
function getMessagesRootDir() {
  return NATIVE_PATHS.opencode.messages;
}

function getMessageDir(sessionId) {
  return path.join(getMessagesRootDir(), sessionId);
}

function getProjectOrder() {
  const order = readJsonSafe(PROJECT_ORDER_FILE, []);
  return Array.isArray(order) ? order : [];
}

function saveProjectOrder(order) {
  if (!Array.isArray(order)) {
    throw new Error('order must be an array');
  }
  writeJsonSafe(PROJECT_ORDER_FILE, order);
  return { success: true };
}

function getSessionOrderMap() {
  const map = readJsonSafe(SESSION_ORDER_FILE, {});
  return map && typeof map === 'object' ? map : {};
}

function saveSessionOrderMap(map) {
  writeJsonSafe(SESSION_ORDER_FILE, map);
}

function getSessionOrder(projectId) {
  const map = getSessionOrderMap();
  const order = map[projectId];
  return Array.isArray(order) ? order : [];
}

function saveSessionOrder(projectId, order) {
  if (!projectId) {
    throw new Error('projectId is required');
  }
  if (!Array.isArray(order)) {
    throw new Error('order must be an array');
  }

  const map = getSessionOrderMap();
  map[projectId] = order;
  saveSessionOrderMap(map);
  return { success: true };
}

function removeSessionFromOrder(projectId, sessionId) {
  const map = getSessionOrderMap();
  if (!Array.isArray(map[projectId])) {
    return;
  }
  map[projectId] = map[projectId].filter(id => id !== sessionId);
  saveSessionOrderMap(map);
}

function removeProjectFromOrder(projectId) {
  const currentOrder = getProjectOrder().filter(name => name !== projectId);
  saveProjectOrder(currentOrder);

  const map = getSessionOrderMap();
  if (map[projectId] !== undefined) {
    delete map[projectId];
    saveSessionOrderMap(map);
  }
}

function getProjectEntries() {
  const projectsDir = getProjectsDir();
  if (!fs.existsSync(projectsDir)) {
    return [];
  }

  const files = fs.readdirSync(projectsDir).filter(file => file.endsWith('.json'));
  const entries = [];
  for (const file of files) {
    const filePath = path.join(projectsDir, file);
    const data = readJsonSafe(filePath, null);
    if (!data || !data.id) {
      continue;
    }
    entries.push({ filePath, data });
  }
  return entries;
}

// 获取所有项目
function getProjects() {
  const projects = [];
  const entries = getProjectEntries();

  for (const entry of entries) {
    const project = entry.data;
    const projectSessions = getSessionsByProjectId(project.id);
    projects.push({
      name: project.id,
      displayName: project.id,
      fullPath: project.worktree || '/',
      path: project.worktree || '/',
      sessionCount: projectSessions.length,
      lastUsed: project.time?.updated || project.time?.created || 0,
      source: 'opencode'
    });
  }

  return sortByOrder(
    projects,
    getProjectOrder(),
    (a, b) => (b.lastUsed || 0) - (a.lastUsed || 0)
  );
}

// 根据项目ID获取会话列表
function getSessionsByProjectId(projectId) {
  const sessionsDir = path.join(getSessionsDir(), projectId);
  const sessions = [];

  if (!fs.existsSync(sessionsDir)) {
    return sessions;
  }

  const files = fs.readdirSync(sessionsDir).filter(file => file.endsWith('.json'));
  for (const file of files) {
    const filePath = path.join(sessionsDir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const session = JSON.parse(content);
      sessions.push(normalizeSession(session, filePath, projectId));
    } catch (err) {
      console.error(`[OpenCode Sessions] Failed to parse session file ${file}:`, err);
    }
  }

  const fallbackSorted = sessions.sort(
    (a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime()
  );

  const order = getSessionOrder(projectId);
  if (order.length === 0) {
    return fallbackSorted;
  }

  const orderMap = new Map(order.map((id, idx) => [id, idx]));
  return [...fallbackSorted].sort((a, b) => {
    const aIndex = orderMap.has(a.sessionId) ? orderMap.get(a.sessionId) : Number.MAX_SAFE_INTEGER;
    const bIndex = orderMap.has(b.sessionId) ? orderMap.get(b.sessionId) : Number.MAX_SAFE_INTEGER;
    if (aIndex === bIndex) {
      return new Date(b.mtime).getTime() - new Date(a.mtime).getTime();
    }
    return aIndex - bIndex;
  });
}

// 归一化会话格式（与 Claude Code 格式一致）
function normalizeSession(session, filePath, projectId = null) {
  const mtime = session.time?.updated
    ? new Date(session.time.updated).toISOString()
    : new Date().toISOString();

  let size = 0;
  try {
    if (filePath && fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      size = stats.size;
    }
  } catch (err) {
    // 忽略错误
  }

  return {
    sessionId: session.id,
    projectName: projectId,
    mtime,
    size,
    filePath: filePath || '',
    gitBranch: null,
    firstMessage: session.title || session.slug || null,
    forkedFrom: null,
    directory: session.directory,
    slug: session.slug,
    source: 'opencode'
  };
}

// 根据项目名获取会话列表
function getSessionsByProject(projectName) {
  return getSessionsByProjectId(projectName);
}

function getSessionLocation(sessionId) {
  const sessionsRoot = getSessionsDir();
  if (!fs.existsSync(sessionsRoot)) {
    return null;
  }

  const projectDirs = fs.readdirSync(sessionsRoot, { withFileTypes: true });
  for (const projectDir of projectDirs) {
    if (!projectDir.isDirectory()) continue;

    const projectPath = path.join(sessionsRoot, projectDir.name);
    const directPath = path.join(projectPath, `${sessionId}.json`);
    if (fs.existsSync(directPath)) {
      const sessionData = readJsonSafe(directPath, null);
      if (sessionData && sessionData.id === sessionId) {
        return { projectId: projectDir.name, sessionPath: directPath, sessionData };
      }
    }

    const files = fs.readdirSync(projectPath).filter(file => file.endsWith('.json'));
    for (const file of files) {
      const sessionPath = path.join(projectPath, file);
      const sessionData = readJsonSafe(sessionPath, null);
      if (sessionData && sessionData.id === sessionId) {
        return { projectId: projectDir.name, sessionPath, sessionData };
      }
    }
  }

  return null;
}

// 根据会话ID获取会话详情
function getSessionById(sessionId) {
  const location = getSessionLocation(sessionId);
  if (!location) {
    return null;
  }

  return normalizeSession(location.sessionData, location.sessionPath, location.projectId);
}

// 获取项目和会话数量统计
function getProjectAndSessionCounts() {
  try {
    const projects = getProjects();
    let sessionCount = 0;

    for (const project of projects) {
      sessionCount += project.sessionCount || 0;
    }

    return {
      projectCount: projects.length,
      sessionCount
    };
  } catch (err) {
    console.error('[OpenCode Sessions] Failed to get counts:', err);
    return { projectCount: 0, sessionCount: 0 };
  }
}

function getRecentSessions(limit = 5) {
  const projects = getProjects();
  const { loadAliases } = require('./alias');
  const { getForkRelations } = require('./sessions');
  const aliases = loadAliases();
  const forkRelations = getForkRelations();
  const allSessions = [];

  for (const project of projects) {
    const sessions = getSessionsByProjectId(project.name);
    sessions.forEach(session => {
      allSessions.push({
        ...session,
        alias: aliases[session.sessionId] || null,
        forkedFrom: forkRelations[session.sessionId] || null,
        projectName: project.name,
        projectDisplayName: project.displayName,
        projectFullPath: project.fullPath
      });
    });
  }

  return allSessions
    .sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime())
    .slice(0, limit);
}

// 删除会话
function deleteSession(sessionId) {
  const location = getSessionLocation(sessionId);
  if (!location) {
    throw new Error('Session not found');
  }

  fs.unlinkSync(location.sessionPath);

  const messageDir = getMessageDir(sessionId);
  if (fs.existsSync(messageDir)) {
    fs.rmSync(messageDir, { recursive: true, force: true });
  }

  try {
    const { deleteAlias } = require('./alias');
    deleteAlias(sessionId);
  } catch (err) {
    // ignore alias cleanup errors
  }

  removeSessionFromOrder(location.projectId, sessionId);

  try {
    const { getForkRelations, saveForkRelations } = require('./sessions');
    const relations = getForkRelations();
    delete relations[sessionId];
    Object.keys(relations).forEach((key) => {
      if (relations[key] === sessionId) {
        delete relations[key];
      }
    });
    saveForkRelations(relations);
  } catch (err) {
    // ignore fork relation cleanup errors
  }

  return { success: true, projectName: location.projectId, sessionId };
}

function forkSession(sessionId) {
  const location = getSessionLocation(sessionId);
  if (!location) {
    throw new Error('Session not found');
  }

  const now = new Date().toISOString();
  const newSessionId = crypto.randomUUID();
  const source = location.sessionData;
  const nextSession = {
    ...source,
    id: newSessionId,
    time: {
      ...(source.time || {}),
      created: now,
      updated: now
    }
  };

  const targetPath = path.join(path.dirname(location.sessionPath), `${newSessionId}.json`);
  fs.writeFileSync(targetPath, JSON.stringify(nextSession, null, 2), 'utf8');

  const sourceMessageDir = getMessageDir(sessionId);
  const targetMessageDir = getMessageDir(newSessionId);
  if (fs.existsSync(sourceMessageDir)) {
    copyDirectoryRecursive(sourceMessageDir, targetMessageDir);
  }

  try {
    const { getForkRelations, saveForkRelations } = require('./sessions');
    const relations = getForkRelations();
    relations[newSessionId] = sessionId;
    saveForkRelations(relations);
  } catch (err) {
    // ignore fork relation save errors
  }

  const existingOrder = getSessionOrder(location.projectId);
  saveSessionOrder(location.projectId, [newSessionId, ...existingOrder.filter(id => id !== newSessionId)]);

  return {
    success: true,
    newSessionId,
    forkedFrom: sessionId,
    projectName: location.projectId,
    newFilePath: targetPath
  };
}

function deleteProject(projectId) {
  const projectSessionDir = path.join(getSessionsDir(), projectId);
  if (!fs.existsSync(projectSessionDir)) {
    throw new Error('Project not found');
  }

  const sessionFiles = fs.readdirSync(projectSessionDir).filter(file => file.endsWith('.json'));
  const deletedSessionIds = [];

  for (const file of sessionFiles) {
    const sessionPath = path.join(projectSessionDir, file);
    const session = readJsonSafe(sessionPath, null);
    const sessionId = session?.id || path.basename(file, '.json');
    deletedSessionIds.push(sessionId);

    const messageDir = getMessageDir(sessionId);
    if (fs.existsSync(messageDir)) {
      fs.rmSync(messageDir, { recursive: true, force: true });
    }

    try {
      const { deleteAlias } = require('./alias');
      deleteAlias(sessionId);
    } catch (err) {
      // ignore alias cleanup errors
    }
  }

  fs.rmSync(projectSessionDir, { recursive: true, force: true });

  const projectEntries = getProjectEntries();
  for (const entry of projectEntries) {
    if (entry.data.id === projectId) {
      fs.rmSync(entry.filePath, { force: true });
    }
  }

  removeProjectFromOrder(projectId);

  try {
    const { getForkRelations, saveForkRelations } = require('./sessions');
    const deletedSet = new Set(deletedSessionIds);
    const relations = getForkRelations();
    Object.keys(relations).forEach((key) => {
      if (deletedSet.has(key) || deletedSet.has(relations[key])) {
        delete relations[key];
      }
    });
    saveForkRelations(relations);
  } catch (err) {
    // ignore relation cleanup errors
  }

  return {
    success: true,
    projectName: projectId,
    deletedCount: deletedSessionIds.length
  };
}

// 搜索会话
function searchSessions(keyword, contextLength = 35, projectFilter = null) {
  if (!keyword || !String(keyword).trim()) {
    return [];
  }

  const searchKeyword = String(keyword).trim();
  const projects = getProjects();
  const { loadAliases } = require('./alias');
  const aliases = loadAliases();
  const results = [];

  for (const project of projects) {
    if (projectFilter && project.name !== projectFilter) {
      continue;
    }

    const sessions = getSessionsByProjectId(project.name);
    for (const session of sessions) {
      const matches = [];

      const quickChecks = [
        session.sessionId,
        session.firstMessage,
        session.slug,
        session.directory
      ];
      for (const text of quickChecks) {
        const context = buildContext(text, searchKeyword, contextLength);
        if (context) {
          matches.push({
            role: 'assistant',
            context,
            timestamp: session.mtime
          });
        }
      }

      const messageDir = getMessageDir(session.sessionId);
      if (fs.existsSync(messageDir)) {
        const messageFiles = fs.readdirSync(messageDir)
          .filter(file => file.endsWith('.json'))
          .sort();
        for (const messageFile of messageFiles) {
          const messagePath = path.join(messageDir, messageFile);
          const message = readJsonSafe(messagePath, null);
          if (!message) continue;

          const text = extractTextContent(message.content);
          const context = buildContext(text, searchKeyword, contextLength);
          if (!context) continue;

          matches.push({
            role: message.role === 'user' ? 'user' : 'assistant',
            context,
            timestamp: message.time?.created || null
          });
        }
      }

      if (matches.length > 0) {
        results.push({
          sessionId: session.sessionId,
          projectName: project.name,
          projectDisplayName: project.displayName,
          projectFullPath: project.fullPath,
          alias: aliases[session.sessionId] || null,
          matchCount: matches.length,
          matches: matches.slice(0, 5),
          source: 'opencode'
        });
      }
    }
  }

  return results.sort((a, b) => b.matchCount - a.matchCount);
}

module.exports = {
  isOpenCodeInstalled,
  getOpenCodeDataDir,
  getSessionsDir,
  getProjectsDir,
  getProjects,
  getProjectOrder,
  saveProjectOrder,
  getSessionsByProject,
  getSessionsByProjectId,
  getSessionById,
  getRecentSessions,
  normalizeSession,
  getProjectAndSessionCounts,
  deleteSession,
  deleteProject,
  forkSession,
  getSessionOrder,
  saveSessionOrder,
  searchSessions
};
