const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { HOME_DIR } = require('../../config/paths');
const { getGeminiDir } = require('./gemini-config');
const { resolveModelPricing } = require('../utils/pricing');
const { listProjects: idxListProjects, listSessions: idxListSessions, getSessionStatus: idxGetSessionStatus, getRecentSessions: idxGetRecent, searchSessions: idxSearch } = require('./session-history-index');

const HASH_RE = /^[a-f0-9]{64}$/;
const SESSION_FILE_RE = /^session-(.*)-([a-f0-9]+)\.(json|jsonl)$/;

// 路径映射缓存
let pathMappingCache = null;
let pathMappingCacheTime = 0;
const PATH_MAPPING_CACHE_TTL = 60000; // 1分钟缓存

/**
 * 获取 Gemini tmp 目录（包含所有项目）
 */
function getTmpDir() {
  return path.join(getGeminiDir(), 'tmp');
}

/**
 * 计算路径的 SHA256 hash（与 Gemini CLI 相同的算法）
 * @param {string} filePath - 文件路径
 * @returns {string} hash 值
 */
function getFilePathHash(filePath) {
  return crypto.createHash('sha256').update(filePath).digest('hex');
}

function isDirectory(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function readTextFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function readProjectRootFile(projectDir) {
  const projectRoot = readTextFile(path.join(projectDir, '.project_root')).trim();
  return projectRoot || null;
}

function loadProjectRootsByStorageName() {
  const projectsPath = path.join(getGeminiDir(), 'projects.json');
  const content = readTextFile(projectsPath);
  if (!content) {
    return new Map();
  }

  try {
    const parsed = JSON.parse(content);
    const projects = parsed && typeof parsed.projects === 'object' && parsed.projects
      ? parsed.projects
      : {};
    return new Map(
      Object.entries(projects)
        .filter(([projectRoot, storageName]) => projectRoot && typeof storageName === 'string')
        .map(([projectRoot, storageName]) => [storageName, projectRoot])
    );
  } catch {
    return new Map();
  }
}

function extractContentText(value) {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item.text === 'string') return item.text;
        if (item && typeof item.content === 'string') return item.content;
        if (item && typeof item === 'object') return JSON.stringify(item);
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  if (value && typeof value.text === 'string') {
    return value.text;
  }

  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }

  return '';
}

function normalizeMessageRecord(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const normalized = { ...record };
  if (Object.prototype.hasOwnProperty.call(record, 'content')) {
    normalized.content = extractContentText(record.content);
  }
  return normalized;
}

function upsertMessage(messages, indexById, message) {
  if (!message) {
    return;
  }

  if (message.id && indexById.has(message.id)) {
    const index = indexById.get(message.id);
    messages[index] = {
      ...messages[index],
      ...message
    };
    return;
  }

  if (message.id) {
    indexById.set(message.id, messages.length);
  }
  messages.push(message);
}

function normalizeSessionObject(session) {
  if (!session || typeof session !== 'object') {
    return null;
  }

  const messages = [];
  const indexById = new Map();
  if (Array.isArray(session.messages)) {
    session.messages.forEach((message) => {
      upsertMessage(messages, indexById, normalizeMessageRecord(message));
    });
  }

  return {
    ...session,
    messages
  };
}

function parseSessionContent(content) {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return normalizeSessionObject(JSON.parse(trimmed));
  } catch {
    // Current Gemini CLI stores sessions as JSONL. Fall through to line parsing.
  }

  const session = {};
  const messages = [];
  const indexById = new Map();
  const lines = trimmed.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

  lines.forEach((line) => {
    const record = JSON.parse(line);
    if (record.$set && typeof record.$set === 'object') {
      Object.assign(session, record.$set);
      return;
    }

    if (record.type) {
      upsertMessage(messages, indexById, normalizeMessageRecord(record));
      return;
    }

    if (record && typeof record === 'object') {
      Object.assign(session, record);
    }
  });

  return normalizeSessionObject({
    ...session,
    messages
  });
}

function readSessionHeader(filePath) {
  const content = readTextFile(filePath).trim();
  if (!content) {
    return null;
  }

  try {
    return JSON.parse(content);
  } catch {
    const firstLine = content.split(/\r?\n/).find(line => line.trim());
    if (!firstLine) {
      return null;
    }
    try {
      return JSON.parse(firstLine);
    } catch {
      return null;
    }
  }
}

