const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { NATIVE_PATHS, PATHS } = require('../../../config/paths');

/**
 * OpenCode 会话服务
 * 读取 OpenCode SQLite 会话数据（node:sqlite / DatabaseSync）
 */

const PROJECT_ORDER_FILE = PATHS.opencodeProjectOrder;
const SESSION_ORDER_FILE = PATHS.opencodeSessionOrder;
const OPENCODE_DB_PATH = path.join(NATIVE_PATHS.opencode.data, 'opencode.db');

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

// ---------------------------------------------------------------------------
// Database helpers (node:sqlite / DatabaseSync)
// ---------------------------------------------------------------------------

function _openCodeDb() {
  if (!isOpenCodeInstalled()) return null;
  const db = new DatabaseSync(OPENCODE_DB_PATH, { readOnly: false, timeout: 5000 });
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

function _query(sql, ...params) {
  const db = _openCodeDb();
  if (!db) return [];
  try {
    return db.prepare(sql).all(...params);
  } catch (err) {
    console.error('[OpenCode Sessions] SQLite query failed:', err.message);
    return [];
  }
}

function _exec(sql, ...params) {
  const db = _openCodeDb();
  if (!db) throw new Error('OpenCode CLI not installed');
  db.prepare(sql).run(...params);
}

function buildContext(text, keyword, contextLength = 35) {
  if (!text || !keyword) {
    return null;
  }
  const lower = text.toLowerCase();
  const idx = lower.indexOf(keyword.toLowerCase());
  if (idx === -1) {
    return null;
  }
  const start = Math.max(0, idx - contextLength);
  const end = Math.min(text.length, idx + keyword.length + contextLength);
  let context = text.slice(start, end);
  if (start > 0) context = '...' + context;
  if (end < text.length) context = context + '...';
  return context;
}

// 检查 OpenCode 是否安装
function isOpenCodeInstalled() {
  return fs.existsSync(OPENCODE_DB_PATH);
}


// ---------------------------------------------------------------------------
// Project / session order (file-based)
// ---------------------------------------------------------------------------

function getProjectOrder() {
  return readJsonSafe(PROJECT_ORDER_FILE, []).order || [];
}

function saveProjectOrder(order) {
  writeJsonSafe(PROJECT_ORDER_FILE, { order: Array.isArray(order) ? order : [] });
}

function removeProjectFromOrder(projectId) {
  const current = getProjectOrder();
  saveProjectOrder(current.filter(id => id !== projectId));
}

function getSessionOrder(projectId) {
  const all = readJsonSafe(SESSION_ORDER_FILE, {}).order || {};
  return all[projectId] || [];
}

function saveSessionOrder(projectId, order) {
  const all = readJsonSafe(SESSION_ORDER_FILE, {}).order || {};
  all[projectId] = Array.isArray(order) ? order : [];
  writeJsonSafe(SESSION_ORDER_FILE, { order: all });
}

function removeSessionFromOrder(projectId, sessionId) {
  const current = getSessionOrder(projectId);
  saveSessionOrder(projectId, current.filter(id => id !== sessionId));
}

// ---------------------------------------------------------------------------
// Metadata helpers
// ---------------------------------------------------------------------------

function getProjectDisplayName(project) {
  if (!project) return 'Unknown';
  const worktree = project.worktree || '';
  if (worktree) {
    const parsed = parseJsonMaybe(project.data);
    if (parsed && typeof parsed.name === 'string' && parsed.name.trim()) {
      return parsed.name.trim();
    }
    return path.basename(worktree);
  }
  return project.id || 'Unknown';
}

function getSessionLocation(sessionId) {
  const row = getSessionRowById(sessionId);
  if (!row) return null;
  return { projectId: row.project_id, directory: row.directory, sessionData: row };
}

// ---------------------------------------------------------------------------
// Database query functions (parameterized)
// ---------------------------------------------------------------------------


function getProjectRows() {
  return _query(`
    SELECT
      p.id,
      p.worktree,
      p.time_created,
      p.time_updated,
      p.time_archived,
      p.data,
      (SELECT COUNT(*) FROM session s WHERE s.project_id = p.id AND s.time_archived IS NULL) AS session_count
    FROM project p
    ORDER BY p.time_updated DESC
  `);
}

function getSessionRowsByProjectId(projectId) {
  return _query(`
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
      s.time_archived
    FROM session s
    WHERE s.project_id = ?
      AND s.time_archived IS NULL
    ORDER BY s.time_updated DESC
  `, projectId);
}

function getSessionRowById(sessionId) {
  const rows = _query(`
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
      s.time_archived
    FROM session s
    WHERE s.id = ?
    LIMIT 1
  `, sessionId);
  return rows.length > 0 ? rows[0] : null;
}

function getMessageRowsBySessionId(sessionId) {
  return _query(`
    SELECT
      id,
      session_id,
      time_created,
      time_updated,
      data
    FROM message
    WHERE session_id = ?
    ORDER BY time_created ASC
  `, sessionId);
}

function getPartRowsBySessionId(sessionId) {
  return _query(`
    SELECT
      id,
      message_id,
      session_id,
      time_created,
      time_updated,
      data
    FROM part
    WHERE session_id = ?
    ORDER BY time_created ASC
  `, sessionId);
}

function normalizeSession(session, projectId) {
  return {
    sessionId: session.id,
    mtime: toIsoTime(session.time_updated) || new Date().toISOString(),
    size: 0, // SQLite doesn't track file size natively
    filePath: `opencode://${projectId}/${session.id}`,
    gitBranch: null,
    firstMessage: session.title || null,
    forkedFrom: session.parent_id || null,
    source: 'opencode',
    directory: session.directory || null,
    slug: session.slug || null,
    model: null,
    provider: null,
    projectName: projectId,
    projectFullPath: null
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function getProjects(_options = {}) {
  const projects = getProjectRows().map((project) => ({
    name: project.id,
    displayName: getProjectDisplayName(project),
    fullPath: project.worktree || '/',
    path: project.worktree || '/',
    sessionCount: Number(project.session_count) || 0,
    lastUsed: toIsoTime(project.time_updated),
    source: 'opencode'
  }));

  const order = getProjectOrder();
  return sortByOrder(projects, order, (a, b) => (b.lastUsed || '').localeCompare(a.lastUsed || ''));
}

function getSessionsByProjectId(projectId, _options = {}) {
  const sessions = getSessionRowsByProjectId(projectId).map(session => normalizeSession(session, projectId));
  const order = getSessionOrder(projectId);

  const fallbackSorted = sessions.sort(
    (a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime()
  );

  return sortByOrder(fallbackSorted, order, (a, b) =>
    new Date(b.mtime).getTime() - new Date(a.mtime).getTime()
  );
}

function searchSessions(keyword) {
  if (!keyword || !keyword.trim()) return [];
  const lowerKeyword = keyword.toLowerCase();

  const allSessions = [];
  const projects = getProjectRows();
  for (const project of projects) {
    const sessions = getSessionRowsByProjectId(project.id);
    for (const session of sessions) {
      const messages = getMessageRowsBySessionId(session.id);
      const parts = getPartRowsBySessionId(session.id);

      const matchedMessages = [];
      const partsByMessageId = new Map();
      for (const part of parts) {
        const existing = partsByMessageId.get(part.message_id) || [];
        existing.push(part);
        partsByMessageId.set(part.message_id, existing);
      }

      for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        const data = parseJsonMaybe(message.data, null);
        let text = '';

        if (data && data.role === 'user') {
          text = extractTextFromMessageData(data);
        } else {
          const messageParts = partsByMessageId.get(message.id) || [];
          for (const part of messageParts) {
            const partData = parseJsonMaybe(part.data, null);
            text += (text ? '\n' : '') + extractTextFromPartData(partData);
          }
        }

        if (text.toLowerCase().includes(lowerKeyword)) {
          matchedMessages.push({
            messageIndex: i,
            role: data ? (data.role || 'unknown') : 'unknown',
            context: buildContext(text, keyword),
            timestamp: toIsoTime(message.time_created)
          });
        }
      }

      if (matchedMessages.length > 0) {
        allSessions.push({
          sessionId: session.id,
          projectName: project.id,
          projectDisplayName: getProjectDisplayName(project),
          firstMessage: session.title || null,
          matches: matchedMessages,
          matchCount: matchedMessages.length,
          source: 'opencode'
        });
      }
    }
  }

  return allSessions.sort((a, b) => b.matchCount - a.matchCount);
}

function getRecentSessions(limit = 5) {
  const allSessions = [];

  const projects = getProjectRows();
  for (const project of projects) {
    const sessions = getSessionRowsByProjectId(project.id);
    for (const session of sessions) {
      allSessions.push({
        ...normalizeSession(session, project.id),
        projectDisplayName: getProjectDisplayName(project),
        projectFullPath: project.worktree || null
      });
    }
  }

  return allSessions
    .sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime())
    .slice(0, limit);
}

function getSessionById(sessionId) {
  const location = getSessionLocation(sessionId);
  if (!location) return null;

  const messages = buildSessionMessages(sessionId);
  return {
    sessionId,
    mtime: toIsoTime(location.sessionData.time_updated) || new Date().toISOString(),
    size: 0,
    filePath: `opencode://${location.projectId}/${sessionId}`,
    source: 'opencode',
    directory: location.directory || null,
    projectName: location.projectId,
    messages
  };
}

function buildSessionMessages(sessionId) {
  const messages = getMessageRowsBySessionId(sessionId);
  const parts = getPartRowsBySessionId(sessionId);

  const partsByMessageId = new Map();
  for (const part of parts) {
    const existing = partsByMessageId.get(part.message_id) || [];
    existing.push(part);
    partsByMessageId.set(part.message_id, existing);
  }

  return messages.map((message) => {
    const data = parseJsonMaybe(message.data, null);
    const messageParts = partsByMessageId.get(message.id) || [];

    let content = '';
    if (data && data.role === 'user') {
      content = extractTextFromMessageData(data);
    } else if (messageParts.length > 0) {
      content = messageParts
        .map(part => {
          const partData = parseJsonMaybe(part.data, null);
          return extractTextFromPartData(partData);
        })
        .filter(Boolean)
        .join('\n');
    }

    return {
      id: message.id,
      role: data ? (data.role || 'unknown') : 'unknown',
      type: data ? (data.role || 'unknown') : 'unknown',
      content,
      timestamp: toIsoTime(message.time_created),
      model: data ? (data.model || null) : null,
      parts: messageParts.map(part => ({
        id: part.id,
        data: parseJsonMaybe(part.data, null)
      }))
    };
  });
}

// 删除会话
function deleteSession(sessionId) {
  const location = getSessionLocation(sessionId);
  if (!location) {
    throw new Error('Session not found');
  }

  _exec(
    `DELETE FROM session WHERE id = ?`,
    sessionId
  );

  try {
    const { deleteAlias } = require('../../../server/services/alias');
    deleteAlias(sessionId);
  } catch (err) {
    // ignore alias cleanup errors
  }

  removeSessionFromOrder(location.projectId, sessionId);

  try {
    const { getForkRelations, saveForkRelations } = require('../claude/sessions-implementation');
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

  const source = location.sessionData;
  const messages = getMessageRowsBySessionId(sessionId);
  const parts = getPartRowsBySessionId(sessionId);
  const now = Date.now();
  const newSessionId = `ses_${crypto.randomUUID().replace(/-/g, '')}`;
  const db = _openCodeDb();
  if (!db) throw new Error('OpenCode CLI not installed');

  const messageIdMap = new Map();
  for (const message of messages) {
    messageIdMap.set(message.id, `msg_${crypto.randomUUID().replace(/-/g, '')}`);
  }

  db.exec('BEGIN IMMEDIATE');

  try {
    db.prepare(`
      INSERT INTO session (
        id, project_id, parent_id, slug, directory, title, version, share_url,
        summary_additions, summary_deletions, summary_files, summary_diffs,
        revert, permission, time_created, time_updated, time_compacting, time_archived
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      newSessionId,
      source.project_id,
      source.parent_id,
      source.slug,
      source.directory,
      source.title,
      source.version,
      source.share_url,
      source.summary_additions,
      source.summary_deletions,
      source.summary_files,
      source.summary_diffs,
      source.revert,
      source.permission,
      now,
      now,
      source.time_compacting
    );

    const insertMessageStmt = db.prepare(
      `INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`
    );
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

      insertMessageStmt.run(
        newMessageId,
        newSessionId,
        message.time_created,
        message.time_updated,
        serializedData
      );
    }

    const insertPartStmt = db.prepare(
      `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const part of parts) {
      const newPartId = `prt_${crypto.randomUUID().replace(/-/g, '')}`;
      const targetMessageId = messageIdMap.get(part.message_id);
      if (!targetMessageId) continue;

      insertPartStmt.run(
        newPartId,
        targetMessageId,
        newSessionId,
        part.time_created,
        part.time_updated,
        part.data
      );
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw new Error('Failed to fork session: ' + err.message);
  }

  try {
    const { getForkRelations, saveForkRelations } = require('../claude/sessions-implementation');
    const relations = getForkRelations();
    relations[newSessionId] = sessionId;
    saveForkRelations(relations);
  } catch (err) {
    // ignore
  }

  return { success: true, sessionId: newSessionId, forkedFrom: sessionId };
}

function deleteProject(projectId) {
  const projectRows = _query(
    `SELECT id FROM project WHERE id = ? LIMIT 1`,
    projectId
  );

  if (projectRows.length === 0) {
    throw new Error('Project not found');
  }

  const sessionRows = _query(
    `SELECT id FROM session WHERE project_id = ?`,
    projectId
  );

  const deletedSessionIds = sessionRows.map(row => row.id);

  try {
    const { deleteAlias } = require('../../../server/services/alias');
    deletedSessionIds.forEach(id => {
      try { deleteAlias(id); } catch (_) {}
    });
  } catch (_) {}

  _exec(`DELETE FROM project WHERE id = ?`, projectId);

  removeProjectFromOrder(projectId);
  return { success: true, projectId, deletedSessions: deletedSessionIds.length };
}

function getProjectAndSessionCounts(options = {}) {
  const projects = getProjects(options);
  return {
    projectCount: projects.length,
    sessionCount: projects.reduce((sum, project) => sum + project.sessionCount, 0)
  };
}

module.exports = {
  isOpenCodeInstalled,
  getProjects,
  getSessionsByProjectId,
  getSessionById,
  searchSessions,
  getRecentSessions,
  deleteSession,
  forkSession,
  deleteProject,
  saveProjectOrder,
  saveSessionOrder,
  getProjectAndSessionCounts,
  _query,  // exposed for testing
  _openCodeDb // exposed for testing
};
