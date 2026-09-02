const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');
const ompConfig = require('./config');
const { prepareManagedOmpChannels } = require('./gateway-routing');
const { MODEL_METADATA, MODEL_ALIASES } = require('../../../config/model-metadata');
const {
  MODEL_METADATA_MODES,
  isPlainObject,
  normalizeProviderConfig,
  resolveModelDefinition,
  serializeModelSelector,
  splitModelSelector
} = require('../../../server/services/model-definition-schema');

const MANAGED_PROVIDER_PREFIX = 'ctx-';
const MODELS_BACKUP_MARKER = '.ctx-backup-';
const VISIBILITY_STATE_VERSION = 2;
const MANAGED_VISIBILITY_STATE_FILE = 'coding-tool-x-omp-managed-visibility.json';
const NO_MANAGED_MODELS_SELECTOR = `${MANAGED_PROVIDER_PREFIX}coding-tool-x/__no_models_configured__`;
let lastManagedOmpSyncResult = null;
const OMP_CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;
const OMP_CATALOG_FAILURE_CACHE_TTL_MS = 30 * 1000;
const ompCatalogCache = new Map();

function getOmpPaths(env = process.env, options = {}) {
  // Channel CRUD only needs the native OMP file layout. Do not start OMP just
  // to discover a path: OMP_CONFIG_DIR, OMP_PROFILE and OMP_CODING_AGENT_DIR
  // are sufficient to derive it, and a blocked CLI must not block a save.
  return ompConfig.getOmpPaths(env, { ...options, resolveRuntime: false });
}

function ensureOmpDir(...args) {
  return ompConfig.ensureOmpDir(...args);
}

function normalizeProviderId(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'coding-tool-x';
}

function getManagedProviderId(channel = {}) {
  const explicitId = normalizeProviderId(channel.managedProviderId || '');
  if (channel.managedProviderId) {
    return explicitId.startsWith(MANAGED_PROVIDER_PREFIX)
      ? explicitId
      : `${MANAGED_PROVIDER_PREFIX}${explicitId}`;
  }
  const baseId = normalizeProviderId(channel.providerKey || channel.provider || channel.name || channel.id);
  return baseId.startsWith(MANAGED_PROVIDER_PREFIX) ? baseId : `${MANAGED_PROVIDER_PREFIX}${baseId}`;
}

function isManagedProviderId(providerId = '') {
  return String(providerId || '').startsWith(MANAGED_PROVIDER_PREFIX);
}

function normalizeProviderApi(value = '', options = {}) {
  const normalized = String(value || '').trim();
  const gatewaySourceType = String(options.gatewaySourceType || '').trim().toLowerCase();

  const isGeneric = !normalized
    || normalized === 'openai'
    || normalized === 'chat'
    || normalized === 'chat.completions'
    || normalized === 'openai-completions';

  if (gatewaySourceType === 'codex' && (
    isGeneric
    || normalized === 'responses'
    || normalized === 'openai-responses'
  )) {
    return 'openai-codex-responses';
  }
  if (gatewaySourceType === 'claude' && isGeneric) {
    return 'anthropic-messages';
  }
  if (gatewaySourceType === 'gemini' && isGeneric) {
    return 'google-generative-ai';
  }
  if (isGeneric) {
    return 'openai-completions';
  }
  if (normalized === 'responses') {
    return 'openai-responses';
  }
  return normalized;
}

function compactObject(value = {}) {
  const next = { ...value };
  Object.keys(next).forEach((key) => {
    if (next[key] === undefined) delete next[key];
  });
  return next;
}

function resolveBuiltinOmpMetadata(modelId) {
  const id = String(modelId || '').trim().toLowerCase();
  if (!id) return null;
  const exactKey = Object.keys(MODEL_METADATA).find(key => key.toLowerCase() === id);
  if (exactKey) return MODEL_METADATA[exactKey];
  const aliasKey = Object.keys(MODEL_ALIASES).find(key => key.toLowerCase() === id);
  return aliasKey ? (MODEL_METADATA[MODEL_ALIASES[aliasKey]] || null) : null;
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const result = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const item = String(value || '').trim();
    if (!item || seen.has(item)) return;
    seen.add(item);
    result.push(item);
  });
  return result;
}

function pushUnique(values, value) {
  const item = String(value || '').trim();
  if (item && !values.includes(item)) {
    values.push(item);
  }
}

function sameStringSet(left = [], right = []) {
  const leftSet = new Set(uniqueStrings(left));
  const rightSet = new Set(uniqueStrings(right));
  if (leftSet.size !== rightSet.size) return false;
  for (const item of leftSet) {
    if (!rightSet.has(item)) return false;
  }
  return true;
}

