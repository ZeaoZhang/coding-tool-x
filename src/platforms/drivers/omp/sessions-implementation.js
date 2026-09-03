const fs = require('fs');
const path = require('path');
const { PATHS, HOME_DIR } = require('../../../config/paths');
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
const { getOmpCommand, getOmpPaths, resolveOmpRuntime } = require('./config');

const PROJECT_ORDER_FILE = PATHS.ompProjectOrder;
const SESSION_ORDER_FILE = PATHS.ompSessionOrder;
const OMP_INSTALL_CACHE_TTL_MS = 5 * 60 * 1000;
let ompInstallCache = { expiresAt: 0, value: false };

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

function parseOmpSessionId(filePath = '') {
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

function convertOmpEntry(entry = {}, index = 0) {
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
  const messages = entries.map(convertOmpEntry).filter(Boolean);
  const modelChange = [...entries].reverse().find(entry => entry?.type === 'model_change');
  const firstUser = messages.find(message => message.type === 'user');
  const lastAssistant = [...messages].reverse().find(message => message.type === 'assistant') || {};
  const cwd = header.cwd || messages.find(message => message.cwd)?.cwd || path.dirname(filePath);
  const sessionId = header.id || parseOmpSessionId(filePath);
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
    source: 'omp'
  };
}

function parseSessionUsageEvents(filePath) {
  const entries = readJsonLines(filePath);
  const header = entries.find(entry => entry?.type === 'session') || {};
  const sessionId = header.id || parseOmpSessionId(filePath);
  let activeProvider = '';
  let activeModel = '';
  const events = [];

  entries.forEach((entry, index) => {
    if (entry?.type === 'model_change') {
      activeProvider = entry.provider || activeProvider;
      activeModel = entry.modelId || entry.model || activeModel;
      return;
    }
    if (entry?.type !== 'message') return;

    const message = entry.message || {};
    const role = message.role || entry.role;
    if (role !== 'assistant') return;

    const eventId = entry.id || message.id || `assistant-${index}`;
    events.push({
      key: `${filePath}:${eventId}`,
      id: `${sessionId}:${eventId}`,
      sessionId,
      filePath,
      provider: entry.provider || message.provider || activeProvider || '',
      model: entry.model || message.model || activeModel || '',
      timestamp: entry.timestamp || message.timestamp || header.timestamp || null,
      usage: parseUsage(entry.usage || message.usage || {})
    });
  });

  return events;
}

function getOmpSessionPaths() {
  // Reading historical sessions normally only needs OMP's native directory
  // convention. Avoid starting the CLI here: project/count snapshot workers
  // invoke this path independently, which made Windows repeatedly open
  // PowerShell shims. Keep the CLI lookup as a fallback for non-standard OMP
  // locations that cannot be derived from the environment.
  const nativePaths = getOmpPaths(process.env, { resolveRuntime: false });
  if (fs.existsSync(nativePaths.agentDir) || fs.existsSync(nativePaths.sessions)) {
    return nativePaths;
  }
  return getOmpPaths();
}

