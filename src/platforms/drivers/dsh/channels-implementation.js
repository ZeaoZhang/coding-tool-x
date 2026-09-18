'use strict';

const fs = require('fs');
const path = require('path');
const { getPlatformStatePath: resolveStatePath } = require('../../../config/paths');
const BaseChannelService = require('../../../shared/base-channel-service');
const {
  resolvePaths,
  readYamlFile,
  writeAtomic,
  dumpYaml,
  isObject
} = require('./common');

const PROVIDER_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const API_KEY_ENV_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const SUPPORTED_PROVIDER_APIS = new Set([
  'openai-completions',
  'openai-responses',
  'anthropic-messages'
]);
const REDACTED_API_KEY = '[REDACTED]';
const getStatePath = typeof resolveStatePath === 'function'
  ? resolveStatePath
  : () => undefined;

let configuredState = {
  channels: getStatePath('channels', 'dsh'),
  activeChannel: getStatePath('activeChannel', 'dsh'),
  native: null
};
let service;

function normalizeProviderKey(value, fallback = 'dsh-provider') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return PROVIDER_KEY_PATTERN.test(normalized) ? normalized : fallback;
}

function normalizeApiKeyEnv(value, providerKey) {
  const candidate = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  if (API_KEY_ENV_PATTERN.test(candidate)) return candidate;
  return `CTX_DSH_${String(providerKey || 'PROVIDER').toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`.slice(0, 128);
}

