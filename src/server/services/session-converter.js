const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { getSessionById: getClaudeSessionById } = require('./sessions');
const { getSessionById: getCodexSessionById } = require('./codex-sessions');
const { getSessionById: getGeminiSessionById, getProjectPath } = require('./gemini-sessions');
const { readJSONL, parseSession: parseCodexFull } = require('./codex-parser');
const { NATIVE_PATHS, HOME_DIR } = require('../../config/paths');

const CLAUDE_PROJECTS_DIR = NATIVE_PATHS.claude.projects;
const CODEX_SESSIONS_DIR = NATIVE_PATHS.codex.sessions;
const GEMINI_TMP_DIR = NATIVE_PATHS.gemini.tmp;

/**
 * 统一中间格式
 * @typedef {Object} UnifiedSession
 * @property {string} sessionId - 会话 ID
 * @property {string} cwd - 工作目录
 * @property {string|null} gitBranch - Git 分支
 * @property {string} startTime - 开始时间（ISO 格式）
 * @property {Array<UnifiedMessage>} messages - 消息列表
 * @property {Object} metadata - 元数据
 */

/**
 * 统一消息格式
 * @typedef {Object} UnifiedMessage
 * @property {string} role - 角色 (user|assistant|system)
 * @property {string} content - 内容
 * @property {string} timestamp - 时间戳（ISO 格式）
 */

/**
 * 将 Claude Code 会话解析为统一格式
 * @param {string} filePath - Claude 会话文件路径
 * @returns {UnifiedSession}
 */
function parseClaudeToUnified(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(line => line.trim());

  const messages = [];
  let cwd = null;
  let gitBranch = null;
  let sessionId = null;
  let startTime = null;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);

      // 提取元数据
      if (entry.cwd && !cwd) {
        cwd = entry.cwd;
      }
      if (entry.gitBranch && !gitBranch) {
        gitBranch = entry.gitBranch;
      }
      if (entry.sessionId && !sessionId) {
        sessionId = entry.sessionId;
      }

      // 解析消息
      if (entry.type === 'user' && entry.message) {
        messages.push({
          role: 'user',
          content: entry.message.content || '',
          timestamp: entry.timestamp || new Date().toISOString()
        });
        if (!startTime) {
          startTime = entry.timestamp;
        }
      } else if (entry.type === 'assistant' && entry.message) {
        messages.push({
          role: 'assistant',
          content: entry.message.content || '',
          timestamp: entry.timestamp || new Date().toISOString()
        });
      } else if (entry.type === 'summary') {
        messages.push({
          role: 'system',
          content: entry.summary || '',
          timestamp: entry.timestamp || new Date().toISOString()
        });
      }
      // 忽略 file-history-snapshot 等其他类型
    } catch (err) {
      // 跳过无效行
    }
  }

  return {
    sessionId: sessionId || crypto.randomUUID(),
    cwd: cwd || process.cwd(),
    gitBranch,
    startTime: startTime || new Date().toISOString(),
    messages,
    metadata: {
      source: 'claude',
      originalPath: filePath
    }
  };
}

/**
 * 将 Codex 会话解析为统一格式
 * @param {string} filePath - Codex 会话文件路径
 * @returns {UnifiedSession}
 */
function parseCodexToUnified(filePath) {
  const session = parseCodexFull(filePath);

  if (!session) {
    throw new Error('Failed to parse Codex session');
  }

  const messages = [];
  let sessionId = null;
  let cwd = null;
  let gitBranch = null;
  let startTime = null;

  // 从元数据提取信息
  if (session.meta) {
    sessionId = session.meta.sessionId || session.sessionId;
    cwd = session.meta.cwd;
    gitBranch = session.meta.git?.branch || null;
    startTime = session.meta.timestamp;
  }

  // 转换消息
  if (session.messages && Array.isArray(session.messages)) {
    session.messages.forEach(msg => {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({
          role: msg.role,
          content: msg.content || '',
          timestamp: msg.timestamp || new Date().toISOString()
        });
      }
    });
  }

  return {
    sessionId: sessionId || crypto.randomUUID(),
    cwd: cwd || process.cwd(),
    gitBranch,
    startTime: startTime || new Date().toISOString(),
    messages,
    metadata: {
      source: 'codex',
      originalPath: filePath,
      git: session.meta?.git
    }
  };
}

