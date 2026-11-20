'use strict';

const fs = require('fs');
const path = require('path');
const { getPlatformStatePath: resolveStatePath } = require('../../../config/paths');
const { MODEL_METADATA, MODEL_ALIASES } = require('../../../config/model-metadata');
const BaseChannelService = require('../../../shared/base-channel-service');
const { writeYamlFile } = require('../../../utils/native-config-patcher');
const {
  resolvePaths,
  readYamlFile,
  writeAtomic,
  DSH_YAML_SOURCE_TAGS,
  isObject,
  listProfiles,
  readProfileChannelConfig,
  resolveDshProfileName,
  normalizeDshProfileChoice,
  upsertProfilePatchRow,
  deleteProfilePatchRow
} = require('./common');
const { upsertSyncedChannels } = require('../../../server/services/channel-sync-utils');
const {
  normalizeChannelModelDefinitions,
  resolveChannelModelDefinition
} = require('../../../shared/channel-model-metadata');

const PROVIDER_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const API_KEY_ENV_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const SUPPORTED_PROVIDER_APIS = new Set([
  'openai-completions',
  'openai-responses',
  'anthropic-messages'
]);
const REDACTED_API_KEY = '[REDACTED]';
const MODEL_METADATA_BY_ID = new Map();
for (const [id, metadata] of Object.entries(MODEL_METADATA)) {
  MODEL_METADATA_BY_ID.set(id.toLowerCase(), metadata);
  if (metadata.sourceId) MODEL_METADATA_BY_ID.set(String(metadata.sourceId).toLowerCase(), metadata);
}
for (const [alias, canonical] of Object.entries(MODEL_ALIASES)) {
  const metadata = MODEL_METADATA_BY_ID.get(String(canonical).toLowerCase());
  if (metadata) MODEL_METADATA_BY_ID.set(alias.toLowerCase(), metadata);
}
const getStatePath = typeof resolveStatePath === 'function'
  ? resolveStatePath
  : () => undefined;

let configuredState = {
  channels: getStatePath('channels', 'dsh'),
  activeChannel: getStatePath('activeChannel', 'dsh'),
  native: null,
  channelProfile: 'auto'
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
  const normalized = normalizeChannelModelDefinitions(models);
  const fallback = String(fallbackModel || '').trim();
  if (normalized.length === 0 && fallback) normalized.push({ id: fallback });
  return normalized.map(enrichDshModelMetadata);
}

function normalizeDshCost(value) {
  if (!isObject(value)) return {};
  const cost = {};
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) {
    if (typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0) {
      cost[key] = value[key];
    }
  }
  if (cost.cacheWrite === undefined && typeof value.cacheCreation === 'number') {
    cost.cacheWrite = value.cacheCreation;
  }
  return cost;
}

function enrichDshModelMetadata(model) {
  const id = String(model?.id || model?.name || '').trim();
  if (!id) return model;
  const metadata = MODEL_METADATA_BY_ID.get(id.toLowerCase());
  if (!metadata) return { ...model, id };

  const limit = isObject(metadata.limit) ? metadata.limit : {};
  const pricing = isObject(metadata.pricing) ? metadata.pricing : {};
  const catalogCost = typeof pricing.input === 'number' && typeof pricing.output === 'number'
    ? {
      input: pricing.input,
      output: pricing.output,
      cacheRead: typeof pricing.cacheRead === 'number' ? pricing.cacheRead : 0,
      cacheWrite: typeof pricing.cacheCreation === 'number' ? pricing.cacheCreation : 0
    }
    : {};
  const catalog = {
    ...(typeof metadata.name === 'string' ? { name: metadata.name } : {}),
    ...(typeof metadata.reasoning === 'boolean' ? { reasoning: metadata.reasoning } : {}),
    ...(Array.isArray(metadata.input) ? { input: [...metadata.input] } : {}),
    ...(typeof limit.context === 'number' ? { contextWindow: limit.context } : {}),
    ...(typeof limit.output === 'number' ? { maxTokens: limit.output } : {}),
    ...(Object.keys(catalogCost).length > 0 ? { cost: catalogCost } : {})
  };
  const explicitCost = normalizeDshCost(model.cost || model.pricing);
  const enriched = { ...catalog, ...model, id };
  if (Object.keys(catalogCost).length > 0 || Object.keys(explicitCost).length > 0) {
    enriched.cost = { ...catalogCost, ...explicitCost };
  }
  if (model.contextWindow === undefined && typeof model.limit?.context === 'number') {
    enriched.contextWindow = model.limit.context;
  }
  if (model.maxTokens === undefined && typeof model.limit?.output === 'number') {
    enriched.maxTokens = model.limit.output;
  }
  return enriched;
}

