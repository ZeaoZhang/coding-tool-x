const fs = require('fs');
const path = require('path');
const os = require('os');

// Claude Code 配置文件路径
function getSettingsPath() {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

// 备份文件路径
function getBackupPath() {
  return path.join(os.homedir(), '.claude', 'settings.json.cc-tool-backup');
}

// 检查配置文件是否存在
function settingsExists() {
  return fs.existsSync(getSettingsPath());
}

// 检查是否已经有备份
function hasBackup() {
  return fs.existsSync(getBackupPath());
}

// 读取配置文件
function readSettings() {
  try {
    const content = fs.readFileSync(getSettingsPath(), 'utf8');
    return JSON.parse(content);
  } catch (err) {
    throw new Error('Failed to read settings.json: ' + err.message);
  }
}

// 写入配置文件
function writeSettings(settings) {
  try {
    const content = JSON.stringify(settings, null, 2);
    fs.writeFileSync(getSettingsPath(), content, 'utf8');
  } catch (err) {
    throw new Error('Failed to write settings.json: ' + err.message);
  }
}

// 备份当前配置
function backupSettings() {
  try {
    if (!settingsExists()) {
      throw new Error('settings.json not found');
    }

    // 如果已经有备份，不覆盖
    if (hasBackup()) {
      console.log('Backup already exists, skipping backup');
      return { success: true, alreadyExists: true };
    }

    const content = fs.readFileSync(getSettingsPath(), 'utf8');
    fs.writeFileSync(getBackupPath(), content, 'utf8');

    console.log('✅ Settings backed up to:', getBackupPath());
    return { success: true, alreadyExists: false };
  } catch (err) {
    throw new Error('Failed to backup settings: ' + err.message);
  }
}

// 恢复配置
function restoreSettings() {
  try {
    if (!hasBackup()) {
      throw new Error('No backup found');
    }

    const content = fs.readFileSync(getBackupPath(), 'utf8');
    fs.writeFileSync(getSettingsPath(), content, 'utf8');

    // 删除备份文件
    fs.unlinkSync(getBackupPath());

    console.log('✅ Settings restored from backup');
    return { success: true };
  } catch (err) {
    throw new Error('Failed to restore settings: ' + err.message);
  }
}

// 设置代理配置
function setProxyConfig(proxyPort) {
  try {
    // 先备份
    backupSettings();

    // 读取当前配置
    const settings = readSettings();

    // 确保 env 对象存在
    if (!settings.env) {
      settings.env = {};
    }

    // 修改为代理配置（使用 Claude Code 的标准格式）
    settings.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${proxyPort}`;
    settings.env.ANTHROPIC_API_KEY = 'PROXY_KEY';
    settings.apiKeyHelper = `echo 'PROXY_KEY'`;

    // 写入
    writeSettings(settings);

    console.log(`✅ Settings updated to use proxy on port ${proxyPort}`);
    return { success: true, port: proxyPort };
  } catch (err) {
    throw new Error('Failed to set proxy config: ' + err.message);
  }
}

// 检查当前是否是代理配置
function isProxyConfig() {
  try {
    if (!settingsExists()) {
      return false;
    }

    const settings = readSettings();
    const baseUrl = settings?.env?.ANTHROPIC_BASE_URL || '';
    const apiKey = settings?.env?.ANTHROPIC_API_KEY || '';

    return baseUrl.includes('127.0.0.1') || apiKey === 'PROXY_KEY';
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

    const settings = readSettings();
    const baseUrl = settings?.env?.ANTHROPIC_BASE_URL || '';
    const match = baseUrl.match(/:(\d+)/);

    return match ? parseInt(match[1]) : null;
  } catch (err) {
    return null;
  }
}

module.exports = {
  getSettingsPath,
  getBackupPath,
  settingsExists,
  hasBackup,
  readSettings,
  writeSettings,
  backupSettings,
  restoreSettings,
  setProxyConfig,
  isProxyConfig,
  getCurrentProxyPort
};
