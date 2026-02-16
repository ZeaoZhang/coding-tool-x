const fs = require('fs');
const path = require('path');
const { NATIVE_PATHS } = require('../../config/paths');

const CONFIG_DIR = NATIVE_PATHS.opencode.config;
const CONFIG_PATHS = {
  config: path.join(CONFIG_DIR, 'config.json'),
  opencode: path.join(CONFIG_DIR, 'opencode.json'),
  opencodec: path.join(CONFIG_DIR, 'opencode.jsonc')
};
const BACKUP_SUFFIX = '.cc-tool-backup';
const EMPTY_SENTINEL = '__CC_TOOL_NO_FILE__';

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function getBackupPath(filePath) {
  return `${filePath}${BACKUP_SUFFIX}`;
}

function selectConfigPath() {
  if (fs.existsSync(CONFIG_PATHS.opencodec)) return CONFIG_PATHS.opencodec;
  if (fs.existsSync(CONFIG_PATHS.opencode)) return CONFIG_PATHS.opencode;
  if (fs.existsSync(CONFIG_PATHS.config)) return CONFIG_PATHS.config;
  return CONFIG_PATHS.opencode;
}

function stripJsonComments(input) {
  let result = '';
  let inString = false;
  let stringChar = '';
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    const next = input[i + 1];

    if (inString) {
      result += ch;
      if (ch === '\\') {
        if (next) {
          result += next;
          i += 2;
          continue;
        }
      } else if (ch === stringChar) {
        inString = false;
      }
      i += 1;
      continue;
    }

    if (ch === '"' || ch === '\'') {
      inString = true;
      stringChar = ch;
      result += ch;
      i += 1;
      continue;
    }

    if (ch === '/' && next === '/') {
      i += 2;
      while (i < input.length && input[i] !== '\n') i += 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < input.length - 1 && !(input[i] === '*' && input[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }

    result += ch;
    i += 1;
  }

  return result;
}

function readConfig(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) return {};

  try {
    if (filePath.endsWith('.jsonc')) {
      return JSON.parse(stripJsonComments(raw));
    }
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse ${path.basename(filePath)}: ${err.message}`);
  }
}

function writeConfig(filePath, config) {
  ensureConfigDir();
  const content = JSON.stringify(config, null, 2);
  fs.writeFileSync(filePath, content, 'utf8');
}

function backupConfig(filePath) {
  ensureConfigDir();
  const backupPath = getBackupPath(filePath);

  if (fs.existsSync(backupPath)) {
    return { success: true, alreadyExists: true };
  }

  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    fs.writeFileSync(backupPath, content, 'utf8');
  } else {
    fs.writeFileSync(backupPath, EMPTY_SENTINEL, 'utf8');
  }

  return { success: true, alreadyExists: false };
}

function restoreConfig(filePath) {
  const backupPath = getBackupPath(filePath);
  if (!fs.existsSync(backupPath)) return false;

  const content = fs.readFileSync(backupPath, 'utf8');
  if (content === EMPTY_SENTINEL) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } else {
    ensureConfigDir();
    fs.writeFileSync(filePath, content, 'utf8');
  }

  fs.unlinkSync(backupPath);
  return true;
}

function configExists() {
  return fs.existsSync(CONFIG_PATHS.opencodec)
    || fs.existsSync(CONFIG_PATHS.opencode)
    || fs.existsSync(CONFIG_PATHS.config);
}

function hasBackup() {
  return fs.existsSync(getBackupPath(CONFIG_PATHS.opencodec))
    || fs.existsSync(getBackupPath(CONFIG_PATHS.opencode))
    || fs.existsSync(getBackupPath(CONFIG_PATHS.config));
}

function setProxyConfig(proxyPort) {
  const filePath = selectConfigPath();
  backupConfig(filePath);

  const config = readConfig(filePath);
  const next = (config && typeof config === 'object') ? config : {};

  if (!next.provider || typeof next.provider !== 'object') {
    next.provider = {};
  }
  if (!next.provider.openai || typeof next.provider.openai !== 'object') {
    next.provider.openai = {};
  }
  if (!next.provider.openai.options || typeof next.provider.openai.options !== 'object') {
    next.provider.openai.options = {};
  }

  next.provider.openai.options.baseURL = `http://127.0.0.1:${proxyPort}/v1`;
  next.provider.openai.options.apiKey = 'PROXY_KEY';

  writeConfig(filePath, next);

  return { success: true, port: proxyPort, path: filePath };
}

function restoreSettings() {
  const restored = [
    restoreConfig(CONFIG_PATHS.opencodec),
    restoreConfig(CONFIG_PATHS.opencode),
    restoreConfig(CONFIG_PATHS.config)
  ].some(Boolean);

  return { success: restored };
}

function isProxyConfig() {
  try {
    const filePath = selectConfigPath();
    if (!fs.existsSync(filePath)) return false;
    const config = readConfig(filePath);
    const baseUrl = config?.provider?.openai?.options?.baseURL || '';
    return baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost');
  } catch (err) {
    return false;
  }
}

function getCurrentProxyPort() {
  try {
    if (!isProxyConfig()) return null;
    const filePath = selectConfigPath();
    const config = readConfig(filePath);
    const baseUrl = config?.provider?.openai?.options?.baseURL || '';
    const match = baseUrl.match(/:(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  } catch (err) {
    return null;
  }
}

module.exports = {
  configExists,
  hasBackup,
  setProxyConfig,
  restoreSettings,
  isProxyConfig,
  getCurrentProxyPort,
  CONFIG_PATHS
};
