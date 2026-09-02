const fs = require('fs');
const path = require('path');
const { NATIVE_PATHS } = require('../../../config/paths');
const { resolveModelMetadata } = require('../../../config/model-metadata');

/**
 * 根据模型 ID 查找 limit（context + output）
 * 委托给集中式 model-metadata.js
 */
function resolveModelLimit(modelId) {
  const meta = resolveModelMetadata(modelId);
  return meta ? meta.limit : null;
}

/**
 * 根据模型 ID 查找定价信息
 * 委托给集中式 model-metadata.js
 */
function resolveModelCost(modelId) {
  const meta = resolveModelMetadata(modelId);
  return meta ? meta.pricing : null;
}

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
const MANAGED_PROVIDER_MARKER = '__ctx_managed__';

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

function normalizeOpenCodeModel(modelId, providerId) {
  const normalized = String(modelId || '').trim();
  if (!normalized) {
    return '';
  }

  const pid = String(providerId || PROXY_PROVIDER_ID).trim() || PROXY_PROVIDER_ID;

  // Already has a provider/ prefix - keep as-is only if it matches the expected provider
  if (normalized.includes('/')) {
    return normalized;
  }
  return `${pid}/${normalized}`;
}

function sanitizeProviderKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'channel';
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

function isManagedChannelProvider(provider) {
  if (!provider || typeof provider !== 'object') return false;
  return provider?.[MANAGED_PROVIDER_MARKER] === true;
}

function isManagedProxyConfig(config) {
  if (!config || typeof config !== 'object') return false;
  // Check legacy single-provider format
  if (isManagedProxyProvider(config?.provider?.[PROXY_PROVIDER_ID])
    || isLegacyProxyProvider(config?.provider?.[LEGACY_PROVIDER_ID])) {
    return true;
  }
  // Check per-channel provider format (any provider with PROXY_API_KEY + local baseURL)
  if (config?.provider && typeof config.provider === 'object') {
    return Object.values(config.provider).some(p => isManagedProxyProvider(p));
  }
  return false;
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

    const entry = { name: trimmed };

    // 注入 limit（context + output），供 OpenCode 显示 "X% used"
    // OpenCode schema 要求 limit 必须同时包含 context 和 output
    const limit = resolveModelLimit(trimmed);
    if (limit) {
      entry.limit = { context: limit.context, output: limit.output };
    }

    // 注入定价信息，供 OpenCode 计算 cost
    const pricing = resolveModelCost(trimmed);
    if (pricing) {
      entry.cost = {
        input: pricing.input,
        output: pricing.output,
        cache_read: pricing.cacheRead,
        cache_write: pricing.cacheCreation
      };
    }

    map[trimmed] = entry;
  };

  if (Array.isArray(models)) {
    models.forEach(add);
  }
  add(fallbackModel);

  return map;
}

function resolveProxyBaseUrl(config) {
  if (config?.provider?.[PROXY_PROVIDER_ID]?.options?.baseURL) {
    return config.provider[PROXY_PROVIDER_ID].options.baseURL;
  }
  if (config?.provider?.[LEGACY_PROVIDER_ID]?.options?.baseURL) {
    return config.provider[LEGACY_PROVIDER_ID].options.baseURL;
  }
  // Check per-channel managed providers
  if (config?.provider && typeof config.provider === 'object') {
    for (const p of Object.values(config.provider)) {
      if (isManagedProxyProvider(p) && p?.options?.baseURL) {
        return p.options.baseURL;
      }
    }
  }
  return '';
}

function collectChannelModelCandidates(channel = {}) {
  const seen = new Set();
  const models = [];
  const add = (value) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    models.push(trimmed);
  };

  add(channel.model);
  add(channel.speedTestModel);

  if (Array.isArray(channel.allowedModels)) {
    channel.allowedModels.forEach(add);
  }

  if (channel.modelConfig && typeof channel.modelConfig === 'object') {
    add(channel.modelConfig.model);
    add(channel.modelConfig.opusModel);
    add(channel.modelConfig.sonnetModel);
    add(channel.modelConfig.haikuModel);
  }

  if (Array.isArray(channel.modelRedirects)) {
    channel.modelRedirects.forEach((rule) => {
      add(rule?.from);
      add(rule?.to);
    });
  }

  return models;
}

