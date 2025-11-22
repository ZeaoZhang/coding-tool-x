const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * 检测系统中可用的终端工具
 */
function detectAvailableTerminals() {
  const platform = process.platform;

  if (platform === 'win32') {
    return detectWindowsTerminals();
  } else if (platform === 'darwin') {
    return detectMacTerminals();
  } else {
    return detectLinuxTerminals();
  }
}

/**
 * Windows 终端检测
 * 只保留经过验证、确定能自动执行命令的终端
 */
function detectWindowsTerminals() {
  const terminals = [];

  // CMD - 系统自带，始终可用
  terminals.push({
    id: 'cmd',
    name: 'CMD',
    available: true,
    isDefault: true,
    command: 'start "Claude Session" cmd /k "cd /d "{cwd}" && claude -r {sessionId}"'
  });

  // PowerShell
  try {
    execSync('where powershell', { encoding: 'utf8', stdio: 'pipe' });
    terminals.push({
      id: 'powershell',
      name: 'PowerShell',
      available: true,
      isDefault: false,
      command: 'start powershell -NoExit -Command "cd \'{cwd}\'; claude -r {sessionId}"'
    });
  } catch (e) {
    // PowerShell 不可用
  }

  // Windows Terminal
  try {
    execSync('where wt', { encoding: 'utf8', stdio: 'pipe' });
    terminals.push({
      id: 'windows-terminal',
      name: 'Windows Terminal',
      available: true,
      isDefault: false,
      command: 'wt.exe -d "{cwd}" cmd /k "claude -r {sessionId}"'
    });
  } catch (e) {
    // Windows Terminal 不可用
  }

  // Git Bash
  const gitBashPaths = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe'
  ];

  for (const bashPath of gitBashPaths) {
    if (fs.existsSync(bashPath)) {
      terminals.push({
        id: 'git-bash',
        name: 'Git Bash',
        available: true,
        isDefault: false,
        command: `start "" "${bashPath}" -c "cd '{cwd}' && claude -r {sessionId}; exec bash"`,
        executablePath: bashPath
      });
      break;
    }
  }

  return terminals;
}

/**
 * macOS 终端检测
 */
function detectMacTerminals() {
  const terminals = [];

  // Terminal.app - 系统自带，始终可用
  terminals.push({
    id: 'terminal',
    name: 'Terminal.app',
    available: true,
    isDefault: true,
    command: 'osascript -e \'tell application "Terminal" to activate\' -e \'tell application "Terminal" to do script "cd \'{cwd}\' && claude -r {sessionId}"\''
  });

  // iTerm2
  if (fs.existsSync('/Applications/iTerm.app')) {
    terminals.push({
      id: 'iterm2',
      name: 'iTerm2',
      available: true,
      isDefault: false,
      command: 'osascript -e \'tell application "iTerm" to create window with default profile command "cd {cwd} && claude -r {sessionId}"\''
    });
  }

  // Alacritty
  try {
    execSync('which alacritty', { encoding: 'utf8', stdio: 'pipe' });
    terminals.push({
      id: 'alacritty',
      name: 'Alacritty',
      available: true,
      isDefault: false,
      command: 'alacritty --working-directory "{cwd}" -e bash -c "claude -r {sessionId}; exec bash"'
    });
  } catch (e) {
    // Alacritty 不可用
  }

  // Kitty
  try {
    execSync('which kitty', { encoding: 'utf8', stdio: 'pipe' });
    terminals.push({
      id: 'kitty',
      name: 'Kitty',
      available: true,
      isDefault: false,
      command: 'kitty --directory "{cwd}" bash -c "claude -r {sessionId}; exec bash"'
    });
  } catch (e) {
    // Kitty 不可用
  }

  // Warp
  if (fs.existsSync('/Applications/Warp.app')) {
    terminals.push({
      id: 'warp',
      name: 'Warp',
      available: true,
      isDefault: false,
      command: 'open -a Warp "{cwd}" --args -e "claude -r {sessionId}"'
    });
  }

  return terminals;
}

/**
 * Linux 终端检测
 */
function detectLinuxTerminals() {
  const terminals = [];

  const terminalConfigs = [
    { id: 'gnome-terminal', name: 'GNOME Terminal', cmd: 'gnome-terminal', args: '-- bash -c "cd \'{cwd}\' && claude -r {sessionId}; exec bash"' },
    { id: 'konsole', name: 'Konsole', cmd: 'konsole', args: '-e bash -c "cd \'{cwd}\' && claude -r {sessionId}; exec bash"' },
    { id: 'xfce4-terminal', name: 'XFCE Terminal', cmd: 'xfce4-terminal', args: '-e "bash -c \\"cd \'{cwd}\' && claude -r {sessionId}; exec bash\\""' },
    { id: 'xterm', name: 'XTerm', cmd: 'xterm', args: '-e "cd \'{cwd}\' && claude -r {sessionId}; exec bash"' },
    { id: 'alacritty', name: 'Alacritty', cmd: 'alacritty', args: '--working-directory "{cwd}" -e bash -c "claude -r {sessionId}; exec bash"' },
    { id: 'kitty', name: 'Kitty', cmd: 'kitty', args: '--directory "{cwd}" bash -c "claude -r {sessionId}; exec bash"' },
    { id: 'tilix', name: 'Tilix', cmd: 'tilix', args: '-e "bash -c \\"cd \'{cwd}\' && claude -r {sessionId}; exec bash\\""' }
  ];

  terminalConfigs.forEach((config, index) => {
    try {
      execSync(`which ${config.cmd}`, { encoding: 'utf8', stdio: 'pipe' });
      terminals.push({
        id: config.id,
        name: config.name,
        available: true,
        isDefault: index === 0,  // 第一个可用的设为默认
        command: `${config.cmd} ${config.args}`
      });
    } catch (e) {
      // 此终端不可用
    }
  });

  return terminals;
}

/**
 * 获取默认终端
 */
function getDefaultTerminal() {
  const terminals = detectAvailableTerminals();
  const defaultTerminal = terminals.find(t => t.isDefault);
  return defaultTerminal || terminals[0];
}

module.exports = {
  detectAvailableTerminals,
  getDefaultTerminal
};