function resolveDshReasoningEfforts(resolved) {
  if (resolved.reasoningEfforts !== undefined) return resolved.reasoningEfforts;
  const efforts = Array.isArray(resolved.thinking?.efforts) ? resolved.thinking.efforts : [];
  if (efforts.length > 0) {
    const mapped = {};
    for (const level of efforts) {
      if (level !== 'off') mapped[level] = level;
    }
    // DSH rejects a level set that only offers "off"; fall back to the catalog
    // capability instead of writing an unusable model entry.
    if (Object.keys(mapped).length > 0) return mapped;
  }
  if (resolved.reasoning === false) return false;
  return undefined;
}

/**
 * Project a channel model definition onto DSH's llm-pi-ai provider model
 * schema. Channel-only fields (cost, thinking, ...) must not reach
 * settings.yaml: DSH validates every entry it loads.
 */
function toDshNativeModel(model) {
  const id = String(model?.id || '').trim();
  if (!id) return null;
  // Callers pass models already enriched by normalizeModels; resolving again
  // without catalog metadata keeps one fallback path instead of two.
  const resolved = resolveChannelModelDefinition(model);
  if (!resolved) return null;
  const entry = { id: resolved.id };
  if (resolved.name) entry.name = resolved.name;
  if (resolved.contextWindow) entry.contextWindow = resolved.contextWindow;
  if (resolved.maxTokens) entry.maxTokens = resolved.maxTokens;
  if (resolved.input?.length) entry.input = [...resolved.input];
  const reasoningEfforts = resolveDshReasoningEfforts(resolved);
  if (reasoningEfforts !== undefined) entry.reasoningEfforts = reasoningEfforts;
  // `compat` is a model-level DSH switch block: pass the author's value through
  // untouched so syncing native settings does not erase it.
  if (isObject(model.compat)) entry.compat = { ...model.compat };
  return entry;
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

function configure({ pathContext, paths, channelsFilePath, config } = {}) {
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
    native: resolvePaths({ paths: native, pathContext }),
    channelProfile: normalizeDshProfileChoice(config?.dshChannelProfile)
  };
  if (service) {
    service.channelsFilePath = configuredState.channels;
    service.nativePaths = configuredState.native;
  }
}

function isProxyModeEnabled() {
  return Boolean(readActiveMarker());
}

function listProfileChannelSources(nativePaths = configuredState.native) {
  const profilesDir = nativePaths?.profiles;
  if (!profilesDir || !fs.existsSync(profilesDir)) return [];
  const context = { paths: nativePaths };
  const sources = [];
  for (const profile of listProfiles(context)) {
    const config = readProfileChannelConfig(context, profile.name);
    if (!config) continue;
    const providerKeys = config.disabled === true ? [] : Object.keys(config.providers).filter(providerKey => (
      providerKey !== 'ctx-dsh-proxy' && isObject(config.providers[providerKey])
    ));
    const patchPath = config.patchPath || path.join(profile.path, 'cordis.patch.yml');
    let mtime = 0;
    try {
      mtime = fs.statSync(patchPath).mtimeMs;
    } catch (_) {
      // A missing patch file cannot win the recency tie-break.
    }
    sources.push({
      ...config,
      patchPath,
      providerCount: providerKeys.length,
      mtime
    });
  }
  return sources.sort((left, right) => (
    right.providerCount - left.providerCount
    || right.mtime - left.mtime
    || left.profile.localeCompare(right.profile)
  ));
}

function missingProfileSource(nativePaths, profile) {
  return {
    profile,
    patchPath: path.join(nativePaths?.profiles || '', profile, 'cordis.patch.yml'),
    missing: true,
    disabled: false,
    config: {},
    providers: {},
    selected: {},
    providerCount: 0,
    mtime: 0
  };
}

