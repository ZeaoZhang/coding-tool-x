const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { getPiPaths, ensurePiDir } = require('./pi-config');

const MANAGED_PROVIDER_PREFIX = 'ctx-';

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

function writeManagedOmpProviders(channels = []) {
  const paths = getPiPaths();
  const config = buildManagedModelsConfig(channels, readModelsConfig(paths.modelsYml));
  writeModelsConfig(config, paths.modelsYml);
  removeLegacyManagedExtension(paths);
  return paths.modelsYml;
}

function removeManagedOmpProviders() {
  const paths = getPiPaths();
  const config = readModelsConfig(paths.modelsYml);
  const before = Object.keys(config.providers || {}).length;
  pruneManagedProviders(config.providers);
  const after = Object.keys(config.providers || {}).length;
  if (before !== after) {
    writeModelsConfig(config, paths.modelsYml);
  }
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
  isManagedOmpProvidersActive,
  isManagedProviderExtensionActive: isManagedOmpProvidersActive,
  normalizeProviderId,
  readModelsConfig,
  removeManagedOmpProviders,
  removeManagedProviderExtension: removeManagedOmpProviders,
  writeManagedOmpProviders,
  writeManagedProviderExtension: writeManagedOmpProviders,
  writeModelsConfig
};