function getOwnProperty(object, key) {
  return object && typeof object === 'object' && !Array.isArray(object)
    ? Object.prototype.hasOwnProperty.call(object, key)
    : false;
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function captureFileSnapshots(filePaths = []) {
  return filePaths.map((filePath) => ({
    filePath,
    existed: Boolean(filePath && fs.existsSync(filePath)),
    content: filePath && fs.existsSync(filePath) ? fs.readFileSync(filePath) : null
  }));
}

function restoreFileSnapshots(snapshots = []) {
  snapshots.forEach((snapshot) => {
    if (!snapshot.filePath) return;
    if (snapshot.existed) {
      ensureOmpDir(path.dirname(snapshot.filePath));
      writeFileAtomic(snapshot.filePath, snapshot.content);
    } else if (fs.existsSync(snapshot.filePath)) {
      fs.unlinkSync(snapshot.filePath);
    }
  });
}

function writeFileAtomic(filePath, content) {
  ensureOmpDir(path.dirname(filePath));
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const mode = fs.existsSync(filePath)
    ? fs.statSync(filePath).mode & 0o777
    : 0o600;
  try {
    fs.writeFileSync(temporaryPath, content, { mode });
    fs.chmodSync(temporaryPath, mode);
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    if (fs.existsSync(temporaryPath)) {
      fs.unlinkSync(temporaryPath);
    }
    throw error;
  }
}

function normalizeModels(channel = {}, options = {}) {
  const models = [];
  const catalogIndex = options.catalogIndex instanceof Map ? options.catalogIndex : new Map();
  const defaultMode = MODEL_METADATA_MODES.includes(channel.modelMetadataMode)
    ? channel.modelMetadataMode
    : 'auto';
  const add = (value) => {
    const raw = typeof value === 'string' ? { id: value } : value;
    if (!raw || typeof raw !== 'object') return;
    const selector = splitModelSelector(raw.id || raw.name || '');
    const id = selector.modelId;
    if (!id || models.some(model => model.id.toLowerCase() === id.toLowerCase())) return;
    const definition = {
      ...raw,
      id,
      metadataMode: MODEL_METADATA_MODES.includes(raw.metadataMode) ? raw.metadataMode : defaultMode
    };
    const resolved = resolveModelDefinition(definition, {
      // OMP provider limits are provider-specific. Use exact built-in metadata
      // only; prefix and generic-family fallbacks could silently invent limits.
      builtin: resolveBuiltinOmpMetadata(id) || {},
      catalog: catalogIndex.get(id.toLowerCase()) || {}
    });
    if (Array.isArray(options.warnings)) {
      options.warnings.push(...resolved.warnings.map(message => `${id}: ${message}`));
    }
    const entry = resolved.spec;
    if (entry) models.push(entry);
  };

  if (Array.isArray(channel.models)) {
    channel.models.forEach((model) => {
      if (typeof model === 'string') {
        add(model);
        return;
      }
      if (!model || typeof model !== 'object') return;
      add(model);
    });
  }

  add(channel.model);
  add(channel.speedTestModel);
  if (Array.isArray(channel.allowedModels)) {
    channel.allowedModels.forEach(add);
  }
  if (Array.isArray(channel.modelBindings)) {
    channel.modelBindings.forEach((binding) => add(binding?.modelId || binding?.id || binding));
  }

  return models.map(compactObject);
}

function readOmpCatalogModels(command, providerId, options = {}) {
  const requestedModelIds = uniqueStrings(options.requestedModelIds)
    .map(modelId => splitModelSelector(modelId).modelId)
    .filter(Boolean);
  const requested = new Set(requestedModelIds.map(modelId => modelId.toLowerCase()));
  const useFullCatalog = requested.size > 0;
  const cacheKey = `${command}\u0000${useFullCatalog ? `requested:${providerId}:${[...requested].sort().join(',')}` : providerId}`;
  const cached = ompCatalogCache.get(cacheKey);
  const now = Date.now();
  const cacheTtl = cached?.failed ? OMP_CATALOG_FAILURE_CACHE_TTL_MS : OMP_CATALOG_CACHE_TTL_MS;
  if (options.forceCatalogRefresh !== true && cached && now - cached.cachedAt < cacheTtl) {
    return cached.models.map(model => ({ ...model }));
  }
  const runner = options.catalogRunner || options.modelsRunner || spawnSync;
  const args = useFullCatalog ? ['models', '--json'] : ['models', providerId, '--json'];
  const result = runner(command, args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...(options.env || {})
    },
    timeout: options.catalogTimeout || 5000,
    windowsHide: true
  });
  const status = result?.status === undefined || result?.status === null ? 0 : result.status;
  if (result?.error || status !== 0) {
    ompCatalogCache.set(cacheKey, { cachedAt: now, models: [], failed: true });
    return [];
  }
  try {
    const parsed = JSON.parse(normalizeCommandOutput(result?.stdout).trim() || '{}');
    const rawModels = Array.isArray(parsed.models) ? parsed.models : [];
    let models = rawModels;
    if (useFullCatalog) {
      const providerCandidates = new Set([providerId, `${MANAGED_PROVIDER_PREFIX}${providerId}`]);
      const selected = new Map();
      for (const model of rawModels) {
        const id = String(model?.id || '').trim().toLowerCase();
        if (!requested.has(id)) continue;
        const provider = normalizeProviderId(model?.provider || '');
        const previous = selected.get(id);
        if (!previous || (providerCandidates.has(provider) && !providerCandidates.has(normalizeProviderId(previous.provider || '')))) {
          selected.set(id, model);
        }
      }
      models = [...selected.values()];
    }
    ompCatalogCache.set(cacheKey, { cachedAt: now, models, failed: false });
    return models.map(model => ({ ...model }));
  } catch {
    ompCatalogCache.set(cacheKey, { cachedAt: now, models: [], failed: true });
    return [];
  }
}


function getOmpCatalogModels(providerId, options = {}) {
  const normalizedProviderId = normalizeProviderId(providerId);
  if (!normalizedProviderId) return [];
  // Catalog sync is an explicit user action. Assume OMP is installed and call
  // it directly instead of paying for a separate `omp --version` probe.
  const command = options.command || options.runtime?.command || options.env?.OMP_COMMAND || process.env.OMP_COMMAND || 'omp';
  return readOmpCatalogModels(command, normalizedProviderId, options);
}

