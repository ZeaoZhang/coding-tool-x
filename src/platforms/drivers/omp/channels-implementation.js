const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PATHS, ensureStorageDirMigrated } = require('../../../config/paths');
const BaseChannelService = require('../../../shared/base-channel-service');
const ompConfig = require('./config');
const { MODEL_METADATA, METADATA_SOURCE } = require('../../../config/model-metadata');
const {
  writeManagedOmpProviders,
  removeManagedOmpProviders,
  getLastManagedOmpSyncResult,
  readModelsConfig,
  readOmpSettingsConfig,
  normalizeProviderId,
  normalizeProviderApi
} = require('./native-config-implementation');
const {
  createSkippedResult,
  isLocalProxyBaseUrl,
  resolveApiKeyValue,
  resolveExistingActiveChannel,
  upsertSyncedChannels
} = require('../../../server/services/channel-sync-utils');

const OMP_THINKING_SUFFIX_RE = /:(minimal|low|medium|high|xhigh|off)$/;

function clearOmpChannelBalanceCache(channel) {
  try {
    require('../../../server/services/channel-balance').clearChannelBalanceCache('omp', channel);
  } catch (_) {
    // Balance cache invalidation is an optimization; channel activation must still succeed.
  }
}

function selectLatestEnabledChannel(channels = []) {
  const enabledChannels = (channels || []).filter(channel => channel?.enabled !== false);
  if (enabledChannels.length === 0) return null;
  return enabledChannels.reduce((latest, current) => {
    const latestTs = Number(latest?.updatedAt || latest?.createdAt || 0);
    const currentTs = Number(current?.updatedAt || current?.createdAt || 0);
    return currentTs > latestTs ? current : latest;
  }, enabledChannels[0]);
}

function loadManagedOmpModeState() {
  ensureStorageDirMigrated();
  try {
    if (!fs.existsSync(PATHS.activeChannel.omp)) return null;
    const data = JSON.parse(fs.readFileSync(PATHS.activeChannel.omp, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

function loadManagedOmpActiveChannelId() {
  return loadManagedOmpModeState()?.activeChannelId || null;
}

function isManagedOmpModeEnabled() {
  ensureStorageDirMigrated();
  return fs.existsSync(PATHS.activeChannel.omp);
}

function writeManagedOmpModeState(filePath, state) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    });
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    throw error;
  }
}

function getOmpGatewaySecretPath() {
  return PATHS.ompGatewaySecret
    || path.join(path.dirname(PATHS.activeChannel.omp), 'omp-gateway-secret');
}

