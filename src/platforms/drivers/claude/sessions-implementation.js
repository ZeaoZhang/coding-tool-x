const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { getAllSessions, parseSessionInfoFast } = require('../../../utils/session');
const { loadAliases, setAlias } = require('../../../server/services/alias');
const { globalCache, CacheKeys } = require('../../../server/services/enhanced-cache');
let sessionHistoryIndex = null;

function configure({ sessionHistoryIndex: index } = {}) {
  sessionHistoryIndex = index || null;
}

function getSessionHistoryIndex(config = {}) {
  if (!sessionHistoryIndex) {
    const { getDefaultDependencies } = require('../../../platforms/runtime');
    sessionHistoryIndex = getDefaultDependencies().sessionHistoryIndex;
    if (!sessionHistoryIndex) {
      const indexModule = require('../../../server/services/session-history-index');
      sessionHistoryIndex = Object.keys(config).length > 0
        ? indexModule.createSessionHistoryIndex({ config })
        : indexModule;
    }
  }
  return sessionHistoryIndex;
}
const { PATHS, NATIVE_PATHS } = require('../../../config/paths');

const CLAUDE_PROJECTS_DIR = NATIVE_PATHS.claude.projects;
const CODEX_PROJECTS_DIR = path.join(path.dirname(NATIVE_PATHS.codex.config), 'projects');
const GEMINI_PROJECTS_DIR = path.join(path.dirname(NATIVE_PATHS.gemini.env), 'projects');

function resolveProjectsDir(config = {}) {
  return config.projectsDir || CLAUDE_PROJECTS_DIR;
}

function withResolvedProjectsDir(config = {}) {
  return { ...config, projectsDir: resolveProjectsDir(config) };
}

function getCcToolDir() { return PATHS.base; }
function getOrderFilePath() { return PATHS.projectOrder; }
function getForkRelationsFilePath() { return PATHS.forkRelations; }
function getSessionOrderFilePath() { return PATHS.sessionOrder; }

function readSessionCwd(config = {}, sessionId) {
  const sessionFile = path.join(
    resolveProjectsDir(config),
    config.currentProject || '',
    `${sessionId}.jsonl`
  );
  let fd;
  try {
    fd = fs.openSync(sessionFile, 'r');
    const buffer = Buffer.alloc(2048);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n').slice(0, 5);
    for (const line of lines) {
      try {
        const value = JSON.parse(line);
        if (typeof value.cwd === 'string' && value.cwd.trim()) return value.cwd;
      } catch (_) {
        // 忽略无效的会话元数据
      }
    }
  } catch (_) {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch (_) {
        // 忽略文件关闭错误
      }
    }
  }
  return null;
}

function resolveLaunchCwd(config, sessionId, cwd) {
  const candidate = typeof cwd === 'string' && cwd.trim()
    ? cwd
    : readSessionCwd(config, sessionId);
  if (candidate) {
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch (_) {
      // 使用当前目录
    }
  }
  return process.cwd();
}

function launch(sessionId, {
  fork = false,
  config = {},
  cwd,
  processRunner = spawnSync
} = {}) {
  const normalizedSessionId = String(sessionId || '');
  const args = ['-r', normalizedSessionId];
  if (fork) args.push('--fork-session');
  const launchCwd = resolveLaunchCwd(config, normalizedSessionId, cwd);
  const result = processRunner('claude', args, {
    cwd: launchCwd,
    stdio: 'inherit',
    windowsHide: true
  });
  if (result?.error) {
    throw result.error instanceof Error ? result.error : new Error(String(result.error));
  }
  return {
    ...(result && typeof result === 'object' ? result : {}),
    status: result?.status ?? 0,
    signal: result?.signal || null,
    cwd: launchCwd,
    args
  };
}

function getProjectOrder(config) {
  const orderFile = getOrderFilePath();
  try { if (fs.existsSync(orderFile)) return JSON.parse(fs.readFileSync(orderFile, 'utf8')); } catch (_) {}
  return [];
}

