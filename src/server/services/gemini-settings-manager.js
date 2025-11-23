const fs = require('fs');
const path = require('path');
const os = require('os');

// Gemini 配置文件路径
function getEnvPath() {
  return path.join(os.homedir(), '.gemini', '.env');
}

function getSettingsPath() {
  return path.join(os.homedir(), '.gemini', 'settings.json');
}

// 备份文件路径
function getEnvBackupPath() {
  return path.join(os.homedir(), '.gemini', '.env.cc-tool-backup');
}

function getSettingsBackupPath() {
  return path.join(os.homedir(), '.gemini', 'settings.json.cc-tool-backup');
}

// 检查配置文件是否存在
function configExists() {
  return fs.existsSync(getEnvPath());
}

function settingsExists() {
  return fs.existsSync(getSettingsPath());
}

// 检查是否已经有备份
function hasBackup() {
  return fs.existsSync(getEnvBackupPath()) || fs.existsSync(getSettingsBackupPath());
}

// 读取 .env
function readEnv() {
  try {
    const content = fs.readFileSync(getEnvPath(), 'utf8');
    const env = {};

    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;

      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        env[match[1].trim()] = match[2].trim();
      }
    });

    return env;
  } catch (err) {
    throw new Error('Failed to read .env: ' + err.message);
  }
}

// 将环境对象转换为 .env 字符串
function envToString(env) {
  let content = '';
  for (const [key, value] of Object.entries(env)) {
    content += `${key}=${value}\n`;
  }
  return content;
}

// 写入 .env
function writeEnv(env) {
  try {
    const content = envToString(env);
    fs.writeFileSync(getEnvPath(), content, 'utf8');

    // 设置文件权限为 600 (仅所有者可读写)
    if (process.platform !== 'win32') {
      fs.chmodSync(getEnvPath(), 0o600);
    }
  } catch (err) {
    throw new Error('Failed to write .env: ' + err.message);
  }
}

// 读取 settings.json
function readSettings() {
  try {
    if (!settingsExists()) {
      return {};
    }
    const content = fs.readFileSync(getSettingsPath(), 'utf8');
    return JSON.parse(content);
  } catch (err) {
    throw new Error('Failed to read settings.json: ' + err.message);
  }
}

// 写入 settings.json
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
    if (!configExists()) {
      throw new Error('.env not found');
    }

    // 如果已经有备份，不覆盖
    if (hasBackup()) {
      console.log('Backup already exists, skipping backup');
      return { success: true, alreadyExists: true };
    }

    // 备份 .env
    const envContent = fs.readFileSync(getEnvPath(), 'utf8');
    fs.writeFileSync(getEnvBackupPath(), envContent, 'utf8');

    // 设置备份文件权限为 600
    if (process.platform !== 'win32') {
      fs.chmodSync(getEnvBackupPath(), 0o600);
    }

    // 备份 settings.json (如果存在)
    if (settingsExists()) {
      const settingsContent = fs.readFileSync(getSettingsPath(), 'utf8');
      fs.writeFileSync(getSettingsBackupPath(), settingsContent, 'utf8');
    }

    console.log('Gemini settings backed up');
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

    // 恢复 .env
    if (fs.existsSync(getEnvBackupPath())) {
      const content = fs.readFileSync(getEnvBackupPath(), 'utf8');
      fs.writeFileSync(getEnvPath(), content, 'utf8');
      fs.unlinkSync(getEnvBackupPath());

      // 设置文件权限为 600
      if (process.platform !== 'win32') {
        fs.chmodSync(getEnvPath(), 0o600);
      }
    }

    // 恢复 settings.json
    if (fs.existsSync(getSettingsBackupPath())) {
      const content = fs.readFileSync(getSettingsBackupPath(), 'utf8');
      fs.writeFileSync(getSettingsPath(), content, 'utf8');
      fs.unlinkSync(getSettingsBackupPath());
    }

    console.log('Gemini settings restored from backup');
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
    const env = configExists() ? readEnv() : {};

    // 设置代理 URL
    env.GOOGLE_GEMINI_BASE_URL = `http://127.0.0.1:${proxyPort}`;
    env.GEMINI_API_KEY = 'PROXY_KEY';
    // 保留或设置默认模型
    if (!env.GEMINI_MODEL) {
      env.GEMINI_MODEL = 'gemini-2.5-pro';
    }

    // 写入 .env
    writeEnv(env);

    // 确保 settings.json 存在并配置正确的认证模式
    const settings = settingsExists() ? readSettings() : {};
    settings.security = settings.security || {};
    settings.security.auth = settings.security.auth || {};
    settings.security.auth.selectedType = 'gemini-api-key';

    writeSettings(settings);

    console.log(`Gemini settings updated to use proxy on port ${proxyPort}`);
    return { success: true, port: proxyPort };
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

    const env = readEnv();

    // 检查 GOOGLE_GEMINI_BASE_URL 是否指向本地代理
    const baseUrl = env.GOOGLE_GEMINI_BASE_URL || '';
    if (baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost')) {
      return true;
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

    const env = readEnv();
    const baseUrl = env.GOOGLE_GEMINI_BASE_URL || '';
    const match = baseUrl.match(/:(\d+)/);
    return match ? parseInt(match[1]) : null;
  } catch (err) {
    return null;
  }
}

module.exports = {
  getEnvPath,
  getSettingsPath,
  getEnvBackupPath,
  getSettingsBackupPath,
  configExists,
  settingsExists,
  hasBackup,
  readEnv,
  writeEnv,
  readSettings,
  writeSettings,
  backupSettings,
  restoreSettings,
  setProxyConfig,
  isProxyConfig,
  getCurrentProxyPort
};