function scanSessionFiles(rootDir = getOmpSessionPaths().sessions) {
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

async function getAllSessions(options = {}) {
  const projects = await getSessionHistoryIndex().listProjects('omp', options);
  const groups = await Promise.all(projects.map(project => getSessionHistoryIndex().listSessions('omp', project.name, options)));
  return groups.flat().map(session => normalizeSession({
    ...session,
    mtime: new Date(session.mtime).toISOString(),
    mtimeMs: session.mtime,
    directory: session.projectFullPath,
    usage: session.tokens
  }));
}

function getOmpUsageEvents(rootDir = getOmpSessionPaths().sessions) {
  return scanSessionFiles(rootDir).flatMap((filePath) => {
    try {
      return parseSessionUsageEvents(filePath);
    } catch (error) {
      console.warn('[OMP Sessions] Failed to parse usage events:', filePath, error.message);
      return [];
    }
  });
}

function createOmpUsageEventCursor(rootDir = null) {
  let signatures = new Map();

  return {
    read() {
      const files = scanSessionFiles(rootDir || getOmpSessionPaths().sessions);
      const nextSignatures = new Map();
      const events = [];

      files.forEach((filePath) => {
        try {
          const stat = fs.statSync(filePath);
          const signature = `${stat.size}:${stat.mtimeMs}`;
          nextSignatures.set(filePath, signature);
          if (signatures.get(filePath) === signature) return;
          events.push(...parseSessionUsageEvents(filePath));
        } catch (error) {
          console.warn('[OMP Sessions] Failed to read changed usage events:', filePath, error.message);
        }
      });

      signatures = nextSignatures;
      return events;
    },
    reset() {
      signatures = new Map();
    }
  };
}

function loadProjectOrder() {
  const data = safeReadJson(PROJECT_ORDER_FILE, { order: [] });
  return Array.isArray(data.order) ? data.order : [];
}

function loadSessionOrder() {
  return safeReadJson(SESSION_ORDER_FILE, {});
}

async function getProjects(options = {}) {
  const idxProjects = await getSessionHistoryIndex().listProjects('omp', options);
  const projects = idxProjects.map(p => ({
    name: p.name,
    path: p.fullPath || p.path || '',
    fullPath: p.fullPath || '',
    displayName: p.displayName || p.name,
    sessionCount: p.sessionCount || 0,
    latestSession: p.latestSession || null,
    mtime: p.lastUsed || null,
    mtimeMs: p.lastUsed ? new Date(p.lastUsed).getTime() : 0,
    source: 'omp'
  }));

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

async function getSessionsByProject(projectName, options = {}) {
  const idxSessions = await getSessionHistoryIndex().listSessions('omp', projectName, options);
  const sessions = idxSessions.map(s => ({
    sessionId: s.sessionId,
    filePath: s.filePath,
    firstMessage: s.firstMessage,
    gitBranch: s.gitBranch,
    provider: s.provider,
    model: s.model,
    size: s.size,
    mtime: new Date(s.mtime).toISOString(),
    mtimeMs: s.mtime,
    directory: s.projectFullPath,
    cwd: s.projectFullPath,
    messageCount: s.messageCount,
    usage: s.tokens
  }));

  const orderMap = loadSessionOrder();
  const order = Array.isArray(orderMap[projectName]) ? orderMap[projectName] : [];
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
    source: 'omp',
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

async function getSessionById(sessionId) {
  const status = await getSessionHistoryIndex().getSessionStatus('omp', sessionId);
  if (!status) return null;
  return {
    sessionId: status.sessionId,
    filePath: status.filePath,
    size: status.size,
    mtime: new Date(status.lastModified).toISOString(),
    mtimeMs: status.lastModified,
    source: 'omp',
    firstMessage: null,
    gitBranch: null,
    forkedFrom: null,
    provider: '',
    model: '',
    directory: null,
    messageCount: 0,
    tokens: { input: 0, output: 0, cached: 0, reasoning: 0, total: 0 }
  };
}
async function getSessionMessages(sessionId) {
  const session = await getSessionById(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }
  return readJsonLines(session.filePath).map(convertOmpEntry).filter(Boolean);
}

async function getRecentSessions(limit = 5) {
  const indexed = await getSessionHistoryIndex().getRecentSessions('omp', limit);
  return indexed.map(session => normalizeSession({
    ...session,
    mtime: new Date(session.mtime).toISOString(),
    mtimeMs: session.mtime,
    directory: session.projectFullPath,
    usage: session.tokens
  }));
}

async function searchSessions(keyword, contextLength = 35, projectName = null) {
  return getSessionHistoryIndex().searchSessions('omp', keyword, { contextLength, projectName });
}

async function deleteSession(sessionId) {
  const session = await getSessionById(sessionId);
  if (!session) throw new Error('Session not found');
  fs.unlinkSync(session.filePath);
  return { success: true };
}

async function deleteProject(projectName) {
  const sessions = await getSessionsByProject(projectName);
  if (sessions.length === 0) throw new Error('Project not found');
  sessions.forEach(session => fs.unlinkSync(session.filePath));
  return { success: true, deletedSessions: sessions.length };
}

async function forkSession(sessionId) {
  const session = await getSessionById(sessionId);
  if (!session) throw new Error('Session not found');
  const newSessionId = crypto.randomUUID();
  const newFile = path.join(path.dirname(session.filePath), `${newSessionId}.jsonl`);
  const content = fs.readFileSync(session.filePath, 'utf8');
  fs.writeFileSync(newFile, content, 'utf8');
  return { success: true, sessionId: newSessionId, filePath: newFile, forkedFrom: sessionId };
}

function saveProjectOrder(order) {
  safeWriteJson(PROJECT_ORDER_FILE, { order: Array.isArray(order) ? order : [] });
}

function saveSessionOrder(projectName, order) {
  const data = loadSessionOrder();
  data[projectName] = Array.isArray(order) ? order : [];
  safeWriteJson(SESSION_ORDER_FILE, data);
}

async function getProjectAndSessionCounts(options = {}) {
  const projects = await getSessionHistoryIndex().listProjects('omp', options);
  return {
    projectCount: projects.length,
    sessionCount: projects.reduce((sum, project) => sum + (project.sessionCount || 0), 0)
  };
}

function buildLaunchCommand(sessionId, cwd, options = {}) {
  const args = [];
  if (options.rpc) {
    args.push('--mode rpc');
  }
  if (options.sessionDir) {
    args.push('--session-dir', shellQuote(options.sessionDir));
  }
  if (options.fork) {
    args.push('--fork', shellQuote(sessionId));
  } else {
    args.push('--session', shellQuote(sessionId));
  }
  return `${getOmpCommand()} ${args.join(' ')}`;
}

function shellQuote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function isOmpCliInstalled() {
  const now = Date.now();
  if (ompInstallCache.expiresAt > now) {
    return ompInstallCache.value;
  }

  let installed = false;
  const nativePaths = getOmpSessionPaths();
  if (fs.existsSync(nativePaths.agentDir)) {
    installed = true;
  } else {
    const runtime = resolveOmpRuntime();
    installed = Boolean(runtime && runtime.installed);
  }

  ompInstallCache = {
    value: installed,
    expiresAt: now + OMP_INSTALL_CACHE_TTL_MS
  };
  return installed;
}

module.exports = {
  configure,
  buildLaunchCommand,
  createOmpUsageEventCursor,
  decodeProjectName,
  deleteProject,
  deleteSession,
  encodeProjectName,
  forkSession,
  getAllSessions,
  getOmpUsageEvents,
  getProjectAndSessionCounts,
  getProjects,
  getRecentSessions,
  getSessionById,
  getSessionMessages,
  getSessionsByProject,
  isOmpInstalled: isOmpCliInstalled,
  normalizeSession,
  parseSessionFile,
  parseSessionUsageEvents,
  scanSessionFiles,
  searchSessions,
  saveProjectOrder,
  saveSessionOrder,
  HOME_DIR
};
