const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');
const piConfig = require('./pi-config');

const MANAGED_PROVIDER_PREFIX = 'ctx-';
const MODELS_BACKUP_MARKER = '.ctx-backup-';

let lastManagedOmpSyncResult = null;

function getPiPaths(...args) {
  return piConfig.getPiPaths(...args);
}

function ensurePiDir(...args) {
  return piConfig.ensurePiDir(...args);
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

function normalizeModelInput(value) {
  if (!Array.isArray(value)) return ['text', 'image'];
  const filtered = value.filter(item => item === 'text' || item === 'image');
  return filtered.length > 0 ? filtered : ['text', 'image'];
}

function normalizeModels(channel = {}) {
  const models = [];
  const add = (value) => {
    const id = String(value || '').trim();
    if (!id || models.some(model => model.id === id)) return;
    models.push({
      id,
      name: id,
      reasoning: false,
      input: ['text', 'image'],
      cost: defaultCost(),
      contextWindow: 128000,
      maxTokens: 4096
    });
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
      models.push({
        id,
        name: model.name || id,
        api: model.api ? normalizeProviderApi(model.api) : undefined,
        reasoning: model.reasoning === true,
        input: normalizeModelInput(model.input),
        cost: model.cost || defaultCost(),
        contextWindow: Number(model.contextWindow || model.context_window || 128000),
        maxTokens: Number(model.maxTokens || model.max_tokens || 4096),
        headers: model.headers && typeof model.headers === 'object' && !Array.isArray(model.headers)
          ? model.headers
          : undefined,
        compat: model.compat && typeof model.compat === 'object' && !Array.isArray(model.compat)
          ? model.compat
          : undefined
      });
    });
  }

  add(channel.model);
  add(channel.speedTestModel);
  if (Array.isArray(channel.allowedModels)) {
    channel.allowedModels.forEach(add);
  }

  return models.map((model) => {
    const next = { ...model };
    Object.keys(next).forEach((key) => {
      if (next[key] === undefined) delete next[key];
    });
    return next;
  });
}

function buildProviderEntry(channel = {}) {
  const entry = {
    baseUrl: String(channel.baseUrl || '').trim(),
    api: normalizeProviderApi(channel.providerApi || channel.api || channel.wireApi),
    models: normalizeModels(channel)
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

function readModelsConfig(filePath = getPiPaths().modelsYml) {
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

function writeModelsConfig(config, filePath = getPiPaths().modelsYml) {
  ensurePiDir(path.dirname(filePath));
  const doc = yaml.dump(config || { providers: {} }, {
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

function validateOmpModelsConfig(options = {}) {
  const env = options.env || process.env;
  const runtime = options.runtime
    || (typeof piConfig.resolvePiRuntime === 'function'
      ? piConfig.resolvePiRuntime(env, options.runtimeOptions || {})
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

function removeLegacyManagedExtension(paths = getPiPaths()) {
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

function buildManagedModelsConfig(channels = [], baseConfig = readModelsConfig()) {
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
      next.providers[getManagedProviderId(channel)] = buildProviderEntry(channel);
    });

  return next;
}

function writeManagedOmpProviders(channels = [], options = {}) {
  const paths = getPiPaths();
  const config = buildManagedModelsConfig(channels, readModelsConfig(paths.modelsYml));
  const backupPath = createModelsBackupIfNeeded(paths.modelsYml, options);
  writeModelsConfig(config, paths.modelsYml);
  const validation = validateOmpModelsConfig(options);
  recordManagedOmpSyncResult({
    path: paths.modelsYml,
    modelsPath: paths.modelsYml,
    backupPath,
    changed: true,
    validation,
    warnings: validation.warnings || []
  });
  removeLegacyManagedExtension(paths);
  return paths.modelsYml;
}

function removeManagedOmpProviders(options = {}) {
  const paths = getPiPaths();
  const config = readModelsConfig(paths.modelsYml);
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
    backupPath,
    changed: before !== after,
    validation,
    warnings: validation.warnings || []
  });
  removeLegacyManagedExtension(paths);
}

function isManagedOmpProvidersActive() {
  const paths = getPiPaths();
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