function buildCatalogIndex(channel = {}, options = {}) {
  if (options.catalogFromCli !== true) {
    return new Map();
  }

  const rawProviderId = normalizeProviderId(channel.providerKey || channel.provider || channel.name || '');
  const providerId = rawProviderId.startsWith(MANAGED_PROVIDER_PREFIX)
    ? rawProviderId.slice(MANAGED_PROVIDER_PREFIX.length)
    : rawProviderId;
  if (!providerId) return new Map();

  const index = new Map();
  getOmpCatalogModels(providerId, options).forEach((model) => {
    const id = String(model?.id || model?.name || '').trim();
    if (id) {
      index.set(id.toLowerCase(), model);
    }
  });
  return index;
}

function buildProviderEntry(channel = {}, options = {}) {
  const catalogIndex = options.catalogIndex instanceof Map
    ? options.catalogIndex
    : buildCatalogIndex(channel, options);
  const providerConfig = isPlainObject(channel.providerConfig) ? channel.providerConfig : {};
  const providerSource = { ...providerConfig };
  for (const key of [
    'headers',
    'compat',
    'remoteCompaction',
    'modelOverrides',
    'authHeader',
    'auth',
    'discovery',
    'disableStrictTools',
    'transport'
  ]) {
    if (channel[key] !== undefined) providerSource[key] = channel[key];
  }
  const normalizedProvider = normalizeProviderConfig(providerSource);
  if (Array.isArray(options.warnings)) {
    const providerName = channel.providerKey || channel.provider || channel.name || channel.id || 'provider';
    options.warnings.push(...normalizedProvider.warnings.map(message => `${providerName}: ${message}`));
  }
  let models = normalizeModels(channel, { catalogIndex, warnings: options.warnings });
  if (channel._ompGatewayRoute) {
    models = models.map((model) => {
      const sanitized = { ...model };
      delete sanitized.baseUrl;
      delete sanitized.headers;
      return sanitized;
    });
  }
  const entry = compactObject({
    ...normalizedProvider.config,
    baseUrl: String(channel.baseUrl || providerConfig.baseUrl || '').trim(),
    api: normalizeProviderApi(channel.providerApi || channel.api || channel.wireApi || providerConfig.api, {
      gatewaySourceType: channel.gatewaySourceType
    }),
    models
  });

  if (channel._ompGatewayRoute) {
    delete entry.headers;
    delete entry.apiKey;
    if (channel.authMode === 'none') {
      entry.auth = 'none';
    } else {
      delete entry.auth;
    }
  }

  const apiKey = String(channel.apiKey || providerConfig.apiKey || '').trim();
  if (apiKey) {
    entry.apiKey = apiKey;
  }

  return entry;
}

function readModelsConfig(filePath = getOmpPaths().modelsYml) {
  try {
    if (!fs.existsSync(filePath)) {
      return { providers: {} };
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) {
      return { providers: {} };
    }
    const parsed = yaml.load(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { providers: {} };
    }
    if (!parsed.providers || typeof parsed.providers !== 'object' || Array.isArray(parsed.providers)) {
      parsed.providers = {};
    }
    return parsed;
  } catch (error) {
    throw new Error(`Failed to read OMP models.yml: ${error.message}`);
  }
}

function writeModelsConfig(config, filePath = getOmpPaths().modelsYml) {
  ensureOmpDir(path.dirname(filePath));
  const doc = yaml.dump(config || { providers: {} }, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false
  });
  writeFileAtomic(filePath, doc);
}

function getOmpSettingsPath(paths = getOmpPaths()) {
  if (paths.settings || paths.config) {
    return paths.settings || paths.config;
  }
  const baseDir = paths.agentDir
    || path.dirname(paths.modelsYml || paths.models || process.cwd());
  return path.join(baseDir, 'config.yml');
}

function readOmpSettingsConfig(filePath = getOmpSettingsPath()) {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return {};
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) {
      return {};
    }
    const parsed = yaml.load(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch (error) {
    throw new Error(`Failed to read OMP config.yml: ${error.message}`);
  }
}

function writeOmpSettingsConfig(config, filePath = getOmpSettingsPath()) {
  ensureOmpDir(path.dirname(filePath));
  const doc = yaml.dump(config || {}, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false
  });
  writeFileAtomic(filePath, doc);
}

function getModelsBackupPrefix(filePath) {
  return `${path.basename(filePath)}${MODELS_BACKUP_MARKER}`;
}

function hasExistingModelsBackup(filePath) {
  const dirPath = path.dirname(filePath);
  if (!fs.existsSync(dirPath)) return false;
  const prefix = getModelsBackupPrefix(filePath);
  return fs.readdirSync(dirPath).some(entry => entry.startsWith(prefix));
}

function formatBackupTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function createModelsBackupIfNeeded(filePath, options = {}) {
  if (options.backup === false || !fs.existsSync(filePath) || hasExistingModelsBackup(filePath)) {
    return null;
  }

  const dirPath = path.dirname(filePath);
  const prefix = getModelsBackupPrefix(filePath);
  const timestamp = formatBackupTimestamp(options.now instanceof Date ? options.now : new Date());
  let backupPath = path.join(dirPath, `${prefix}${timestamp}`);
  let counter = 1;
  while (fs.existsSync(backupPath)) {
    backupPath = path.join(dirPath, `${prefix}${timestamp}-${counter}`);
    counter += 1;
  }
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function getManagedVisibilityStatePath(paths = getOmpPaths()) {
  if (paths.managedVisibilityState) {
    return paths.managedVisibilityState;
  }
  const baseDir = paths.agentDir
    || path.dirname(paths.settings || paths.config || paths.modelsYml || paths.models || process.cwd());
  return path.join(baseDir, MANAGED_VISIBILITY_STATE_FILE);
}

function readManagedVisibilityState(paths = getOmpPaths()) {
  const filePath = getManagedVisibilityStatePath(paths);
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeManagedVisibilityState(state, paths = getOmpPaths()) {
  const filePath = getManagedVisibilityStatePath(paths);
  ensureOmpDir(path.dirname(filePath));
  writeFileAtomic(filePath, `${JSON.stringify(state, null, 2)}\n`);
  return filePath;
}

function removeManagedVisibilityState(paths = getOmpPaths()) {
  const filePath = getManagedVisibilityStatePath(paths);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

function normalizeCommandOutput(value) {
  if (value === undefined || value === null) return '';
  return Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
}

function pushUniqueWarning(warnings, value) {
  const warning = String(value || '').trim();
  if (warning && !warnings.includes(warning)) {
    warnings.push(warning);
  }
}

function collectValidationWarnings(stdout, stderr) {
  const warnings = [];
  normalizeCommandOutput(stderr)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .forEach(line => pushUniqueWarning(warnings, line));

  const rawStdout = normalizeCommandOutput(stdout).trim();
  if (rawStdout) {
    try {
      const parsed = JSON.parse(rawStdout);
      if (Array.isArray(parsed?.warnings)) {
        parsed.warnings.forEach(warning => pushUniqueWarning(warnings, warning));
      }
    } catch {
      // OMP's JSON payload is informational here; stderr carries schema warnings.
    }
  }
  return warnings;
}

function runModelsJson(command, env, options = {}) {
  const runner = options.modelsRunner || spawnSync;
  const result = runner(command, ['models', '--json'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env
    },
    timeout: options.timeout || 5000,
    windowsHide: true
  });
  if (typeof result === 'string' || Buffer.isBuffer(result)) {
    return { status: 0, stdout: result, stderr: '' };
  }
  return result || { status: 0, stdout: '', stderr: '' };
}

function collectVisibleProviderIds(command, env, options = {}) {
  const runner = options.visibilityModelsRunner || options.modelsRunner || spawnSync;
  const result = runner(command, ['models', '--json'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env
    },
    timeout: options.visibilityTimeout || options.timeout || 5000,
    windowsHide: true
  });
  const status = result?.status === undefined || result?.status === null ? 0 : result.status;
  if (result?.error || status !== 0) return [];
  try {
    const parsed = JSON.parse(normalizeCommandOutput(result?.stdout).trim() || '{}');
    const models = Array.isArray(parsed.models) ? parsed.models : [];
    return uniqueStrings(models.map(model => model?.provider));
  } catch {
    return [];
  }
}

function validateOmpModelsConfig(options = {}) {
  const env = options.env || process.env;
  const runtime = options.runtime
    || (typeof ompConfig.resolveOmpRuntime === 'function'
      ? ompConfig.resolveOmpRuntime(env, options.runtimeOptions || {})
      : null);

  if (!runtime || runtime.runtime !== 'omp' || !runtime.installed) {
    return {
      skipped: true,
      reason: 'omp-not-available',
      command: runtime?.command || 'omp',
      warnings: []
    };
  }

  const result = runModelsJson(runtime.command, env, options);
  if (result.error) {
    throw new Error(`Failed to validate OMP models.yml with "${runtime.command} models --json": ${result.error.message}`);
  }

  const status = result.status === undefined || result.status === null ? 0 : result.status;
  const stdout = normalizeCommandOutput(result.stdout);
  const stderr = normalizeCommandOutput(result.stderr);
  const warnings = collectValidationWarnings(stdout, stderr);
  if (status !== 0) {
    const details = stderr.trim() || stdout.trim() || `exit code ${status}`;
    throw new Error(`OMP models.yml validation failed: ${details}`);
  }

  return {
    skipped: false,
    command: runtime.command,
    warnings,
    validatedAt: new Date().toISOString()
  };
}

function recordManagedOmpSyncResult(result) {
  lastManagedOmpSyncResult = {
    success: true,
    warnings: [],
    ...result
  };
  return lastManagedOmpSyncResult;
}

function getLastManagedOmpSyncResult() {
  return lastManagedOmpSyncResult
    ? {
      ...lastManagedOmpSyncResult,
      warnings: [...(lastManagedOmpSyncResult.warnings || [])],
      validation: lastManagedOmpSyncResult.validation
        ? {
          ...lastManagedOmpSyncResult.validation,
          warnings: [...(lastManagedOmpSyncResult.validation.warnings || [])]
        }
        : lastManagedOmpSyncResult.validation
    }
    : null;
}

function removeLegacyManagedExtension(paths = getOmpPaths()) {
  const target = paths.managedProviderExtension;
  if (target && fs.existsSync(target)) {
    fs.unlinkSync(target);
  }
}

function pruneManagedProviders(providers = {}) {
  Object.keys(providers).forEach((providerId) => {
    if (isManagedProviderId(providerId)) {
      delete providers[providerId];
    }
  });
}

function buildManagedModelsConfig(channels = [], baseConfig = readModelsConfig(), options = {}) {
  const next = {
    ...baseConfig,
    providers: {
      ...(baseConfig.providers || {})
    }
  };
  pruneManagedProviders(next.providers);

  channels
    .filter(channel => channel && channel.enabled !== false && channel.baseUrl)
    .forEach((channel) => {
      next.providers[getManagedProviderId(channel)] = buildProviderEntry(channel, options);
    });

  return next;
}

function getOriginalProviderId(channel = {}) {
  if (channel.originalProviderId) {
    return normalizeProviderId(channel.originalProviderId);
  }
  const providerId = normalizeProviderId(channel.providerKey || channel.provider || channel.name || channel.id);
  return isManagedProviderId(providerId)
    ? providerId.slice(MANAGED_PROVIDER_PREFIX.length)
    : providerId;
}

function collectManagedVisibility(channels = [], modelsConfig = { providers: {} }, options = {}) {
  const managedEnabledModels = [];
  const managedDisabledProviders = [];
  const warnings = [];
  const providers = modelsConfig.providers || {};
  let managedDefaultModel = null;

  (channels || [])
    .filter(channel => channel && channel.enabled !== false && channel.baseUrl)
    .forEach((channel) => {
      const managedProviderId = getManagedProviderId(channel);
      const providerEntry = providers[managedProviderId] || {};
      const models = Array.isArray(providerEntry.models) ? providerEntry.models : [];
      models.forEach((model) => {
        const modelId = String(model?.id || model?.name || '').trim();
        if (modelId) {
          pushUnique(managedEnabledModels, `${managedProviderId}/${modelId}`);
        }
      });

      const defaultSelection = splitModelSelector(channel.model || '');
      if (!managedDefaultModel && defaultSelection.modelId) {
        const hasDefaultModel = models.some((model) => {
          const modelId = String(model?.id || model?.name || '').trim();
          return modelId.toLowerCase() === defaultSelection.modelId.toLowerCase();
        });
        if (hasDefaultModel) {
          managedDefaultModel = `${managedProviderId}/${serializeModelSelector(
            defaultSelection.modelId,
            defaultSelection.thinkingLevel
          )}`;
        }
      }

      const originalProviderId = getOriginalProviderId(channel);
      if (originalProviderId && !isManagedProviderId(originalProviderId)) {
        pushUnique(managedDisabledProviders, originalProviderId);
      }
      if (models.length === 0) {
        warnings.push(`OMP channel "${channel.name || channel.id || managedProviderId}" has no configured models; OMP model scope will resolve to no usable managed models.`);
      }
    });

  if (options.discoverDisabledProviders === true) {
    const env = options.env || process.env;
    const runtime = options.runtime
      || (typeof ompConfig.resolveOmpRuntime === 'function'
        ? ompConfig.resolveOmpRuntime(env, options.runtimeOptions || {})
        : null);
    if (runtime && runtime.runtime === 'omp' && runtime.installed) {
      collectVisibleProviderIds(runtime.command, env, options)
        .filter(providerId => providerId && !isManagedProviderId(providerId))
        .forEach(providerId => pushUnique(managedDisabledProviders, providerId));
    }
  }

  return {
    managedEnabledModels,
    managedEnabledModelsForSettings: managedEnabledModels.length > 0
      ? managedEnabledModels
      : [NO_MANAGED_MODELS_SELECTOR],
    managedDisabledProviders,
    managedDefaultModel: managedDefaultModel || managedEnabledModels[0] || null,
    warnings
  };
}

function captureOriginalVisibility(settings = {}) {
  const modelRoles = settings.modelRoles && typeof settings.modelRoles === 'object' && !Array.isArray(settings.modelRoles)
    ? settings.modelRoles
    : {};
  const fallbackChains = settings.retry && typeof settings.retry === 'object' && !Array.isArray(settings.retry)
    ? settings.retry.fallbackChains
    : undefined;
  return {
    enabledModels: getOwnProperty(settings, 'enabledModels') ? uniqueStrings(settings.enabledModels) : null,
    disabledProviders: getOwnProperty(settings, 'disabledProviders') ? uniqueStrings(settings.disabledProviders) : null,
    modelRolesHadDefault: getOwnProperty(modelRoles, 'default'),
    modelRolesDefault: getOwnProperty(modelRoles, 'default') ? String(modelRoles.default || '') : null,
    modelRolesHadValue: getOwnProperty(settings, 'modelRoles'),
    modelRoles: getOwnProperty(settings, 'modelRoles') ? cloneJson(modelRoles) : null,
    retryFallbackChainsHadValue: fallbackChains !== undefined,
    retryFallbackChains: fallbackChains !== undefined ? cloneJson(fallbackChains) : null
  };
}

function collectUserDisabledProviders(settings = {}, previousState = null) {
  const currentDisabled = uniqueStrings(settings.disabledProviders);
  if (!previousState?.active || !previousState.original) {
    return currentDisabled;
  }
  const originalDisabled = Array.isArray(previousState.original.disabledProviders)
    ? previousState.original.disabledProviders
    : [];
  const previousManagedDisabled = uniqueStrings(previousState.managedDisabledProviders);
  const userAddedDuringManagedMode = currentDisabled
    .filter(providerId => !previousManagedDisabled.includes(providerId) && !originalDisabled.includes(providerId));
  return uniqueStrings([...originalDisabled, ...userAddedDuringManagedMode]);
}

function buildProviderMappings(channels = []) {
  const originalToManaged = {};
  const managedToOriginal = {};
  channels.forEach((channel) => {
    const original = getOriginalProviderId(channel);
    const managed = getManagedProviderId(channel);
    if (!original || !managed) return;
    if (!originalToManaged[original]) {
      originalToManaged[original] = managed;
    }
    managedToOriginal[managed] = original;
  });
  return { originalToManaged, managedToOriginal };
}

function rewriteModelSelector(value, providerMap = {}) {
  if (typeof value !== 'string') return value;
  const index = value.indexOf('/');
  if (index <= 0) return value;
  const providerId = value.slice(0, index);
  const replacement = providerMap[providerId];
  return replacement ? `${replacement}${value.slice(index)}` : value;
}

function rewriteSelectorTree(value, providerMap = {}) {
  if (typeof value === 'string') return rewriteModelSelector(value, providerMap);
  if (Array.isArray(value)) return value.map(item => rewriteSelectorTree(item, providerMap));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, rewriteSelectorTree(item, providerMap)])
    );
  }
  return value;
}

