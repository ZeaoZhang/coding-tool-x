const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');
const ompConfig = require('./omp-config');

const MANAGED_PROVIDER_PREFIX = 'ctx-';
const MODELS_BACKUP_MARKER = '.ctx-backup-';
const VISIBILITY_STATE_VERSION = 1;
const MANAGED_VISIBILITY_STATE_FILE = 'coding-tool-x-omp-managed-visibility.json';
const NO_MANAGED_MODELS_SELECTOR = `${MANAGED_PROVIDER_PREFIX}coding-tool-x/__no_models_configured__`;
const THINKING_EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh'];
const THINKING_MODES = new Set([
  'effort',
  'budget',
  'google-level',
  'anthropic-adaptive',
  'anthropic-budget-effort'
]);

let lastManagedOmpSyncResult = null;

function getOmpPaths(...args) {
  return ompConfig.getOmpPaths(...args);
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
  const baseId = normalizeProviderId(channel.providerKey || channel.provider || channel.name || channel.id);
  return baseId.startsWith(MANAGED_PROVIDER_PREFIX) ? baseId : `${MANAGED_PROVIDER_PREFIX}${baseId}`;
}

function isManagedProviderId(providerId = '') {
  return String(providerId || '').startsWith(MANAGED_PROVIDER_PREFIX);
}

function normalizeProviderApi(value = '') {
  const normalized = String(value || '').trim();
  if (!normalized || normalized === 'openai' || normalized === 'chat' || normalized === 'chat.completions') {
    return 'openai-completions';
  }
  if (normalized === 'responses') {
    return 'openai-responses';
  }
  return normalized;
}

function defaultCost() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

function normalizeCost(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return defaultCost();
  }
  const numberOrZero = (item) => {
    const number = Number(item);
    return Number.isFinite(number) ? number : 0;
  };
  return {
    input: numberOrZero(value.input),
    output: numberOrZero(value.output),
    cacheRead: numberOrZero(value.cacheRead ?? value.cache_read),
    cacheWrite: numberOrZero(value.cacheWrite ?? value.cache_write)
  };
}

function normalizePositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeModelInput(value) {
  if (!Array.isArray(value)) return ['text', 'image'];
  const filtered = value.filter(item => item === 'text' || item === 'image');
  return filtered.length > 0 ? filtered : ['text', 'image'];
}

function normalizeThinkingEfforts(value) {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set();
  const filtered = value
    .map(item => String(item || '').trim())
    .filter(item => THINKING_EFFORT_LEVELS.includes(item))
    .filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });
  return filtered.length > 0 ? filtered : undefined;
}

function normalizeThinking(value) {
  if (Array.isArray(value)) {
    const efforts = normalizeThinkingEfforts(value);
    return efforts ? { mode: 'effort', efforts } : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (THINKING_EFFORT_LEVELS.includes(trimmed)) {
      return { mode: 'effort', efforts: [trimmed] };
    }
    return undefined;
  }
  if (value && typeof value === 'object') {
    const mode = String(value.mode || '').trim();
    if (!THINKING_MODES.has(mode)) return undefined;
    const efforts = normalizeThinkingEfforts(value.efforts || value.levels);
    const minLevel = String(value.minLevel || '').trim();
    const maxLevel = String(value.maxLevel || '').trim();
    const defaultLevel = String(value.defaultLevel || '').trim();
    const hasRange = THINKING_EFFORT_LEVELS.includes(minLevel) && THINKING_EFFORT_LEVELS.includes(maxLevel);
    if (!efforts && !hasRange) return undefined;
    return compactObject({
      mode,
      efforts,
      defaultLevel: THINKING_EFFORT_LEVELS.includes(defaultLevel) ? defaultLevel : undefined,
      minLevel: efforts ? undefined : minLevel,
      maxLevel: efforts ? undefined : maxLevel,
      effortMap: value.effortMap && typeof value.effortMap === 'object' && !Array.isArray(value.effortMap)
        ? value.effortMap
        : undefined,
      supportsDisplay: typeof value.supportsDisplay === 'boolean' ? value.supportsDisplay : undefined
    });
  }
  return undefined;
}

