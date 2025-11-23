const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * 获取 Gemini 配置目录
 */
function getGeminiDir() {
  return path.join(os.homedir(), '.gemini');
}

/**
 * 读取 .env 文件
 */
function loadEnv() {
  const envPath = path.join(getGeminiDir(), '.env');

  if (!fs.existsSync(envPath)) {
    return {};
  }

  try {
    const content = fs.readFileSync(envPath, 'utf8');
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
    console.error('[Gemini] Failed to parse .env:', err);
    return {};
  }
}

/**
 * 读取 settings.json
 */
function loadSettings() {
  const settingsPath = path.join(getGeminiDir(), 'settings.json');

  if (!fs.existsSync(settingsPath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (err) {
    console.error('[Gemini] Failed to parse settings.json:', err);
    return {};
  }
}

/**
 * 检查 Gemini CLI 是否已安装
 */
function isGeminiInstalled() {
  return fs.existsSync(getGeminiDir());
}

module.exports = {
  getGeminiDir,
  loadEnv,
  loadSettings,
  isGeminiInstalled
};
