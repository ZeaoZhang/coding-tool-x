const fs = require('fs');
const path = require('path');
const { NATIVE_PATHS } = require('../../config/paths');

/**
 * OpenCode 会话服务
 * 读取 OpenCode CLI 的原生会话数据
 */

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

// 获取所有项目
function getProjects() {
  const projectsDir = getProjectsDir();
  const projects = [];

  if (!fs.existsSync(projectsDir)) {
    return projects;
  }

  const files = fs.readdirSync(projectsDir);

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const filePath = path.join(projectsDir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const project = JSON.parse(content);

      // 获取该项目下的会话数量
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
    } catch (err) {
      console.error(`[OpenCode Sessions] Failed to parse project file ${file}:`, err);
    }
  }

  // 按最后使用时间排序
  return projects.sort((a, b) => b.lastUsed - a.lastUsed);
}

// 根据项目ID获取会话列表
function getSessionsByProjectId(projectId) {
  const sessionsDir = path.join(getSessionsDir(), projectId);
  const sessions = [];

  if (!fs.existsSync(sessionsDir)) {
    return sessions;
  }

  const files = fs.readdirSync(sessionsDir);

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const filePath = path.join(sessionsDir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const session = JSON.parse(content);

      sessions.push(normalizeSession(session, filePath));
    } catch (err) {
      console.error(`[OpenCode Sessions] Failed to parse session file ${file}:`, err);
    }
  }

  // 按更新时间排序
  return sessions.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
}

// 归一化会话格式（与 Claude Code 格式一致）
function normalizeSession(session, filePath) {
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

// 根据会话ID获取会话详情
function getSessionById(sessionId) {
  const sessionsDir = getSessionsDir();

  if (!fs.existsSync(sessionsDir)) {
    return null;
  }

  // 遍历所有项目目录查找会话
  const projectDirs = fs.readdirSync(sessionsDir, { withFileTypes: true });

  for (const projectDir of projectDirs) {
    if (!projectDir.isDirectory()) continue;

    const projectPath = path.join(sessionsDir, projectDir.name);
    const sessionFile = `${sessionId}.json`;
    const sessionPath = path.join(projectPath, sessionFile);

    if (fs.existsSync(sessionPath)) {
      try {
        const content = fs.readFileSync(sessionPath, 'utf8');
        const session = JSON.parse(content);
        return normalizeSession(session, sessionPath);
      } catch (err) {
        console.error(`[OpenCode Sessions] Failed to read session ${sessionId}:`, err);
      }
    }
  }

  return null;
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

// 删除会话
function deleteSession(sessionId) {
  const sessionsDir = getSessionsDir();

  if (!fs.existsSync(sessionsDir)) {
    throw new Error('Sessions directory not found');
  }

  const projectDirs = fs.readdirSync(sessionsDir, { withFileTypes: true });

  for (const projectDir of projectDirs) {
    if (!projectDir.isDirectory()) continue;

    const projectPath = path.join(sessionsDir, projectDir.name);
    const sessionFile = `${sessionId}.json`;
    const sessionPath = path.join(projectPath, sessionFile);

    if (fs.existsSync(sessionPath)) {
      fs.unlinkSync(sessionPath);
      return { success: true };
    }
  }

  throw new Error('Session not found');
}

// 搜索会话
function searchSessions(keyword) {
  const projects = getProjects();
  const results = [];

  for (const project of projects) {
    const sessions = getSessionsByProjectId(project.name);

    for (const session of sessions) {
      const searchText = [
        session.sessionId,
        session.firstMessage,
        session.slug,
        session.directory
      ].filter(Boolean).join(' ').toLowerCase();

      if (searchText.includes(keyword.toLowerCase())) {
        results.push({
          ...session,
          projectName: project.name,
          projectDisplayName: project.displayName,
          source: 'opencode'
        });
      }
    }
  }

  return results;
}

module.exports = {
  isOpenCodeInstalled,
  getOpenCodeDataDir,
  getSessionsDir,
  getProjectsDir,
  getProjects,
  getSessionsByProject,
  getSessionsByProjectId,
  getSessionById,
  normalizeSession,
  getProjectAndSessionCounts,
  deleteSession,
  searchSessions
};
