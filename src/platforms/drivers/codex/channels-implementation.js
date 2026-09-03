const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const toml = require('toml');
const tomlStringify = require('@iarna/toml').stringify;
const { PATHS } = require('../../../config/paths');
const { getCodexDir } = require('./config');
const { isProxyConfig, readConfig } = require('./native-config-implementation');
const { syncCodexUserEnvironment } = require('./env-manager');
const BaseChannelService = require('../../../shared/base-channel-service');
const {
  createSkippedResult,
  isLocalProxyBaseUrl,
  resolveApiKeyValue,
  resolveExistingActiveChannel,
  upsertSyncedChannels
} = require('../../../server/services/channel-sync-utils');

const CODEX_MANAGED_ENV_KEY = 'CC_PROXY_KEY';
const CODEX_PROXY_ENV_VALUE = 'PROXY_KEY';

// ── Codex 特有工具函数 ──

function resolveCurrentManagedChannel(channels = []) {
  const allChannels = Array.isArray(channels) ? channels : [];
  let currentProvider = '';

  try {
    currentProvider = String(readConfig()?.model_provider || '').trim();
  } catch (err) {
    currentProvider = '';
  }

  if (currentProvider && currentProvider !== 'cc-proxy') {
    const matched = allChannels.find(ch => ch.providerKey === currentProvider);
    if (matched) {
      return matched;
    }
  }

  return allChannels.find(ch => ch.enabled !== false) || null;
}

function channelRequiresOpenaiAuth() {
  return false;
}

function buildManagedCodexEnvMap(channels = [], { includeProxyKey = false, activeChannel = null } = {}) {
  if (includeProxyKey) {
    return { [CODEX_MANAGED_ENV_KEY]: CODEX_PROXY_ENV_VALUE };
  }

  const targetChannel = activeChannel || resolveCurrentManagedChannel(channels);
  if (!channelRequiresOpenaiAuth(targetChannel) && targetChannel?.apiKey) {
    return { [CODEX_MANAGED_ENV_KEY]: targetChannel.apiKey };
  }
  return {};
}

function syncAllChannelEnvVars() {
  try {
    const svc = getServiceInstance();
    const data = svc.loadChannels();
    const proxyRunning = isProxyConfig();
    const envMap = buildManagedCodexEnvMap(data.channels, {
      includeProxyKey: proxyRunning,
      activeChannel: proxyRunning ? null : resolveCurrentManagedChannel(data.channels)
    });
    syncCodexUserEnvironment(envMap, { replace: true });
  } catch (err) {
    console.warn('[Codex Channels] syncAllChannelEnvVars failed:', err.message);
  }
}

function writeAnnotatedCodexConfig(configPath, config, comments = []) {
  let tomlContent = tomlStringify(config);
  if (comments.length > 0) {
    tomlContent = comments.join('\n') + '\n\n' + tomlContent;
  }
  fs.writeFileSync(configPath, tomlContent, 'utf8');
}

function pruneManagedProviders(existingProviders, currentProviderKey, allChannels) {
  const knownKeys = new Set(allChannels.map(ch => ch.providerKey).filter(Boolean));
  for (const key of Object.keys(existingProviders)) {
    if (key === 'cc-proxy' || (key !== currentProviderKey && knownKeys.has(key))) {
      delete existingProviders[key];
    }
  }
}

function writeCodexConfigForMultiChannel(channels) {
  const codexDir = getCodexDir();
  const configPath = path.join(codexDir, 'config.toml');

  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      config = toml.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      console.warn('[Codex Channels] Failed to parse existing config.toml:', err.message);
      config = {};
    }
  }

  if (!config.model_providers || typeof config.model_providers !== 'object') {
    config.model_providers = {};
  }

  const enabledChannels = channels.filter(ch => ch.enabled !== false);
  if (enabledChannels.length > 0) {
    const primary = enabledChannels[0];
    config.model_provider = primary.providerKey;

    for (const ch of enabledChannels) {
      config.model_providers[ch.providerKey] = {
        name: ch.name,
        base_url: ch.baseUrl,
        wire_api: ch.wireApi || 'responses',
        env_key: CODEX_MANAGED_ENV_KEY,
        requires_openai_auth: channelRequiresOpenaiAuth(ch)
      };
      if (ch.queryParams && Object.keys(ch.queryParams).length > 0) {
        config.model_providers[ch.providerKey].query_params = ch.queryParams;
      }
    }
  }

  writeAnnotatedCodexConfig(configPath, config, [
    '# Codex Configuration',
    '# Managed by Coding-Tool (multi-channel)'
  ]);
}

// ── CodexChannelService ──

class CodexChannelService extends BaseChannelService {
  constructor() {
    super({
      platform: 'codex',
      channelsFilePath: PATHS.channels.codex,
      defaultGatewaySource: 'codex',
      isProxyRunning: () => isProxyConfig(),
    });
  }

