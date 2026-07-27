const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PATHS } = require('../../config/paths');
const BaseChannelService = require('./base/base-channel-service');
const ompConfig = require('./omp-config');
const {
  writeManagedOmpProviders,
  removeManagedOmpProviders,
  isManagedOmpProvidersActive,
  getLastManagedOmpSyncResult,
  readModelsConfig,
  readOmpSettingsConfig,
  normalizeProviderId,
  normalizeProviderApi
} = require('./omp-settings-manager');
const {
  createSkippedResult,
  resolveApiKeyValue,
  resolveExistingActiveChannel,
  upsertSyncedChannels
} = require('./channel-sync-utils');

const OMP_THINKING_SUFFIX_RE = /:(minimal|low|medium|high|xhigh|off)$/;

class OmpChannelService extends BaseChannelService {
  constructor() {
    super({
      platform: 'omp',
      channelsFilePath: PATHS.channels.omp,
      defaultGatewaySource: 'openai_compatible',
      isProxyRunning: () => isManagedOmpProvidersActive()
    });
  }

  _applyDefaults(channel) {
    const normalized = super._applyDefaults(channel);
    normalized.providerKey = normalized.providerKey || normalized.provider || normalized.name || normalized.id;
    normalized.providerApi = normalized.providerApi || normalized.api || normalized.wireApi || 'openai-completions';
    normalized.authMode = normalized.authMode === 'oauth' ? 'oauth' : 'api_key';
    normalized.oauthProviderId = normalized.oauthProviderId || (normalized.authMode === 'oauth' ? normalized.providerKey : '');
    if (normalized.authMode === 'oauth') {
      normalized.apiKey = normalized.apiKey || '';
    }
    normalized.model = normalized.model || null;
    normalized.models = Array.isArray(normalized.models) ? normalized.models : [];
    normalized.modelMetadataMode = ['auto', 'hybrid', 'manual'].includes(normalized.modelMetadataMode)
      ? normalized.modelMetadataMode
      : 'auto';
    normalized.modelBindings = Array.isArray(normalized.modelBindings) ? normalized.modelBindings : [];
    normalized.providerConfig = normalized.providerConfig && typeof normalized.providerConfig === 'object'
      && !Array.isArray(normalized.providerConfig)
      ? normalized.providerConfig
      : {};
    normalized.allowedModels = Array.isArray(normalized.allowedModels) ? normalized.allowedModels : [];
    normalized.speedTestModel = normalized.speedTestModel || null;
    normalized.modelRedirects = Array.isArray(normalized.modelRedirects) ? normalized.modelRedirects : [];
    return normalized;
  }

  _applyToNativeSettings(channel) {
    writeManagedOmpProviders([channel]);
  }

  _onAfterCreate(_channel, allChannels) {
    this.syncManagedOmpProviders(allChannels);
  }

  _onAfterUpdate(_oldChannel, _newChannel, allChannels) {
    this.syncManagedOmpProviders(allChannels);
  }

  _onAfterDelete(_channel, allChannels) {
    this.syncManagedOmpProviders(allChannels);
  }

  syncManagedOmpProviders(channels = this.getChannels().channels) {
    const enabledChannels = (channels || []).filter(channel => channel.enabled !== false);
    if (enabledChannels.length === 0) {
      removeManagedOmpProviders();
      return getLastManagedOmpSyncResult();
    }
    writeManagedOmpProviders(enabledChannels);
    return getLastManagedOmpSyncResult();
  }

  disableManagedOmpProviders() {
    removeManagedOmpProviders();
    return getLastManagedOmpSyncResult();
  }

  syncManagedProviderExtension(channels = this.getChannels().channels) {
    return this.syncManagedOmpProviders(channels);
  }

  disableManagedProviderExtension() {
    this.disableManagedOmpProviders();
  }
}

const service = new OmpChannelService();

function splitOmpModelRef(value = '') {
  const raw = String(value || '').trim();
  if (!raw || !raw.includes('/')) {
    return { providerId: '', modelId: normalizeOmpModelId(raw) };
  }
  const index = raw.indexOf('/');
  return {
    providerId: raw.slice(0, index).trim(),
    modelId: normalizeOmpModelId(raw.slice(index + 1))
  };
}

function getOriginalOmpProviderId(providerId = '') {
  const normalized = String(providerId || '').trim();
  return normalized.startsWith('ctx-') ? normalized.slice(4) : normalized;
}

function normalizeOmpModelId(value = '') {
  return String(value || '').trim().replace(OMP_THINKING_SUFFIX_RE, '');
}

function pushUnique(values, value) {
  const item = String(value || '').trim();
  if (item && !values.includes(item)) {
    values.push(item);
  }
}

function collectOmpModelIds(provider = {}) {
  const models = Array.isArray(provider.models) ? provider.models : [];
  return models
    .map(model => typeof model === 'string' ? model : (model?.id || model?.name || ''))
    .map(normalizeOmpModelId)
    .filter(Boolean);
}

