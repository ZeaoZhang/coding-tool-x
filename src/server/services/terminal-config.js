const fs = require('fs');
const path = require('path');
const os = require('os');
const { detectAvailableTerminals, getDefaultTerminal, getSystemShell } = require('./terminal-detector');

/**
 * 获取配置文件路径
 */
function getConfigFilePath() {
  const ccToolDir = path.join(os.homedir(), '.cc-tool');
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

function getSystemRoot() {
  return process.env.SystemRoot || process.env.windir || null;
}

function resolveWindowsShellPath(selectedTerminalId) {
  const systemRoot = getSystemRoot();

  if (selectedTerminalId === 'cmd') {
    const candidates = [];
    if (process.env.COMSPEC) {
      candidates.push(process.env.COMSPEC);
    }
    if (systemRoot) {
      candidates.push(path.join(systemRoot, 'System32', 'cmd.exe'));
    }
    return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
  }

  if (selectedTerminalId === 'powershell') {
    const candidates = [];
    if (systemRoot) {
      candidates.push(path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
    }
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    candidates.push(path.join(programFiles, 'PowerShell', '7', 'pwsh.exe'));
    return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
  }

  if (selectedTerminalId === 'git-bash') {
    const terminals = detectAvailableTerminals();
    const gitBash = terminals.find(t => t.id === 'git-bash');
    if (gitBash && gitBash.executablePath && fs.existsSync(gitBash.executablePath)) {
      return gitBash.executablePath;
    }
  }

  return null;
}

function getWebTerminalShellConfig() {
  const config = loadTerminalConfig();
  const selectedTerminalId = config.selectedTerminal;

  if (!selectedTerminalId) {
    return {};
  }

  if (selectedTerminalId === 'system-shell') {
    const shell = getSystemShell();
    if (shell) {
      return { shell };
    }
    return {};
  }

  if (process.platform !== 'win32') {
    return {};
  }

  const shell = resolveWindowsShellPath(selectedTerminalId);
  if (!shell) {
    return {};
  }

  const args = [];
  if (selectedTerminalId === 'git-bash') {
    args.push('--login', '-i');
  }

  return { shell, args };
}

/**
 * 获取终端启动命令（填充参数后）
 * @param {string} cwd - 工作目录
 * @param {string} sessionId - 会话ID（用于 Claude -r 参数）
 * @param {string} toolType - 工具类型 ('claude', 'codex', 'gemini')
 * @param {string} customCliCommand - 自定义 CLI 命令（如 "gemini --resume latest"），如果提供则替换默认的 claude 命令
 */
function getTerminalLaunchCommand(cwd, sessionId, toolType, customCliCommand) {
  const terminal = getSelectedTerminal();

  if (!terminal) {
    throw new Error('No terminal available');
  }

  if (terminal.supportsLocalLaunch === false || terminal.id === 'system-shell') {
    throw new Error('系统 Shell 仅用于 Web 终端，请使用 Web 终端启动会话');
  }

  let command = terminal.command;
  if (!command) {
    throw new Error('未配置终端启动命令');
  }

  // 根据工具类型构建 CLI 命令
  let cliCommand;
  if (customCliCommand) {
    cliCommand = customCliCommand;
  } else {
    // 根据工具类型选择对应的 CLI 命令
    switch (toolType) {
      case 'codex':
        cliCommand = `codex resume {sessionId}`;
        break;
      case 'gemini':
        cliCommand = `gemini -r {sessionId}`;
        break;
      case 'claude':
      default:
        cliCommand = `claude -r {sessionId}`;
        break;
    }
  }

  // 替换 sessionId 占位符
  cliCommand = cliCommand.replace(/{sessionId}/g, sessionId);

  // 替换命令中的 claude 相关部分为实际的 CLI 命令
  command = command
    .replace(/claude\s+-r\s+\{sessionId\}/g, cliCommand)
    .replace(/claude\s+-r\s+{sessionId}/g, cliCommand)
    .replace(/claude -r {sessionId}/g, cliCommand);

  // 替换 cwd 占位符
  command = command.replace(/{cwd}/g, cwd);

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
  getWebTerminalShellConfig,
  getTerminalLaunchCommand
};