function removeManagedSelectorTree(value) {
  if (typeof value === 'string') {
    const providerId = String(value).split('/')[0];
    return isManagedProviderId(providerId) ? undefined : value;
  }
  if (Array.isArray(value)) {
    return value
      .map(removeManagedSelectorTree)
      .filter(item => item !== undefined);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, removeManagedSelectorTree(item)])
        .filter(([, item]) => item !== undefined)
    );
  }
  return value;
}

function applyManagedModelRoles(settings, visibility, mappings, previousState = null) {
  const originalRoles = previousState?.active && previousState.original?.modelRolesHadValue
    ? previousState.original.modelRoles
    : settings.modelRoles;
  const roles = originalRoles && typeof originalRoles === 'object' && !Array.isArray(originalRoles)
    ? rewriteSelectorTree(cloneJson(originalRoles), mappings.originalToManaged)
    : {};
  const originalDefault = String(originalRoles?.default || '');
  const mappedDefault = rewriteModelSelector(originalDefault, mappings.originalToManaged);
  const defaultWasMapped = originalDefault && mappedDefault !== originalDefault;
  const defaultIsManaged = isManagedProviderId(String(roles.default || '').split('/')[0]);
  if (visibility.managedDefaultModel && (!roles.default || (!defaultWasMapped && !defaultIsManaged))) {
    roles.default = visibility.managedDefaultModel;
  }
  return roles;
}