function getOmpProviders(modelsConfig = {}) {
  return modelsConfig?.providers && typeof modelsConfig.providers === 'object' && !Array.isArray(modelsConfig.providers)
    ? modelsConfig.providers
    : {};
}

function getKnownOmpProviderId(providers = {}, providerId = '') {
  const raw = String(providerId || '').trim();
  if (providers[raw]) return raw;
  const normalizedRaw = normalizeProviderId(raw);
  return Object.keys(providers).find((key) => {
    return normalizeProviderId(key) === normalizedRaw
      || normalizeProviderId(getOriginalOmpProviderId(key)) === normalizedRaw;
  }) || raw;
}

function createOmpSelection(providerId = '') {
  return {
    providerId,
    modelIds: [],
    roleModelIds: []
  };
}

function collectOmpSyncSelections(modelsConfig = {}, settings = {}) {
  const providers = getOmpProviders(modelsConfig);
  const selections = new Map();

  const addRef = (value, source = 'enabled') => {
    const { providerId, modelId } = splitOmpModelRef(value);
    if (!providerId) return;
    const knownProviderId = getKnownOmpProviderId(providers, providerId);
    const selection = selections.get(knownProviderId) || createOmpSelection(knownProviderId);
    if (modelId) {
      pushUnique(selection.modelIds, modelId);
      if (source === 'role') {
        pushUnique(selection.roleModelIds, modelId);
      }
    }
    selections.set(knownProviderId, selection);
  };

  (Array.isArray(settings.enabledModels) ? settings.enabledModels : []).forEach(item => addRef(item, 'enabled'));

  const roles = settings?.modelRoles && typeof settings.modelRoles === 'object' && !Array.isArray(settings.modelRoles)
    ? settings.modelRoles
    : {};
  addRef(roles.default, 'role');
  Object.entries(roles).forEach(([roleName, value]) => {
    if (roleName !== 'default') addRef(value, 'role');
  });

  const fallbackChains = settings?.retry?.fallbackChains;
  if (fallbackChains && typeof fallbackChains === 'object' && !Array.isArray(fallbackChains)) {
    Object.values(fallbackChains).forEach((chain) => {
      (Array.isArray(chain) ? chain : [chain]).forEach(item => addRef(item, 'fallback'));
    });
  }

  if (selections.size === 0) {
    const providerIds = Object.keys(providers);
    if (providerIds.length === 1) {
      selections.set(providerIds[0], createOmpSelection(providerIds[0]));
    }
  }

  return [...selections.values()];
}

function findOmpExistingChannel(channels = [], providerId = '', baseUrl = '') {
  const rawProvider = String(providerId || '').trim();
  const originalProvider = getOriginalOmpProviderId(rawProvider);
  const normalizedProvider = normalizeProviderId(originalProvider || rawProvider);
  return channels.find(channel => {
    const keys = [
      channel.providerKey,
      channel.provider,
      channel.name,
      getOriginalOmpProviderId(channel.providerKey)
    ].map(value => normalizeProviderId(value || '')).filter(Boolean);
    return keys.includes(normalizedProvider);
  }) || channels.find(channel => baseUrl && channel.baseUrl === baseUrl) || null;
}

function filterOmpProviderModels(models = [], allowedModels = []) {
  if (!Array.isArray(models) || allowedModels.length === 0) return Array.isArray(models) ? models : [];
  const allowed = new Set(allowedModels.map(normalizeOmpModelId));
  return models.filter((model) => {
    const id = normalizeOmpModelId(typeof model === 'string' ? model : (model?.id || model?.name || ''));
    return allowed.has(id);
  });
}

function parseOmpApiKeyCredentialData(data) {
  if (!data) return '';
  try {
    const parsed = JSON.parse(String(data));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '';
    return String(parsed.key || parsed.apiKey || parsed.api_key || parsed.value || parsed.token || '').trim();
  } catch {
    return '';
  }
}

