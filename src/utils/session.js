// 会话相关工具函数
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

/**
 * 获取会话目录
 */
function getSessionsDir(config) {
  return path.join(config.projectsDir, config.currentProject);
}

/**
 * 获取所有会话文件
 */
function getAllSessions(config) {
  const sessionsDir = getSessionsDir(config);
  if (!fs.existsSync(sessionsDir)) {
    console.log(chalk.red(`会话目录不存在: ${sessionsDir}`));
    return [];
  }

  const files = fs.readdirSync(sessionsDir)
    .filter(file => file.endsWith('.jsonl') && !file.startsWith('agent-'))
    .map(file => {
      const filePath = path.join(sessionsDir, file);
      const stats = fs.statSync(filePath);
      return {
        sessionId: file.replace('.jsonl', ''),
        filePath,
        size: stats.size,
        mtime: stats.mtime,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);

  return files;
}

/**
 * 快速解析会话信息（读取开头和结尾）
 */
function parseSessionInfoFast(filePath) {
  try {
    const fileSize = fs.statSync(filePath).size;

    // 如果文件太大（>10MB），只读取开头和结尾
    if (fileSize > 10 * 1024 * 1024) {
      const fd = fs.openSync(filePath, 'r');

      // 读取开头 8KB
      const headBuffer = Buffer.alloc(8192);
      fs.readSync(fd, headBuffer, 0, 8192, 0);

      // 读取结尾 8KB
      const tailBuffer = Buffer.alloc(8192);
      const tailOffset = Math.max(0, fileSize - 8192);
      fs.readSync(fd, tailBuffer, 0, 8192, tailOffset);

      fs.closeSync(fd);

      const headContent = headBuffer.toString('utf8');
      const tailContent = tailBuffer.toString('utf8');

      const headLines = headContent.split('\n').slice(0, 10);
      const tailLines = tailContent.split('\n').slice(-20);

      return parseLinesWithTail(headLines, tailLines);
    }

    // 小文件直接读取
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const headLines = lines.slice(0, 10);
    const tailLines = lines.slice(-20);

    return parseLinesWithTail(headLines, tailLines);
  } catch (error) {
    return { summary: '', gitBranch: '', firstMessage: '', lastMessage: '', messageCount: 0 };
  }
}

/**
 * 解析行数据（包含开头和结尾）
 */
function parseLinesWithTail(headLines, tailLines) {
  let summary = '';
  let gitBranch = '';
  let firstMessage = '';
  let lastMessage = '';
  let lastUserMessage = '';

  // 解析开头
  for (const line of headLines) {
    if (!line.trim()) continue;

    try {
      const json = JSON.parse(line);

      if (json.type === 'summary' && json.summary) {
        summary = json.summary;
      }

      if (json.gitBranch && !gitBranch) {
        gitBranch = json.gitBranch;
      }

      if (json.type === 'user' && json.message && json.message.content !== 'Warmup' && !firstMessage) {
        firstMessage = typeof json.message.content === 'string'
          ? json.message.content
          : JSON.stringify(json.message.content);
      }
    } catch (e) {
      // 忽略解析错误
    }
  }

  // 解析结尾 - 获取最后的对话
  const validTailLines = [];
  for (const line of tailLines) {
    if (!line.trim()) continue;
    try {
      const json = JSON.parse(line);
      if (json.type === 'user' || json.type === 'assistant') {
        validTailLines.push(json);
      }
    } catch (e) {
      // 忽略
    }
  }

  // 从后往前找最后一条有效消息
  for (let i = validTailLines.length - 1; i >= 0; i--) {
    const json = validTailLines[i];

    if (!lastMessage && json.type === 'assistant' && json.message && json.message.content) {
      const content = json.message.content;
      if (Array.isArray(content)) {
        for (const item of content) {
          if (item.type === 'text' && item.text) {
            lastMessage = item.text;
            break;
          }
        }
      } else if (typeof content === 'string') {
        lastMessage = content;
      }
    }

    if (!lastUserMessage && json.type === 'user' && json.message && json.message.content) {
      const content = json.message.content;
      if (typeof content === 'string' && content !== 'Warmup') {
        lastUserMessage = content;
      }
    }

    if (lastMessage && lastUserMessage) break;
  }

  return {
    summary,
    gitBranch,
    firstMessage,
    lastMessage: lastMessage || lastUserMessage, // 优先显示助手回复，否则显示用户消息
    messageCount: 0
  };
}

/**
 * 获取所有可用的项目
 */
function getAvailableProjects(config) {
  const projectsDir = config.projectsDir;
  if (!fs.existsSync(projectsDir)) {
    console.log(chalk.red(`项目目录不存在: ${projectsDir}`));
    return [];
  }

  return fs.readdirSync(projectsDir)
    .filter(file => {
      const fullPath = path.join(projectsDir, file);
      return fs.statSync(fullPath).isDirectory() && file.startsWith('-');
    })
    .map(dir => ({
      name: dir.replace(/-/g, '/').substring(1),
      value: dir,
    }));
}

module.exports = {
  getSessionsDir,
  getAllSessions,
  parseSessionInfoFast,
  parseLinesWithTail,
  getAvailableProjects,
};
