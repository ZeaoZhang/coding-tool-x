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
const PROXY_PROVIDER_ID = 'ctx-proxy';
const LEGACY_PROVIDER_ID = 'openai';
const PROXY_API_KEY = 'PROXY_KEY';

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

function normalizeOpenCodeModel(modelId) {
  const normalized = String(modelId || '').trim();
  if (!normalized) {
    return '';
  }

  // OpenCode 要求格式为 provider/model。这里统一绑定到 ctx-proxy provider，
  // 避免落到内置 openai provider 的模型清单。
  if (normalized.startsWith(`${PROXY_PROVIDER_ID}/`)) {
    return normalized;
  }
  return `${PROXY_PROVIDER_ID}/${normalized}`;
}

function isLocalProxyBaseUrl(url) {
  const value = String(url || '').trim();
  return value.includes('127.0.0.1') || value.includes('localhost');
}

function isLegacyProxyProvider(provider) {
  if (!provider || typeof provider !== 'object') return false;
  const apiKey = provider?.options?.apiKey;
  const baseUrl = provider?.options?.baseURL;
  return apiKey === PROXY_API_KEY && isLocalProxyBaseUrl(baseUrl);
}

function isManagedProxyProvider(provider) {
  if (!provider || typeof provider !== 'object') return false;
  const apiKey = provider?.options?.apiKey;
  const baseUrl = provider?.options?.baseURL;
  return apiKey === PROXY_API_KEY && isLocalProxyBaseUrl(baseUrl);
}

function isManagedProxyConfig(config) {
  if (!config || typeof config !== 'object') return false;
  return isManagedProxyProvider(config?.provider?.[PROXY_PROVIDER_ID])
    || isLegacyProxyProvider(config?.provider?.[LEGACY_PROVIDER_ID]);
}

function buildModelsMap(models = [], fallbackModel = '') {
  const map = {};
  const seen = new Set();

  const add = (value) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    map[trimmed] = { name: trimmed };
  };

  if (Array.isArray(models)) {
    models.forEach(add);
  }
  add(fallbackModel);

  return map;
}

function resolveProxyBaseUrl(config) {
  return config?.provider?.[PROXY_PROVIDER_ID]?.options?.baseURL
    || config?.provider?.[LEGACY_PROVIDER_ID]?.options?.baseURL
    || '';
}

function backupConfig(filePath) {
  ensureConfigDir();
  const backupPath = getBackupPath(filePath);

  if (fs.existsSync(backupPath)) {
    // 防止历史残留备份误伤：若当前配置已回到“非代理托管态”，刷新备份为当前真实配置。
    // 这样 stop/restore 不会把用户配置恢复成陈旧快照（或空文件哨兵）。
    try {
      const backupContent = fs.readFileSync(backupPath, 'utf8');
      if (backupContent === EMPTY_SENTINEL && fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        fs.writeFileSync(backupPath, content, 'utf8');
        return { success: true, alreadyExists: true };
      }

      const current = readConfig(filePath);
      if (!isManagedProxyConfig(current)) {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf8');
          fs.writeFileSync(backupPath, content, 'utf8');
        } else {
          fs.writeFileSync(backupPath, EMPTY_SENTINEL, 'utf8');
        }
      }
    } catch (error) {
      // ignore backup refresh errors, fallback to existing backup
    }
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

function setProxyConfig(proxyPort, options = {}) {
  const filePath = selectConfigPath();
  backupConfig(filePath);

  const config = readConfig(filePath);
  const next = (config && typeof config === 'object') ? config : {};

  if (!next.provider || typeof next.provider !== 'object') {
    next.provider = {};
  }
  // 清理历史 openai 代理注入，避免 /models 出现与代理无关的 openai 模型列表。
  if (isLegacyProxyProvider(next.provider[LEGACY_PROVIDER_ID])) {
    delete next.provider[LEGACY_PROVIDER_ID];
  }

  if (Object.prototype.hasOwnProperty.call(next.provider[LEGACY_PROVIDER_ID] || {}, 'model')) {
    delete next.provider[LEGACY_PROVIDER_ID].model;
  }

  const modelsMap = buildModelsMap(options.models, options.model);
  const modelIds = Object.keys(modelsMap);

  if (modelIds.length > 0) {
    next.provider[PROXY_PROVIDER_ID] = {
      npm: '@ai-sdk/openai-compatible',
      name: 'CTX Proxy',
      options: {
        baseURL: `http://127.0.0.1:${proxyPort}/v1`,
        apiKey: PROXY_API_KEY
      },
      models: modelsMap
    };
  } else {
    // 无模型时不暴露 provider，避免出现误导性的 provider.openai/provider 列表。
    delete next.provider[PROXY_PROVIDER_ID];
  }

  // 写入顶层 model（OpenCode 要求 provider/model 格式），无显式模型时兜底第一个模型。
  const fallbackModel = options.model || modelIds[0] || '';
  if (fallbackModel) {
    const resolvedModel = normalizeOpenCodeModel(fallbackModel);
    if (resolvedModel) {
      next.model = resolvedModel;
    }
  } else if (String(next.model || '').startsWith(`${PROXY_PROVIDER_ID}/`) || String(next.model || '').startsWith(`${LEGACY_PROVIDER_ID}/`)) {
    delete next.model;
  }

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
    const baseUrl = resolveProxyBaseUrl(config);
    return isLocalProxyBaseUrl(baseUrl);
  } catch (err) {
    return false;
  }
}

function getCurrentProxyPort() {
  try {
    if (!isProxyConfig()) return null;
    const filePath = selectConfigPath();
    const config = readConfig(filePath);
    const baseUrl = resolveProxyBaseUrl(config);
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
