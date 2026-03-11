const fs = require('fs');
const path = require('path');
const os = require('os');
const toml = require('toml');
const tomlStringify = require('@iarna/toml').stringify;
const { resolvePreferredHomeDir, isWindowsLikePlatform } = require('../../utils/home-dir');

const HOME_DIR = resolvePreferredHomeDir(process.platform, process.env, os.homedir());

// Codex 配置文件路径
function getConfigPath() {
  return path.join(HOME_DIR, '.codex', 'config.toml');
}

function getAuthPath() {
  return path.join(HOME_DIR, '.codex', 'auth.json');
}

// 备份文件路径
function getConfigBackupPath() {
  return path.join(HOME_DIR, '.codex', 'config.toml.cc-tool-backup');
}

function getAuthBackupPath() {
  return path.join(HOME_DIR, '.codex', 'auth.json.cc-tool-backup');
}

// 检查配置文件是否存在
function configExists() {
  return fs.existsSync(getConfigPath());
}

function authExists() {
  return fs.existsSync(getAuthPath());
}

// 检查是否已经有备份
function hasBackup() {
  return fs.existsSync(getConfigBackupPath()) || fs.existsSync(getAuthBackupPath());
}

const INVALID_ENV_NAME_PATTERN = /[\r\n]/;
const SHELL_MARKER_PREFIX = '# Added by Coding-Tool for Codex';