function scanProjectEntries() {
  const tmpDir = getTmpDir();

  if (!isDirectory(tmpDir)) {
    return [];
  }

  const projectRootsByStorageName = loadProjectRootsByStorageName();
  const entries = fs.readdirSync(tmpDir, { withFileTypes: true });

  return entries
    .filter(entry => entry.isDirectory())
    .map((entry) => {
      const projectDir = path.join(tmpDir, entry.name);
      const chatsDir = path.join(projectDir, 'chats');
      const projectRoot = readProjectRootFile(projectDir) || projectRootsByStorageName.get(entry.name) || null;
      const projectHash = HASH_RE.test(entry.name)
        ? entry.name
        : (projectRoot ? getFilePathHash(projectRoot) : null);

      if (!isDirectory(chatsDir) && !HASH_RE.test(entry.name)) {
        return null;
      }

      return {
        storageName: entry.name,
        projectDir,
        chatsDir,
        projectRoot,
        projectHash
      };
    })
    .filter(Boolean);
}

function scanEntrySessionFiles(projectEntry) {
  if (!projectEntry || !isDirectory(projectEntry.chatsDir)) {
    return [];
  }

  const entries = fs.readdirSync(projectEntry.chatsDir, { withFileTypes: true });

  return entries
    .filter(entry => entry.isFile() && SESSION_FILE_RE.test(entry.name))
    .map(entry => {
      const match = entry.name.match(SESSION_FILE_RE);

      return {
        filePath: path.join(projectEntry.chatsDir, entry.name),
        timestamp: match[1],
        shortId: match[2],
        extension: match[3],
        projectHash: projectEntry.projectHash,
        storageName: projectEntry.storageName,
        projectDir: projectEntry.projectDir,
        projectRoot: projectEntry.projectRoot
      };
    });
}

function resolveProjectHashForEntry(projectEntry) {
  if (projectEntry.projectHash) {
    return projectEntry.projectHash;
  }

  const sessionFiles = scanEntrySessionFiles(projectEntry);
  for (const file of sessionFiles) {
    const header = readSessionHeader(file.filePath);
    if (header?.projectHash) {
      return header.projectHash;
    }
  }

  return projectEntry.storageName;
}

/**
 * 扫描目录及其子目录，建立 hash → path 映射
 * @param {string} dir - 要扫描的目录
 * @param {Set} targetHashes - 目标 hash 集合
 * @param {number} maxDepth - 最大扫描深度
 * @param {Map} results - 结果映射
 * @param {number} currentDepth - 当前深度
 */
function scanDirForHashes(dir, targetHashes, maxDepth, results, currentDepth = 0) {
  if (currentDepth > maxDepth || results.size >= targetHashes.size) {
    return;
  }

  // 计算当前目录的 hash
  const hash = getFilePathHash(dir);
  if (targetHashes.has(hash) && !results.has(hash)) {
    results.set(hash, dir);
  }

  // 如果所有目标都已找到，提前返回
  if (results.size >= targetHashes.size) {
    return;
  }

  // 扫描子目录
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      // 跳过隐藏目录和常见的无关目录
      if (item.name.startsWith('.') ||
          item.name === 'node_modules' ||
          item.name === 'Library' ||
          item.name === 'Applications') {
        continue;
      }

      if (item.isDirectory()) {
        scanDirForHashes(
          path.join(dir, item.name),
          targetHashes,
          maxDepth,
          results,
          currentDepth + 1
        );

        // 如果所有目标都已找到，提前返回
        if (results.size >= targetHashes.size) {
          return;
        }
      }
    }
  } catch (err) {
    // 忽略权限错误等
  }
}

/**
 * 建立所有项目 hash 到路径的映射（彩虹表方法）
 * @returns {Map} hash → path 映射
 */