function saveProjectOrder(config, order) {
  const orderFile = getOrderFilePath();
  const dir = path.dirname(orderFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(orderFile, JSON.stringify(order, null, 2), 'utf8');
}

function getForkRelations() {
  const relationsFile = getForkRelationsFilePath();
  try { if (fs.existsSync(relationsFile)) return JSON.parse(fs.readFileSync(relationsFile, 'utf8')); } catch (_) {}
  return {};
}

function saveForkRelations(relations) {
  const relationsFile = getForkRelationsFilePath();
  const dir = path.dirname(relationsFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(relationsFile, JSON.stringify(relations, null, 2), 'utf8');
}

function invalidateSessionResultCache(projectName) {
  if (!projectName) return;
  globalCache.delete(`${CacheKeys.SESSIONS}${projectName}`);
}

function getClaudeForkMessageText(content) {
  if (typeof content === 'string') return content === 'Warmup' ? '' : content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const item of content) {
    if (item?.type === 'text' && item.text) parts.push(item.text);
    else if (item?.type === 'image') parts.push('[图片]');
  }
  return parts.join('\n\n').trim();
}

function splitTextPreserveEol(content) {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const hasTrailingEol = content.endsWith('\r\n') || content.endsWith('\n');
  return { lines: content.split(/\r?\n/), eol, hasTrailingEol };
}

function joinTextPreserveEol(lines, eol, hasTrailingEol) {
  const text = lines.join(eol);
  return hasTrailingEol ? `${text}${eol}` : text;
}

function sliceClaudeSessionContentByUserMessage(content, afterUserMessageNumber) {
  if (!Number.isInteger(afterUserMessageNumber) || afterUserMessageNumber <= 0) return content;
  const { lines, eol, hasTrailingEol } = splitTextPreserveEol(content);
  const keptLines = [];
  let matchedUserMessages = 0;
  let targetUserReached = false;
  for (const line of lines) {
    if (!line.trim()) { keptLines.push(line); continue; }
    let json;
    try { json = JSON.parse(line); } catch (_) { keptLines.push(line); continue; }
    if (json.type !== 'user') { keptLines.push(line); continue; }
    const userText = getClaudeForkMessageText(json.message?.content);
    if (!userText) { keptLines.push(line); continue; }
    if (targetUserReached) return joinTextPreserveEol(keptLines, eol, hasTrailingEol);
    matchedUserMessages += 1;
    keptLines.push(line);
    if (matchedUserMessages >= afterUserMessageNumber) targetUserReached = true;
  }
  if (targetUserReached) return joinTextPreserveEol(keptLines, eol, hasTrailingEol);
  throw new Error(`afterUserMessageNumber ${afterUserMessageNumber} exceeds available user messages (${matchedUserMessages})`);
}

// ===== Read-side: all project/list/session/recent/search delegate to session-history-index =====

async function getProjects(config = {}, options = {}) {
  const indexed = await getSessionHistoryIndex(config).listProjects('claude', { ...options, config });
  return indexed.map(p => p.name);
}

async function getProjectsWithStats(config = {}, options = {}) {
  return getSessionHistoryIndex(config).listProjects('claude', { ...options, config });
}

// ===== Path resolution helpers (kept for mutation/conversion paths) =====

function parseRealProjectPath(encodedName, config = {}) {
  const isWindows = process.platform === 'win32';
  const fallbackFromSessions = tryResolvePathFromSessions(encodedName, config);
  const windowsDriveMatch = encodedName.match(/^([A-Z])--(.+)$/);

  if (isWindows && windowsDriveMatch) {
    const driveLetter = windowsDriveMatch[1];
    const restPath = windowsDriveMatch[2];
    const segments = restPath.split('-').filter(s => s);
    let realSegments = [];
    let accumulated = '';
    let currentPath = '';

    for (let i = 0; i < segments.length; i++) {
      if (accumulated) accumulated += '-' + segments[i];
      else accumulated = segments[i];
      const testPath = driveLetter + ':\\' + realSegments.concat(accumulated).join('\\');
      let found = fs.existsSync(testPath);
      let finalAccumulated = accumulated;
      if (!found && accumulated.includes('-')) {
        const withUnderscore = accumulated.replace(/-/g, '_');
        const testPathUnderscore = driveLetter + ':\\' + realSegments.concat(withUnderscore).join('\\');
        if (fs.existsSync(testPathUnderscore)) { finalAccumulated = withUnderscore; found = true; }
      }
      if (found) { realSegments.push(finalAccumulated); accumulated = ''; currentPath = driveLetter + ':\\' + realSegments.join('\\'); }
    }

    if (accumulated) {
      let finalAccumulated = accumulated;
      if (accumulated.includes('-')) {
        const withUnderscore = accumulated.replace(/-/g, '_');
        const testPath = driveLetter + ':\\' + realSegments.concat(withUnderscore).join('\\');
        if (fs.existsSync(testPath)) finalAccumulated = withUnderscore;
      }
      realSegments.push(finalAccumulated);
      currentPath = driveLetter + ':\\' + realSegments.join('\\');
    }

    return {
      fullPath: validateProjectPath(currentPath) || fallbackFromSessions?.fullPath || (driveLetter + ':\\' + restPath.replace(/-/g, '\\')),
      projectName: fallbackFromSessions?.projectName || realSegments[realSegments.length - 1] || encodedName
    };
  }

  const pathStr = encodedName.replace(/^-/, '/').replace(/-/g, '/');
  const segments = pathStr.split('/').filter(s => s);
  let currentPath = '';
  const realSegments = [];
  let accumulated = '';

  for (let i = 0; i < segments.length; i++) {
    if (accumulated) accumulated += '-' + segments[i];
    else accumulated = segments[i];
    const testPath = '/' + realSegments.concat(accumulated).join('/');
    let found = fs.existsSync(testPath);
    let finalAccumulated = accumulated;
    if (!found && accumulated.includes('-')) {
      const withUnderscore = accumulated.replace(/-/g, '_');
      const testPathUnderscore = '/' + realSegments.concat(withUnderscore).join('/');
      if (fs.existsSync(testPathUnderscore)) { finalAccumulated = withUnderscore; found = true; }
    }
    if (found) { realSegments.push(finalAccumulated); accumulated = ''; currentPath = '/' + realSegments.join('/'); }
  }

  if (accumulated) {
    let finalAccumulated = accumulated;
    if (accumulated.includes('-')) {
      const withUnderscore = accumulated.replace(/-/g, '_');
      const testPath = '/' + realSegments.concat(withUnderscore).join('/');
      if (fs.existsSync(testPath)) finalAccumulated = withUnderscore;
    }
    realSegments.push(finalAccumulated);
    currentPath = '/' + realSegments.join('/');
  }

  return {
    fullPath: validateProjectPath(currentPath) || fallbackFromSessions?.fullPath || pathStr,
    projectName: fallbackFromSessions?.projectName || realSegments[realSegments.length - 1] || encodedName
  };
}

function validateProjectPath(candidatePath) {
  return (candidatePath && fs.existsSync(candidatePath)) ? candidatePath : null;
}

function tryResolvePathFromSessions(encodedName, config = {}) {
  try {
    const projectDir = path.join(resolveProjectsDir(config), encodedName);
    if (!fs.existsSync(projectDir)) return null;
    const files = fs.readdirSync(projectDir).filter(f => f.endsWith('.jsonl'));
    for (const file of files) {
      const sessionFile = path.join(projectDir, file);
      const cwd = extractCwdFromSessionHeader(sessionFile);
      if (cwd && fs.existsSync(cwd)) return { fullPath: cwd, projectName: path.basename(cwd) };
    }
  } catch (_) {}
  return null;
}

function extractCwdFromSessionHeader(sessionFile) {
  try {
    const fd = fs.openSync(sessionFile, 'r');
    const buffer = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, buffer, 0, 4096, 0);
    fs.closeSync(fd);
    const content = buffer.slice(0, bytesRead).toString('utf8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try { const json = JSON.parse(line); if (json.cwd && typeof json.cwd === 'string') return json.cwd; } catch (_) {}
    }
  } catch (_) {}
  return null;
}