function applyManagedFallbackChains(settings, mappings, previousState = null) {
  const source = previousState?.active && previousState.original?.retryFallbackChainsHadValue
    ? previousState.original.retryFallbackChains
    : settings.retry?.fallbackChains;
  if (source === undefined) return undefined;
  return rewriteSelectorTree(cloneJson(source), mappings.originalToManaged);
}

function syncManagedOmpVisibility(channels = [], modelsConfig = { providers: {} }, options = {}) {
  const paths = getOmpPaths();
  const settingsPath = getOmpSettingsPath(paths);
  const statePath = getManagedVisibilityStatePath(paths);
  const settings = readOmpSettingsConfig(settingsPath);
  const previousState = readManagedVisibilityState(paths);
  const visibility = collectManagedVisibility(channels, modelsConfig, options);
  const mappings = buildProviderMappings(channels);
  const original = previousState?.active && previousState.original
    ? previousState.original
    : captureOriginalVisibility(settings);
  const before = JSON.stringify(settings);
  const settingsBackupPath = createModelsBackupIfNeeded(settingsPath, options);

  settings.enabledModels = visibility.managedEnabledModelsForSettings;
  settings.disabledProviders = uniqueStrings([
    ...collectUserDisabledProviders(settings, previousState),
    ...visibility.managedDisabledProviders
  ]);
  settings.modelRoles = applyManagedModelRoles(settings, visibility, mappings, previousState);
  const fallbackChains = applyManagedFallbackChains(settings, mappings, previousState);
  if (fallbackChains !== undefined) {
    settings.retry = settings.retry && typeof settings.retry === 'object' && !Array.isArray(settings.retry)
      ? { ...settings.retry, fallbackChains }
      : { fallbackChains };
  }

  const after = JSON.stringify(settings);
  if (before !== after) {
    writeOmpSettingsConfig(settings, settingsPath);
  }

  const state = {
    version: VISIBILITY_STATE_VERSION,
    active: true,
    settingsPath,
    managedEnabledModels: visibility.managedEnabledModels,
    managedEnabledModelsForSettings: visibility.managedEnabledModelsForSettings,
    managedDisabledProviders: visibility.managedDisabledProviders,
    managedDefaultModel: visibility.managedDefaultModel,
    providerMappings: mappings,
    original,
    applied: {
      modelRoles: cloneJson(settings.modelRoles),
      retryFallbackChains: cloneJson(settings.retry?.fallbackChains)
    },
    updatedAt: new Date().toISOString()
  };
  writeManagedVisibilityState(state, paths);

  return {
    settingsPath,
    statePath,
    settingsBackupPath,
    changed: before !== after,
    managedEnabledModels: visibility.managedEnabledModels,
    managedEnabledModelsForSettings: visibility.managedEnabledModelsForSettings,
    managedDisabledProviders: visibility.managedDisabledProviders,
    managedDefaultModel: visibility.managedDefaultModel,
    warnings: visibility.warnings
  };
}

function restoreOriginalList(settings, key, originalValue) {
  if (Array.isArray(originalValue)) {
    settings[key] = uniqueStrings(originalValue);
    return;
  }
  delete settings[key];
}