function clearManagedProviders(config) {
  const removedProviderKeys = [];

  if (!config?.provider || typeof config.provider !== 'object') {
    return removedProviderKeys;
  }

  if (isLegacyProxyProvider(config.provider[LEGACY_PROVIDER_ID])) {
    delete config.provider[LEGACY_PROVIDER_ID];
    removedProviderKeys.push(LEGACY_PROVIDER_ID);
  }

  if (isManagedProxyProvider(config.provider[PROXY_PROVIDER_ID])) {
    delete config.provider[PROXY_PROVIDER_ID];
    removedProviderKeys.push(PROXY_PROVIDER_ID);
  }

  Object.keys(config.provider).forEach((key) => {
    const provider = config.provider[key];
    if (isManagedProxyProvider(provider) || isManagedChannelProvider(provider)) {
      delete config.provider[key];
      removedProviderKeys.push(key);
    }
  });

  if (Object.keys(config.provider).length === 0) {
    delete config.provider;
  }

  return removedProviderKeys;
}

function clearManagedModelRef(config, removedProviderKeys = []) {
  const modelRef = String(config?.model || '').trim();
  if (!modelRef) {
    return;
  }

  if (isOldManagedModelRef(modelRef)) {
    delete config.model;
    return;
  }

  const providerId = modelRef.includes('/') ? modelRef.split('/')[0] : '';
  if (providerId && removedProviderKeys.includes(providerId)) {
    delete config.model;
  }
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
  const removedProviderKeys = clearManagedProviders(next);
  clearManagedModelRef(next, removedProviderKeys);

  // clearManagedProviders 可能在清空所有 provider 后 delete next.provider，重新确保存在
  if (!next.provider || typeof next.provider !== 'object') {
    next.provider = {};
  }

  const channels = Array.isArray(options.channels) ? options.channels : null;

  if (channels && channels.length > 0) {
    // Per-channel mode: write one provider entry per channel
    const usedKeys = new Set();
    let firstProviderId = null;
    let firstModelId = null;

    channels.forEach((ch) => {
      const rawKey = sanitizeProviderKey(ch.providerKey || ch.name || '');
      // Ensure uniqueness
      let key = rawKey;
      let suffix = 2;
      while (usedKeys.has(key)) {
        key = `${rawKey}-${suffix}`;
        suffix += 1;
      }
      usedKeys.add(key);

      const modelsMap = buildModelsMap(ch.models, ch.model);
      const modelIds = Object.keys(modelsMap);

      if (modelIds.length > 0) {
        next.provider[key] = {
          npm: '@ai-sdk/openai-compatible',
          name: ch.name || key,
          options: {
            baseURL: `http://127.0.0.1:${proxyPort}/v1`,
            apiKey: PROXY_API_KEY
          },
          models: modelsMap
        };

        if (firstProviderId === null) {
          firstProviderId = key;
          firstModelId = ch.model || modelIds[0] || null;
        }
      }
    });

    // Write top-level model pointing to first channel's first model
    const topModel = options.model || (firstProviderId && firstModelId
      ? `${firstProviderId}/${firstModelId}`
      : null);
    if (topModel) {
      const resolved = normalizeOpenCodeModel(topModel, firstProviderId || PROXY_PROVIDER_ID);
      if (resolved) {
        next.model = resolved;
      }
    } else if (isOldManagedModelRef(next.model)) {
      delete next.model;
    }
  } else {
    // Fallback: legacy flat-model mode (single ctx-proxy provider)
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
    }

    const fallbackModel = options.model || modelIds[0] || '';
    if (fallbackModel) {
      const resolvedModel = normalizeOpenCodeModel(fallbackModel, PROXY_PROVIDER_ID);
      if (resolvedModel) {
        next.model = resolvedModel;
      }
    } else if (isOldManagedModelRef(next.model)) {
      delete next.model;
    }
  }

  writeConfig(filePath, next);

  return { success: true, port: proxyPort, path: filePath };
}