// ===== Counts: delegates to index =====

async function getProjectAndSessionCounts(config = {}, options = {}) {
  const projects = await getSessionHistoryIndex().listProjects('claude', { ...options, config });
  let sessionCount = 0;
  for (const project of projects) sessionCount += project.sessionCount || 0;
  return { projectCount: projects.length, sessionCount };
}

// ===== Sessions for project: index + saved order + fork relations =====

async function getSessionsForProject(config, projectName, options = {}) {
  const indexed = await getSessionHistoryIndex().listSessions('claude', projectName, { ...options, config });
  const forkRelations = getForkRelations();
  const savedOrder = getSessionOrder(projectName);
  let sessions = indexed.map(s => ({
    sessionId: s.sessionId,
    mtime: s.mtime,
    size: s.size,
    filePath: s.filePath,
    gitBranch: s.gitBranch || null,
    firstMessage: s.firstMessage || null,
    forkedFrom: forkRelations[s.sessionId] || null
  }));

  if (savedOrder.length > 0) {
    const sm = new Map(sessions.map(s => [s.sessionId, s]));
    const ordered = [];
    for (const sid of savedOrder) {
      if (sm.has(sid)) { ordered.push(sm.get(sid)); sm.delete(sid); }
    }
    ordered.push(...sm.values());
    sessions = ordered;
  }

  const totalSize = sessions.reduce((sum, s) => sum + (s.size || 0), 0);
  return { sessions, totalSize };
}
// ===== Mutations (sync) =====

