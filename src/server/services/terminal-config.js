const fs = require('fs');
const path = require('path');
const os = require('os');
const { detectAvailableTerminals, getDefaultTerminal } = require('./terminal-detector');

/**
 * 获取配置文件路径
 */
function getConfigFilePath() {
  const ccToolDir = path.join(os.homedir(), '.claude', 'cc-tool');
  if (!fs.existsSync(ccToolDir)) {
    fs.mkdirSync(ccToolDir, { recursive: true });
  }
  return path.join(ccToolDir, 'terminal-config.json');
}

/**
 * 加载终端配置
 */
function loadTerminalConfig() {
  const configPath = getConfigFilePath();

  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Failed to load terminal config:', err);
  }

  // 返回默认配置
  const defaultTerminal = getDefaultTerminal();
  return {
    selectedTerminal: defaultTerminal ? defaultTerminal.id : null,
    customCommand: null
  };
}

/**
 * 保存终端配置
 */
function saveTerminalConfig(config) {
  const configPath = getConfigFilePath();

  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    return { success: true };
  } catch (err) {
    console.error('Failed to save terminal config:', err);
    throw new Error('Failed to save terminal config: ' + err.message);
  }
}

/**
 * 获取当前选中的终端配置
 */
function getSelectedTerminal() {
  const config = loadTerminalConfig();
  const availableTerminals = detectAvailableTerminals();

  // 如果配置了自定义命令，返回自定义配置
  if (config.customCommand) {
    return {
      id: 'custom',
      name: 'Custom',
      available: true,
      isDefault: false,
      command: config.customCommand
    };
  }

  // 查找选中的终端
  const selectedTerminal = availableTerminals.find(t => t.id === config.selectedTerminal);

  // 如果找到则返回，否则返回默认终端
  return selectedTerminal || getDefaultTerminal();
}

/**
 * 获取终端启动命令（填充参数后）
 */
function getTerminalLaunchCommand(cwd, sessionId) {
  const terminal = getSelectedTerminal();

  if (!terminal) {
    throw new Error('No terminal available');
  }

  // 替换命令模板中的占位符
  let command = terminal.command
    .replace(/{cwd}/g, cwd)
    .replace(/{sessionId}/g, sessionId);

  return {
    command,
    terminalId: terminal.id,
    terminalName: terminal.name
  };
}

module.exports = {
  loadTerminalConfig,
  saveTerminalConfig,
  getSelectedTerminal,
  getTerminalLaunchCommand
};
