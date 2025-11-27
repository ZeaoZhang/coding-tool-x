const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { getGeminiDir } = require('./gemini-config');

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

  const projectHashes = scanProjects();
  if (projectHashes.length === 0) {
    pathMappingCache = new Map();
    pathMappingCacheTime = now;
    return pathMappingCache;
  }

  const targetHashes = new Set(projectHashes);
  const results = new Map();
  const homeDir = os.homedir();

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
  const tmpDir = getTmpDir();

  if (!fs.existsSync(tmpDir)) {
    return [];
  }

  const entries = fs.readdirSync(tmpDir, { withFileTypes: true });

  return entries
    .filter(entry => entry.isDirectory())
    // 过滤掉非项目目录（如 bin）- projectHash 是 64 位十六进制字符串
    .filter(entry => /^[a-f0-9]{64}$/.test(entry.name))
    .map(entry => entry.name); // 项目 hash
}

/**
 * 扫描单个项目的所有会话文件
 * @param {string} projectHash - 项目 hash
 * @returns {Array} 会话文件路径数组
 */
function scanProjectSessions(projectHash) {
  const chatsDir = path.join(getTmpDir(), projectHash, 'chats');

  if (!fs.existsSync(chatsDir)) {
    return [];
  }

  const entries = fs.readdirSync(chatsDir, { withFileTypes: true });

  return entries
    .filter(entry => entry.isFile() && entry.name.match(/^session-.*\.json$/))
    .map(entry => {
      const filePath = path.join(chatsDir, entry.name);
      // 文件名格式：session-2025-11-23T02-09-87570eb4.json
      // session-{timestamp}-{shortId}.json
      const match = entry.name.match(/^session-(.*)-([a-f0-9]+)\.json$/);

      if (!match) return null;

      return {
        filePath,
        timestamp: match[1],
        shortId: match[2],
        projectHash
      };
    })
    .filter(Boolean);
}

/**
 * 读取会话文件元数据（轻量级）
 * @param {string} filePath - 会话文件路径
 * @returns {Object|null} 会话元数据
 */
function readSessionMeta(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const session = JSON.parse(content);

    // Gemini 会话文件结构
    // {
    //   sessionId: "uuid",
    //   projectHash: "hash",
    //   startTime: "ISO timestamp",
    //   lastUpdated: "ISO timestamp",
    //   messages: [...]
    // }

    const messages = session.messages || [];
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
          // gemini-2.5-pro: $1.25 / 1M input, $5 / 1M output
          totalCost += (inputTokens * 1.25 / 1000000) + (outputTokens * 5 / 1000000);
        }
      }
    });

    return {
      sessionId: session.sessionId,
      projectHash: session.projectHash,
      startTime: session.startTime,
      lastUpdated: session.lastUpdated,
      messageCount: messages.length,
      firstMessage: firstUserMessage ? firstUserMessage.content : '',
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
    return JSON.parse(content);
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
  const projectHashes = scanProjects();
  const allSessions = [];

  projectHashes.forEach(projectHash => {
    const sessionFiles = scanProjectSessions(projectHash);

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
    projectName: geminiSession.projectHash // 兼容前端统一使用 projectName
  };
}

/**
 * 获取项目的工作目录路径（使用彩虹表方法反推）
 * @param {string} projectHash - 项目 hash
 * @returns {string|null} 项目路径
 */
function getProjectPath(projectHash) {
  const pathMapping = buildPathMapping();
  return pathMapping.get(projectHash) || null;
}

/**
 * 聚合项目列表
 * @returns {Array} 项目对象数组
 */
function getProjects() {
  const sessions = getAllSessions();
  const projectMap = new Map();

  sessions.forEach(session => {
    const projectHash = session.projectHash;

    if (!projectMap.has(projectHash)) {
      const projectPath = getProjectPath(projectHash);

      // 如果找到了真实路径，使用目录名作为显示名称
      let displayName;
      if (projectPath) {
        displayName = path.basename(projectPath);
        // 如果是 home 目录，显示 ~
        if (projectPath === os.homedir()) {
          displayName = '~';
        }
      } else {
        // 未找到路径，使用 hash 前 8 位
        displayName = `Project ${projectHash.substring(0, 8)}`;
      }

      projectMap.set(projectHash, {
        name: projectHash,
        displayName,
        path: projectPath,
        sessionCount: 0,
        lastUpdated: session.lastUpdated,
        source: 'gemini'
      });
    }

    const project = projectMap.get(projectHash);
    project.sessionCount++;

    // 更新最后活动时间
    if (new Date(session.lastUpdated) > new Date(project.lastUpdated)) {
      project.lastUpdated = session.lastUpdated;
    }
  });

  // 转换为数组并排序（按最后活动时间）
  const projects = Array.from(projectMap.values());
  projects.sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));

  return projects;
}

