/**
 * Terminal Commands Service - CLI 启动命令配置管理
 * 管理不同渠道 (Claude/Codex/Gemini) 的 CLI 启动命令
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// 配置文件路径
const CONFIG_DIR = path.join(os.homedir(), '.cc-tool');
const CONFIG_FILE = path.join(CONFIG_DIR, 'terminal-commands.json');

// 默认命令配置
const DEFAULT_COMMANDS = {
  claude: {
    name: 'Claude Code',
    newSession: 'claude',
    resumeSession: 'claude -r {sessionId}',
    description: 'Anthropic Claude Code CLI'
  },
  codex: {
    name: 'Codex CLI',
    newSession: 'codex',
    resumeSession: 'codex resume {sessionId}',
    description: 'OpenAI Codex CLI'
  },
  gemini: {
    name: 'Gemini CLI',
    newSession: 'gemini',
    resumeSession: 'gemini -r {sessionId}',
    description: 'Google Gemini CLI'
  },
  opencode: {
    name: 'OpenCode',
    newSession: 'opencode',
    resumeSession: 'opencode -r {sessionId}',
    description: 'OpenCode AI coding agent for the terminal'
  }
};

/**
 * 确保配置目录存在
 */
function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * 加载命令配置
 * @returns {Object} 命令配置
 */
function loadTerminalCommands() {
  try {
    ensureConfigDir();

    if (fs.existsSync(CONFIG_FILE)) {
      const content = fs.readFileSync(CONFIG_FILE, 'utf8');
      const saved = JSON.parse(content);

      // 合并默认配置和已保存配置
      return {
        claude: { ...DEFAULT_COMMANDS.claude, ...saved.claude },
        codex: { ...DEFAULT_COMMANDS.codex, ...saved.codex },
        gemini: { ...DEFAULT_COMMANDS.gemini, ...saved.gemini },
        opencode: { ...DEFAULT_COMMANDS.opencode, ...saved.opencode }
      };
    }
  } catch (err) {
    console.error('Failed to load terminal commands config:', err.message);
  }

  return { ...DEFAULT_COMMANDS };
}

/**
 * 保存命令配置
 * @param {Object} commands - 命令配置
 * @returns {boolean} 是否成功
 */
function saveTerminalCommands(commands) {
  try {
    ensureConfigDir();

    // 验证配置格式
    const validated = {};
    for (const channel of ['claude', 'codex', 'gemini', 'opencode']) {
      if (commands[channel]) {
        validated[channel] = {
          name: commands[channel].name || DEFAULT_COMMANDS[channel].name,
          newSession: commands[channel].newSession || DEFAULT_COMMANDS[channel].newSession,
          resumeSession: commands[channel].resumeSession || DEFAULT_COMMANDS[channel].resumeSession,
          description: commands[channel].description || DEFAULT_COMMANDS[channel].description
        };
      } else {
        validated[channel] = { ...DEFAULT_COMMANDS[channel] };
      }
    }

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(validated, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Failed to save terminal commands config:', err.message);
    return false;
  }
}

/**
 * 获取指定渠道的启动命令
 * @param {string} channel - 渠道类型 (claude/codex/gemini)
 * @param {string|null} sessionId - 会话 ID (可选)
 * @param {string|null} cwd - 工作目录 (可选)
 * @returns {string} 启动命令
 */
function getCommandForChannel(channel, sessionId = null, cwd = null) {
  // Add support for plain shell (do not auto-run any command)
  if (channel === 'shell') {
    return null;
  }

  const commands = loadTerminalCommands();
  const channelConfig = commands[channel] || commands.claude;

  let command;
  if (sessionId) {
    // 恢复会话命令
    command = channelConfig.resumeSession;
    command = command.replace(/{sessionId}/g, sessionId);
  } else {
    // 新会话命令
    command = channelConfig.newSession;
  }

  // 替换工作目录占位符
  if (cwd) {
    command = command.replace(/{cwd}/g, cwd);
  }

  return command;
}

/**
 * 获取默认命令配置
 * @returns {Object} 默认配置
 */
function getDefaultCommands() {
  return { ...DEFAULT_COMMANDS };
}

/**
 * 重置为默认配置
 * @returns {boolean} 是否成功
 */
function resetToDefaults() {
  return saveTerminalCommands(DEFAULT_COMMANDS);
}

module.exports = {
  loadTerminalCommands,
  saveTerminalCommands,
  getCommandForChannel,
  getDefaultCommands,
  resetToDefaults,
  DEFAULT_COMMANDS
};