function deleteSession(config, projectName, sessionId) {
  const resolvedConfig = withResolvedProjectsDir(config);
  const projectDir = path.join(resolvedConfig.projectsDir, projectName);
  const filePath = path.join(projectDir, sessionId + '.jsonl');
  if (!fs.existsSync(filePath)) throw new Error('Session not found');
  fs.unlinkSync(filePath);
  invalidateSessionResultCache(projectName);
  return { success: true };
}

function forkSession(config, projectName, sessionId, options = {}) {
  const resolvedConfig = withResolvedProjectsDir(config);
  const projectDir = path.join(resolvedConfig.projectsDir, projectName);
  const sourcePath = path.join(projectDir, sessionId + '.jsonl');
  if (!fs.existsSync(sourcePath)) throw new Error('Session not found');
  const forkId = crypto.randomUUID();
  const targetPath = path.join(projectDir, forkId + '.jsonl');
  let content;
  if (options.afterUserMessageNumber && Number.isInteger(options.afterUserMessageNumber) && options.afterUserMessageNumber > 0) {
    content = sliceClaudeSessionContentByUserMessage(fs.readFileSync(sourcePath, 'utf8'), options.afterUserMessageNumber);
  } else {
    content = fs.readFileSync(sourcePath, 'utf8');
  }
  fs.writeFileSync(targetPath, content, 'utf8');
  const forkRelations = getForkRelations();
  forkRelations[forkId] = sessionId;
  saveForkRelations(forkRelations);
  if (options.alias) setAlias(forkId, options.alias);
  invalidateSessionResultCache(projectName);
  return {
    newSessionId: forkId,
    forkedFrom: sessionId,
    alias: options.alias || null,
    afterUserMessageNumber: options.afterUserMessageNumber || null
  };
}

function getSessionOrder(projectName) {
  const orderFile = getSessionOrderFilePath();
  try {
    if (fs.existsSync(orderFile)) {
      const data = JSON.parse(fs.readFileSync(orderFile, 'utf8'));
      return data[projectName] || [];
    }
  } catch (_) {}
  return [];
}