  _generateId() {
    return crypto.randomUUID();
  }

  _applyDefaults(channel) {
    const ch = super._applyDefaults(channel);
    ch.providerKey = ch.providerKey || '';
    ch.envKey = CODEX_MANAGED_ENV_KEY;
    ch.wireApi = ch.wireApi || 'responses';
    ch.model = ch.model || '';
    ch.speedTestModel = ch.speedTestModel || null;
    ch.modelRedirects = Array.isArray(ch.modelRedirects) ? ch.modelRedirects : [];
    ch.gatewaySourceType = ch.gatewaySourceType || 'codex';
    ch.requiresOpenaiAuth = false;
    ch.queryParams = ch.queryParams || {};
    return ch;
  }

  _validateUniqueness(channels, fields, excludeId) {
    if (!fields.providerKey) return;
    const dup = channels.find(ch =>
      ch.providerKey === fields.providerKey && ch.id !== excludeId
    );
    if (dup) {
      throw new Error(`Provider key "${fields.providerKey}" already exists`);
    }
  }

  _onAfterCreate(_channel, _allChannels) {
    if (_channel.enabled !== false && !isProxyConfig()) {
      this._applyToNativeSettings(_channel);
      return;
    }
    syncAllChannelEnvVars();
  }

  _onAfterUpdate(_old, _next, allChannels) {
    if (!isProxyConfig()) {
      if (_old.enabled === false && _next.enabled !== false) {
        this._applyToNativeSettings(_next);
        return;
      }
      const activeChannel = resolveCurrentManagedChannel(allChannels);
      if (_next.enabled !== false && activeChannel?.id === _next.id) {
        this._applyToNativeSettings(_next);
        return;
      }
    }
    syncAllChannelEnvVars();
  }

  _onAfterDelete(_channel, allChannels) {
    if (!isProxyConfig()) {
      const activeChannel = resolveCurrentManagedChannel(allChannels);
      if (activeChannel && activeChannel.enabled !== false) {
        this._applyToNativeSettings(activeChannel);
        return;
      }
    }
    syncAllChannelEnvVars();
  }

  _applyToNativeSettings(channel) {
    const codexDir = getCodexDir();
    const configPath = path.join(codexDir, 'config.toml');

    let config = {};
    if (fs.existsSync(configPath)) {
      try {
        config = toml.parse(fs.readFileSync(configPath, 'utf8'));
      } catch (err) {
        config = {};
      }
    }

    config.model_provider = channel.providerKey;

    if (!config.model_providers || typeof config.model_providers !== 'object') {
      config.model_providers = {};
    }
    const data = this.loadChannels();
    pruneManagedProviders(config.model_providers, channel.providerKey, data.channels);

    config.model_providers[channel.providerKey] = {
      name: channel.name,
      base_url: channel.baseUrl,
      wire_api: channel.wireApi || 'responses',
      env_key: CODEX_MANAGED_ENV_KEY,
      requires_openai_auth: channelRequiresOpenaiAuth(channel)
    };

    if (channel.queryParams && Object.keys(channel.queryParams).length > 0) {
      config.model_providers[channel.providerKey].query_params = channel.queryParams;
    }

    writeAnnotatedCodexConfig(configPath, config, [
      '# Codex Configuration',
      '# Managed by Coding-Tool',
      `# Current provider: ${channel.name}`
    ]);
    console.log(`[Codex Channels] Applied channel ${channel.name} to config.toml`);
    syncAllChannelEnvVars();
  }
}

// ── 单例 + 兼容导出 ──

let _instance = null;
function getServiceInstance() {
  if (!_instance) _instance = new CodexChannelService();
  return _instance;
}

const service = getServiceInstance();

function getChannels() { return service.getChannels(); }
function getEnabledChannels() { return service.getEnabledChannels(); }
function createChannel(name, providerKey, baseUrl, apiKey, wireApi, extraConfig = {}) {
  return service.createChannel({
    name, providerKey, baseUrl, apiKey, wireApi,
    envKey: CODEX_MANAGED_ENV_KEY,
    ...extraConfig,
  });
}
function updateChannel(id, updates) { return service.updateChannel(id, updates); }
function markChannelAsRecentlyUsed(id) { return service.updateChannel(id, {}); }
function deleteChannel(id) { return service.deleteChannel(id); }
function saveChannelOrder(order) { return service.saveChannelOrder(order); }
function applyChannelToSettings(id) { return service.applyChannelToSettings(id); }
function getEffectiveApiKey(channel) { return service.getEffectiveApiKey(channel); }
function disableAllChannels() { return service.disableAllChannels(); }

function findCodexExistingChannel(channels = [], providerKey = '', baseUrl = '') {
  const key = String(providerKey || '').trim();
  const url = String(baseUrl || '').trim();
  return channels.find(channel => key && channel.providerKey === key)
    || channels.find(channel => url && channel.baseUrl === url)
    || null;
}