/**
 * 将 Gemini 会话解析为统一格式
 * @param {string} filePath - Gemini 会话文件路径
 * @returns {UnifiedSession}
 */
function parseGeminiToUnified(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const session = JSON.parse(content);

  const messages = [];

  // 转换消息
  if (session.messages && Array.isArray(session.messages)) {
    session.messages.forEach(msg => {
      if (msg.type === 'user') {
        messages.push({
          role: 'user',
          content: msg.content || '',
          timestamp: msg.timestamp || new Date().toISOString()
        });
      } else if (msg.type === 'assistant' || msg.type === 'gemini') {
        messages.push({
          role: 'assistant',
          content: msg.content || '',
          timestamp: msg.timestamp || new Date().toISOString()
        });
      } else if (msg.type === 'info') {
        messages.push({
          role: 'system',
          content: msg.content || '',
          timestamp: msg.timestamp || new Date().toISOString()
        });
      }
    });
  }

  // 尝试从 projectHash 获取实际路径
  const projectPath = getProjectPath(session.projectHash);

  return {
    sessionId: session.sessionId || crypto.randomUUID(),
    cwd: projectPath || HOME_DIR,
    gitBranch: null, // Gemini 不记录 git branch
    startTime: session.startTime || new Date().toISOString(),
    messages,
    metadata: {
      source: 'gemini',
      originalPath: filePath,
      projectHash: session.projectHash,
      model: session.messages?.[0]?.model
    }
  };
}

/**
 * 从统一格式生成 Claude Code 会话
 * @param {UnifiedSession} unified - 统一格式会话
 * @param {string} targetPath - 目标文件路径
 * @returns {string} 生成的文件路径
 */
function generateClaudeFromUnified(unified, targetPath) {
  const lines = [];
  const version = '1.0.24'; // Claude Code 版本

  // 为每条消息生成 JSONL 行
  unified.messages.forEach(msg => {
    if (msg.role === 'user') {
      lines.push(JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: msg.content
        },
        cwd: unified.cwd,
        sessionId: unified.sessionId,
        gitBranch: unified.gitBranch,
        version,
        timestamp: msg.timestamp
      }));
    } else if (msg.role === 'assistant') {
      lines.push(JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: msg.content
        },
        sessionId: unified.sessionId,
        timestamp: msg.timestamp
      }));
    } else if (msg.role === 'system') {
      lines.push(JSON.stringify({
        type: 'summary',
        summary: msg.content,
        timestamp: msg.timestamp
      }));
    }
  });

  // 确保目标目录存在
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 写入文件
  fs.writeFileSync(targetPath, lines.join('\n') + '\n', 'utf8');

  return targetPath;
}

/**
 * 从统一格式生成 Codex 会话
 * @param {UnifiedSession} unified - 统一格式会话
 * @param {string} targetPath - 目标文件路径
 * @returns {string} 生成的文件路径
 */
function generateCodexFromUnified(unified, targetPath) {
  const lines = [];

  // 生成 session_start 事件
  lines.push(JSON.stringify({
    type: 'event',
    event: {
      type: 'session_start',
      session_id: unified.sessionId,
      cwd: unified.cwd,
      git: unified.gitBranch ? {
        branch: unified.gitBranch,
        repositoryUrl: unified.metadata.git?.repositoryUrl || null
      } : null
    },
    timestamp: unified.startTime
  }));

  // 生成消息
  unified.messages.forEach(msg => {
    if (msg.role === 'user' || msg.role === 'assistant') {
      lines.push(JSON.stringify({
        type: 'message',
        message: {
          role: msg.role,
          content: msg.content
        },
        timestamp: msg.timestamp
      }));
    }
    // 忽略 system 消息（Codex 不支持）
  });

  // 确保目标目录存在
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 写入文件
  fs.writeFileSync(targetPath, lines.join('\n') + '\n', 'utf8');

  return targetPath;
}

/**
 * 从统一格式生成 Gemini 会话
 * @param {UnifiedSession} unified - 统一格式会话
 * @param {string} targetPath - 目标文件路径
 * @returns {string} 生成的文件路径
 */