function buildPathMapping() {
  const now = Date.now();

  // 检查缓存是否有效
  if (pathMappingCache && (now - pathMappingCacheTime) < PATH_MAPPING_CACHE_TTL) {
    return pathMappingCache;
  }

  const projectEntries = scanProjectEntries();
  if (projectEntries.length === 0) {
    pathMappingCache = new Map();
    pathMappingCacheTime = now;
    return pathMappingCache;
  }

  const results = new Map();
  const targetHashes = new Set();
  projectEntries.forEach((entry) => {
    const projectHash = resolveProjectHashForEntry(entry);
    if (!projectHash) {
      return;
    }
    if (entry.projectRoot) {
      results.set(projectHash, entry.projectRoot);
      return;
    }
    if (HASH_RE.test(projectHash)) {
      targetHashes.add(projectHash);
    }
  });

  if (targetHashes.size === 0) {
    pathMappingCache = results;
    pathMappingCacheTime = now;
    return results;
  }

  const homeDir = HOME_DIR;

  // 定义要扫描的目录及其最大深度
  // 深度说明：depth=3 表示可以扫描到 Desktop/a/b/c 这样的 4 层目录
  const searchPaths = [
    { dir: homeDir, depth: 0 },                           // 只检查 home 目录本身
    { dir: path.join(homeDir, 'Desktop'), depth: 4 },     // Desktop 及 4 层子目录
    { dir: path.join(homeDir, 'Documents'), depth: 4 },   // Documents 及 4 层子目录
    { dir: path.join(homeDir, 'Downloads'), depth: 3 },   // Downloads 及 3 层子目录
    { dir: path.join(homeDir, 'Projects'), depth: 4 },    // Projects 及 4 层子目录
    { dir: path.join(homeDir, 'Code'), depth: 4 },        // Code 及 4 层子目录
    { dir: path.join(homeDir, 'workspace'), depth: 4 },   // workspace 及 4 层子目录
    { dir: path.join(homeDir, 'dev'), depth: 4 },         // dev 及 4 层子目录
    { dir: path.join(homeDir, 'src'), depth: 4 },         // src 及 4 层子目录
    { dir: path.join(homeDir, 'work'), depth: 4 },        // work 及 4 层子目录
    { dir: path.join(homeDir, 'repos'), depth: 4 },       // repos 及 4 层子目录
    { dir: path.join(homeDir, 'github'), depth: 4 },      // github 及 4 层子目录
  ];

  for (const { dir, depth } of searchPaths) {
    if (fs.existsSync(dir)) {
      scanDirForHashes(dir, targetHashes, depth, results);
    }

    // 如果所有目标都已找到，提前结束
    if (results.size >= targetHashes.size) {
      break;
    }
  }

  pathMappingCache = results;
  pathMappingCacheTime = now;

  return results;
}

/**
 * 扫描所有项目目录
 * @returns {Array} 项目 hash 数组
 */
function scanProjects() {
  const seen = new Set();
  return scanProjectEntries()
    .map(resolveProjectHashForEntry)
    .filter(Boolean)
    .filter((projectHash) => {
      if (seen.has(projectHash)) {
        return false;
      }
      seen.add(projectHash);
      return true;
    });
}

/**
 * 扫描单个项目的所有会话文件
 * @param {string} projectHash - 项目 hash
 * @returns {Array} 会话文件路径数组
 */
function scanProjectSessions(projectHash) {
  return scanProjectEntries()
    .filter((entry) => entry.storageName === projectHash || resolveProjectHashForEntry(entry) === projectHash)
    .flatMap((entry) => scanEntrySessionFiles({
      ...entry,
      projectHash: resolveProjectHashForEntry(entry)
    }));
}

/**
 * 读取会话文件元数据（轻量级）
 * @param {string} filePath - 会话文件路径
 * @returns {Object|null} 会话元数据
 */
function readSessionMeta(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const session = parseSessionContent(content);
    if (!session) {
      return null;
    }

    // Gemini 会话文件结构
    // {
    //   sessionId: "uuid",
    //   projectHash: "hash",
    //   startTime: "ISO timestamp",
    //   lastUpdated: "ISO timestamp",
    //   messages: [...]
    // }

    const messages = Array.isArray(session.messages) ? session.messages : [];
    const firstUserMessage = messages.find(msg => msg.type === 'user');

    // 计算总 tokens（从所有消息中累加）
    let totalTokens = 0;
    let totalCost = 0;
    let model = '';

    messages.forEach(msg => {
      if (msg.tokens) {
        totalTokens += msg.tokens.total || 0;

        // 计算成本（简化版本，使用 gemini-2.5-pro 的定价）
        if (msg.model) {
          model = msg.model;
          const inputTokens = msg.tokens.input || 0;
          const outputTokens = msg.tokens.output || 0;
          const pricing = resolveModelPricing('gemini', msg.model);
          const inputRate = typeof pricing.input === 'number' ? pricing.input : 1.25;
          const outputRate = typeof pricing.output === 'number' ? pricing.output : 10;
          totalCost += (inputTokens * inputRate / 1000000) + (outputTokens * outputRate / 1000000);
        }
      }
    });

    return {
      sessionId: session.sessionId,
      projectHash: session.projectHash,
      startTime: session.startTime,
      lastUpdated: session.lastUpdated,
      messageCount: messages.length,
      firstMessage: firstUserMessage ? extractContentText(firstUserMessage.content) : '',
      tokens: totalTokens,
      cost: totalCost,
      model: model || 'gemini-2.5-pro',
      forkedFrom: session.forkedFrom || null
    };
  } catch (err) {
    console.error(`[Gemini Sessions] Failed to read session meta: ${filePath}`, err);
    return null;
  }
}

