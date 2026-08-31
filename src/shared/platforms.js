const BUILT_IN_MANIFESTS = [
  require('../platforms/manifests/claude.json'),
  require('../platforms/manifests/codex.json'),
  require('../platforms/manifests/gemini.json'),
  require('../platforms/manifests/opencode.json'),
  require('../platforms/manifests/omp.json')
];

const DEFAULT_ENABLED_CLI_PLATFORMS = ['claude', 'codex', 'opencode', 'omp'];

function capabilityEnabled(manifest, capability) {
  const driver = manifest?.capabilities?.[capability];
  return driver !== undefined && driver !== null && driver !== 'unsupported';
}

const BUILT_IN_CLI_PLATFORMS = BUILT_IN_MANIFESTS.map(manifest => ({
  key: manifest.key,
  title: manifest.title || manifest.label || manifest.key,
  label: manifest.label || manifest.title || manifest.key,
  command: manifest.command || manifest.key,
  color: manifest.color || '',
  defaultVisible: manifest.defaultVisible !== false,
  supportsManagedChannels: capabilityEnabled(manifest, 'channels'),
  supportsManagedConfig: capabilityEnabled(manifest, 'nativeConfig'),
  supportsProxy: capabilityEnabled(manifest, 'proxy'),
  supportsProjects: capabilityEnabled(manifest, 'projects'),
  supportsSessions: capabilityEnabled(manifest, 'sessions'),
  supportsSkills: manifest.resourceTypes?.skills !== false,
  supportsCommands: manifest.resourceTypes?.commands !== false,
  supportsPlugins: manifest.resourceTypes?.plugins !== false,
  supportsAgents: manifest.resourceTypes?.agents !== false
}));

function normalizePlatformKey(value = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizeAllowedPlatformKeys(allowedKeys) {
  if (!allowedKeys || typeof allowedKeys[Symbol.iterator] !== 'function') {
    return new Set();
  }

  const normalized = new Set();
  for (const value of allowedKeys) {
    const key = normalizePlatformKey(value);
    if (key) {
      normalized.add(key);
    }
  }
  return normalized;
}

function normalizeEnabledCliPlatforms(input, allowedKeys, fallback = DEFAULT_ENABLED_CLI_PLATFORMS) {
  const allowed = normalizeAllowedPlatformKeys(allowedKeys);
  const values = Array.isArray(input) ? input : fallback;
  const result = [];
  const seen = new Set();

  if (!Array.isArray(values)) {
    return result;
  }

  for (const value of values) {
    const key = normalizePlatformKey(value);
    if (!key || seen.has(key) || !allowed.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(key);
  }
  return result;
}

function migrateLegacyCliConfig(config = {}) {
  const {
    enabledCliPlatforms,
    homeCliColumns,
    dashboardChannelOrder,
    allowedKeys
  } = config;
  const hasExplicitSelection = Object.prototype.hasOwnProperty.call(config, 'enabledCliPlatforms');

  if (hasExplicitSelection) {
    return normalizeEnabledCliPlatforms(enabledCliPlatforms, allowedKeys, DEFAULT_ENABLED_CLI_PLATFORMS);
  }

  const allowed = normalizeAllowedPlatformKeys(allowedKeys);
  const legacyInput = Array.isArray(homeCliColumns)
    ? homeCliColumns
    : dashboardChannelOrder;
  const normalizedLegacyInput = Array.isArray(legacyInput)
    ? legacyInput.map(normalizePlatformKey)
    : [];
  const normalizedLegacy = normalizeEnabledCliPlatforms(legacyInput, allowedKeys, []);
  const isExactOldDefault = normalizedLegacyInput.length === 4 &&
    normalizedLegacyInput.every((key, index) => key === ['claude', 'codex', 'gemini', 'opencode'][index]);

  if (isExactOldDefault) {
    return normalizeEnabledCliPlatforms(DEFAULT_ENABLED_CLI_PLATFORMS, allowedKeys, DEFAULT_ENABLED_CLI_PLATFORMS);
  }

  const result = [...normalizedLegacy];
  for (const key of DEFAULT_ENABLED_CLI_PLATFORMS) {
    if (allowed.has(key) && !result.includes(key)) {
      result.push(key);
    }
  }

  return result.length > 0
    ? result
    : normalizeEnabledCliPlatforms(DEFAULT_ENABLED_CLI_PLATFORMS, allowedKeys, DEFAULT_ENABLED_CLI_PLATFORMS);
}

function getBuiltInPlatformKeys() {
  return BUILT_IN_CLI_PLATFORMS.map(platform => platform.key);
}

function getPlatformDefinition(key) {
  const normalizedKey = normalizePlatformKey(key);
  return BUILT_IN_CLI_PLATFORMS.find(platform => platform.key === normalizedKey) || null;
}

module.exports = {
  BUILT_IN_CLI_PLATFORMS,
  DEFAULT_ENABLED_CLI_PLATFORMS,
  getBuiltInPlatformKeys,
  getPlatformDefinition,
  normalizePlatformKey,
  normalizeEnabledCliPlatforms,
  migrateLegacyCliConfig
};