function generateGeminiFromUnified(unified, targetPath) {
  // 计算 projectHash（如果有 cwd）
  let projectHash;
  if (unified.metadata.projectHash) {
    projectHash = unified.metadata.projectHash;
  } else {
    projectHash = crypto.createHash('sha256').update(unified.cwd).digest('hex');
  }

  // 转换消息
  const messages = unified.messages.map(msg => {
    const geminiMsg = {
      type: msg.role === 'user' ? 'user' : msg.role === 'assistant' ? 'assistant' : 'info',
      content: msg.content,
      timestamp: msg.timestamp
    };

    // 如果是 assistant 消息，添加 model 信息
    if (msg.role === 'assistant') {
      geminiMsg.model = unified.metadata.model || 'gemini-2.5-pro';
    }

    return geminiMsg;
  });

  // 计算最后更新时间
  const lastUpdated = messages.length > 0
    ? messages[messages.length - 1].timestamp
    : unified.startTime;

  const session = {
    sessionId: unified.sessionId,
    projectHash,
    startTime: unified.startTime,
    lastUpdated,
    messages
  };

  // 确保目标目录存在
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 写入文件
  fs.writeFileSync(targetPath, JSON.stringify(session, null, 2), 'utf8');

  return targetPath;
}

/**
 * 生成目标路径
 * @param {string} targetType - 目标格式 (claude|codex|gemini)
 * @param {UnifiedSession} unified - 统一格式会话
 * @param {Object} options - 选项
 * @returns {string} 目标文件路径
 */
function generateTargetPath(targetType, unified, options = {}) {
  const newSessionId = options.sessionId || crypto.randomUUID();

  if (targetType === 'claude') {
    // Claude: ~/.claude/projects/{encoded-path}/{uuid}.jsonl
    const projectsDir = CLAUDE_PROJECTS_DIR;
    const encodedPath = options.targetProject
      ? encodePath(options.targetProject)
      : encodePath(unified.cwd);

    return path.join(projectsDir, encodedPath, `${newSessionId}.jsonl`);
  } else if (targetType === 'codex') {
    // Codex: ~/.codex/sessions/{YYYY}/{MM}/{DD}/rollout-{timestamp}-{uuid}.jsonl
    const sessionsDir = CODEX_SESSIONS_DIR;
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const timestamp = now.toISOString()
      .replace(/\.\d{3}Z$/, '')
      .replace(/:/g, '-');

    return path.join(sessionsDir, String(year), month, day,
      `rollout-${timestamp}-${newSessionId}.jsonl`);
  } else if (targetType === 'gemini') {
    // Gemini: ~/.gemini/tmp/{project_hash}/chats/session-{timestamp}-{shortId}.json
    const geminiDir = GEMINI_TMP_DIR;
    const projectHash = unified.metadata.projectHash ||
      crypto.createHash('sha256').update(unified.cwd).digest('hex');
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const shortId = crypto.randomBytes(4).toString('hex');

    return path.join(geminiDir, projectHash, 'chats',
      `session-${timestamp}-${shortId}.json`);
  } else {
    throw new Error(`Unsupported target type: ${targetType}`);
  }
}

/**
 * 编码路径（Claude Code 格式）
 * @param {string} realPath - 真实路径
 * @returns {string} 编码后的路径
 */