function runOmpAuthDbQuery(dbPath, providerIds = []) {
  if (!dbPath || !fs.existsSync(dbPath) || providerIds.length === 0) return [];
  const escapedProviders = providerIds
    .map(providerId => `'${String(providerId || '').replace(/'/g, "''")}'`)
    .join(',');
  const sql = [
    'select provider, credential_type, data',
    'from auth_credentials',
    `where provider in (${escapedProviders})`,
    "and credential_type = 'api_key'",
    'and (disabled_cause is null or disabled_cause = \'\')',
    'order by updated_at desc',
    'limit 5'
  ].join(' ');

  try {
    const output = execFileSync('sqlite3', ['-json', dbPath, sql], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024,
      windowsHide: true
    }).trim();
    if (!output) return [];
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readOmpApiKeyCredential(providerId = '') {
  const rawProviderId = String(providerId || '').trim();
  const originalProviderId = getOriginalOmpProviderId(rawProviderId);
  const providerIds = [...new Set([rawProviderId, originalProviderId].filter(Boolean))];
  if (providerIds.length === 0) return { value: '', source: '', envName: '' };

  let dbPath = '';
  try {
    const paths = typeof ompConfig.getOmpPaths === 'function' ? ompConfig.getOmpPaths() : {};
    dbPath = path.join(paths.agentDir || path.dirname(paths.modelsYml || ''), 'agent.db');
  } catch {
    dbPath = '';
  }

  const rows = runOmpAuthDbQuery(dbPath, providerIds);
  for (const row of rows) {
    const value = parseOmpApiKeyCredentialData(row?.data);
    if (value) {
      return { value, source: 'omp-auth-db', envName: '' };
    }
  }
  return { value: '', source: '', envName: '' };
}

function buildOmpSyncCandidate(modelsConfig, selection, channels) {
  const providerId = selection?.providerId || '';
  const provider = modelsConfig?.providers?.[providerId] || null;
  if (!provider || typeof provider !== 'object') {
    return {
      skip: true,
      warning: `OMP 当前 provider "${providerId}" 未在 models.yml 中定义。`
    };
  }

  const baseUrl = String(provider.baseUrl || provider.base_url || '').trim();
  const originalProviderId = getOriginalOmpProviderId(providerId);
  const existing = findOmpExistingChannel(channels, providerId, baseUrl);
  let credential = resolveApiKeyValue(provider.apiKey || provider.api_key || '');
  if (!credential.value) {
    credential = readOmpApiKeyCredential(providerId);
  }
  const apiKey = credential.value || existing?.apiKey || '';
  const providerModelIds = collectOmpModelIds(provider);
  const selectedModelIds = Array.isArray(selection?.modelIds) ? selection.modelIds : [];
  const allowedModels = selectedModelIds.length > 0 ? selectedModelIds : providerModelIds;
  const preferredModel = selection?.roleModelIds?.[0]
    || selectedModelIds[0]
    || existing?.model
    || allowedModels[0]
    || null;
  if (!apiKey) {
    return {
      skip: true,
      channel: existing || null,
      warning: `OMP 当前 provider "${providerId}" 缺少可解析 API Key，OAuth/登录态渠道不支持同步导入。`
    };
  }

  return {
    name: existing?.name || originalProviderId || providerId,
    providerKey: originalProviderId || providerId,
    baseUrl,
    apiKey,
    providerApi: normalizeProviderApi(provider.api),
    wireApi: provider.api || 'openai-completions',
    authMode: 'api_key',
    oauthProviderId: '',
    model: preferredModel,
    allowedModels,
    models: filterOmpProviderModels(provider.models, allowedModels),
    gatewaySourceType: existing?.gatewaySourceType || 'openai_compatible',
    credentialSource: credential.value ? credential.source : 'existing-channel'
  };
}

function syncCurrentOmpChannel() {
  let modelsConfig = { providers: {} };
  let settings = {};
  try {
    modelsConfig = readModelsConfig();
    settings = readOmpSettingsConfig();
  } catch (error) {
    return createSkippedResult('omp', `OMP 配置读取失败：${error.message}`);
  }

  const data = service.loadChannels();
  const channels = Array.isArray(data.channels) ? data.channels : [];
  const selections = collectOmpSyncSelections(modelsConfig, settings);
  if (selections.length === 0) {
    const active = resolveExistingActiveChannel('omp', channels);
    if (active) {
      return createSkippedResult('omp', 'OMP 当前配置未明确 provider；已找到当前面板中的 active 渠道，未重复导入。', active);
    }
    return createSkippedResult('omp', 'OMP 当前配置未明确 provider，无法同步当前渠道。');
  }
  const candidates = selections.map(selection => buildOmpSyncCandidate(modelsConfig, selection, channels));

  return upsertSyncedChannels({
    toolType: 'omp',
    loadChannels: () => service.loadChannels(),
    saveChannels: payload => service.saveChannels(payload),
    applyDefaults: channel => service._applyDefaults(channel),
    candidates,
    matchers: [
      (channel, current) => channel.providerKey && channel.providerKey === current.providerKey,
      (channel, current) => channel.baseUrl === current.baseUrl && channel.apiKey === current.apiKey
    ]
  });
}

module.exports = {
  getChannels: () => service.getChannels(),
  createChannel: (name, baseUrl, apiKey, extra = {}) => service.createChannel({
    name,
    baseUrl,
    apiKey,
    ...extra
  }),
  updateChannel: (id, updates) => service.updateChannel(id, updates),
  markChannelAsRecentlyUsed: (id) => service.updateChannel(id, {}),
  deleteChannel: (id) => service.deleteChannel(id),
  getEnabledChannels: () => service.getEnabledChannels(),
  saveChannelOrder: (order) => service.saveChannelOrder(order),
  applyChannelToSettings: (id) => service.applyChannelToSettings(id),
  disableAllChannels: () => service.disableAllChannels(),
  getEffectiveApiKey: (channel) => channel?.apiKey || null,
  syncManagedOmpProviders: (channels) => service.syncManagedOmpProviders(channels),
  disableManagedOmpProviders: () => service.disableManagedOmpProviders(),
  syncManagedProviderExtension: (channels) => service.syncManagedProviderExtension(channels),
  disableManagedProviderExtension: () => service.disableManagedProviderExtension(),
  syncCurrentOmpChannel
};