function removeManagedOmpVisibility(options = {}) {
  const paths = getOmpPaths();
  const settingsPath = getOmpSettingsPath(paths);
  const state = readManagedVisibilityState(paths);
  const settings = readOmpSettingsConfig(settingsPath);
  const before = JSON.stringify(settings);
  const warnings = [];
  let settingsBackupPath = null;

  if (state?.active) {
    settingsBackupPath = createModelsBackupIfNeeded(settingsPath, options);
    const managedEnabled = uniqueStrings(state.managedEnabledModelsForSettings || state.managedEnabledModels);
    const currentEnabled = uniqueStrings(settings.enabledModels);
    if (sameStringSet(currentEnabled, managedEnabled)) {
      restoreOriginalList(settings, 'enabledModels', state.original?.enabledModels);
    } else if (managedEnabled.length > 0) {
      const nextEnabled = currentEnabled.filter(model => !managedEnabled.includes(model));
      if (nextEnabled.length > 0) {
        settings.enabledModels = nextEnabled;
      } else {
        restoreOriginalList(settings, 'enabledModels', state.original?.enabledModels);
      }
      warnings.push('OMP enabledModels was changed while coding-tool-x managed visibility was active; preserved non-managed entries during cleanup.');
    }

    const managedDisabled = uniqueStrings(state.managedDisabledProviders);
    const originalDisabled = Array.isArray(state.original?.disabledProviders)
      ? state.original.disabledProviders
      : [];
    const currentDisabled = uniqueStrings(settings.disabledProviders);
    const expectedDisabled = uniqueStrings([...originalDisabled, ...managedDisabled]);
    if (sameStringSet(currentDisabled, expectedDisabled)) {
      restoreOriginalList(settings, 'disabledProviders', state.original?.disabledProviders);
    } else if (managedDisabled.length > 0) {
      const nextDisabled = currentDisabled.filter(providerId => !managedDisabled.includes(providerId));
      if (nextDisabled.length > 0) {
        settings.disabledProviders = nextDisabled;
      } else {
        restoreOriginalList(settings, 'disabledProviders', state.original?.disabledProviders);
      }
      warnings.push('OMP disabledProviders was changed while coding-tool-x managed visibility was active; removed only managed provider entries.');
    }

    if (state.version >= 2 && state.original) {
      const currentRoles = settings.modelRoles && typeof settings.modelRoles === 'object' && !Array.isArray(settings.modelRoles)
        ? settings.modelRoles
        : undefined;
      if (JSON.stringify(currentRoles) === JSON.stringify(state.applied?.modelRoles)) {
        if (state.original.modelRolesHadValue) {
          settings.modelRoles = cloneJson(state.original.modelRoles);
        } else {
          delete settings.modelRoles;
        }
      } else if (currentRoles) {
        settings.modelRoles = rewriteSelectorTree(currentRoles, state.providerMappings?.managedToOriginal || {});
        warnings.push('OMP modelRoles was changed while coding-tool-x managed visibility was active; restored managed provider references only.');
      }

      const currentFallback = settings.retry?.fallbackChains;
      if (JSON.stringify(currentFallback) === JSON.stringify(state.applied?.retryFallbackChains)) {
        if (state.original.retryFallbackChainsHadValue) {
          settings.retry = settings.retry && typeof settings.retry === 'object' && !Array.isArray(settings.retry)
            ? { ...settings.retry, fallbackChains: cloneJson(state.original.retryFallbackChains) }
            : { fallbackChains: cloneJson(state.original.retryFallbackChains) };
        } else if (settings.retry && typeof settings.retry === 'object' && !Array.isArray(settings.retry)) {
          delete settings.retry.fallbackChains;
          if (Object.keys(settings.retry).length === 0) delete settings.retry;
        }
      } else if (currentFallback !== undefined) {
        settings.retry.fallbackChains = rewriteSelectorTree(
          currentFallback,
          state.providerMappings?.managedToOriginal || {}
        );
        warnings.push('OMP retry.fallbackChains was changed while coding-tool-x managed visibility was active; restored managed provider references only.');
      }
    } else if (settings.modelRoles && typeof settings.modelRoles === 'object' && !Array.isArray(settings.modelRoles)) {
      const roles = { ...settings.modelRoles };
      if (roles.default === state.managedDefaultModel) {
        if (state.original?.modelRolesHadDefault) {
          roles.default = state.original.modelRolesDefault;
        } else {
          delete roles.default;
        }
        settings.modelRoles = roles;
      }
      if (Object.keys(settings.modelRoles).length === 0) {
        delete settings.modelRoles;
      }
    }
  } else {
    const managedEnabled = uniqueStrings(settings.enabledModels)
      .filter(model => isManagedProviderId(String(model).split('/')[0]));
    if (managedEnabled.length > 0) {
      settingsBackupPath = createModelsBackupIfNeeded(settingsPath, options);
      settings.enabledModels = uniqueStrings(settings.enabledModels)
        .filter(model => !managedEnabled.includes(model));
      if (settings.enabledModels.length === 0) {
        delete settings.enabledModels;
      }
      warnings.push('Removed stale coding-tool-x managed OMP enabledModels entries without a visibility state file.');
    }

    if (settings.modelRoles && typeof settings.modelRoles === 'object' && !Array.isArray(settings.modelRoles)) {
      const roles = Object.fromEntries(
        Object.entries(settings.modelRoles).filter(([, model]) => {
          const providerId = String(model || '').split('/')[0];
          return !isManagedProviderId(providerId);
        })
      );
      if (Object.keys(roles).length !== Object.keys(settings.modelRoles).length) {
        settingsBackupPath = settingsBackupPath || createModelsBackupIfNeeded(settingsPath, options);
        if (Object.keys(roles).length > 0) {
          settings.modelRoles = roles;
        } else {
          delete settings.modelRoles;
        }
        warnings.push('Removed stale coding-tool-x managed OMP modelRoles entries without a visibility state file.');
      }
    }

    const currentFallback = settings.retry?.fallbackChains;
    if (currentFallback !== undefined) {
      const fallbackChains = removeManagedSelectorTree(currentFallback);
      if (JSON.stringify(fallbackChains) !== JSON.stringify(currentFallback)) {
        settingsBackupPath = settingsBackupPath || createModelsBackupIfNeeded(settingsPath, options);
        if (fallbackChains && typeof fallbackChains === 'object' && Object.keys(fallbackChains).length > 0) {
          settings.retry.fallbackChains = fallbackChains;
        } else {
          delete settings.retry.fallbackChains;
          if (Object.keys(settings.retry).length === 0) delete settings.retry;
        }
        warnings.push('Removed stale coding-tool-x managed OMP retry.fallbackChains entries without a visibility state file.');
      }
    }
  }

  const after = JSON.stringify(settings);
  if (before !== after) {
    writeOmpSettingsConfig(settings, settingsPath);
  }
  const stateRemoved = removeManagedVisibilityState(paths);

  return {
    settingsPath,
    statePath: getManagedVisibilityStatePath(paths),
    settingsBackupPath,
    changed: before !== after || stateRemoved,
    stateRemoved,
    warnings
  };
}