function compactObject(value = {}) {
  const next = { ...value };
  Object.keys(next).forEach((key) => {
    if (next[key] === undefined) delete next[key];
  });
  return next;
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

function mergeDefined(base = {}, override = {}) {
  const next = { ...base };
  Object.entries(override || {}).forEach(([key, value]) => {
    if (value !== undefined) {
      next[key] = value;
    }
  });
  return next;
}

function buildModelEntry(model = {}, fallbackId = '') {
  const id = String(model.id || model.name || fallbackId || '').trim();
  if (!id) return null;
  return compactObject({
    id,
    name: model.name || id,
    api: model.api ? normalizeProviderApi(model.api) : undefined,
    reasoning: model.reasoning === true,
    thinking: normalizeThinking(model.thinking),
    input: normalizeModelInput(model.input),
    cost: normalizeCost(model.cost),
    contextWindow: normalizePositiveNumber(model.contextWindow || model.context_window, 128000),
    maxTokens: normalizePositiveNumber(model.maxTokens || model.max_tokens, 4096),
    headers: model.headers && typeof model.headers === 'object' && !Array.isArray(model.headers)
      ? model.headers
      : undefined,
    compat: model.compat && typeof model.compat === 'object' && !Array.isArray(model.compat)
      ? model.compat
      : undefined
  });
}

function normalizeModels(channel = {}, options = {}) {
  const models = [];
  const catalogIndex = options.catalogIndex instanceof Map ? options.catalogIndex : new Map();
  const add = (value) => {
    const id = String(value || '').trim();
    if (!id || models.some(model => model.id === id)) return;
    const catalogModel = catalogIndex.get(id.toLowerCase()) || {};
    const entry = buildModelEntry({ ...catalogModel, id }, id);
    if (entry) models.push(entry);
  };

  if (Array.isArray(channel.models)) {
    channel.models.forEach((model) => {
      if (typeof model === 'string') {
        add(model);
        return;
      }
      if (!model || typeof model !== 'object') return;
      const id = String(model.id || model.name || '').trim();
      if (!id || models.some(item => item.id === id)) return;
      const catalogModel = catalogIndex.get(id.toLowerCase()) || {};
      const entry = buildModelEntry(mergeDefined(catalogModel, model), id);
      if (entry) models.push(entry);
    });
  }

  add(channel.model);
  add(channel.speedTestModel);
  if (Array.isArray(channel.allowedModels)) {
    channel.allowedModels.forEach(add);
  }

  return models.map(compactObject);
}

function readOmpCatalogModels(command, providerId, options = {}) {
  const runner = options.catalogRunner || options.modelsRunner || spawnSync;
  const result = runner(command, ['models', providerId, '--json'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...(options.env || {})
    },
    timeout: options.catalogTimeout || 5000
  });
  const status = result?.status === undefined || result?.status === null ? 0 : result.status;
  if (result?.error || status !== 0) return [];
  try {
    const parsed = JSON.parse(normalizeCommandOutput(result?.stdout).trim() || '{}');
    return Array.isArray(parsed.models) ? parsed.models : [];
  } catch {
    return [];
  }
}

