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

  // Ghostty
  if (fs.existsSync('/Applications/Ghostty.app')) {
    terminals.push({
      id: 'ghostty',
      name: 'Ghostty',
      available: true,
      isDefault: false,
      command: 'open -a Ghostty --args -e "cd \'{cwd}\' && claude -r {sessionId}; exec $SHELL"'
    });
  }
  // 也检查 homebrew 安装的 ghostty
  try {
    execSync('which ghostty', { encoding: 'utf8', stdio: 'pipe' });
    if (!terminals.find(t => t.id === 'ghostty')) {
      terminals.push({
        id: 'ghostty',
        name: 'Ghostty',
        available: true,
        isDefault: false,
        command: 'ghostty -e "cd \'{cwd}\' && claude -r {sessionId}; exec $SHELL"'
      });
    }
  } catch (e) {
    // Ghostty CLI 不可用
  }

  // Alacritty
  if (fs.existsSync('/Applications/Alacritty.app')) {
    terminals.push({
      id: 'alacritty',
      name: 'Alacritty',
      available: true,
      isDefault: false,
      command: 'alacritty --working-directory "{cwd}" -e bash -c "claude -r {sessionId}; exec bash"'
    });
  } else {
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
  }

  // Kitty
  if (fs.existsSync('/Applications/kitty.app')) {
    terminals.push({
      id: 'kitty',
      name: 'Kitty',
      available: true,
      isDefault: false,
      command: 'kitty --directory "{cwd}" bash -c "claude -r {sessionId}; exec bash"'
    });
  } else {
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

  // Hyper
  if (fs.existsSync('/Applications/Hyper.app')) {
    terminals.push({
      id: 'hyper',
      name: 'Hyper',
      available: true,
      isDefault: false,
      command: 'open -a Hyper --args "{cwd}"'
    });
  }

  // WezTerm
  if (fs.existsSync('/Applications/WezTerm.app')) {
    terminals.push({
      id: 'wezterm',
      name: 'WezTerm',
      available: true,
      isDefault: false,
      command: 'wezterm start --cwd "{cwd}" -- bash -c "claude -r {sessionId}; exec bash"'
    });
  } else {
    try {
      execSync('which wezterm', { encoding: 'utf8', stdio: 'pipe' });
      terminals.push({
        id: 'wezterm',
        name: 'WezTerm',
        available: true,
        isDefault: false,
        command: 'wezterm start --cwd "{cwd}" -- bash -c "claude -r {sessionId}; exec bash"'
      });
    } catch (e) {
      // WezTerm 不可用
    }
  }

  // Rio
  try {
    execSync('which rio', { encoding: 'utf8', stdio: 'pipe' });
    terminals.push({
      id: 'rio',
      name: 'Rio',
      available: true,
      isDefault: false,
      command: 'rio -e bash -c "cd \'{cwd}\' && claude -r {sessionId}; exec bash"'
    });
  } catch (e) {
    // Rio 不可用
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
    { id: 'tilix', name: 'Tilix', cmd: 'tilix', args: '-e "bash -c \\"cd \'{cwd}\' && claude -r {sessionId}; exec bash\\""' },
    { id: 'ghostty', name: 'Ghostty', cmd: 'ghostty', args: '-e "cd \'{cwd}\' && claude -r {sessionId}; exec $SHELL"' },
    { id: 'wezterm', name: 'WezTerm', cmd: 'wezterm', args: 'start --cwd "{cwd}" -- bash -c "claude -r {sessionId}; exec bash"' },
    { id: 'rio', name: 'Rio', cmd: 'rio', args: '-e bash -c "cd \'{cwd}\' && claude -r {sessionId}; exec bash"' },
    { id: 'foot', name: 'Foot', cmd: 'foot', args: 'bash -c "cd \'{cwd}\' && claude -r {sessionId}; exec bash"' },
    { id: 'terminator', name: 'Terminator', cmd: 'terminator', args: '-e "bash -c \\"cd \'{cwd}\' && claude -r {sessionId}; exec bash\\""' },
    { id: 'urxvt', name: 'URxvt', cmd: 'urxvt', args: '-e bash -c "cd \'{cwd}\' && claude -r {sessionId}; exec bash"' },
    { id: 'st', name: 'st (suckless)', cmd: 'st', args: '-e bash -c "cd \'{cwd}\' && claude -r {sessionId}; exec bash"' }
  ];

  let foundDefault = false;
  terminalConfigs.forEach((config) => {
    try {
      execSync(`which ${config.cmd}`, { encoding: 'utf8', stdio: 'pipe' });
      terminals.push({
        id: config.id,
        name: config.name,
        available: true,
        isDefault: !foundDefault,  // 第一个可用的设为默认
        command: `${config.cmd} ${config.args}`
      });
      foundDefault = true;
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