function buildDefaultCodexProvider(providerKey = '') {
  if (providerKey !== 'openai') return null;
  return {
    name: 'OpenAI',
    base_url: 'https://api.openai.com/v1',
    env_key: 'OPENAI_API_KEY',
    wire_api: 'responses'
  };
}

function buildCodexSyncCandidate(config, channels) {
  const configuredProvider = String(config?.model_provider || '').trim();
  const currentProvider = configuredProvider || (process.env.OPENAI_API_KEY ? 'openai' : '');
  if (!currentProvider) {
    return {
      skip: true,
      warning: 'Codex config.toml 未配置 model_provider，且未找到 OPENAI_API_KEY，无法同步当前渠道。'
    };
  }

  const provider = config?.model_providers?.[currentProvider]
    || buildDefaultCodexProvider(currentProvider)
    || null;
  const baseUrl = String(provider?.base_url || provider?.baseUrl || '').trim();
  if (currentProvider === 'cc-proxy' || isLocalProxyBaseUrl(baseUrl)) {
    const existing = resolveExistingActiveChannel('codex', channels);
    if (existing) {
      return {
        skip: true,
        channel: existing,
        warning: 'Codex 当前配置指向 ctx 代理；对应渠道已在列表中，未重复导入。'
      };
    }
    return {
      skip: true,
      warning: 'Codex 当前配置指向 ctx 代理，但没有找到可匹配的现有渠道。'
    };
  }

  if (!provider || typeof provider !== 'object') {
    return {
      skip: true,
      warning: `Codex 当前 provider "${currentProvider}" 未在 model_providers 中定义。`
    };
  }

  const existing = findCodexExistingChannel(channels, currentProvider, baseUrl);
  const directKey = provider.api_key || provider.apiKey || provider.key || '';
  let credential = resolveApiKeyValue(directKey);
  if (!credential.value && provider.env_key) {
    credential = resolveApiKeyValue(String(provider.env_key || ''));
  }
  const apiKey = credential.value || existing?.apiKey || '';
  if (!apiKey) {
    return {
      skip: true,
      channel: existing || null,
      warning: provider.requires_openai_auth
        ? 'Codex 当前 provider 使用 OAuth/OpenAI 登录态，OAuth 渠道不支持同步导入。'
        : `Codex 当前 provider "${currentProvider}" 缺少可解析 API Key，无法同步导入。`
    };
  }

  return {
    name: existing?.name || provider.name || currentProvider,
    providerKey: currentProvider,
    baseUrl,
    apiKey,
    wireApi: provider.wire_api || provider.wireApi || 'responses',
    envKey: CODEX_MANAGED_ENV_KEY,
    requiresOpenaiAuth: false,
    queryParams: provider.query_params || provider.queryParams || {},
    gatewaySourceType: existing?.gatewaySourceType || 'codex',
    credentialSource: credential.value ? credential.source : 'existing-channel'
  };
}

function syncCurrentCodexChannel() {
  const data = service.loadChannels();
  const channels = Array.isArray(data.channels) ? data.channels : [];
  let config = {};
  try {
    config = readConfig();
  } catch (error) {
    if (/ENOENT|no such file|config\.toml not found/i.test(String(error?.message || ''))) {
      config = {};
    } else {
      return createSkippedResult('codex', `Codex config.toml 读取失败：${error.message}`);
    }
  }

  const candidate = buildCodexSyncCandidate(config, channels);
  if (candidate?.skip) {
    return createSkippedResult('codex', candidate.warning, candidate.channel);
  }

  return upsertSyncedChannels({
    toolType: 'codex',
    loadChannels: () => service.loadChannels(),
    saveChannels: payload => service.saveChannels(payload),
    applyDefaults: channel => service._applyDefaults(channel),
    candidates: [candidate],
    matchers: [
      (channel, current) => channel.providerKey && channel.providerKey === current.providerKey,
      (channel, current) => channel.baseUrl === current.baseUrl && channel.apiKey === current.apiKey
    ]
  });
}

// 服务启动时自动同步环境变量
try {
  const data = service.loadChannels();
  if (data.channels && data.channels.length > 0) {
    syncAllChannelEnvVars();
  }
} catch (err) {
  console.warn('[Codex Channels] Auto sync env vars failed:', err.message);
}

module.exports = {
  getChannels,
  createChannel,
  updateChannel,
  markChannelAsRecentlyUsed,
  deleteChannel,
  getEnabledChannels,
  saveChannelOrder,
  syncAllChannelEnvVars,
  writeCodexConfigForMultiChannel,
  applyChannelToSettings,
  getEffectiveApiKey,
  disableAllChannels,
  syncCurrentCodexChannel,
  _test: {
    buildManagedCodexEnvMap,
    CODEX_MANAGED_ENV_KEY,
    resolveCurrentManagedChannel
  }
};