function buildCatalogIndex(channel = {}, options = {}) {
  const runtime = options.runtime
    || (typeof ompConfig.resolveOmpRuntime === 'function'
      ? ompConfig.resolveOmpRuntime(options.env || process.env, options.runtimeOptions || {})
      : null);
  if (!runtime || runtime.runtime !== 'omp' || !runtime.installed) {
    return new Map();
  }

  const rawProviderId = normalizeProviderId(channel.providerKey || channel.provider || channel.name || '');
  const providerId = rawProviderId.startsWith(MANAGED_PROVIDER_PREFIX)
    ? rawProviderId.slice(MANAGED_PROVIDER_PREFIX.length)
    : rawProviderId;
  if (!providerId) return new Map();

  const index = new Map();
  readOmpCatalogModels(runtime.command, providerId, options).forEach((model) => {
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
  const entry = {
    baseUrl: String(channel.baseUrl || '').trim(),
    api: normalizeProviderApi(channel.providerApi || channel.api || channel.wireApi),
    models: normalizeModels(channel, { catalogIndex })
  };

  const apiKey = String(channel.apiKey || '').trim();
  if (apiKey) {
    entry.apiKey = apiKey;
  }

  if (channel.headers && typeof channel.headers === 'object' && !Array.isArray(channel.headers)) {
    entry.headers = channel.headers;
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
  fs.writeFileSync(filePath, doc, 'utf8');
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
  fs.writeFileSync(filePath, doc, 'utf8');
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
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
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
    timeout: options.timeout || 5000
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
    timeout: options.visibilityTimeout || options.timeout || 5000
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

      const originalProviderId = getOriginalProviderId(channel);
      if (originalProviderId && !isManagedProviderId(originalProviderId)) {
        pushUnique(managedDisabledProviders, originalProviderId);
      }
      if (models.length === 0) {
        warnings.push(`OMP channel "${channel.name || channel.id || managedProviderId}" has no configured models; OMP model scope will resolve to no usable managed models.`);
      }
    });

  const env = options.env || process.env;
  const runtime = options.runtime
    || (typeof ompConfig.resolveOmpRuntime === 'function'
      ? ompConfig.resolveOmpRuntime(env, options.runtimeOptions || {})
      : null);
  if (runtime && runtime.runtime === 'omp' && runtime.installed && options.discoverDisabledProviders !== false) {
    collectVisibleProviderIds(runtime.command, env, options)
      .filter(providerId => providerId && !isManagedProviderId(providerId))
      .forEach(providerId => pushUnique(managedDisabledProviders, providerId));
  }

  return {
    managedEnabledModels,
    managedEnabledModelsForSettings: managedEnabledModels.length > 0
      ? managedEnabledModels
      : [NO_MANAGED_MODELS_SELECTOR],
    managedDisabledProviders,
    managedDefaultModel: managedEnabledModels[0] || null,
    warnings
  };
}

function captureOriginalVisibility(settings = {}) {
  const modelRoles = settings.modelRoles && typeof settings.modelRoles === 'object' && !Array.isArray(settings.modelRoles)
    ? settings.modelRoles
    : {};
  return {
    enabledModels: getOwnProperty(settings, 'enabledModels') ? uniqueStrings(settings.enabledModels) : null,
    disabledProviders: getOwnProperty(settings, 'disabledProviders') ? uniqueStrings(settings.disabledProviders) : null,
    modelRolesHadDefault: getOwnProperty(modelRoles, 'default'),
    modelRolesDefault: getOwnProperty(modelRoles, 'default') ? String(modelRoles.default || '') : null
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

function applyManagedModelRole(settings, visibility, previousState = null) {
  const roles = settings.modelRoles && typeof settings.modelRoles === 'object' && !Array.isArray(settings.modelRoles)
    ? { ...settings.modelRoles }
    : {};
  const currentDefault = String(roles.default || '').trim();
  const previousManagedDefault = String(previousState?.managedDefaultModel || '').trim();
  if (!visibility.managedDefaultModel) {
    return roles;
  }
  const defaultIsManaged = visibility.managedEnabledModels.includes(currentDefault);
  if (!currentDefault || !defaultIsManaged || currentDefault === previousManagedDefault) {
    roles.default = visibility.managedDefaultModel;
  }
  return roles;
}

function syncManagedOmpVisibility(channels = [], modelsConfig = { providers: {} }, options = {}) {
  const paths = getOmpPaths();
  const settingsPath = getOmpSettingsPath(paths);
  const statePath = getManagedVisibilityStatePath(paths);
  const settings = readOmpSettingsConfig(settingsPath);
  const previousState = readManagedVisibilityState(paths);
  const visibility = collectManagedVisibility(channels, modelsConfig, options);
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
  settings.modelRoles = applyManagedModelRole(settings, visibility, previousState);

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
    original,
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

    if (settings.modelRoles && typeof settings.modelRoles === 'object' && !Array.isArray(settings.modelRoles)) {
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
  const config = buildManagedModelsConfig(channels, readModelsConfig(paths.modelsYml), options);
  const backupPath = createModelsBackupIfNeeded(paths.modelsYml, options);
  writeModelsConfig(config, paths.modelsYml);
  const visibility = syncManagedOmpVisibility(channels, config, options);
  const validation = validateOmpModelsConfig(options);
  const warnings = [
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
}

function removeManagedOmpProviders(options = {}) {
  const paths = getOmpPaths();
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
    validation = validateOmpModelsConfig(options);
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
  getManagedProviderId,
  getLastManagedOmpSyncResult,
  isManagedOmpProvidersActive,
  isManagedProviderExtensionActive: isManagedOmpProvidersActive,
  normalizeProviderId,
  readModelsConfig,
  removeManagedOmpProviders,
  removeManagedProviderExtension: removeManagedOmpProviders,
  validateOmpModelsConfig,
  writeManagedOmpProviders,
  writeManagedProviderExtension: writeManagedOmpProviders,
  writeModelsConfig
};