function normalizeModels(models, fallbackModel) {
  const values = Array.isArray(models) ? models : [];
  const normalized = values.map(item => {
    if (typeof item === 'string') return { id: item.trim() };
    if (isObject(item)) return { ...item, id: String(item.id || item.name || '').trim() };
    return null;
  }).filter(item => item?.id);
  const fallback = String(fallbackModel || '').trim();
  if (normalized.length === 0 && fallback) normalized.push({ id: fallback });
  const seen = new Set();
  return normalized.filter(item => {
    const key = item.id.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readActiveMarker() {
  try {
    if (!configuredState.activeChannel || !fs.existsSync(configuredState.activeChannel)) return null;
    const value = JSON.parse(fs.readFileSync(configuredState.activeChannel, 'utf8'));
    return isObject(value) ? value : null;
  } catch (_) {
    return null;
  }
}

function writeActiveMarker(activeChannelId, port) {
  if (!configuredState.activeChannel) return;
  const marker = {
    activeChannelId: activeChannelId || null,
    provider: 'ctx-dsh-proxy',
    port: Number(port) || null,
    updatedAt: Date.now()
  };
  writeAtomic(configuredState.activeChannel, `${JSON.stringify(marker, null, 2)}\n`, 0o600);
}

function clearActiveMarker() {
  try {
    if (configuredState.activeChannel && fs.existsSync(configuredState.activeChannel)) {
      fs.unlinkSync(configuredState.activeChannel);
    }
  } catch (_) {
    // Marker cleanup must not hide a successful proxy shutdown.
  }
}

function configure({ pathContext, paths, channelsFilePath } = {}) {
  const custom = pathContext?.customized === true;
  const native = pathContext?.native || paths || {};
  const directTestState = !pathContext && paths?.dir
    ? path.join(paths.dir, 'channels.json')
    : null;
  configuredState = {
    channels: channelsFilePath
      || pathContext?.state?.channels
      || directTestState
      || getStatePath('channels', 'dsh'),
    activeChannel: custom
      ? (pathContext?.state?.activeChannel || getStatePath('activeChannel', 'dsh'))
      : (paths?.dir && !pathContext
        ? path.join(paths.dir, 'active-channel.json')
        : getStatePath('activeChannel', 'dsh')),
    native: resolvePaths({ paths: native, pathContext })
  };
  if (service) {
    service.channelsFilePath = configuredState.channels;
    service.nativePaths = configuredState.native;
  }
}

function isProxyModeEnabled() {
  return Boolean(readActiveMarker());
}

class DshChannelService extends BaseChannelService {
  constructor() {
    super({
      platform: 'dsh',
      channelsFilePath: configuredState.channels,
      defaultGatewaySource: 'openai_compatible',
      isProxyRunning: isProxyModeEnabled
    });
    this.nativePaths = configuredState.native || resolvePaths({});
  }

  _applyDefaults(channel) {
    const normalized = super._applyDefaults(channel);
    normalized.name = String(normalized.name || normalized.baseUrl || normalized.providerKey || 'DSH 渠道').trim();
    normalized.providerKey = normalizeProviderKey(normalized.providerKey || normalized.baseUrl || normalized.name || `dsh-${normalized.id || 'provider'}`);
    normalized.providerApi = SUPPORTED_PROVIDER_APIS.has(String(normalized.providerApi || '').trim())
      ? String(normalized.providerApi).trim()
      : 'openai-completions';
    normalized.baseUrl = String(normalized.baseUrl || '').trim().replace(/\/$/, '');
    normalized.models = normalizeModels(normalized.models, normalized.model || 'deepseek-chat');
    normalized.model = String(normalized.model || normalized.models[0]?.id || '').trim();
    if (normalized.model && !normalized.models.some(model => model.id === normalized.model)) {
      normalized.models = [{ id: normalized.model }, ...normalized.models];
    }
    normalized.apiKeyEnv = normalizeApiKeyEnv(normalized.apiKeyEnv, normalized.providerKey);
    normalized.gatewaySourceType = 'openai_compatible';
    return normalized;
  }

  _normalizeAuthFields(fields = {}, channels = [], existing = null) {
    const next = { ...fields };
    if (next.apiKey === REDACTED_API_KEY || next.apiKey === '已设置' || next.apiKey === '已隐藏') {
      delete next.apiKey;
    }
    return super._normalizeAuthFields(next, channels, existing);
  }

  _validateUniqueness(channels, fields, excludeId) {
    const hasProviderKeyMutation = Object.prototype.hasOwnProperty.call(fields || {}, 'providerKey');
    if (excludeId && !hasProviderKeyMutation) return;
    const providerKey = normalizeProviderKey(fields.providerKey || fields.name || fields.baseUrl);
    const duplicate = channels.find(channel => (
      channel.id !== excludeId && String(channel.providerKey || '').toLowerCase() === providerKey.toLowerCase()
    ));
    if (duplicate) {
      const error = new Error(`DSH providerKey already exists: ${providerKey}`);
      error.statusCode = 409;
      error.code = 'dsh_provider_key_conflict';
      throw error;
    }
  }

  _validateBeforeChannelMutation(channel, _allChannels, { operation }) {
    if (!channel.baseUrl) throw new Error('DSH channel baseUrl is required');
    try {
      const parsed = new URL(channel.baseUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
    } catch (_) {
      throw new Error('DSH channel baseUrl must be a valid http(s) URL');
    }
    if (!PROVIDER_KEY_PATTERN.test(channel.providerKey)) {
      throw new Error('DSH providerKey must contain only lowercase letters, digits, underscores, or hyphens');
    }
    if (!SUPPORTED_PROVIDER_APIS.has(channel.providerApi)) {
      throw new Error(`Unsupported DSH provider api: ${channel.providerApi}`);
    }
    if (!channel.model || !channel.models.length) {
      throw new Error('DSH channel requires at least one model');
    }
    if (channel.authMode === 'api_key' && operation === 'create' && !String(channel.apiKey || '').trim()) {
      throw new Error('DSH API-key channel requires an apiKey');
    }
    if (!API_KEY_ENV_PATTERN.test(channel.apiKeyEnv)) {
      throw new Error('DSH apiKeyEnv must be an uppercase environment-style name');
    }
  }

  _activeChannel(channels = []) {
    return channels.find(channel => channel.enabled !== false) || channels[0] || null;
  }

  _onAfterCreate(channel) {
    if (!isProxyModeEnabled() && channel.enabled !== false) {
      this._applyToNativeSettings(channel);
    }
  }

  _onAfterUpdate(oldChannel, nextChannel, allChannels) {
    if (isProxyModeEnabled()) return;
    if (oldChannel.providerKey !== nextChannel.providerKey) {
      this._removeNativeProvider(oldChannel.providerKey);
    }
    const active = this._activeChannel(allChannels);
    if (active?.id === nextChannel.id || (oldChannel.enabled !== false && nextChannel.enabled === false)) {
      if (active) this._applyToNativeSettings(active);
    }
  }

  _onAfterDelete(channel, allChannels) {
    if (isProxyModeEnabled()) return;
    this._removeNativeProvider(channel.providerKey);
    const active = this._activeChannel(allChannels);
    if (active) this._applyToNativeSettings(active);
  }

  _nativeSettings() {
    return readYamlFile(this.nativePaths.settings, {});
  }

  _writeNativeSettings(settings) {
    writeAtomic(this.nativePaths.settings, dumpYaml(settings), 0o600);
  }

  _removeNativeProvider(providerKey) {
    const key = String(providerKey || '').trim();
    if (!key || key === 'ctx-dsh-proxy') return;
    const settings = this._nativeSettings();
    const llm = isObject(settings['llm-pi-ai']) ? { ...settings['llm-pi-ai'] } : {};
    const providers = isObject(llm.providers) ? { ...llm.providers } : {};
    if (!Object.prototype.hasOwnProperty.call(providers, key)) return;
    delete providers[key];
    settings['llm-pi-ai'] = { ...llm, providers };
    this._writeNativeSettings(settings);
  }

  _writeCredentials(channel) {
    if (channel.authMode !== 'api_key') return;
    const credentials = readYamlFile(this.nativePaths.credentials, { version: 1, refs: {}, records: {} });
    if (!isObject(credentials.refs)) credentials.refs = {};
    credentials.refs[channel.apiKeyEnv] = channel.apiKey || '';
    if (!isObject(credentials.records)) credentials.records = {};
    writeAtomic(this.nativePaths.credentials, dumpYaml(credentials), 0o600);
  }

  _providerEntry(channel, baseUrl = channel.baseUrl, models = channel.models) {
    const entry = {
      displayName: channel.name,
      api: channel.providerApi,
      baseURL: baseUrl,
      models: normalizeModels(models, channel.model)
    };
    if (channel.authMode === 'api_key') entry.apiKeyEnv = channel.apiKeyEnv;
    return entry;
  }

  _applyToNativeSettings(channel) {
    const settings = this._nativeSettings();
    const llm = isObject(settings['llm-pi-ai']) ? { ...settings['llm-pi-ai'] } : {};
    const providers = isObject(llm.providers) ? { ...llm.providers } : {};
    providers[channel.providerKey] = this._providerEntry(channel);
    settings['llm-pi-ai'] = { ...llm, providers };
    settings['agent-default-model'] = {
      ...(isObject(settings['agent-default-model']) ? settings['agent-default-model'] : {}),
      provider: channel.providerKey,
      model: channel.model
    };
    this._writeNativeSettings(settings);
    this._writeCredentials(channel);
    clearActiveMarker();
    return channel;
  }

  applyChannelToSettings(channelId) {
    if (isProxyModeEnabled()) {
      const error = new Error('请先停止 DSH 动态代理，再写入单渠道配置');
      error.statusCode = 409;
      error.code = 'dsh_proxy_running';
      throw error;
    }
    return super.applyChannelToSettings(channelId);
  }

  getCurrentChannel() {
    const marker = readActiveMarker();
    if (marker?.activeChannelId) {
      const active = this.loadChannels().channels.find(item => item.id === marker.activeChannelId) || null;
      if (active) {
        return {
          providerKey: 'ctx-dsh-proxy',
          model: active.model || null,
          proxy: true,
          channel: active
        };
      }
    }
    const settings = this._nativeSettings();
    const selected = isObject(settings['agent-default-model']) ? settings['agent-default-model'] : {};
    const providerKey = String(selected.provider || '').trim();
    const channel = this.loadChannels().channels.find(item => item.providerKey === providerKey) || null;
    return {
      providerKey: providerKey || null,
      model: String(selected.model || '').trim() || null,
      channel
    };
  }

  syncCurrentChannel() {
    const current = this.getCurrentChannel();
    if (current.channel) return { added: 0, updated: 0, skipped: 1, current: current.channel };
    if (!current.providerKey) return { added: 0, updated: 0, skipped: 0, warnings: ['DSH 当前配置没有 agent-default-model.provider'] };

    const settings = this._nativeSettings();
    const provider = settings['llm-pi-ai']?.providers?.[current.providerKey];
    if (!isObject(provider) || !provider.baseURL) {
      return { added: 0, updated: 0, skipped: 0, warnings: [`未找到可导入的 DSH provider: ${current.providerKey}`] };
    }
    const credentials = readYamlFile(this.nativePaths.credentials, {});
    const apiKeyEnv = String(provider.apiKeyEnv || '').trim();
    const apiKey = apiKeyEnv && isObject(credentials.refs) ? String(credentials.refs[apiKeyEnv] || '') : '';
    const channel = this.createChannel({
      name: provider.displayName || current.providerKey,
      providerKey: current.providerKey,
      providerApi: provider.api || 'openai-completions',
      baseUrl: provider.baseURL,
      model: current.model || provider.models?.[0]?.id || provider.models?.[0] || 'default',
      models: provider.models,
      apiKeyEnv: apiKeyEnv || undefined,
      apiKey,
      authMode: apiKey ? 'api_key' : 'none',
      enabled: true
    });
    return { added: 1, updated: 0, skipped: 0, current: channel };
  }

  setProxyConfig(port, { activeChannelId } = {}) {
    const channels = this.getEnabledChannels();
    if (channels.length === 0) throw new Error('请先添加并启用至少一个 DSH 渠道');
    const selected = channels.find(channel => channel.id === activeChannelId) || channels[0];
    const settings = this._nativeSettings();
    const llm = isObject(settings['llm-pi-ai']) ? { ...settings['llm-pi-ai'] } : {};
    const providers = isObject(llm.providers) ? { ...llm.providers } : {};
    const models = channels.flatMap(channel => channel.models.map(model => ({ id: model.id })));
    providers['ctx-dsh-proxy'] = {
      displayName: 'coding-tool-x DSH 动态代理',
      api: 'openai-completions',
      baseURL: `http://127.0.0.1:${Number(port)}/v1`,
      models: models.length > 0 ? models : [{ id: selected.model }]
    };
    settings['llm-pi-ai'] = { ...llm, providers };
    settings['agent-default-model'] = {
      ...(isObject(settings['agent-default-model']) ? settings['agent-default-model'] : {}),
      provider: 'ctx-dsh-proxy',
      model: selected.model
    };
    this._writeNativeSettings(settings);
    writeActiveMarker(selected.id, port);
    return { channel: selected, port, provider: 'ctx-dsh-proxy' };
  }

  restoreNativeConfig() {
    const marker = readActiveMarker();
    const channels = this.loadChannels().channels;
    const selected = channels.find(channel => channel.id === marker?.activeChannelId)
      || channels.find(channel => channel.enabled !== false)
      || channels[0];
    if (!selected) {
      clearActiveMarker();
      return null;
    }
    const settings = this._nativeSettings();
    const llm = isObject(settings['llm-pi-ai']) ? { ...settings['llm-pi-ai'] } : {};
    const providers = isObject(llm.providers) ? { ...llm.providers } : {};
    delete providers['ctx-dsh-proxy'];
    settings['llm-pi-ai'] = { ...llm, providers };
    this._writeNativeSettings(settings);
    clearActiveMarker();
    return this.applyChannelToSettings(selected.id);
  }

  getEffectiveApiKey(channel) {
    const id = channel?.id;
    const source = id ? this.loadChannels().channels.find(item => item.id === id) : channel;
    return source?.authMode === 'none' ? null : String(source?.apiKey || '').trim() || null;
  }
}

function getServiceInstance() {
  if (!service) service = new DshChannelService();
  service.channelsFilePath = configuredState.channels;
  service.nativePaths = configuredState.native || service.nativePaths;
  return service;
}

function toPublicChannel(channel) {
  if (!channel || typeof channel !== 'object') return channel;
  const { apiKey: _apiKey, ...publicChannel } = channel;
  return {
    ...publicChannel,
    apiKey: channel.apiKey ? REDACTED_API_KEY : '',
    apiKeyConfigured: Boolean(channel.apiKey),
    models: normalizeModels(channel.models, channel.model)
  };
}

function getChannels() {
  return { channels: getServiceInstance().getChannels().channels.map(toPublicChannel) };
}

function getEnabledChannels() {
  return getServiceInstance().getEnabledChannels().map(toPublicChannel);
}

function getCurrentChannel() {
  const result = getServiceInstance().getCurrentChannel();
  return { ...result, channel: toPublicChannel(result.channel) };
}

function syncCurrentDshChannel() {
  const result = getServiceInstance().syncCurrentChannel();
  return { ...result, current: toPublicChannel(result.current) };
}

module.exports = {
  configure,
  getServiceInstance,
  getChannels,
  getEnabledChannels,
  getCurrentChannel,
  syncCurrentDshChannel,
  toPublicChannel,
  getEffectiveApiKey: channel => getServiceInstance().getEffectiveApiKey(channel),
  createChannel: fields => getServiceInstance().createChannel(fields),
  updateChannel: (id, patch) => getServiceInstance().updateChannel(id, patch),
  deleteChannel: id => getServiceInstance().deleteChannel(id),
  applyChannelToSettings: id => getServiceInstance().applyChannelToSettings(id),
  saveChannelOrder: order => getServiceInstance().saveChannelOrder(order),
  setDshProxyConfig: (port, options) => getServiceInstance().setProxyConfig(port, options),
  restoreDshNativeConfig: () => getServiceInstance().restoreNativeConfig(),
  clearActiveMarker,
  isProxyModeEnabled,
  readActiveMarker
};
