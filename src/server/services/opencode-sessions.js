const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { NATIVE_PATHS, PATHS } = require('../../config/paths');

/**
 * OpenCode 会话服务
 * 读取 OpenCode SQLite 会话数据
 */

const PROJECT_ORDER_FILE = PATHS.opencodeProjectOrder;
const SESSION_ORDER_FILE = PATHS.opencodeSessionOrder;
const OPENCODE_DB_PATH = path.join(NATIVE_PATHS.opencode.data, 'opencode.db');
const COUNTS_CACHE_TTL_MS = 30 * 1000;
const EMPTY_COUNTS = Object.freeze({ projectCount: 0, sessionCount: 0 });

let countsCache = {
  expiresAt: 0,
  value: EMPTY_COUNTS
};

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

function parseJsonMaybe(raw, fallback = null) {
  if (typeof raw !== 'string') {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
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

function extractTextFromPartData(partData) {
  if (!partData || typeof partData !== 'object') {
    return '';
  }

  if (typeof partData.text === 'string' && partData.text.trim()) {
    return partData.text.trim();
  }

  if (typeof partData.content === 'string' && partData.content.trim()) {
    return partData.content.trim();
  }

  if (Array.isArray(partData.content)) {
    return partData.content
      .filter(item => item && item.type === 'text' && typeof item.text === 'string')
      .map(item => item.text)
      .join('\n')
      .trim();
  }

  return '';
}

function extractTextFromMessageData(messageData) {
  if (!messageData || typeof messageData !== 'object') {
    return '';
  }

  const contentText = extractTextContent(messageData.content);
  if (contentText) {
    return contentText;
  }

  if (typeof messageData.text === 'string' && messageData.text.trim()) {
    return messageData.text.trim();
  }

  return '';
}

function normalizeTimestampMs(input) {
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value > 1e12 ? value : value * 1000;
}

function toIsoTime(input) {
  const ts = normalizeTimestampMs(input);
  if (!ts) {
    return null;
  }
  try {
    return new Date(ts).toISOString();
  } catch (err) {
    return null;
  }
}

function sqlQuote(value) {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(Math.trunc(value)) : 'NULL';
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runSqliteQuery(sql) {
  if (!isOpenCodeInstalled()) {
    return [];
  }

  try {
    const output = execFileSync('sqlite3', ['-json', OPENCODE_DB_PATH, sql], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true
    }).trim();

    if (!output) {
      return [];
    }

    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[OpenCode Sessions] SQLite query failed:', err.message);
    return [];
  }
}

function runSqliteExec(sql) {
  if (!isOpenCodeInstalled()) {
    throw new Error('OpenCode CLI not installed');
  }

  execFileSync('sqlite3', [OPENCODE_DB_PATH, sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true
  });
}

function buildContext(text, keyword, contextLength = 35) {
  if (!text || !keyword) {
    return null;
  }

  const parsedContextLength = Number(contextLength);
  const safeContextLength = Number.isFinite(parsedContextLength) && parsedContextLength >= 0
    ? parsedContextLength
    : 35;

  const lowerText = String(text).toLowerCase();
  const lowerKeyword = String(keyword).toLowerCase();
  const index = lowerText.indexOf(lowerKeyword);
  if (index === -1) {
    return null;
  }

  const start = Math.max(0, index - safeContextLength);
  const end = Math.min(lowerText.length, index + lowerKeyword.length + safeContextLength);
  let context = String(text).slice(start, end);
  if (start > 0) context = `...${context}`;
  if (end < String(text).length) context = `${context}...`;
  return context;
}

// 检查 OpenCode 是否安装
function isOpenCodeInstalled() {
  return fs.existsSync(OPENCODE_DB_PATH);
}

// 获取 OpenCode 数据目录
function getOpenCodeDataDir() {
  return NATIVE_PATHS.opencode.data;
}

// 兼容导出：保留旧路径函数
function getSessionsDir() {
  return path.join(getOpenCodeDataDir(), 'storage', 'session');
}

// 兼容导出：保留旧路径函数
function getProjectsDir() {
  return path.join(getOpenCodeDataDir(), 'storage', 'project');
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

function invalidateProjectAndSessionCountsCache() {
  countsCache.expiresAt = 0;
}

function queryProjectAndSessionCounts() {
  const rows = runSqliteQuery(`
    SELECT
      (SELECT COUNT(*) FROM project) AS project_count,
      (SELECT COUNT(*) FROM session WHERE time_archived IS NULL) AS session_count
  `);

  const row = rows[0] || {};
  return {
    projectCount: Number(row.project_count) || 0,
    sessionCount: Number(row.session_count) || 0
  };
}

function getProjectRows() {
  return runSqliteQuery(`
    SELECT
      p.id,
      p.worktree,
      p.name,
      p.time_created,
      p.time_updated,
      COALESCE(s.session_count, 0) AS session_count
    FROM project p
    LEFT JOIN (
      SELECT project_id, COUNT(*) AS session_count
      FROM session
      WHERE time_archived IS NULL
      GROUP BY project_id
    ) s ON s.project_id = p.id
  `);
}

function getSessionRowsByProjectId(projectId) {
  return runSqliteQuery(`
    SELECT
      s.id,
      s.project_id,
      s.parent_id,
      s.slug,
      s.directory,
      s.title,
      s.version,
      s.share_url,
      s.summary_additions,
      s.summary_deletions,
      s.summary_files,
      s.summary_diffs,
      s.revert,
      s.permission,
      s.time_created,
      s.time_updated,
      s.time_compacting,
      s.time_archived,
      (
        COALESCE((
          SELECT SUM(length(CAST(COALESCE(m.data, '') AS BLOB)))
          FROM message m
          WHERE m.session_id = s.id
        ), 0) +
        COALESCE((
          SELECT SUM(length(CAST(COALESCE(p.data, '') AS BLOB)))
          FROM part p
          WHERE p.session_id = s.id
        ), 0)
      ) AS size
    FROM session s
    WHERE s.project_id = ${sqlQuote(projectId)}
      AND s.time_archived IS NULL
    ORDER BY s.time_updated DESC
  `);
}

function getSessionRowById(sessionId) {
  const rows = runSqliteQuery(`
    SELECT
      s.id,
      s.project_id,
      s.parent_id,
      s.slug,
      s.directory,
      s.title,
      s.version,
      s.share_url,
      s.summary_additions,
      s.summary_deletions,
      s.summary_files,
      s.summary_diffs,
      s.revert,
      s.permission,
      s.time_created,
      s.time_updated,
      s.time_compacting,
      s.time_archived,
      (
        COALESCE((
          SELECT SUM(length(CAST(COALESCE(m.data, '') AS BLOB)))
          FROM message m
          WHERE m.session_id = s.id
        ), 0) +
        COALESCE((
          SELECT SUM(length(CAST(COALESCE(p.data, '') AS BLOB)))
          FROM part p
          WHERE p.session_id = s.id
        ), 0)
      ) AS size
    FROM session s
    WHERE s.id = ${sqlQuote(sessionId)}
    LIMIT 1
  `);

  return rows[0] || null;
}

function getMessageRowsBySessionId(sessionId) {
  return runSqliteQuery(`
    SELECT
      id,
      session_id,
      time_created,
      time_updated,
      data
    FROM message
    WHERE session_id = ${sqlQuote(sessionId)}
    ORDER BY time_created ASC
  `);
}

function getPartRowsBySessionId(sessionId) {
  return runSqliteQuery(`
    SELECT
      id,
      message_id,
      session_id,
      time_created,
      time_updated,
      data
    FROM part
    WHERE session_id = ${sqlQuote(sessionId)}
    ORDER BY time_created ASC
  `);
}

function normalizeSession(session, projectId = null) {
  const size = Number(session?.size);
  return {
    sessionId: session.id,
    projectName: projectId || session.project_id,
    mtime: toIsoTime(session.time_updated) || new Date().toISOString(),
    size: Number.isFinite(size) && size > 0 ? size : 0,
    filePath: '',
    gitBranch: null,
    firstMessage: session.title || session.slug || null,
    forkedFrom: null,
    directory: session.directory,
    slug: session.slug,
    source: 'opencode'
  };
}

function isSessionLikeName(name) {
  return /^ses_[a-z0-9_-]+$/i.test(name);
}

function getProjectDisplayName(project) {
  const rawName = typeof project?.name === 'string' ? project.name.trim() : '';
  const rawId = typeof project?.id === 'string' ? project.id.trim() : '';
  const worktree = typeof project?.worktree === 'string' ? project.worktree.trim() : '';

  // OpenCode 的 project.name 可能为空或异常写成会话ID，优先回退为目录名。
  if (rawName && rawName !== rawId && !isSessionLikeName(rawName)) {
    return rawName;
  }

  if (worktree) {
    const dirName = path.basename(worktree);
    if (dirName && dirName !== path.sep && dirName !== '.' && dirName !== '..') {
      return dirName;
    }
  }

  return rawName || rawId;
}

// 获取所有项目
function getProjects() {
  const projects = getProjectRows().map((project) => ({
    name: project.id,
    displayName: getProjectDisplayName(project),
    fullPath: project.worktree || '/',
    path: project.worktree || '/',
    sessionCount: Number(project.session_count) || 0,
    lastUsed: Number(project.time_updated) || Number(project.time_created) || 0,
    source: 'opencode'
  }));

  return sortByOrder(
    projects,
    getProjectOrder(),
    (a, b) => (b.lastUsed || 0) - (a.lastUsed || 0)
  );
}

// 根据项目ID获取会话列表
function getSessionsByProjectId(projectId) {
  const sessions = getSessionRowsByProjectId(projectId).map(session => normalizeSession(session, projectId));
  const order = getSessionOrder(projectId);

  const fallbackSorted = sessions.sort(
    (a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime()
  );

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

// 根据项目名获取会话列表
function getSessionsByProject(projectName) {
  return getSessionsByProjectId(projectName);
}

function getSessionLocation(sessionId) {
  const session = getSessionRowById(sessionId);
  if (!session) {
    return null;
  }
  return {
    projectId: session.project_id,
    sessionData: session
  };
}

// 根据会话ID获取会话详情
function getSessionById(sessionId) {
  const location = getSessionLocation(sessionId);
  if (!location) {
    return null;
  }

  return normalizeSession(location.sessionData, location.projectId);
}

function buildSessionMessages(sessionId) {
  const messages = getMessageRowsBySessionId(sessionId);
  const parts = getPartRowsBySessionId(sessionId);

  const partsByMessageId = new Map();
  for (const part of parts) {
    if (!partsByMessageId.has(part.message_id)) {
      partsByMessageId.set(part.message_id, []);
    }
    partsByMessageId.get(part.message_id).push(part);
  }

  const converted = [];

  for (const row of messages) {
    const messageData = parseJsonMaybe(row.data, {});
    const role = messageData?.role;
    if (role !== 'user' && role !== 'assistant') {
      continue;
    }

    const messageParts = partsByMessageId.get(row.id) || [];
    const partTexts = [];
    for (const part of messageParts) {
      const partData = parseJsonMaybe(part.data, null);
      const text = extractTextFromPartData(partData);
      if (text) {
        partTexts.push(text);
      }
    }

    const fallbackText = extractTextFromMessageData(messageData);
    const content = partTexts.join('\n').trim() || fallbackText || '[空消息]';

    const timestamp = toIsoTime(
      messageData?.time?.created || row.time_created || row.time_updated
    );

    converted.push({
      type: role,
      role,
      content,
      timestamp,
      model: role === 'assistant'
        ? (messageData?.model?.modelID || messageData?.modelID || messageData?.model || 'opencode')
        : null
    });
  }

  return converted;
}

function getSessionMessages(sessionId) {
  const location = getSessionLocation(sessionId);
  if (!location) {
    throw new Error('Session not found');
  }

  return buildSessionMessages(sessionId).map(({ type, content, timestamp, model }) => ({
    type,
    content,
    timestamp,
    model
  }));
}

// 获取项目和会话数量统计
function getProjectAndSessionCounts() {
  const now = Date.now();
  if (countsCache.expiresAt > now) {
    return countsCache.value;
  }

  try {
    const counts = queryProjectAndSessionCounts();
    countsCache = {
      value: counts,
      expiresAt: now + COUNTS_CACHE_TTL_MS
    };
    return counts;
  } catch (err) {
    console.error('[OpenCode Sessions] Failed to get counts:', err);
    return countsCache.value || EMPTY_COUNTS;
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

  runSqliteExec(`
    PRAGMA foreign_keys = ON;
    DELETE FROM session WHERE id = ${sqlQuote(sessionId)};
  `);

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

  invalidateProjectAndSessionCountsCache();
  return { success: true, projectName: location.projectId, sessionId };
}

function forkSession(sessionId) {
  const location = getSessionLocation(sessionId);
  if (!location) {
    throw new Error('Session not found');
  }

  const source = location.sessionData;
  const messages = getMessageRowsBySessionId(sessionId);
  const parts = getPartRowsBySessionId(sessionId);
  const now = Date.now();
  const newSessionId = `ses_${crypto.randomUUID().replace(/-/g, '')}`;

  const messageIdMap = new Map();
  for (const message of messages) {
    messageIdMap.set(message.id, `msg_${crypto.randomUUID().replace(/-/g, '')}`);
  }

  const statements = [];
  statements.push('PRAGMA foreign_keys = ON;');
  statements.push('BEGIN IMMEDIATE;');

  statements.push(`
    INSERT INTO session (
      id, project_id, parent_id, slug, directory, title, version, share_url,
      summary_additions, summary_deletions, summary_files, summary_diffs,
      revert, permission, time_created, time_updated, time_compacting, time_archived
    ) VALUES (
      ${sqlQuote(newSessionId)},
      ${sqlQuote(source.project_id)},
      ${sqlQuote(source.parent_id)},
      ${sqlQuote(source.slug)},
      ${sqlQuote(source.directory)},
      ${sqlQuote(source.title)},
      ${sqlQuote(source.version)},
      ${sqlQuote(source.share_url)},
      ${sqlQuote(source.summary_additions)},
      ${sqlQuote(source.summary_deletions)},
      ${sqlQuote(source.summary_files)},
      ${sqlQuote(source.summary_diffs)},
      ${sqlQuote(source.revert)},
      ${sqlQuote(source.permission)},
      ${sqlQuote(now)},
      ${sqlQuote(now)},
      ${sqlQuote(source.time_compacting)},
      NULL
    );
  `);

  for (const message of messages) {
    const newMessageId = messageIdMap.get(message.id);
    const messageData = parseJsonMaybe(message.data, null);

    let serializedData = message.data;
    if (messageData && typeof messageData === 'object') {
      if (typeof messageData.parentID === 'string' && messageIdMap.has(messageData.parentID)) {
        messageData.parentID = messageIdMap.get(messageData.parentID);
      }
      if (typeof messageData.id === 'string') {
        messageData.id = newMessageId;
      }
      serializedData = JSON.stringify(messageData);
    }

    statements.push(`
      INSERT INTO message (id, session_id, time_created, time_updated, data)
      VALUES (
        ${sqlQuote(newMessageId)},
        ${sqlQuote(newSessionId)},
        ${sqlQuote(message.time_created)},
        ${sqlQuote(message.time_updated)},
        ${sqlQuote(serializedData)}
      );
    `);
  }

  for (const part of parts) {
    const newPartId = `prt_${crypto.randomUUID().replace(/-/g, '')}`;
    const targetMessageId = messageIdMap.get(part.message_id);
    if (!targetMessageId) {
      continue;
    }

    statements.push(`
      INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
      VALUES (
        ${sqlQuote(newPartId)},
        ${sqlQuote(targetMessageId)},
        ${sqlQuote(newSessionId)},
        ${sqlQuote(part.time_created)},
        ${sqlQuote(part.time_updated)},
        ${sqlQuote(part.data)}
      );
    `);
  }

  statements.push('COMMIT;');

  runSqliteExec(statements.join('\n'));

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

  invalidateProjectAndSessionCountsCache();
  return {
    success: true,
    newSessionId,
    forkedFrom: sessionId,
    projectName: location.projectId,
    newFilePath: null
  };
}

function deleteProject(projectId) {
  const projectRows = runSqliteQuery(`
    SELECT id FROM project WHERE id = ${sqlQuote(projectId)} LIMIT 1
  `);

  if (projectRows.length === 0) {
    throw new Error('Project not found');
  }

  const sessionRows = runSqliteQuery(`
    SELECT id FROM session WHERE project_id = ${sqlQuote(projectId)}
  `);

  const deletedSessionIds = sessionRows.map(row => row.id);

  for (const sessionId of deletedSessionIds) {
    try {
      const { deleteAlias } = require('./alias');
      deleteAlias(sessionId);
    } catch (err) {
      // ignore alias cleanup errors
    }
  }

  runSqliteExec(`
    PRAGMA foreign_keys = ON;
    DELETE FROM project WHERE id = ${sqlQuote(projectId)};
  `);

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

  invalidateProjectAndSessionCountsCache();
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

      const sessionMessages = buildSessionMessages(session.sessionId);
      for (const message of sessionMessages) {
        const context = buildContext(message.content, searchKeyword, contextLength);
        if (!context) {
          continue;
        }

        matches.push({
          role: message.role,
          context,
          timestamp: message.timestamp
        });
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
  getSessionMessages,
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