function resolveProfileChannelSource(nativePaths = configuredState.native) {
  const sources = listProfileChannelSources(nativePaths);
  if (sources.length === 0) return null;
  const target = resolveDshProfileName({
    choice: configuredState.channelProfile,
    profiles: sources.map(source => source.profile),
    envProfile: process.env.DSH_PROFILE
  });
  if (!target) return null;
  return sources.find(source => source.profile === target) || missingProfileSource(nativePaths, target);
}

class DshChannelService extends BaseChannelService {
  constructor() {
    super({
      platform: 'dsh',
      channelsFilePath: configuredState.channels,
      defaultGatewaySource: 'openai_compatible',
      allowMultipleEnabled: true,
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
    if (['create', 'update', 'apply'].includes(operation) && !isProxyModeEnabled()) {
      this._assertNativeChannelWriteAllowed(this._resolveNativeChannelState());
    }
    if (operation === 'apply' && isProxyModeEnabled()) {
      const error = new Error('请先停止 DSH 动态代理，再写入渠道配置');
      error.statusCode = 409;
      error.code = 'dsh_proxy_running';
      throw error;
    }
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
    const previous = _allChannels.find(item => item.id === channel.id);
    const enablingUnsupported = channel.enabled !== false
      && channel.providerApi !== 'openai-completions'
      && (!previous || previous.enabled === false || previous.providerApi !== channel.providerApi);
    if (isProxyModeEnabled() && enablingUnsupported) {
      const error = new Error('DSH 动态代理仅支持 OpenAI Chat Completions；请先停止代理或禁用该渠道');
      error.statusCode = 409;
      error.code = 'dsh_proxy_provider_api_unsupported';
      throw error;
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

  /**
   * 直连模式下原生配置承载所有已启用渠道；preferredChannelId 用于决定默认模型。
   */
  _onAfterCreate(channel, allChannels) {
    if (isProxyModeEnabled()) return;
    this._syncNativeSettingsForChannels(allChannels, channel.enabled !== false ? channel.id : null);
  }

  _onAfterUpdate(oldChannel, nextChannel, allChannels) {
    if (oldChannel.providerKey !== nextChannel.providerKey) {
      this._removeNativeProvider(oldChannel.providerKey);
    }
    if (isProxyModeEnabled()) return;
    const justEnabled = oldChannel.enabled === false && nextChannel.enabled !== false;
    this._syncNativeSettingsForChannels(allChannels, justEnabled ? nextChannel.id : null);
  }

  _onAfterDelete(channel, allChannels) {
    this._removeNativeProvider(channel.providerKey);
    this._removeCredentialsForChannels([channel]);
    if (isProxyModeEnabled()) return;
    if (this._resolveNativeChannelState().disabled === true) return;
    this._syncNativeSettingsForChannels(allChannels);
  }

  _nativeSettings() {
    return readYamlFile(this.nativePaths.settings, {});
  }

  _writeNativeSettings(settings) {
    writeYamlFile(this.nativePaths.settings, settings, {
      atomic: true,
      mode: 0o600,
      customTags: DSH_YAML_SOURCE_TAGS
    });
  }

  _profileChannelState(profileSource) {
    return {
      kind: 'profile',
      profile: profileSource.profile,
      patchPath: profileSource.patchPath,
      config: profileSource.config,
      providers: { ...profileSource.providers },
      selected: { ...profileSource.selected },
      missing: profileSource.missing === true,
      disabled: profileSource.disabled === true,
      disabledSource: profileSource.disabledSource || null,
      settings: null
    };
  }

  _resolveNativeChannelState() {
    const profileSource = resolveProfileChannelSource(this.nativePaths);
    if (profileSource) return this._profileChannelState(profileSource);

    const settings = this._nativeSettings();
    const llm = isObject(settings['llm-pi-ai']) ? settings['llm-pi-ai'] : {};
    return {
      kind: 'settings',
      profile: null,
      patchPath: this.nativePaths.settings,
      config: llm,
      providers: isObject(llm.providers) ? { ...llm.providers } : {},
      selected: isObject(settings['agent-default-model']) ? { ...settings['agent-default-model'] } : {},
      missing: false,
      settings
    };
  }

  _assertNativeChannelWriteAllowed(state) {
    if (!state || state.kind !== 'profile' || state.disabled !== true) return;
    const source = state.disabledSource || state.patchPath;
    const error = new Error(
      `DSH profile "${state.profile}" 的 llm-pi-ai 已被禁用（${source} 中的 disabled: true），无法写入渠道配置；请先移除该禁用项或重新启用该模块`
    );
    error.statusCode = 409;
    error.code = 'dsh_profile_module_disabled';
    throw error;
  }

  _writeNativeChannelState(state, { providers = {}, selected = {} } = {}) {
    if (!state) throw new Error('DSH native channel state is required');
    if (state.missing) {
      const error = new Error(`DSH profile "${state.profile}" 未安装或未初始化，请先在 DSH 中创建该 profile`);
      error.statusCode = 400;
      error.code = 'dsh_profile_missing';
      throw error;
    }
    this._assertNativeChannelWriteAllowed(state);
    const nextSelected = isObject(selected) ? { ...selected } : {};
    if (state.kind === 'profile') {
      const context = { paths: this.nativePaths };
      upsertProfilePatchRow(context, state.profile, {
        id: 'llm-pi-ai',
        config: {
          ...(isObject(state.config) ? state.config : {}),
          providers
        }
      });
      if (Object.keys(nextSelected).length > 0) {
        upsertProfilePatchRow(context, state.profile, {
          id: 'agent-default-model',
          config: nextSelected
        });
      } else {
        deleteProfilePatchRow(context, state.profile, 'agent-default-model');
      }
      return;
    }
    const settings = isObject(state.settings) ? state.settings : {};
    const llm = isObject(settings['llm-pi-ai']) ? { ...settings['llm-pi-ai'] } : {};
    settings['llm-pi-ai'] = { ...llm, providers };
    if (Object.keys(nextSelected).length > 0) settings['agent-default-model'] = nextSelected;
    else delete settings['agent-default-model'];
    this._writeNativeSettings(settings);
  }

  _removeNativeProvider(providerKey) {
    const key = String(providerKey || '').trim();
    if (!key || key === 'ctx-dsh-proxy') return;
    const state = this._resolveNativeChannelState();
    if (!Object.prototype.hasOwnProperty.call(state.providers, key)) return;
    const providers = { ...state.providers };
    delete providers[key];
    const selected = { ...state.selected };
    if (selected.provider === key) {
      delete selected.provider;
      delete selected.model;
    }
    this._writeNativeChannelState(state, { providers, selected });
  }

  _writeCredentialsForChannels(channels = []) {
    const apiKeyChannels = (channels || []).filter(channel => channel.authMode === 'api_key');
    if (apiKeyChannels.length === 0) return;
    const credentials = readYamlFile(this.nativePaths.credentials, { version: 1, refs: {}, records: {} });
    if (!isObject(credentials.refs)) credentials.refs = {};
    apiKeyChannels.forEach(channel => {
      credentials.refs[channel.apiKeyEnv] = channel.apiKey || '';
    });
    if (!isObject(credentials.records)) credentials.records = {};
    writeYamlFile(this.nativePaths.credentials, credentials, {
      atomic: true,
      mode: 0o600,
      customTags: DSH_YAML_SOURCE_TAGS
    });
  }

  _removeCredentialsForChannels(channels = []) {
    const apiKeyChannels = (channels || [])
      .filter(channel => channel.authMode === 'api_key' && channel.apiKeyEnv);
    if (apiKeyChannels.length === 0) return;
    const credentials = readYamlFile(this.nativePaths.credentials, { version: 1, refs: {}, records: {} });
    if (!isObject(credentials.refs)) return;
    let changed = false;
    apiKeyChannels.forEach(channel => {
      if (!Object.prototype.hasOwnProperty.call(credentials.refs, channel.apiKeyEnv)) return;
      delete credentials.refs[channel.apiKeyEnv];
      changed = true;
    });
    if (!changed) return;
    writeYamlFile(this.nativePaths.credentials, credentials, {
      atomic: true,
      mode: 0o600,
      customTags: DSH_YAML_SOURCE_TAGS
    });
  }

  _providerEntry(channel, baseUrl = channel.baseUrl, models = channel.models) {
    const entry = {
      displayName: channel.name,
      api: channel.providerApi,
      baseURL: baseUrl,
      models: normalizeModels(models, channel.model).map(toDshNativeModel).filter(Boolean)
    };
    if (channel.authMode === 'api_key') entry.apiKeyEnv = channel.apiKeyEnv;
    return entry;
  }

  _syncNativeSettingsForChannels(channels = [], preferredChannelId = null) {
    const allChannels = (channels || []).filter(channel => channel && channel.providerKey);
    const enabledChannels = this._orderEnabledChannels(allChannels, preferredChannelId);
    const state = this._resolveNativeChannelState();
    this._assertNativeChannelWriteAllowed(state);
    const providers = { ...state.providers };

    delete providers['ctx-dsh-proxy'];
    const disabledChannels = allChannels.filter(channel => channel.enabled === false);
    disabledChannels.forEach(channel => {
      delete providers[channel.providerKey];
    });
    this._removeCredentialsForChannels(disabledChannels);

    enabledChannels.forEach(channel => {
      providers[channel.providerKey] = {
        ...(isObject(providers[channel.providerKey]) ? providers[channel.providerKey] : {}),
        ...this._providerEntry(channel)
      };
    });

    this._writeCredentialsForChannels(enabledChannels);

    const currentDefault = { ...state.selected };
    const preferred = preferredChannelId
      ? enabledChannels.find(channel => channel.id === preferredChannelId)
      : enabledChannels.find(channel => channel.providerKey === currentDefault.provider);
    const selected = preferred || enabledChannels[0] || null;
    if (selected) {
      currentDefault.provider = selected.providerKey;
      currentDefault.model = selected.model;
    } else {
      delete currentDefault.provider;
      delete currentDefault.model;
    }

    this._writeNativeChannelState(state, { providers, selected: currentDefault });
    return selected;
  }

  _applyToNativeSettings(channel) {
    clearActiveMarker();
    return this._syncNativeSettingsForChannels(this.loadChannels().channels, channel?.id || null);
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
    const state = this._resolveNativeChannelState();
    const selected = state.selected;
    const providerKey = String(selected.provider || '').trim();
    const channel = this.loadChannels().channels.find(item => item.providerKey === providerKey) || null;
    return {
      providerKey: providerKey || null,
      model: String(selected.model || '').trim() || null,
      channel
    };
  }

  syncCurrentChannel() {
    const state = this._resolveNativeChannelState();
    const selected = state.selected;
    const selectedProviderKey = String(selected.provider || '').trim();
    const providers = state.providers;
    const source = state.kind === 'profile'
      ? {
        type: 'profile',
        profile: state.profile,
        path: state.patchPath,
        missing: state.missing === true,
        disabled: state.disabled === true
      }
      : { type: 'settings', path: state.patchPath };
    const configuredProviders = Object.entries(providers)
      .filter(([providerKey, provider]) => providerKey !== 'ctx-dsh-proxy' && isObject(provider));
    if (configuredProviders.length === 0) {
      let warning = 'DSH 设置和 profiles 中没有可同步的 llm-pi-ai.providers';
      if (state.missing) {
        warning = `DSH profile "${state.profile}" 未安装或未初始化`;
      } else if (state.disabled) {
        const disabledPath = state.disabledSource || state.patchPath;
        warning = `DSH profile "${state.profile}" 的 llm-pi-ai 已被禁用（${disabledPath} 中的 disabled: true），其 providers 不会生效；请移除该禁用项或重新启用后再同步`;
      }
      return {
        added: 0,
        updated: 0,
        skipped: 0,
        channels: [],
        current: null,
        source,
        warnings: [warning]
      };
    }

    const channels = this.loadChannels().channels;
    const activeMarker = readActiveMarker();
    const activeChannel = activeMarker?.activeChannelId
      ? channels.find(channel => channel.id === activeMarker.activeChannelId)
      : null;
    const activeProviderKey = activeChannel?.providerKey || selectedProviderKey;
    const credentials = readYamlFile(this.nativePaths.credentials, {});
    const credentialRefs = isObject(credentials.refs) ? credentials.refs : {};
    const candidates = [];

    for (const [providerKey, provider] of configuredProviders) {
      if (!PROVIDER_KEY_PATTERN.test(providerKey)) {
        candidates.push({ skip: true, warning: `跳过无效的 DSH provider key: ${providerKey}` });
        continue;
      }
      const baseUrl = String(provider.baseURL || '').trim();
      if (!baseUrl) {
        candidates.push({
          skip: true,
          warning: `DSH provider ${providerKey} 缺少 baseURL，已跳过`
        });
        continue;
      }
      try {
        const parsed = new URL(baseUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
      } catch (_) {
        candidates.push({
          skip: true,
          warning: `DSH provider ${providerKey} 的 baseURL 无效，已跳过`
        });
        continue;
      }

      const apiKeyEnv = String(provider.apiKeyEnv || '').trim();
      const apiKey = apiKeyEnv ? String(credentialRefs[apiKeyEnv] || '') : '';
      const existing = channels.find(channel => channel.providerKey === providerKey);
      const selectedModel = providerKey === selectedProviderKey ? String(selected.model || '').trim() : '';
      const models = normalizeModels(provider.models, selectedModel || existing?.model || 'default');
      const model = selectedModel || existing?.model || models[0]?.id || 'default';
      if (!models.some(item => item.id.toLowerCase() === model.toLowerCase())) models.unshift({ id: model });
      const authMode = apiKey
        ? 'api_key'
        : (existing?.authMode === 'api_key' && existing.apiKey ? 'api_key' : 'none');
      candidates.push({
        name: provider.displayName || providerKey,
        providerKey,
        providerApi: provider.api || 'openai-completions',
        baseUrl,
        model,
        models,
        apiKeyEnv: apiKeyEnv || undefined,
        ...(apiKey ? { apiKey } : {}),
        authMode,
        enabled: true
      });
    }

    const result = upsertSyncedChannels({
      toolType: 'dsh',
      loadChannels: () => this.loadChannels(),
      saveChannels: data => this.saveChannels(data),
      applyDefaults: channel => this._applyDefaults(channel),
      candidates,
      matchers: [
        (channel, candidate) => channel.providerKey === candidate.providerKey
      ]
    });
    const current = result.channels.find(channel => channel.providerKey === activeProviderKey) || null;
    return { ...result, current, source };
  }

  setProxyConfig(port, { activeChannelId } = {}) {
    const channels = this.getEnabledChannels();
    if (channels.length === 0) throw new Error('请先添加并启用至少一个 DSH 渠道');
    const selected = channels.find(channel => channel.id === activeChannelId) || channels[0];
    const state = this._resolveNativeChannelState();
    const providers = { ...state.providers };
    const modelEntries = new Map();
    for (const channel of channels) {
      for (const model of normalizeModels(channel.models, channel.model)) {
        const native = toDshNativeModel(model);
        if (!native) continue;
        const key = native.id.toLowerCase();
        if (!modelEntries.has(key)) modelEntries.set(key, native);
      }
    }
    const models = [...modelEntries.values()];
    providers['ctx-dsh-proxy'] = {
      displayName: 'coding-tool-x DSH 动态代理',
      api: 'openai-completions',
      baseURL: `http://127.0.0.1:${Number(port)}/v1`,
      models: models.length > 0 ? models : [{ id: selected.model }]
    };
    this._writeNativeChannelState(state, {
      providers,
      selected: {
        ...state.selected,
        provider: 'ctx-dsh-proxy',
        model: selected.model
      }
    });
    writeActiveMarker(selected.id, port);
    return { channel: selected, port, provider: 'ctx-dsh-proxy' };
  }

  restoreNativeConfig() {
    const marker = readActiveMarker();
    const channels = this.loadChannels().channels;
    const enabledChannels = channels.filter(channel => channel.enabled !== false);
    const selected = enabledChannels.find(channel => channel.id === marker?.activeChannelId)
      || enabledChannels[0]
      || null;
    clearActiveMarker();
    if (this._resolveNativeChannelState().disabled === true) return selected;
    this._syncNativeSettingsForChannels(channels, selected?.id || null);
    return selected;
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
  return {
    ...channel,
    apiKey: channel.apiKey || '',
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
  const instance = getServiceInstance();
  const result = instance.syncCurrentChannel();
  const fullChannels = instance.getChannels().channels;
  const byId = new Map(fullChannels.map(channel => [channel.id, channel]));
  const currentChannel = result.current ? byId.get(result.current.id) || result.current : null;
  return {
    ...result,
    channels: Array.isArray(result.channels)
      ? result.channels.map(channel => toPublicChannel(byId.get(channel.id) || channel))
      : [],
    current: toPublicChannel(currentChannel)
  };
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