/**
 * 获取指定项目的所有会话
 * @param {string} projectHash - 项目 hash
 * @returns {Array} 会话对象数组
 */
function getProjectSessions(projectHash) {
  const allSessions = getAllSessions();
  return allSessions
    .filter(session => session.projectHash === projectHash)
    .map(normalizeSession);
}

/**
 * 获取单个会话的完整内容
 * @param {string} sessionId - 会话 ID
 * @returns {Object|null} 完整会话数据
 */
function getSession(sessionId) {
  const allSessions = getAllSessions();
  const session = allSessions.find(s => s.sessionId === sessionId);

  if (!session) {
    return null;
  }

  return readSessionFull(session.filePath);
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
  const projectDir = path.join(getTmpDir(), projectHash);

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
function getRecentSessions(limit = 5) {
  const allSessions = getAllSessions();
  return allSessions
    .slice(0, limit)
    .map(normalizeSession);
}

/**
 * 按 sessionId 获取会话（返回完整数据用于消息显示）
 * @param {string} sessionId - 会话 ID
 * @returns {Object|null} 完整会话数据
 */
function getSessionById(sessionId) {
  const allSessions = getAllSessions();
  const sessionMeta = allSessions.find(s => s.sessionId === sessionId);

  if (!sessionMeta) {
    return null;
  }

  const fullSession = readSessionFull(sessionMeta.filePath);

  if (!fullSession) {
    return null;
  }

  // 合并元数据
  return {
    ...fullSession,
    filePath: sessionMeta.filePath,
    size: sessionMeta.size,
    mtime: sessionMeta.mtime,
    source: 'gemini'
  };
}

/**
 * 全局搜索会话内容
 * @param {string} keyword - 搜索关键词
 * @param {number} contextLength - 上下文长度（可选）
 * @returns {Array} 搜索结果数组
 */
function searchSessions(keyword, contextLength = 35) {
  const allSessions = getAllSessions();
  const results = [];

  allSessions.forEach(sessionMeta => {
    const fullSession = readSessionFull(sessionMeta.filePath);

    if (!fullSession || !fullSession.messages) {
      return;
    }

    const matches = [];

    fullSession.messages.forEach((msg, index) => {
      let content = '';

      // 提取消息内容
      if (msg.type === 'user' || msg.type === 'assistant') {
        content = msg.content || '';
      }

      // 搜索关键词
      const lowerContent = content.toLowerCase();
      const lowerKeyword = keyword.toLowerCase();

      if (lowerContent.includes(lowerKeyword)) {
        const keywordIndex = lowerContent.indexOf(lowerKeyword);

        // 提取上下文
        const start = Math.max(0, keywordIndex - contextLength);
        const end = Math.min(content.length, keywordIndex + keyword.length + contextLength);

        let context = content.substring(start, end);

        // 添加省略号
        if (start > 0) context = '...' + context;
        if (end < content.length) context = context + '...';

        matches.push({
          messageIndex: index,
          role: msg.type,
          context,
          timestamp: msg.timestamp
        });
      }
    });

    if (matches.length > 0) {
      results.push({
        sessionId: sessionMeta.sessionId,
        projectHash: sessionMeta.projectHash,
        firstMessage: sessionMeta.firstMessage,
        lastUpdated: sessionMeta.lastUpdated,
        matches,
        matchCount: matches.length,
        source: 'gemini'
      });
    }
  });

  // 按匹配数量排序
  results.sort((a, b) => b.matchCount - a.matchCount);

  return results;
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
function forkSession(sessionId) {
  const allSessions = getAllSessions();
  const sourceSession = allSessions.find(s => s.sessionId === sessionId);

  if (!sourceSession) {
    throw new Error('Source session not found');
  }

  const fullSession = readSessionFull(sourceSession.filePath);

  if (!fullSession) {
    throw new Error('Failed to read source session');
  }

  // 生成新的会话 ID
  const newSessionId = crypto.randomUUID();
  const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
  const shortId = crypto.randomBytes(4).toString('hex');
  const newFileName = `session-${timestamp}-${shortId}.json`;

  // 创建新会话
  const newSession = {
    ...fullSession,
    sessionId: newSessionId,
    startTime: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    forkedFrom: sessionId
  };

  // 写入新文件
  const chatsDir = path.join(getTmpDir(), sourceSession.projectHash, 'chats');
  const newFilePath = path.join(chatsDir, newFileName);

  try {
    fs.writeFileSync(newFilePath, JSON.stringify(newSession, null, 2), 'utf8');

    return {
      success: true,
      sessionId: newSessionId,
      filePath: newFilePath,
      forkedFrom: sessionId
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
    const projectHashes = scanProjects();
    let sessionCount = 0;
    projectHashes.forEach((hash) => {
      sessionCount += scanProjectSessions(hash).length;
    });
    return {
      projectCount: projectHashes.length,
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
