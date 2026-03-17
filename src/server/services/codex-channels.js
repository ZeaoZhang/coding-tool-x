const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const toml = require('toml');
const tomlStringify = require('@iarna/toml').stringify;
const { PATHS } = require('../../config/paths');
const { getCodexDir } = require('./codex-config');
const { isProxyConfig } = require('./codex-settings-manager');
const { clearNativeOAuth } = require('./native-oauth-adapters');
const { syncCodexUserEnvironment } = require('./codex-env-manager');
const BaseChannelService = require('./base/base-channel-service');

const CODEX_PROXY_ENV_KEY = 'CC_PROXY_KEY';
const CODEX_PROXY_ENV_VALUE = 'PROXY_KEY';

// ── Codex 特有工具函数 ──

function buildManagedCodexEnvMap(channels = [], { includeProxyKey = false } = {}) {
  if (includeProxyKey) {
    return { [CODEX_PROXY_ENV_KEY]: CODEX_PROXY_ENV_VALUE };
  }
  const envMap = {};
  for (const ch of channels) {
    if (ch.enabled !== false && ch.envKey && ch.apiKey) {
      envMap[ch.envKey] = ch.apiKey;
    }
  }
  return envMap;
}

function syncAllChannelEnvVars() {
  try {
    const svc = getServiceInstance();
    const data = svc.loadChannels();
    const proxyRunning = isProxyConfig();
    const envMap = buildManagedCodexEnvMap(data.channels, {
      includeProxyKey: proxyRunning
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
    if (key !== currentProviderKey && !knownKeys.has(key)) {
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
        env_key: ch.envKey,
        requires_openai_auth: ch.requiresOpenaiAuth !== false
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
    ch.envKey = ch.envKey || '';
    ch.wireApi = ch.wireApi || 'responses';
    ch.model = ch.model || '';
    ch.speedTestModel = ch.speedTestModel || null;
    ch.modelRedirects = Array.isArray(ch.modelRedirects) ? ch.modelRedirects : [];
    ch.gatewaySourceType = ch.gatewaySourceType || 'codex';
    ch.requiresOpenaiAuth = ch.requiresOpenaiAuth !== false;
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
    syncAllChannelEnvVars();
    // 注意：不再自动写入 config.toml，只在开启代理控制时才同步
  }

  _onAfterUpdate(_old, _next, _allChannels) {
    syncAllChannelEnvVars();
    // 注意：不再自动写入 config.toml，只在开启代理控制时才同步
  }

  _onAfterDelete(_channel, _allChannels) {
    clearNativeOAuth('codex');
    syncAllChannelEnvVars();
    // 注意：不再自动写入 config.toml，只在开启代理控制时才同步
  }

  _applyToNativeSettings(channel) {
    clearNativeOAuth('codex');
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
      env_key: channel.envKey,
      requires_openai_auth: channel.requiresOpenaiAuth !== false
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
  const envKey = extraConfig.envKey || `${providerKey.toUpperCase()}_API_KEY`;
  return service.createChannel({
    name, providerKey, baseUrl, apiKey, wireApi,
    envKey,
    ...extraConfig,
  });
}
function updateChannel(id, updates) { return service.updateChannel(id, updates); }
function deleteChannel(id) { return service.deleteChannel(id); }
function saveChannelOrder(order) { return service.saveChannelOrder(order); }
function applyChannelToSettings(id) { return service.applyChannelToSettings(id); }
function getEffectiveApiKey(channel) { return service.getEffectiveApiKey(channel); }
function disableAllChannels() { return service.disableAllChannels(); }

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
  deleteChannel,
  getEnabledChannels,
  saveChannelOrder,
  syncAllChannelEnvVars,
  writeCodexConfigForMultiChannel,
  applyChannelToSettings,
  getEffectiveApiKey,
  disableAllChannels,
};