function normalizeEnvName(envName) {
  const normalized = String(envName || '').trim();
  if (!normalized || INVALID_ENV_NAME_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

function ensureParentDir(filePath) {
  const dirPath = path.dirname(filePath);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeFileAtomic(filePath, content) {
  ensureParentDir(filePath);
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;

  try {
    fs.writeFileSync(tempPath, content, 'utf8');
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch (cleanupErr) {
        // ignore cleanup errors
      }
    }
  }
}

function normalizeHomePath(filePath) {
  const normalizedPath = String(filePath || '').replace(/\\/g, '/');
  const normalizedHome = HOME_DIR.replace(/\\/g, '/');
  if (normalizedPath.startsWith(normalizedHome)) {
    return `~${normalizedPath.slice(normalizedHome.length)}`;
  }
  return filePath;
}

function compactBlankLines(lines) {
  const compacted = [];
  let previousIsBlank = false;

  for (const line of lines) {
    const isBlank = line.trim() === '';
    if (isBlank) {
      if (!previousIsBlank) {
        compacted.push('');
      }
      previousIsBlank = true;
      continue;
    }

    compacted.push(line);
    previousIsBlank = false;
  }

  while (compacted.length > 0 && compacted[compacted.length - 1].trim() === '') {
    compacted.pop();
  }

  return compacted;
}

function isPowerShellProfile(filePath) {
  return String(filePath || '').toLowerCase().endsWith('.ps1');
}

function getShellConfigCandidates() {
  const homeDir = HOME_DIR;
  const shell = String(process.env.SHELL || '').toLowerCase();
  const candidates = [];

  if (isWindowsLikePlatform(process.platform, process.env)) {
    const oneDriveDir = process.env.OneDrive || process.env.ONEDRIVE || '';

    if (shell.includes('zsh')) {
      candidates.push(path.join(homeDir, '.zshrc'));
    }

    if (shell.includes('bash')) {
      candidates.push(path.join(homeDir, '.bashrc'));
      candidates.push(path.join(homeDir, '.bash_profile'));
    }

    candidates.push(path.join(homeDir, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1'));
    candidates.push(path.join(homeDir, 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'));
    if (oneDriveDir) {
      candidates.push(path.join(oneDriveDir, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1'));
      candidates.push(path.join(oneDriveDir, 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'));
    }
    candidates.push(path.join(homeDir, '.bashrc'));
    candidates.push(path.join(homeDir, '.profile'));
  } else if (shell.includes('zsh')) {
    candidates.push(path.join(homeDir, '.zshrc'));
    candidates.push(path.join(homeDir, '.zprofile'));
    candidates.push(path.join(homeDir, '.profile'));
  } else if (shell.includes('bash')) {
    if (process.platform === 'darwin') {
      candidates.push(path.join(homeDir, '.bash_profile'));
      candidates.push(path.join(homeDir, '.bashrc'));
    } else {
      candidates.push(path.join(homeDir, '.bashrc'));
      candidates.push(path.join(homeDir, '.bash_profile'));
    }
    candidates.push(path.join(homeDir, '.profile'));
  } else {
    candidates.push(path.join(homeDir, '.zshrc'));
    candidates.push(path.join(homeDir, '.bashrc'));
    candidates.push(path.join(homeDir, '.bash_profile'));
    candidates.push(path.join(homeDir, '.profile'));
  }

  return [...new Set(candidates)];
}

function getShellReloadCommand(configPath) {
  if (!configPath) {
    return isWindowsLikePlatform(process.platform, process.env) ? '重启终端' : 'source ~/.zshrc';
  }

  const displayPath = normalizeHomePath(configPath);
  const normalized = String(displayPath || '').replace(/\\/g, '/').toLowerCase();

  if (normalized.endsWith('microsoft.powershell_profile.ps1')) {
    return '. $PROFILE';
  }
  if (normalized.endsWith('/.zshrc')) {
    return 'source ~/.zshrc';
  }
  if (normalized.endsWith('/.bash_profile')) {
    return 'source ~/.bash_profile';
  }
  if (normalized.endsWith('/.bashrc')) {
    return 'source ~/.bashrc';
  }
  if (normalized.endsWith('/.profile')) {
    return 'source ~/.profile';
  }

  if (isWindowsLikePlatform(process.platform, process.env)) {
    return '. $PROFILE';
  }

  return `source ${displayPath}`;
}

function escapeShellValue(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`');
}

function escapePowerShellValue(value) {
  return String(value ?? '')
    .replace(/`/g, '``')
    .replace(/"/g, '`"');
}

// 读取 config.toml
function readConfig() {
  try {
    const content = fs.readFileSync(getConfigPath(), 'utf8');
    return toml.parse(content);
  } catch (err) {
    throw new Error('Failed to read config.toml: ' + err.message);
  }
}

// 将配置对象转换为 TOML 字符串
function configToToml(config) {
  let content = `# Codex Configuration
# Managed by Coding-Tool (Proxy Mode)

`;

  // 写入顶级字段
  for (const [key, value] of Object.entries(config)) {
    if (key === 'model_providers') continue; // 稍后处理
    if (typeof value === 'string') {
      content += `${key} = "${value}"\n`;
    } else if (typeof value === 'boolean') {
      content += `${key} = ${value}\n`;
    } else if (typeof value === 'number') {
      content += `${key} = ${value}\n`;
    }
  }

  content += '\n';

  // 写入 model_providers
  if (config.model_providers) {
    for (const [providerKey, providerConfig] of Object.entries(config.model_providers)) {
      content += `[model_providers.${providerKey}]\n`;
      for (const [key, value] of Object.entries(providerConfig)) {
        if (typeof value === 'string') {
          content += `${key} = "${value}"\n`;
        } else if (typeof value === 'boolean') {
          content += `${key} = ${value}\n`;
        } else if (typeof value === 'number') {
          content += `${key} = ${value}\n`;
        }
      }
      content += '\n';
    }
  }

  return content;
}

// 写入 config.toml
function writeConfig(config) {
  try {
    const safeConfig = JSON.parse(JSON.stringify(config || {}));
    const content = tomlStringify(safeConfig);
    fs.writeFileSync(getConfigPath(), content, 'utf8');
  } catch (err) {
    throw new Error('Failed to write config.toml: ' + err.message);
  }
}

// 读取 auth.json
function readAuth() {
  try {
    if (!authExists()) {
      return {};
    }
    const content = fs.readFileSync(getAuthPath(), 'utf8');
    return JSON.parse(content);
  } catch (err) {
    throw new Error('Failed to read auth.json: ' + err.message);
  }
}

// 写入 auth.json
function writeAuth(auth) {
  try {
    const content = JSON.stringify(auth, null, 2);
    fs.writeFileSync(getAuthPath(), content, 'utf8');
  } catch (err) {
    throw new Error('Failed to write auth.json: ' + err.message);
  }
}

// 备份当前配置
function backupSettings() {
  try {
    if (!configExists()) {
      throw new Error('config.toml not found');
    }

    // 如果已经有备份，不覆盖
    if (hasBackup()) {
      console.log('Backup already exists, skipping backup');
      return { success: true, alreadyExists: true };
    }

    // 备份 config.toml
    const configContent = fs.readFileSync(getConfigPath(), 'utf8');
    fs.writeFileSync(getConfigBackupPath(), configContent, 'utf8');

    // 备份 auth.json (如果存在)
    if (authExists()) {
      const authContent = fs.readFileSync(getAuthPath(), 'utf8');
      fs.writeFileSync(getAuthBackupPath(), authContent, 'utf8');
    }

    console.log('Codex settings backed up');
    return { success: true, alreadyExists: false };
  } catch (err) {
    throw new Error('Failed to backup settings: ' + err.message);
  }
}

// 只删除备份文件，不恢复（保留当前配置）
function deleteBackup() {
  try {
    if (fs.existsSync(getConfigBackupPath())) {
      fs.unlinkSync(getConfigBackupPath());
    }
    if (fs.existsSync(getAuthBackupPath())) {
      fs.unlinkSync(getAuthBackupPath());
    }
    console.log('Codex backup files deleted');
    return { success: true };
  } catch (err) {
    console.warn('Failed to delete backup files:', err.message);
    return { success: false, error: err.message };
  }
}

// 恢复配置
function restoreSettings() {
  try {
    if (!hasBackup()) {
      throw new Error('No backup found');
    }

    // 恢复 config.toml
    if (fs.existsSync(getConfigBackupPath())) {
      const content = fs.readFileSync(getConfigBackupPath(), 'utf8');
      fs.writeFileSync(getConfigPath(), content, 'utf8');
      fs.unlinkSync(getConfigBackupPath());
    }

    // 恢复 auth.json
    if (fs.existsSync(getAuthBackupPath())) {
      const content = fs.readFileSync(getAuthBackupPath(), 'utf8');
      fs.writeFileSync(getAuthPath(), content, 'utf8');
      fs.unlinkSync(getAuthBackupPath());
    }

    // 清理 shell 配置文件中的环境变量（可选，不影响恢复结果）
    removeEnvFromShell('CC_PROXY_KEY');

    // 同步删除当前进程的环境变量，使恢复立即生效（无需新开终端）
    delete process.env.CC_PROXY_KEY;

    console.log('Codex settings restored from backup');
    return { success: true };
  } catch (err) {
    throw new Error('Failed to restore settings: ' + err.message);
  }
}

// 获取用户的 shell 配置文件路径
function getShellConfigPath() {
  const candidates = getShellConfigCandidates();
  const existing = candidates.find(filePath => fs.existsSync(filePath));
  return existing || candidates[0];
}

// 注入环境变量到 shell 配置文件
function injectEnvToShell(envName, envValue) {
  const normalizedEnvName = normalizeEnvName(envName);
  if (!normalizedEnvName) {
    return {
      success: false,
      error: `Invalid environment variable name: ${envName}`,
      isFirstTime: false
    };
  }

  const configPath = getShellConfigPath();
  const marker = `${SHELL_MARKER_PREFIX} [${normalizedEnvName}]`;
  const usePowerShell = isPowerShellProfile(configPath);
  const exportLine = usePowerShell
    ? `$env:${normalizedEnvName} = "${escapePowerShellValue(envValue)}"`
    : `export ${normalizedEnvName}="${escapeShellValue(envValue)}"`;

  try {
    let content = '';
    if (fs.existsSync(configPath)) {
      content = fs.readFileSync(configPath, 'utf8');
    }

    const envKeyEscaped = String(normalizedEnvName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const envLineRegex = usePowerShell
      ? new RegExp(`^\\s*\\$env:${envKeyEscaped}\\s*=`, 'i')
      : new RegExp(`^\\s*(?:export\\s+)?${envKeyEscaped}=`);

    const originalLines = content ? content.split(/\r?\n/) : [];
    const cleanedLines = [];
    let existed = false;

    for (let i = 0; i < originalLines.length; i++) {
      const currentLine = originalLines[i];
      const trimmedLine = currentLine.trim();

      if (trimmedLine === marker) {
        const nextLine = originalLines[i + 1] || '';
        if (envLineRegex.test(nextLine.trim())) {
          i += 1;
        }
        existed = true;
        continue;
      }

      if (envLineRegex.test(trimmedLine)) {
        existed = true;
        continue;
      }

      cleanedLines.push(currentLine);
    }

    while (cleanedLines.length > 0 && cleanedLines[cleanedLines.length - 1].trim() === '') {
      cleanedLines.pop();
    }

    if (cleanedLines.length > 0) {
      cleanedLines.push('');
    }

    cleanedLines.push(marker, exportLine);

    const nextContent = `${cleanedLines.join('\n')}\n`;
    if (nextContent !== content) {
      writeFileAtomic(configPath, nextContent);
    }

    // 同步更新当前进程的环境变量，使变更立即生效（无需新开终端）
    process.env[normalizedEnvName] = String(envValue ?? '');

    return { success: true, path: configPath, isFirstTime: !existed };
  } catch (err) {
    // 不抛出错误，只是警告，因为这不是致命问题
    console.warn(`[Codex] Failed to inject env to shell config: ${err.message}`);
    return { success: false, error: err.message, isFirstTime: false };
  }
}

// 从 shell 配置文件移除环境变量
function removeEnvFromShell(envName) {
  const normalizedEnvName = normalizeEnvName(envName);
  if (!normalizedEnvName) {
    return {
      success: false,
      error: `Invalid environment variable name: ${envName}`
    };
  }

  const configPath = getShellConfigPath();

  try {
    if (!fs.existsSync(configPath)) {
      return { success: true };
    }

    const content = fs.readFileSync(configPath, 'utf8');
    const usePowerShell = isPowerShellProfile(configPath);
    const marker = `${SHELL_MARKER_PREFIX} [${normalizedEnvName}]`;
    const envKeyEscaped = String(normalizedEnvName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const envLineRegex = usePowerShell
      ? new RegExp(`^\\s*\\$env:${envKeyEscaped}\\s*=`, 'i')
      : new RegExp(`^\\s*(?:export\\s+)?${envKeyEscaped}=`);

    const originalLines = content ? content.split(/\r?\n/) : [];
    const cleanedLines = [];
    let changed = false;

    for (let i = 0; i < originalLines.length; i++) {
      const currentLine = originalLines[i];
      const trimmedLine = currentLine.trim();

      if (trimmedLine === marker) {
        const nextLine = originalLines[i + 1] || '';
        if (envLineRegex.test(nextLine.trim())) {
          i += 1;
        }
        changed = true;
        continue;
      }

      if (envLineRegex.test(trimmedLine)) {
        changed = true;
        continue;
      }

      cleanedLines.push(currentLine);
    }

    if (!changed) {
      return { success: true };
    }

    const normalized = compactBlankLines(cleanedLines);
    const nextContent = normalized.length > 0 ? `${normalized.join('\n')}\n` : '';
    writeFileAtomic(configPath, nextContent);

    // 同步删除当前进程的环境变量，使变更立即生效（无需新开终端）
    delete process.env[normalizedEnvName];

    return { success: true };
  } catch (err) {
    console.warn(`[Codex] Failed to remove env from shell config: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// 设置代理配置
function setProxyConfig(proxyPort) {
  try {
    // 先备份
    backupSettings();

    // 读取当前配置
    const config = readConfig();

    // 设置 model_provider 为 proxy
    config.model_provider = 'cc-proxy';

    // 确保 model_providers 对象存在
    if (!config.model_providers) {
      config.model_providers = {};
    }

    // 添加代理 provider
    config.model_providers['cc-proxy'] = {
      name: 'cc-proxy',
      base_url: `http://127.0.0.1:${proxyPort}/v1`,
      wire_api: 'responses',
      env_key: 'CC_PROXY_KEY'
    };

    // 写入配置
    writeConfig(config);

    // 写入 auth.json
    const auth = readAuth();
    auth.CC_PROXY_KEY = 'PROXY_KEY';
    writeAuth(auth);

    // 注入环境变量到 shell 配置文件（解决某些系统环境变量优先级问题）
    const shellInjectResult = injectEnvToShell('CC_PROXY_KEY', 'PROXY_KEY');

    // 同步更新当前进程的环境变量，使代理立即生效（无需新开终端）
    process.env.CC_PROXY_KEY = 'PROXY_KEY';

    // 获取 shell 配置文件路径用于提示信息
    const shellConfigPath = shellInjectResult.path || getShellConfigPath();
    const sourceCommand = getShellReloadCommand(shellConfigPath);

    console.log(`Codex settings updated to use proxy on port ${proxyPort}`);
    return {
      success: true,
      port: proxyPort,
      envInjected: shellInjectResult.success,
      isFirstTime: shellInjectResult.isFirstTime,
      shellConfigPath: shellConfigPath,
      sourceCommand: sourceCommand
    };
  } catch (err) {
    throw new Error('Failed to set proxy config: ' + err.message);
  }
}

// 检查当前是否是代理配置
function isProxyConfig() {
  try {
    if (!configExists()) {
      return false;
    }

    const config = readConfig();

    // 检查是否使用 cc-proxy provider
    if (config.model_provider === 'cc-proxy') {
      return true;
    }

    // 检查当前 provider 的 base_url 是否指向本地代理
    const currentProvider = config.model_provider;
    if (currentProvider && config.model_providers && config.model_providers[currentProvider]) {
      const baseUrl = config.model_providers[currentProvider].base_url || '';
      if (baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost')) {
        return true;
      }
    }

    return false;
  } catch (err) {
    return false;
  }
}

// 获取当前代理端口（如果是代理配置）
function getCurrentProxyPort() {
  try {
    if (!isProxyConfig()) {
      return null;
    }

    const config = readConfig();
    const proxyProvider = config.model_providers?.['cc-proxy'];
    if (proxyProvider) {
      const baseUrl = proxyProvider.base_url || '';
      const match = baseUrl.match(/:(\d+)/);
      return match ? parseInt(match[1]) : null;
    }

    return null;
  } catch (err) {
    return null;
  }
}

module.exports = {
  getConfigPath,
  getAuthPath,
  getConfigBackupPath,
  getAuthBackupPath,
  configExists,
  authExists,
  hasBackup,
  readConfig,
  writeConfig,
  readAuth,
  writeAuth,
  backupSettings,
  restoreSettings,
  deleteBackup,
  setProxyConfig,
  isProxyConfig,
  getCurrentProxyPort,
  // 导出环境变量注入函数供其他模块使用
  getShellConfigPath,
  injectEnvToShell,
  removeEnvFromShell
};
