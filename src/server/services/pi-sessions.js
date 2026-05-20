const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PATHS, HOME_DIR } = require('../../config/paths');
const { getPiPaths, isPiInstalled } = require('./pi-config');

const PROJECT_ORDER_FILE = PATHS.piProjectOrder;
const SESSION_ORDER_FILE = PATHS.piSessionOrder;

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function safeReadJson(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeWriteJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value || {}, null, 2), 'utf8');
}

function encodeProjectName(cwd = '') {
  return `--${String(cwd || '').replace(/\\/g, '/').replace(/\//g, '--')}--`;
}

function decodeProjectName(projectName = '') {
  const value = String(projectName || '');
  if (!value.startsWith('--') || !value.endsWith('--')) {
    return value;
  }
  const inner = value.slice(2, -2);
  return `/${inner.split('--').filter(Boolean).join('/')}`;
}

function makeProjectName(cwd = '') {
  const normalized = String(cwd || '').trim();
  return normalized ? encodeProjectName(normalized) : 'unknown';
}

function getDisplayName(cwd = '') {
  const normalized = String(cwd || '').trim();
  if (!normalized) return 'Unknown';
  return path.basename(normalized) || normalized;
}

function parsePiSessionId(filePath = '') {
  const base = path.basename(filePath, '.jsonl');
  const match = base.match(/([0-9a-f]{8}-[0-9a-f-]{8,})$/i);
  if (match) return match[1];
  return base;
}

function normalizeTextContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === 'string') return item;
      if (item?.type === 'text') return item.text || '';
      if (item?.text) return item.text;
      return '';
    }).filter(Boolean).join('\n');
  }
  if (content && typeof content === 'object') {
    if (typeof content.text === 'string') return content.text;
    if (typeof content.content === 'string') return content.content;
  }
  return '';
}

function extractMessageText(message = {}) {
  if (typeof message.content === 'string' || Array.isArray(message.content)) {
    return normalizeTextContent(message.content);
  }
  if (Array.isArray(message.parts)) {
    return normalizeTextContent(message.parts);
  }
  if (Array.isArray(message.thinking)) {
    return normalizeTextContent(message.thinking);
  }
  if (message.toolCall && typeof message.toolCall === 'object') {
    return JSON.stringify(message.toolCall, null, 2);
  }
  if (message.toolResult && typeof message.toolResult === 'object') {
    return normalizeTextContent(message.toolResult.content || message.toolResult.output || message.toolResult);
  }
  if (message.bashExecution && typeof message.bashExecution === 'object') {
    return normalizeTextContent(message.bashExecution.output || message.bashExecution.command || message.bashExecution);
  }
  if (typeof message.text === 'string') {
    return message.text;
  }
  if (typeof message.output === 'string') {
    return message.output;
  }
  if (typeof message.result === 'string') {
    return message.result;
  }
  return '';
}

function parseUsage(usage = {}) {
  const input = Number(usage.input ?? usage.inputTokens ?? usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokens ?? 0) || 0;
  const output = Number(usage.output ?? usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens ?? usage.completionTokens ?? 0) || 0;
  const cacheRead = Number(usage.cacheRead ?? usage.cache_read ?? usage.cachedTokens ?? usage.cached_tokens ?? usage.cache_read_input_tokens ?? 0) || 0;
  const cacheWrite = Number(usage.cacheWrite ?? usage.cache_write ?? usage.cacheCreation ?? usage.cache_creation ?? usage.cache_creation_input_tokens ?? 0) || 0;
  const reasoning = Number(usage.reasoningTokens ?? usage.reasoning_tokens ?? 0) || 0;
  const total = Number(usage.totalTokens ?? usage.total_tokens ?? (input + output + cacheRead + cacheWrite + reasoning)) || 0;
  const cost = typeof usage.cost === 'number'
    ? usage.cost
    : Number(usage.cost?.total ?? usage.cost?.usd ?? 0) || 0;
  return { input, output, cached: cacheRead, cacheRead, cacheWrite, reasoning, total, cost };
}

function readJsonLines(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw
      .split(/\r?\n/)
      .filter(line => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { type: 'invalid', raw: line };
        }
      });
  } catch {
    return [];
  }
}