/**
 * 读取完整会话内容
 * @param {string} filePath - 会话文件路径
 * @returns {Object|null} 完整会话数据
 */
function readSessionFull(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return parseSessionContent(content);
  } catch (err) {
    console.error(`[Gemini Sessions] Failed to read session: ${filePath}`, err);
    return null;
  }
}

/**
 * 获取所有会话（轻量级，仅元数据）
 * @returns {Array} 会话对象数组
 */
function getAllSessions() {
  const projectEntries = scanProjectEntries();
  const allSessions = [];

  projectEntries.forEach(projectEntry => {
    const resolvedProjectHash = resolveProjectHashForEntry(projectEntry);
    const sessionFiles = scanEntrySessionFiles({
      ...projectEntry,
      projectHash: resolvedProjectHash
    });

    sessionFiles.forEach(file => {
      const meta = readSessionMeta(file.filePath);

      if (!meta) return;

      // 获取文件大小和修改时间
      let size = 0;
      let mtime = meta.lastUpdated;
      try {
        const stats = fs.statSync(file.filePath);
        size = stats.size;
        mtime = stats.mtime.toISOString();
      } catch (err) {
        // 忽略错误
      }

      allSessions.push({
        ...meta,
        projectHash: meta.projectHash || resolvedProjectHash,
        storageName: projectEntry.storageName,
        projectDir: projectEntry.projectDir,
        projectRoot: projectEntry.projectRoot,
        filePath: file.filePath,
        size,
        mtime,
        source: 'gemini'
      });
    });
  });

  // 按最后更新时间排序（降序，最新的在前）- 前端显示用
  allSessions.sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));

  return allSessions;
}

/**
 * 归一化会话数据为 Claude Code 格式
 * @param {Object} geminiSession - Gemini 会话对象
 * @returns {Object} 归一化后的会话对象
 */
function normalizeSession(geminiSession) {
  return {
    sessionId: geminiSession.sessionId,
    mtime: geminiSession.mtime,
    size: geminiSession.size,
    filePath: geminiSession.filePath,
    gitBranch: null, // Gemini 不记录 git branch
    firstMessage: geminiSession.firstMessage,
    forkedFrom: geminiSession.forkedFrom || null,
    source: 'gemini',
    tokens: geminiSession.tokens,
    cost: geminiSession.cost,
    model: geminiSession.model,
    projectHash: geminiSession.projectHash,
    projectName: geminiSession.projectHash, // 兼容前端统一使用 projectName
    storageName: geminiSession.storageName,
    projectRoot: geminiSession.projectRoot
  };
}

/**
 * 获取项目的工作目录路径（使用彩虹表方法反推）
 * @param {string} projectHash - 项目 hash
 * @returns {string|null} 项目路径
 */
function getProjectPath(projectHash, options = {}) {
  if (options.force) {
    pathMappingCache = null;
    pathMappingCacheTime = 0;
  }
  const pathMapping = buildPathMapping();
  return pathMapping.get(projectHash) || null;
}

/**
 * 聚合项目列表
 * @returns {Array} 项目对象数组
 */
async function getProjects(options = {}) {
  const projects = await idxListProjects('gemini', options);
  const paths = buildPathMapping();
  return projects.map(project => {
    const fullPath = project.fullPath || paths.get(project.name) || null;
    return {
      ...project,
      displayName: fullPath ? path.basename(fullPath) : project.displayName,
      path: fullPath,
      fullPath,
      storageName: fullPath ? path.basename(fullPath) : project.name,
      lastUpdated: new Date(project.lastUsed).toISOString()
    };
  });
}

/**
 * 获取指定项目的所有会话
 * @param {string} projectHash - 项目 hash
 * @returns {Array} 会话对象数组
 */