function setChannelConfig(channel = {}) {
  const filePath = selectConfigPath();
  backupConfig(filePath);

  const current = readConfig(filePath);
  const next = (current && typeof current === 'object') ? current : {};

  if (!next.provider || typeof next.provider !== 'object') {
    next.provider = {};
  }

  const removedProviderKeys = clearManagedProviders(next);
  clearManagedModelRef(next, removedProviderKeys);

  const baseProviderKey = sanitizeProviderKey(channel.providerKey || channel.name || 'ctx-channel');
  let providerKey = baseProviderKey;
  let suffix = 2;
  while (next.provider[providerKey] && !isManagedChannelProvider(next.provider[providerKey])) {
    providerKey = `${baseProviderKey}-${suffix}`;
    suffix += 1;
  }

  const modelCandidates = collectChannelModelCandidates(channel);
  const fallbackModel = String(channel.model || channel.speedTestModel || modelCandidates[0] || '').trim();
  const modelsMap = buildModelsMap(modelCandidates, fallbackModel);
  const modelIds = Object.keys(modelsMap);

  if (modelIds.length === 0) {
    throw new Error('OpenCode 渠道缺少可写入的模型，请至少配置默认模型或可用模型。');
  }

  next.provider[providerKey] = {
    [MANAGED_PROVIDER_MARKER]: true,
    npm: '@ai-sdk/openai-compatible',
    name: channel.name || providerKey,
    options: {
      baseURL: String(channel.baseUrl || '').trim(),
      apiKey: String(channel.apiKey || '').trim()
    },
    models: modelsMap
  };

  const topModel = normalizeOpenCodeModel(fallbackModel || modelIds[0], providerKey);
  if (topModel) {
    next.model = topModel;
  } else {
    clearManagedModelRef(next, [providerKey]);
  }

  writeConfig(filePath, next);
  return { success: true, path: filePath, providerKey, model: next.model || null };
}

function clearManagedChannelConfig() {
  const filePath = selectConfigPath();
  if (!fs.existsSync(filePath)) {
    return { success: true, path: filePath };
  }

  const current = readConfig(filePath);
  const next = (current && typeof current === 'object') ? current : {};
  const removedProviderKeys = clearManagedProviders(next);
  clearManagedModelRef(next, removedProviderKeys);
  writeConfig(filePath, next);
  return { success: true, path: filePath };
}

function isOldManagedModelRef(modelRef) {
  const s = String(modelRef || '');
  return s.startsWith(`${PROXY_PROVIDER_ID}/`) || s.startsWith(`${LEGACY_PROVIDER_ID}/`);
}

function restoreSettings() {
  const restored = [
    restoreConfig(CONFIG_PATHS.opencodec),
    restoreConfig(CONFIG_PATHS.opencode),
    restoreConfig(CONFIG_PATHS.config)
  ].some(Boolean);

  return { success: restored };
}

// 只删除备份文件，不恢复（保留当前配置中用户对 MCP 等的修改）
function deleteBackup() {
  try {
    [CONFIG_PATHS.opencodec, CONFIG_PATHS.opencode, CONFIG_PATHS.config].forEach(p => {
      const bp = getBackupPath(p);
      if (fs.existsSync(bp)) fs.unlinkSync(bp);
    });
    console.log('[OpenCode] Backup files deleted');
    return { success: true };
  } catch (err) {
    console.warn('[OpenCode] Failed to delete backup files:', err.message);
    return { success: false, error: err.message };
  }
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
  readConfig,
  writeConfig,
  selectConfigPath,
  setProxyConfig,
  setChannelConfig,
  clearManagedChannelConfig,
  restoreSettings,
  deleteBackup,
  isProxyConfig,
  getCurrentProxyPort,
  CONFIG_PATHS
};