function writeOmpGatewaySecret(filePath, secret) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    fs.writeFileSync(temporaryPath, `${secret}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    throw error;
  }
}

function getOrCreateOmpGatewaySecret() {
  ensureStorageDirMigrated();
  const filePath = getOmpGatewaySecretPath();
  const previousStateSecret = loadManagedOmpModeState()?.gateway?.secret;
  const fileExists = fs.existsSync(filePath);

  if (fileExists) {
    try {
      const stored = fs.readFileSync(filePath, 'utf8').trim();
      if (stored) return stored;
    } catch (error) {
      if (previousStateSecret) {
        writeOmpGatewaySecret(filePath, previousStateSecret);
        return previousStateSecret;
      }
      throw new Error(`Failed to read persisted OMP gateway secret: ${error.message}`);
    }
    if (!previousStateSecret) {
      throw new Error('Persisted OMP gateway secret is empty');
    }
    writeOmpGatewaySecret(filePath, previousStateSecret);
    return previousStateSecret;
  }

  const secret = String(previousStateSecret || crypto.randomBytes(32).toString('hex'));
  writeOmpGatewaySecret(filePath, secret);
  return secret;
}

function enableManagedOmpMode(activeChannelId = null, gateway = null) {
  ensureStorageDirMigrated();
  const filePath = PATHS.activeChannel.omp;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const nextActiveChannelId = activeChannelId || loadManagedOmpActiveChannelId();
  const previousState = loadManagedOmpModeState();
  const nextGateway = gateway || previousState?.gateway || null;
  const state = {
    version: 2,
    activeChannelId: nextActiveChannelId || null
  };
  if (nextGateway) {
    state.gateway = {
      host: String(nextGateway.host || '127.0.0.1'),
      port: Number(nextGateway.port),
      secret: String(nextGateway.secret || ''),
      supportedOAuthChannelIds: Array.isArray(nextGateway.supportedOAuthChannelIds)
        ? [...nextGateway.supportedOAuthChannelIds]
        : []
    };
  }
  writeManagedOmpModeState(filePath, state);
  return nextActiveChannelId || null;
}

function disableManagedOmpMode() {
  ensureStorageDirMigrated();
  if (fs.existsSync(PATHS.activeChannel.omp)) {
    fs.unlinkSync(PATHS.activeChannel.omp);
  }
}

class OmpChannelService extends BaseChannelService {
  constructor() {
    super({
      platform: 'omp',
      channelsFilePath: PATHS.channels.omp,
      defaultGatewaySource: 'openai_compatible',
      oauthChannelPolicy: 'mixed',
      isProxyRunning: () => isManagedOmpModeEnabled()
    });
  }

  _applyDefaults(channel) {
    const normalized = super._applyDefaults(channel);
    normalized.providerKey = normalized.providerKey || normalized.provider || normalized.name || normalized.id;
    normalized.providerApi = normalizeProviderApi(
      normalized.providerApi || normalized.api || normalized.wireApi || 'openai-completions',
      { gatewaySourceType: normalized.gatewaySourceType }
    );
    normalized.authMode = ['api_key', 'oauth', 'none'].includes(normalized.authMode)
      ? normalized.authMode
      : 'api_key';
    normalized.routingGroup = String(normalized.routingGroup || '').trim();
    normalized.oauthProviderId = normalized.oauthProviderId || (normalized.authMode === 'oauth' ? normalized.providerKey : '');
    if (normalized.authMode === 'oauth') {
      normalized.apiKey = normalized.apiKey || '';
    } else if (normalized.authMode === 'none') {
      normalized.apiKey = '';
      normalized.oauthProviderId = '';
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
    if (isManagedOmpModeEnabled()) {
      const state = loadManagedOmpModeState();
      enableManagedOmpMode(channel.id, state?.gateway || null);
      writeManagedOmpProviders([channel], state?.gateway ? {
        gateway: state.gateway,
        activeChannelId: channel.id
      } : {});
      return;
    }
    writeManagedOmpProviders([channel], {});
  }

  _onAfterCreate(_channel, allChannels) {
    this.syncOmpProvidersForCurrentMode(allChannels);
  }

  _onAfterUpdate(_oldChannel, _newChannel, allChannels) {
    this.syncOmpProvidersForCurrentMode(allChannels);
  }

  _onAfterDelete(_channel, allChannels) {
    this.syncOmpProvidersForCurrentMode(allChannels);
  }

  syncOmpProvidersForCurrentMode(channels = this.getChannels().channels) {
    if (isManagedOmpModeEnabled()) {
      const state = loadManagedOmpModeState();
      return this.syncManagedOmpProviders(channels, state?.gateway ? {
        gateway: state.gateway,
        activeChannelId: state.activeChannelId
      } : {});
    }
    const activeChannel = selectLatestEnabledChannel(channels);
    return this.syncManagedOmpProviders(activeChannel ? [activeChannel] : [], {});
  }

  syncManagedOmpProviders(channels = this.getChannels().channels, options = {}) {
    const enabledChannels = (channels || []).filter(channel => channel.enabled !== false);
    if (enabledChannels.length === 0) {
      removeManagedOmpProviders();
      return getLastManagedOmpSyncResult();
    }
    writeManagedOmpProviders(enabledChannels, options);
    return getLastManagedOmpSyncResult();
  }

  disableManagedOmpProviders() {
    removeManagedOmpProviders();
    return getLastManagedOmpSyncResult();
  }

  activateStaticOmpChannel(channelId) {
    const data = this.loadChannels();
    const channel = data.channels.find(item => item.id === channelId);
    if (!channel) {
      throw new Error('Channel not found');
    }

    const previousData = JSON.parse(JSON.stringify(data));
    const wasEnabled = channel.enabled !== false;
    data.channels.forEach(item => {
      item.enabled = item.id === channelId;
    });

    try {
      this.saveChannels(data);
      const sync = this.syncManagedOmpProviders([channel], {});
      if (!wasEnabled) {
        clearOmpChannelBalanceCache(channel);
      }
      return { channel, sync };
    } catch (error) {
      try {
        this.saveChannels(previousData);
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
      throw error;
    }
  }

  applyChannelToSettings(channelId) {
    if (isManagedOmpModeEnabled()) {
      return super.applyChannelToSettings(channelId);
    }
    return this.activateStaticOmpChannel(channelId).channel;
  }

  syncManagedProviderExtension(channels = this.getChannels().channels) {
    return this.syncOmpProvidersForCurrentMode(channels);
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

function isManagedOmpProviderId(providerId = '') {
  return String(providerId || '').trim().startsWith('ctx-');
}

function isGeneratedOmpApiKey(value = '') {
  return /^ctx_[a-f0-9]{40}$/i.test(String(value || '').trim());
}

function isGeneratedOmpBaseUrl(value = '') {
  const raw = String(value || '').trim();
  if (!isLocalProxyBaseUrl(raw)) return false;
  try {
    return /^\/omp\/[a-f0-9]{24}(?:\/|$)/i.test(new URL(raw).pathname);
  } catch {
    return false;
  }
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

function findOmpOriginalProvider(providers = {}, providerId = '') {
  const normalizedProviderId = normalizeProviderId(getOriginalOmpProviderId(providerId));
  const candidates = Object.entries(providers)
    .filter(([key]) => !isManagedOmpProviderId(key))
    .map(([id, provider]) => ({
      id,
      provider,
      normalizedId: normalizeProviderId(id)
    }));
  const exactMatches = candidates.filter(item => item.normalizedId === normalizedProviderId);
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) return null;

  const prefixMatches = candidates
    .filter(item => normalizedProviderId.startsWith(`${item.normalizedId}-`))
    .sort((left, right) => right.normalizedId.length - left.normalizedId.length);
  if (prefixMatches.length === 0) return null;
  const longestLength = prefixMatches[0].normalizedId.length;
  const longestMatches = prefixMatches.filter(item => item.normalizedId.length === longestLength);
  return longestMatches.length === 1 ? longestMatches[0] : null;
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

function resolveOmpAuthMode(provider = {}, sourceProvider = {}, existing = null) {
  const rawAuth = String(sourceProvider.auth || provider.auth || '').trim().toLowerCase();
  if (rawAuth === 'none') return 'none';
  if (existing?.authMode === 'none') return 'none';
  if (existing?.authMode === 'oauth') return 'oauth';
  return 'api_key';
}

function buildOmpSyncCandidate(modelsConfig, selection, channels, options = {}) {
  const providers = getOmpProviders(modelsConfig);
  const providerId = selection?.providerId || '';
  const provider = providers[providerId] || null;
  if (!provider || typeof provider !== 'object') {
    return {
      skip: true,
      warning: `OMP 当前 provider "${providerId}" 未在 models.yml 中定义。`
    };
  }

  const managedProvider = isManagedOmpProviderId(providerId);
  const originalProviderEntry = managedProvider
    ? findOmpOriginalProvider(providers, providerId)
    : null;
  const sourceProvider = originalProviderEntry?.provider || (managedProvider ? {} : provider);
  const originalProviderId = originalProviderEntry?.id || getOriginalOmpProviderId(providerId);
  const providerBaseUrl = String(sourceProvider.baseUrl || sourceProvider.base_url || '').trim();
  const managedBaseUrl = String(provider.baseUrl || provider.base_url || '').trim();
  const existing = findOmpExistingChannel(
    channels,
    originalProviderId || providerId,
    managedProvider ? '' : managedBaseUrl
  );
  const baseUrl = managedProvider && (
    !providerBaseUrl || isGeneratedOmpBaseUrl(providerBaseUrl)
  )
    ? existing?.baseUrl || ''
    : providerBaseUrl || existing?.baseUrl || managedBaseUrl;
  const authMode = options.authMode && options.authMode !== 'all'
    ? options.authMode
    : resolveOmpAuthMode(provider, sourceProvider, existing);

  let credential = resolveApiKeyValue(sourceProvider.apiKey || sourceProvider.api_key || '');
  if (!credential.value) {
    credential = readOmpApiKeyCredential(originalProviderId || providerId);
  }
  const existingCredential = resolveApiKeyValue(existing?.apiKey || '');
  const apiKey = credential.value && !isGeneratedOmpApiKey(credential.value)
    ? credential.value
    : existingCredential.value && !isGeneratedOmpApiKey(existingCredential.value)
      ? existingCredential.value
      : '';
  if (!credential.value || isGeneratedOmpApiKey(credential.value)) {
    credential = existingCredential.value && !isGeneratedOmpApiKey(existingCredential.value)
      ? { ...existingCredential, source: 'existing-channel' }
      : credential;
  }

  const providerModelIds = collectOmpModelIds(provider);
  const selectedModelIds = Array.isArray(selection?.modelIds) ? selection.modelIds : [];
  const allowedModels = selectedModelIds.length > 0 ? selectedModelIds : providerModelIds;
  const preferredModel = selection?.roleModelIds?.[0]
    || selectedModelIds[0]
    || existing?.model
  if (authMode !== 'oauth' && (!baseUrl || (authMode !== 'none' && !apiKey))) {
    return {
      skip: true,
      channel: existing || null,
      warning: `OMP 当前 provider "${providerId}" 缺少可解析的上游 Base URL 或 API Key，已跳过同步。`
    };
  }

  const rawProviderApi = sourceProvider.api || provider.api || 'openai-completions';
  const apiVal = String(rawProviderApi).trim();
  let gatewaySourceType;
  if (existing?.gatewaySourceType) {
    gatewaySourceType = existing.gatewaySourceType;
  } else if (apiVal === 'anthropic-messages') {
    gatewaySourceType = 'claude';
  } else if (apiVal === 'google-generative-ai' || apiVal === 'google-gemini-cli' || apiVal === 'google-vertex') {
    gatewaySourceType = 'gemini';
  } else if (apiVal === 'openai-codex-responses') {
    gatewaySourceType = 'codex';
  } else {
    gatewaySourceType = 'openai_compatible';
  }
  const providerApi = normalizeProviderApi(rawProviderApi, { gatewaySourceType });

  return {
    name: existing?.name || originalProviderId || providerId,
    providerKey: originalProviderId || providerId,
    baseUrl: authMode === 'oauth' ? '' : baseUrl,
    apiKey: authMode === 'oauth' || authMode === 'none' ? '' : apiKey,
    providerApi,
    wireApi: providerApi,
    authMode,
    authRef: authMode === 'oauth' ? {
      credentialId: '',
      providerId: providerId || originalProviderId,
      accountId: sourceProvider.accountId || sourceProvider.account_id || '',
      identityKey: sourceProvider.identityKey || sourceProvider.identity_key || '',
      accountEmail: sourceProvider.accountEmail || sourceProvider.email || ''
    } : undefined,
    authSource: authMode === 'oauth' ? 'synced-local' : undefined,
    oauthProviderId: authMode === 'oauth' ? (existing?.oauthProviderId || originalProviderId || providerId) : '',
    model: preferredModel,
    allowedModels,
    models: filterOmpProviderModels(provider.models, allowedModels),
    gatewaySourceType,
    credentialSource: credential.value ? credential.source : 'existing-channel'
  };
}


function getCatalogMetadata({
  providerKey = '',
  model = '',
  speedTestModel = '',
  allowedModels = [],
  models = []
} = {}) {
  const requestedIds = [
    model,
    speedTestModel,
    ...(Array.isArray(models)
      ? models.map(item => (
        item && typeof item === 'object' && !Array.isArray(item) ? item.id || item.name : item
      ))
      : []),
    ...(Array.isArray(allowedModels)
      ? allowedModels.map(item => (
        item && typeof item === 'object' && !Array.isArray(item) ? item.id || item.name : item
      ))
      : [])
  ]
    .map(value => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  const normalizedProviderKey = String(providerKey || '').trim().toLowerCase();

  const allEntries = Object.entries(MODEL_METADATA)
    .filter(([, metadata]) => Array.isArray(metadata.toolTypes) && metadata.toolTypes.includes('omp'))
    .map(([id, metadata]) => ({ ...structuredClone(metadata), id }));

  const matchesRequestedId = entry => requestedIds.length > 0 && requestedIds.some(requested => (
    requested === entry.id.toLowerCase()
      || requested === String(entry.sourceId || '').toLowerCase()
      || requested === entry.id.split('/').pop().toLowerCase()
  ));
  const matchesProvider = entry => (
    String(entry.provider || '').toLowerCase() === normalizedProviderKey
    || String(entry.sourceId || '').toLowerCase().startsWith(`${normalizedProviderKey}/`)
  );
  const providerEntries = normalizedProviderKey
    ? allEntries.filter(entry => matchesRequestedId(entry) || matchesProvider(entry))
    : [];
  const entries = normalizedProviderKey && providerEntries.length > 0 ? providerEntries : allEntries;

  return {
    models: entries,
    warnings: [],
    source: { ...METADATA_SOURCE }
  };
}

function syncCurrentOmpChannel(options = {}) {
  const authMode = options.authMode || 'api_key';
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
  if (selections.length === 0) return createSkippedResult('omp', 'OMP 当前配置未明确 provider，无法同步当前渠道。');
  const candidates = selections
    .map(selection => buildOmpSyncCandidate(modelsConfig, selection, channels, { authMode }))
    .filter(candidate => authMode === 'all' || candidate.authMode === authMode || candidate.skip);
  return upsertSyncedChannels({
    toolType: 'omp',
    loadChannels: () => service.loadChannels(),
    saveChannels: payload => service.saveChannels(payload),
    applyDefaults: channel => service._applyDefaults(channel),
    candidates,
    matchers: [
      (channel, current) => channel.providerKey === current.providerKey
        && channel.authMode === current.authMode
        && (channel.model || '') === (current.model || ''),
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
  activateStaticOmpChannel: (id) => service.activateStaticOmpChannel(id),
  disableAllChannels: () => service.disableAllChannels(),
  getEffectiveApiKey: (channel) => channel?.apiKey || null,
  syncManagedOmpProviders: (channels, options) => service.syncManagedOmpProviders(channels, options),
  disableManagedOmpProviders: () => service.disableManagedOmpProviders(),
  syncManagedProviderExtension: (channels) => service.syncManagedProviderExtension(channels),
  getCatalogMetadata,
  isManagedOmpModeEnabled,
  getOrCreateOmpGatewaySecret,
  enableManagedOmpMode,
  disableManagedOmpMode,
  loadManagedOmpModeState,
  loadManagedOmpActiveChannelId,
  syncCurrentOmpChannel
};