async function getProjectSessions(projectHash, options = {}) {
  const indexed = await idxListSessions('gemini', projectHash, options);
  return indexed.map(session => ({
    sessionId: session.sessionId,
    mtime: new Date(session.mtime).toISOString(),
    size: session.size,
    filePath: session.filePath,
    gitBranch: null,
    firstMessage: session.firstMessage,
    forkedFrom: session.extra?.forkedFrom || null,
    source: 'gemini',
    tokens: session.tokens?.total ?? session.tokens ?? 0,
    cost: session.extra?.cost || 0,
    model: session.model || 'gemini-2.5-pro',
    projectHash: session.projectName,
    projectName: session.projectName,
    storageName: session.extra?.storageName || session.projectName,
    projectRoot: session.projectFullPath || null
  }));
}

/**
 * 获取单个会话的完整内容
 * @param {string} sessionId - 会话 ID
 * @returns {Object|null} 完整会话数据
 */
async function getSession(sessionId) {
  const status = await idxGetSessionStatus('gemini', sessionId);
  return status ? readSessionFull(status.filePath) : null;
}

/**
 * 删除会话
 * @param {string} sessionId - 会话 ID
 * @returns {Object} 删除结果
 */
function deleteSession(sessionId) {
  const allSessions = getAllSessions();
  const session = allSessions.find(s => s.sessionId === sessionId);

  if (!session) {
    throw new Error('Session not found');
  }

  try {
    fs.unlinkSync(session.filePath);
    return { success: true, sessionId };
  } catch (err) {
    throw new Error('Failed to delete session: ' + err.message);
  }
}

/**
 * 删除项目（删除项目下所有会话）
 * @param {string} projectHash - 项目 hash
 * @returns {Object} 删除结果
 */
function deleteProject(projectHash) {
  const projectEntry = scanProjectEntries()
    .find(entry => entry.storageName === projectHash || resolveProjectHashForEntry(entry) === projectHash);
  const projectDir = projectEntry ? projectEntry.projectDir : path.join(getTmpDir(), projectHash);

  if (!fs.existsSync(projectDir)) {
    throw new Error('Project not found');
  }

  try {
    fs.rmSync(projectDir, { recursive: true, force: true });
    return { success: true, projectHash };
  } catch (err) {
    throw new Error('Failed to delete project: ' + err.message);
  }
}

/**
 * 保存项目顺序（Gemini 不需要持久化顺序，前端自行处理）
 * @param {Array} order - 项目 hash 顺序数组
 */
function saveProjectOrder(order) {
  // Gemini 不需要持久化项目顺序
  // 前端可以使用 localStorage 保存
  return { success: true };
}

/**
 * 获取最近的会话列表
 * @param {number} limit - 限制数量
 * @returns {Array} 会话对象数组
 */
async function getRecentSessions(limit = 5) {
  const sessions = await idxGetRecent('gemini', limit);
  return sessions.map(session => ({
    ...session,
    mtime: new Date(session.mtime).toISOString(),
    projectHash: session.projectName
  }));
}

/**
 * 按 sessionId 获取会话（返回完整数据用于消息显示）
 * @param {string} sessionId - 会话 ID
 * @returns {Object|null} 完整会话数据
 */
async function getSessionById(sessionId) {
  const status = await idxGetSessionStatus('gemini', sessionId);
  if (!status) return null;
  const fullSession = readSessionFull(status.filePath);
  if (!fullSession) return null;
  return {
    ...fullSession,
    filePath: status.filePath,
    size: status.size,
    mtime: new Date(status.lastModified).toISOString(),
    source: 'gemini'
  };
}

/**
 * 全局搜索会话内容
 * @param {string} keyword - 搜索关键词
 * @param {number} contextLength - 上下文长度（可选）
 * @returns {Array} 搜索结果数组
 */
async function searchSessions(keyword, contextLength = 35) {
  const results = await idxSearch('gemini', keyword, { contextLength });
  return results.map(result => ({
    sessionId: result.sessionId,
    projectHash: result.projectName,
    firstMessage: result.firstMessage,
    lastUpdated: result.updatedAt || null,
    matches: result.matches.map(match => ({
      messageIndex: match.ordinal,
      role: match.type === 'gemini' ? 'gemini' : match.role,
      context: match.context,
      timestamp: match.timestamp
    })),
    matchCount: result.matchCount,
    source: 'gemini'
  }));
}

/**
 * 保存会话顺序（Gemini 不需要持久化顺序，前端自行处理）
 * @param {string} projectHash - 项目 hash
 * @param {Array} order - 会话 ID 顺序数组
 */