function encodePath(realPath) {
  // macOS/Linux: /Users/user/project -> -Users-user-project
  // Windows: C:\Users\user\project -> C--Users-user-project
  if (process.platform === 'win32') {
    return realPath.replace(/\\/g, '-').replace(/:/g, '--');
  } else {
    return realPath.replace(/\//g, '-');
  }
}

/**
 * 主转换函数
 * @param {string} sourceType - 源格式 (claude|codex|gemini)
 * @param {string} targetType - 目标格式 (claude|codex|gemini)
 * @param {string} sessionId - 会话 ID
 * @param {Object} options - 选项
 * @returns {Object} 转换结果
 */
async function convertSession(sourceType, targetType, sessionId, options = {}) {
  // 验证参数
  const validTypes = ['claude', 'codex', 'gemini'];
  if (!validTypes.includes(sourceType)) {
    throw new Error(`Invalid source type: ${sourceType}`);
  }
  if (!validTypes.includes(targetType)) {
    throw new Error(`Invalid target type: ${targetType}`);
  }
  if (sourceType === targetType) {
    throw new Error('Source and target types must be different');
  }

  // 1. 读取源会话
  let sourceFilePath;
  let sourceSession;

  if (sourceType === 'claude') {
    const { getConfig } = require('../config/default');
    const config = getConfig();
    const sessions = require('./sessions');
    const allSessions = require('../../utils/session').getAllSessions(config);
    sourceSession = allSessions.find(s => s.sessionId === sessionId);
    if (!sourceSession) {
      throw new Error('Source session not found');
    }
    sourceFilePath = sourceSession.filePath;
  } else if (sourceType === 'codex') {
    sourceSession = await getCodexSessionById(sessionId);
    if (!sourceSession) {
      throw new Error('Source session not found');
    }
    sourceFilePath = sourceSession.filePath;
  } else if (sourceType === 'gemini') {
    sourceSession = await getGeminiSessionById(sessionId);
    if (!sourceSession) {
      throw new Error('Source session not found');
    }
    sourceFilePath = sourceSession.filePath;
  }

  // 2. 解析为统一格式
  let unified;
  if (sourceType === 'claude') {
    unified = parseClaudeToUnified(sourceFilePath);
  } else if (sourceType === 'codex') {
    unified = parseCodexToUnified(sourceFilePath);
  } else if (sourceType === 'gemini') {
    unified = parseGeminiToUnified(sourceFilePath);
  }

  // 3. 生成目标路径
  const targetPath = generateTargetPath(targetType, unified, options);

  // 4. 生成目标格式
  let generatedPath;
  if (targetType === 'claude') {
    generatedPath = generateClaudeFromUnified(unified, targetPath);
  } else if (targetType === 'codex') {
    generatedPath = generateCodexFromUnified(unified, targetPath);
  } else if (targetType === 'gemini') {
    generatedPath = generateGeminiFromUnified(unified, targetPath);
  }

  return {
    success: true,
    sourceType,
    targetType,
    sourceSessionId: sessionId,
    targetPath: generatedPath,
    targetSessionId: path.basename(generatedPath, path.extname(generatedPath)).split('-').pop(),
    messageCount: unified.messages.length
  };
}

/**
 * 预览转换（不写入文件）
 * @param {string} sourceType - 源格式
 * @param {string} sessionId - 会话 ID
 * @returns {Object} 预览数据
 */
async function previewConversion(sourceType, sessionId) {
  let sourceFilePath;

  if (sourceType === 'claude') {
    const { getConfig } = require('../config/default');
    const config = getConfig();
    const allSessions = require('../../utils/session').getAllSessions(config);
    const sourceSession = allSessions.find(s => s.sessionId === sessionId);
    if (!sourceSession) {
      throw new Error('Source session not found');
    }
    sourceFilePath = sourceSession.filePath;
  } else if (sourceType === 'codex') {
    const sourceSession = await getCodexSessionById(sessionId);
    if (!sourceSession) {
      throw new Error('Source session not found');
    }
    sourceFilePath = sourceSession.filePath;
  } else if (sourceType === 'gemini') {
    const sourceSession = await getGeminiSessionById(sessionId);
    if (!sourceSession) {
      throw new Error('Source session not found');
    }
    sourceFilePath = sourceSession.filePath;
  }

  // 解析为统一格式
  let unified;
  if (sourceType === 'claude') {
    unified = parseClaudeToUnified(sourceFilePath);
  } else if (sourceType === 'codex') {
    unified = parseCodexToUnified(sourceFilePath);
  } else if (sourceType === 'gemini') {
    unified = parseGeminiToUnified(sourceFilePath);
  }

  return {
    sessionId: unified.sessionId,
    cwd: unified.cwd,
    gitBranch: unified.gitBranch,
    startTime: unified.startTime,
    messageCount: unified.messages.length,
    messages: unified.messages.slice(0, 5), // 只返回前 5 条消息作为预览
    metadata: unified.metadata
  };
}

module.exports = {
  convertSession,
  previewConversion,
  parseClaudeToUnified,
  parseCodexToUnified,
  parseGeminiToUnified,
  generateClaudeFromUnified,
  generateCodexFromUnified,
  generateGeminiFromUnified
};