function convertPiEntry(entry = {}, index = 0) {
  if (!entry || entry.type !== 'message') {
    return null;
  }
  const message = entry.message || {};
  const role = message.role || entry.role;
  const assistantLikeRoles = new Set(['assistant', 'tool', 'toolResult', 'tool_result', 'bashExecution', 'bash_execution', 'custom']);
  if (role !== 'user' && !assistantLikeRoles.has(role)) {
    return null;
  }
  const text = extractMessageText(message);
  const type = role === 'user' ? 'user' : 'assistant';
  const result = {
    id: entry.id || message.id || `msg-${index}`,
    type,
    role,
    content: text || message.content || '',
    timestamp: entry.timestamp || message.timestamp || null
  };

  if (type === 'assistant') {
    if (role !== 'assistant') {
      result.subtype = role;
    }
    result.provider = entry.provider || message.provider || '';
    result.model = entry.model || message.model || '';
    result.usage = parseUsage(entry.usage || message.usage || {});
  }

  return result;
}

function parseSessionFile(filePath) {
  const stat = fs.statSync(filePath);
  const entries = readJsonLines(filePath);
  const header = entries.find(entry => entry?.type === 'session') || {};
  const messages = entries.map(convertPiEntry).filter(Boolean);
  const modelChange = [...entries].reverse().find(entry => entry?.type === 'model_change');
  const firstUser = messages.find(message => message.type === 'user');
  const lastAssistant = [...messages].reverse().find(message => message.type === 'assistant') || {};
  const cwd = header.cwd || messages.find(message => message.cwd)?.cwd || path.dirname(filePath);
  const sessionId = header.id || parsePiSessionId(filePath);
  const usage = messages.reduce((acc, message) => {
    if (message.type !== 'assistant') return acc;
    const current = parseUsage(message.usage || {});
    acc.input += current.input;
    acc.output += current.output;
    acc.cached += current.cached;
    acc.reasoning += current.reasoning;
    acc.total += current.total;
    return acc;
  }, { input: 0, output: 0, cached: 0, reasoning: 0, total: 0 });

  return {
    sessionId,
    filePath,
    cwd,
    directory: cwd,
    projectName: makeProjectName(cwd),
    preview: firstUser?.content || '',
    firstMessage: firstUser?.content || null,
    messageCount: messages.length,
    model: modelChange?.modelId || modelChange?.model || lastAssistant.model || '',
    provider: modelChange?.provider || lastAssistant.provider || '',
    usage,
    size: stat.size,
    mtime: new Date(stat.mtimeMs).toISOString(),
    mtimeMs: stat.mtimeMs,
    timestamp: header.timestamp || null,
    source: 'pi'
  };
}

function scanSessionFiles(rootDir = getPiPaths().sessions) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  const files = [];
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.forEach((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    });
  };
  walk(rootDir);
  return files;
}