function saveSessionOrder(projectHash, order) {
  // Gemini 不需要持久化会话顺序
  // 前端可以使用 localStorage 保存
  return { success: true };
}

/**
 * Fork 会话（复制会话文件）
 * @param {string} sessionId - 原会话 ID
 * @returns {Object} Fork 结果
 */
function forkSession(sessionId, options = {}) {
  const allSessions = getAllSessions();
  const sourceSession = allSessions.find(s => s.sessionId === sessionId);

  if (!sourceSession) {
    throw new Error('Source session not found');
  }

  const fullSession = readSessionFull(sourceSession.filePath);

  if (!fullSession) {
    throw new Error('Failed to read source session');
  }

  const sourceMessages = Array.isArray(fullSession.messages) ? fullSession.messages : [];
  let truncatedMessages = sourceMessages;
  if (Number.isInteger(options.afterUserMessageNumber) && options.afterUserMessageNumber > 0) {
    let matchedUserMessages = 0;
    let targetUserIndex = -1;
    for (let index = 0; index < sourceMessages.length; index += 1) {
      if (sourceMessages[index]?.type !== 'user') continue;
      matchedUserMessages += 1;
      if (matchedUserMessages >= options.afterUserMessageNumber) {
        targetUserIndex = index;
        break;
      }
    }

    if (targetUserIndex < 0) {
      throw new Error(`afterUserMessageNumber ${options.afterUserMessageNumber} exceeds available user messages (${matchedUserMessages})`);
    }

    let nextUserIndex = sourceMessages.length;
    for (let index = targetUserIndex + 1; index < sourceMessages.length; index += 1) {
      if (sourceMessages[index]?.type === 'user') {
        nextUserIndex = index;
        break;
      }
    }

    truncatedMessages = sourceMessages.slice(0, nextUserIndex);
  }

  // 生成新的会话 ID
  const newSessionId = crypto.randomUUID();
  const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
  const shortId = crypto.randomBytes(4).toString('hex');
  const newExtension = path.extname(sourceSession.filePath) === '.jsonl' ? 'jsonl' : 'json';
  const newFileName = `session-${timestamp}-${shortId}.${newExtension}`;

  // 创建新会话
  const newSession = {
    ...fullSession,
    sessionId: newSessionId,
    startTime: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    forkedFrom: sessionId,
    messages: truncatedMessages
  };

  // 写入新文件
  const chatsDir = path.dirname(sourceSession.filePath);
  const newFilePath = path.join(chatsDir, newFileName);

  try {
    if (newExtension === 'jsonl') {
      const { messages, ...sessionHeader } = newSession;
      fs.writeFileSync(newFilePath, `${JSON.stringify(sessionHeader)}\n${truncatedMessages.map(message => JSON.stringify(message)).join('\n')}\n`, 'utf8');
    } else {
      fs.writeFileSync(newFilePath, JSON.stringify(newSession, null, 2), 'utf8');
    }
    if (options.alias) {
      const { setAlias } = require('./alias');
      setAlias(newSessionId, options.alias);
    }

    return {
      success: true,
      sessionId: newSessionId,
      filePath: newFilePath,
      forkedFrom: sessionId,
      alias: options.alias || null,
      afterUserMessageNumber: options.afterUserMessageNumber || null
    };
  } catch (err) {
    throw new Error('Failed to fork session: ' + err.message);
  }
}

/**
 * 获取 Gemini 项目与会话数量（仪表盘轻量统计）
 */
function getProjectAndSessionCounts() {
  try {
    const projectEntries = scanProjectEntries();
    let sessionCount = 0;
    const projectHashes = new Set();
    projectEntries.forEach((entry) => {
      projectHashes.add(resolveProjectHashForEntry(entry));
      sessionCount += scanEntrySessionFiles(entry).length;
    });
    return {
      projectCount: Array.from(projectHashes).filter(Boolean).length,
      sessionCount
    };
  } catch (err) {
    return { projectCount: 0, sessionCount: 0 };
  }
}

module.exports = {
  getAllSessions,
  getProjects,
  getProjectSessions,
  getSession,
  getSessionById,
  deleteSession,
  deleteProject,
  normalizeSession,
  saveProjectOrder,
  getRecentSessions,
  searchSessions,
  saveSessionOrder,
  forkSession,
  getProjectPath,
  getProjectAndSessionCounts
};