function saveSessionOrder(projectName, order) {
  const orderFile = getSessionOrderFilePath();
  const dir = path.dirname(orderFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let data = {};
  try { if (fs.existsSync(orderFile)) data = JSON.parse(fs.readFileSync(orderFile, 'utf8')); } catch (_) {}
  data[projectName] = order;
  fs.writeFileSync(orderFile, JSON.stringify(data, null, 2), 'utf8');
}

function deleteProject(config, projectName) {
  const resolvedConfig = withResolvedProjectsDir(config);
  const projectDir = path.join(resolvedConfig.projectsDir, projectName);
  if (!fs.existsSync(projectDir)) throw new Error('Project not found');
  fs.rmSync(projectDir, { recursive: true, force: true });
  const order = getProjectOrder(resolvedConfig);
  const newOrder = order.filter(name => name !== projectName);
  if (newOrder.length !== order.length) saveProjectOrder(resolvedConfig, newOrder);
  return { success: true };
}

// ===== Search: delegates to index =====

async function searchSessions(config, projectName, keyword, contextLength = 15, options = {}) {
  const results = await getSessionHistoryIndex().searchSessions('claude', keyword, { projectName, contextLength, ...options, config });
  const aliases = loadAliases();
  return results.map(r => ({
    sessionId: r.sessionId,
    alias: aliases[r.sessionId] || null,
    matchCount: r.matchCount,
    matches: r.matches
  }));
}

async function getRecentSessions(config, limit = 5, options = {}) {
  const indexed = await getSessionHistoryIndex().getRecentSessions('claude', limit, { ...options, config });
  const forkRelations = getForkRelations();
  return indexed.map(s => ({
    sessionId: s.sessionId,
    projectName: s.projectName,
    projectDisplayName: s.projectDisplayName,
    projectFullPath: s.projectFullPath,
    mtime: s.mtime,
    size: s.size,
    filePath: s.filePath,
    gitBranch: s.gitBranch || null,
    firstMessage: s.firstMessage || null,
    forkedFrom: forkRelations[s.sessionId] || null,
    alias: aliases[s.sessionId] || null
  }));
}

async function searchSessionsAcrossProjects(config, keyword, contextLength = 35) {
  const allResults = [];

  try {
    const claudeResults = await getSessionHistoryIndex().searchSessions('claude', keyword, { contextLength });
    for (const r of claudeResults) allResults.push({ ...r, channel: 'claude' });
  } catch (_) {}

  try {
    if (fs.existsSync(CODEX_PROJECTS_DIR)) {
      const { searchSessions: codexSearch } = require('../codex/sessions-implementation');
      const codexResults = await codexSearch(keyword);
      for (const r of codexResults) allResults.push({ ...r, channel: 'codex' });
    }
  } catch (_) {}

  try {
    if (fs.existsSync(GEMINI_PROJECTS_DIR)) {
      const { searchSessions: geminiSearch } = require('../gemini/sessions-implementation');
      const geminiResults = await geminiSearch(keyword, contextLength);
      for (const r of geminiResults) allResults.push({ ...r, channel: 'gemini' });
    }
  } catch (_) {}

  allResults.sort((a, b) => (b.matchCount || 0) - (a.matchCount || 0));
  return allResults;
}
function hasActualMessages(sessionFile) {
  if (!sessionFile || !fs.existsSync(sessionFile)) return false;
  return fs.readFileSync(sessionFile, 'utf8')
    .split(/\r?\n/)
    .some(line => {
      if (!line.trim()) return false;
      try {
        const entry = JSON.parse(line);
        return entry.type === 'user' || entry.type === 'assistant'
          || entry.message?.role === 'user' || entry.message?.role === 'assistant';
      } catch (_) {
        return false;
      }
    });
}


module.exports = {
  configure,
  getProjects,
  getProjectsWithStats,
  getSessionsForProject,
  deleteSession,
  forkSession,
  launch,
  getRecentSessions,
  getProjectOrder,
  saveProjectOrder,
  getSessionOrder,
  saveSessionOrder,
  deleteProject,
  parseRealProjectPath,
  searchSessions,
  searchSessionsAcrossProjects,
  getForkRelations,
  saveForkRelations,
  getProjectAndSessionCounts
};