function getAllSessions() {
  return scanSessionFiles()
    .map((filePath) => {
      try {
        return parseSessionFile(filePath);
      } catch (error) {
        console.warn('[Pi Sessions] Failed to parse session:', filePath, error.message);
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
}

function loadProjectOrder() {
  const data = safeReadJson(PROJECT_ORDER_FILE, { order: [] });
  return Array.isArray(data.order) ? data.order : [];
}

function loadSessionOrder() {
  return safeReadJson(SESSION_ORDER_FILE, {});
}

function getProjects() {
  const sessions = getAllSessions();
  const projectMap = new Map();
  sessions.forEach((session) => {
    const key = session.projectName;
    const existing = projectMap.get(key) || {
      name: key,
      path: session.cwd,
      fullPath: session.cwd,
      displayName: getDisplayName(session.cwd),
      sessionCount: 0,
      latestSession: null,
      mtime: session.mtime,
      mtimeMs: 0,
      source: 'pi'
    };
    existing.sessionCount += 1;
    if ((session.mtimeMs || 0) > (existing.mtimeMs || 0)) {
      existing.latestSession = session.sessionId;
      existing.mtime = session.mtime;
      existing.mtimeMs = session.mtimeMs;
    }
    projectMap.set(key, existing);
  });

  const projects = Array.from(projectMap.values());
  const order = loadProjectOrder();
  projects.sort((a, b) => {
    const ai = order.indexOf(a.name);
    const bi = order.indexOf(b.name);
    if (ai !== -1 || bi !== -1) {
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }
    return (b.mtimeMs || 0) - (a.mtimeMs || 0);
  });
  return projects;
}

function getSessionsByProject(projectName) {
  const orderMap = loadSessionOrder();
  const order = Array.isArray(orderMap[projectName]) ? orderMap[projectName] : [];
  const sessions = getAllSessions().filter(session => session.projectName === projectName);
  sessions.sort((a, b) => {
    const ai = order.indexOf(a.sessionId);
    const bi = order.indexOf(b.sessionId);
    if (ai !== -1 || bi !== -1) {
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }
    return (b.mtimeMs || 0) - (a.mtimeMs || 0);
  });
  return sessions.map(normalizeSession);
}

function normalizeSession(session) {
  if (!session) return null;
  return {
    sessionId: session.sessionId,
    filePath: session.filePath,
    firstMessage: session.firstMessage || null,
    gitBranch: null,
    forkedFrom: null,
    source: 'pi',
    provider: session.provider || '',
    model: session.model || '',
    size: session.size || 0,
    mtime: session.mtime,
    mtimeMs: session.mtimeMs,
    directory: session.directory || session.cwd || null,
    messageCount: session.messageCount || 0,
    tokens: session.usage || { input: 0, output: 0, cached: 0, reasoning: 0, total: 0 }
  };
}

function getSessionById(sessionId) {
  return getAllSessions().find(session => session.sessionId === sessionId || path.basename(session.filePath, '.jsonl') === sessionId) || null;
}

function getSessionMessages(sessionId) {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }
  return readJsonLines(session.filePath).map(convertPiEntry).filter(Boolean);
}

function getRecentSessions(limit = 5) {
  return getAllSessions().slice(0, limit).map(normalizeSession);
}

function searchSessions(keyword, contextLength = 35, projectName = null) {
  const needle = String(keyword || '').toLowerCase();
  if (!needle) return [];

  return getAllSessions()
    .filter(session => !projectName || session.projectName === projectName)
    .map((session) => {
      const messages = readJsonLines(session.filePath).map(convertPiEntry).filter(Boolean);
      const matches = [];
      messages.forEach((message) => {
        const text = String(message.content || '');
        const index = text.toLowerCase().indexOf(needle);
        if (index === -1) return;
        const start = Math.max(0, index - contextLength);
        const end = Math.min(text.length, index + needle.length + contextLength);
        matches.push({
          role: message.role || message.type,
          context: text.slice(start, end),
          timestamp: message.timestamp || null
        });
      });
      if (matches.length === 0) return null;
      return {
        ...normalizeSession(session),
        projectName: session.projectName,
        projectDisplayName: getDisplayName(session.cwd),
        matchCount: matches.length,
        matches
      };
    })
    .filter(Boolean);
}

function deleteSession(sessionId) {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }
  fs.unlinkSync(session.filePath);
  return { success: true };
}

function deleteProject(projectName) {
  const sessions = getAllSessions().filter(session => session.projectName === projectName);
  if (sessions.length === 0) {
    throw new Error('Project not found');
  }
  sessions.forEach(session => fs.unlinkSync(session.filePath));
  return { success: true, deletedSessions: sessions.length };
}

function forkSession(sessionId) {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }
  const parsed = path.parse(session.filePath);
  const forkId = `fork-${Date.now()}`;
  const targetPath = path.join(parsed.dir, `${parsed.name}-${forkId}${parsed.ext}`);
  fs.copyFileSync(session.filePath, targetPath);
  return { success: true, newSessionId: parsePiSessionId(targetPath), filePath: targetPath };
}

function saveProjectOrder(order) {
  safeWriteJson(PROJECT_ORDER_FILE, { order: Array.isArray(order) ? order : [] });
}

function saveSessionOrder(projectName, order) {
  const data = loadSessionOrder();
  data[projectName] = Array.isArray(order) ? order : [];
  safeWriteJson(SESSION_ORDER_FILE, data);
}

function getProjectAndSessionCounts() {
  const sessions = getAllSessions();
  return {
    projectCount: new Set(sessions.map(session => session.projectName)).size,
    sessionCount: sessions.length
  };
}

function buildLaunchCommand(sessionId, cwd, options = {}) {
  const args = [];
  if (options.rpc) {
    args.push('--mode rpc');
  }
  if (options.fork) {
    args.push('--fork', shellQuote(sessionId));
  } else {
    args.push('--session', shellQuote(sessionId));
  }
  return `pi ${args.join(' ')}`;
}

function shellQuote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function isPiCliInstalled() {
  if (isPiInstalled()) return true;
  try {
    execFileSync('pi', ['--version'], { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  buildLaunchCommand,
  decodeProjectName,
  deleteProject,
  deleteSession,
  encodeProjectName,
  forkSession,
  getAllSessions,
  getProjectAndSessionCounts,
  getProjects,
  getRecentSessions,
  getSessionById,
  getSessionMessages,
  getSessionsByProject,
  isPiInstalled: isPiCliInstalled,
  normalizeSession,
  parseSessionFile,
  scanSessionFiles,
  searchSessions,
  saveProjectOrder,
  saveSessionOrder,
  HOME_DIR
};