function writeManagedOmpProviders(channels = [], options = {}) {
  const paths = getOmpPaths();
  const settingsPath = getOmpSettingsPath(paths);
  const statePath = getManagedVisibilityStatePath(paths);
  const snapshots = captureFileSnapshots([paths.modelsYml, settingsPath, statePath]);
  const buildWarnings = [];
  const orderedChannels = options.activeChannelId
    ? [
      ...channels.filter(channel => channel?.id === options.activeChannelId),
      ...channels.filter(channel => channel?.id !== options.activeChannelId)
    ]
    : channels;
  const prepared = options.gateway
    ? prepareManagedOmpChannels(orderedChannels, options.gateway)
    : { managedChannels: orderedChannels, unsupportedChannels: [] };
  const effectiveChannels = prepared.managedChannels;
  prepared.unsupportedChannels.forEach((channel) => {
    buildWarnings.push(`OMP channel "${channel.name || channel.id}" was not managed: ${channel.reason}.`);
  });
  try {
    const config = buildManagedModelsConfig(effectiveChannels, readModelsConfig(paths.modelsYml), {
      ...options,
      warnings: buildWarnings
    });
    const backupPath = createModelsBackupIfNeeded(paths.modelsYml, options);
    writeModelsConfig(config, paths.modelsYml);
    const visibility = syncManagedOmpVisibility(effectiveChannels, config, options);
    const validation = options.validateWithCli === true
      ? validateOmpModelsConfig(options)
      : { skipped: true, reason: 'cli-validation-disabled', warnings: [] };
    const warnings = [
      ...buildWarnings,
      ...(visibility.warnings || []),
      ...(validation.warnings || [])
    ];
    recordManagedOmpSyncResult({
      path: paths.modelsYml,
      modelsPath: paths.modelsYml,
      settingsPath: visibility.settingsPath,
      statePath: visibility.statePath,
      backupPath,
      modelsBackupPath: backupPath,
      settingsBackupPath: visibility.settingsBackupPath,
      changed: true,
      visibilityChanged: visibility.changed,
      managedEnabledModels: visibility.managedEnabledModels,
      managedEnabledModelsForSettings: visibility.managedEnabledModelsForSettings,
      managedDisabledProviders: visibility.managedDisabledProviders,
      managedDefaultModel: visibility.managedDefaultModel,
      validation,
      warnings
    });
    removeLegacyManagedExtension(paths);
    return paths.modelsYml;
  } catch (error) {
    restoreFileSnapshots(snapshots);
    throw error;
  }
}

function removeManagedOmpProviders(options = {}) {
  const paths = getOmpPaths();
  const settingsPath = getOmpSettingsPath(paths);
  const statePath = getManagedVisibilityStatePath(paths);
  const snapshots = captureFileSnapshots([paths.modelsYml, settingsPath, statePath]);
  try {
    const config = readModelsConfig(paths.modelsYml);
    const visibility = removeManagedOmpVisibility(options);
    const before = Object.keys(config.providers || {}).length;
    pruneManagedProviders(config.providers);
    const after = Object.keys(config.providers || {}).length;
    let backupPath = null;
    let validation = {
      skipped: true,
      reason: before === after ? 'no-managed-providers' : 'not-run',
      warnings: []
    };
    if (before !== after) {
      backupPath = createModelsBackupIfNeeded(paths.modelsYml, options);
      writeModelsConfig(config, paths.modelsYml);
      validation = options.validateWithCli === true
        ? validateOmpModelsConfig(options)
        : { skipped: true, reason: 'cli-validation-disabled', warnings: [] };
    }
    recordManagedOmpSyncResult({
      path: paths.modelsYml,
      modelsPath: paths.modelsYml,
      settingsPath: visibility.settingsPath,
      statePath: visibility.statePath,
      backupPath,
      modelsBackupPath: backupPath,
      settingsBackupPath: visibility.settingsBackupPath,
      changed: before !== after,
      visibilityChanged: visibility.changed,
      stateRemoved: visibility.stateRemoved,
      validation,
      warnings: [
        ...(visibility.warnings || []),
        ...(validation.warnings || [])
      ]
    });
    removeLegacyManagedExtension(paths);
  } catch (error) {
    restoreFileSnapshots(snapshots);
    throw error;
  }
}

function isManagedOmpProvidersActive() {
  const paths = getOmpPaths();
  if (!fs.existsSync(paths.modelsYml)) {
    return false;
  }
  const config = readModelsConfig(paths.modelsYml);
  return Object.keys(config.providers || {}).some(isManagedProviderId);
}

function buildManagedExtensionSource(channels = []) {
  return yaml.dump(buildManagedModelsConfig(channels, { providers: {} }), {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false
  });
}

module.exports = {
  MANAGED_PROVIDER_PREFIX,
  buildManagedExtensionSource,
  buildManagedModelsConfig,
  buildProviderEntry,
  getOmpCatalogModels,
  getManagedProviderId,
  getLastManagedOmpSyncResult,
  isManagedOmpProvidersActive,
  isManagedProviderExtensionActive: isManagedOmpProvidersActive,
  isManagedProviderId,
  normalizeProviderId,
  normalizeProviderApi,
  normalizeModels,
  readOmpSettingsConfig,
  readModelsConfig,
  removeManagedOmpProviders,
  removeManagedProviderExtension: removeManagedOmpProviders,
  validateOmpModelsConfig,
  writeManagedOmpProviders,
  writeManagedProviderExtension: writeManagedOmpProviders,
  writeModelsConfig
};
