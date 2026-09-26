'use strict';

const {
  getOmpPaths,
  readOmpSettingsStrict,
  readYamlFile,
  writeOmpSettingsAtomic
} = require('./config');
const { getPlatformCatalog } = require('../../../server/services/platform-catalog');

const OMP_MODEL_ROLE_KEYS = Object.freeze([
  'default',
  'smol',
  'slow',
  'plan',
  'commit',
  'vision',
  'designer',
  'task',
  'advisor',
  'tiny'
]);

const OMP_THINKING_LEVELS = new Set([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseModelRoleSelector(value) {
  const selector = typeof value === 'string' ? value.trim() : '';
  const suffix = selector.match(/:(minimal|low|medium|high|xhigh|max)$/i);
  if (!suffix) return { model: selector, thinkingLevel: '' };

  return {
    model: selector.slice(0, -suffix[0].length),
    thinkingLevel: suffix[1].toLowerCase()
  };
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

function readEnabledOmpChannels() {
  const driver = getPlatformCatalog().driver('omp', 'channels');
  const result = driver?.getEnabled?.();
  if (!result || result.status !== 'ok') {
    throw new Error(result?.error || 'Unable to read enabled OMP channels');
  }
  const channels = Array.isArray(result.data)
    ? result.data
    : (Array.isArray(result.data?.channels) ? result.data.channels : []);
  return channels.filter(channel => channel && channel.enabled !== false);
}

function modelIdFromConfig(value) {
  const candidate = typeof value === 'string' ? value : (value?.id || value?.name || '');
  return String(candidate || '').trim().replace(/:(minimal|low|medium|high|xhigh|max|off)$/i, '');
}

function uniqueModelIds(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const modelId = modelIdFromConfig(value);
    const key = modelId.toLowerCase();
    if (!modelId || seen.has(key)) continue;
    seen.add(key);
    result.push(modelId);
  }
  return result;
}

function getManagedProviderId(channel = {}) {
  const rawId = channel.managedProviderId
    || channel.extra?.managedProviderId
    || channel.providerKey
    || channel.provider
    || channel.name
    || channel.id;
  const normalizedId = normalizeProviderId(rawId);
  return normalizedId.startsWith('ctx-') ? normalizedId : `ctx-${normalizedId}`;
}

function findConfiguredProviderId(providers, managedProviderId) {
  const target = normalizeProviderId(managedProviderId);
  return Object.keys(providers).find(providerId => normalizeProviderId(providerId) === target)
    || managedProviderId;
}

function collectNativeOAuthModelOptions(channel) {
  const rawProviderId = String(channel.oauthProviderId || channel.authRef?.providerId || '').trim();
  if (!rawProviderId) return [];
  const providerId = normalizeProviderId(rawProviderId);
  const allowedModels = Array.isArray(channel.allowedModels) ? channel.allowedModels : [];
  const candidates = allowedModels.length > 0
    ? allowedModels
    : [
      ...(Array.isArray(channel.models) ? channel.models : []),
      channel.model
    ];
  return uniqueModelIds(candidates).map(modelId => `${providerId}/${modelId}`);
}

function collectManagedChannelModelOptions(channel, providers) {
  const managedProviderId = getManagedProviderId(channel);
  const configuredProviderId = findConfiguredProviderId(providers, managedProviderId);
  const configuredModels = providers[configuredProviderId]?.models;
  const channelModels = [
    ...(Array.isArray(channel.models) ? channel.models : []),
    ...(Array.isArray(channel.allowedModels) ? channel.allowedModels : []),
    channel.model,
    channel.speedTestModel,
    ...(Array.isArray(channel.modelBindings)
      ? channel.modelBindings.map(binding => binding?.modelId || binding?.id || binding)
      : [])
  ];
  const modelIds = uniqueModelIds(Array.isArray(configuredModels) && configuredModels.length > 0
    ? configuredModels
    : channelModels);
  return modelIds.map(modelId => `${configuredProviderId}/${modelId}`);
}

function collectModelOptions(modelsConfig = {}, channels = []) {
  const options = new Set();
  const providers = isPlainObject(modelsConfig.providers) ? modelsConfig.providers : {};
  for (const channel of channels) {
    const isNativeOAuth = channel.authMode === 'oauth' && !String(channel.baseUrl || '').trim();
    const channelOptions = isNativeOAuth
      ? collectNativeOAuthModelOptions(channel)
      : collectManagedChannelModelOptions(channel, providers);
    channelOptions.forEach(option => options.add(option));
  }
  return [...options].sort((left, right) => left.localeCompare(right));
}

function readOmpModelRoleSettings() {
  const settings = readOmpSettingsStrict();
  const modelRoles = isPlainObject(settings.modelRoles) ? settings.modelRoles : {};
  const roles = Object.fromEntries(OMP_MODEL_ROLE_KEYS.map((key) => [
    key,
    parseModelRoleSelector(modelRoles[key])
  ]));
  const modelsConfig = readYamlFile(getOmpPaths().modelsYml, {});
  const modelOptions = collectModelOptions(modelsConfig, readEnabledOmpChannels());
  const optionSet = new Set(modelOptions);

  return {
    roles,
    modelOptions,
    unavailableRoles: Object.fromEntries(Object.entries(roles)
      .filter(([, role]) => role.model && !optionSet.has(role.model))
      .map(([key]) => [key, true]))
  };
}

function updateOmpModelRoleSettings(input) {
  if (!isPlainObject(input)) {
    throw new Error('roles must be an object');
  }

  const settings = readOmpSettingsStrict();
  const modelRoles = isPlainObject(settings.modelRoles) ? { ...settings.modelRoles } : {};
  const currentModelRoles = isPlainObject(settings.modelRoles) ? settings.modelRoles : {};
  const modelOptions = new Set(collectModelOptions(
    readYamlFile(getOmpPaths().modelsYml, {}),
    readEnabledOmpChannels()
  ));
  for (const [key, role] of Object.entries(input)) {
    if (!OMP_MODEL_ROLE_KEYS.includes(key)) {
      throw new Error(`roles.${key} is not a supported OMP model role`);
    }
    if (!isPlainObject(role) || typeof role.model !== 'string') {
      throw new Error(`roles.${key}.model must be a string`);
    }

    const suppliedModel = role.model.trim();
    if (suppliedModel.length > 500) {
      throw new Error(`roles.${key}.model must be 500 characters or fewer`);
    }

    const suppliedThinkingLevel = role.thinkingLevel == null ? '' : role.thinkingLevel;
    if (typeof suppliedThinkingLevel !== 'string'
        || (suppliedThinkingLevel && !OMP_THINKING_LEVELS.has(suppliedThinkingLevel))) {
      throw new Error(`roles.${key}.thinkingLevel must be one of ${[...OMP_THINKING_LEVELS].join(', ')}`);
    }

    if (!suppliedModel) {
      delete modelRoles[key];
      continue;
    }

    const parsed = parseModelRoleSelector(suppliedModel);
    if (!parsed.model) {
      throw new Error(`roles.${key}.model must include a model selector`);
    }
    const thinkingLevel = suppliedThinkingLevel || parsed.thinkingLevel;
    const nextSelector = thinkingLevel ? `${parsed.model}:${thinkingLevel}` : parsed.model;
    const currentSelector = String(currentModelRoles[key] || '').trim();
    if (!modelOptions.has(parsed.model) && nextSelector !== currentSelector) {
      throw new Error(`roles.${key}.model must use a model from an enabled OMP channel`);
    }
    modelRoles[key] = nextSelector;
  }

  if (Object.keys(modelRoles).length > 0) settings.modelRoles = modelRoles;
  else delete settings.modelRoles;

  writeOmpSettingsAtomic(settings);
  return readOmpModelRoleSettings();
}

module.exports = {
  OMP_MODEL_ROLE_KEYS,
  OMP_THINKING_LEVELS,
  collectModelOptions,
  readEnabledOmpChannels,
  parseModelRoleSelector,
  readOmpModelRoleSettings,
  updateOmpModelRoleSettings
};
