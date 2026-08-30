const BUILT_IN_MANIFESTS = [
  require('../platforms/manifests/claude.json'),
  require('../platforms/manifests/codex.json'),
  require('../platforms/manifests/gemini.json'),
  require('../platforms/manifests/opencode.json'),
  require('../platforms/manifests/omp.json')
];

const DEFAULT_HOME_CLI_COLUMNS = ['claude', 'codex', 'gemini', 'opencode'];
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
    allowedKeys,
    fallback = []
  } = config;
  const hasExplicitSelection = Object.prototype.hasOwnProperty.call(config, 'enabledCliPlatforms');

  if (hasExplicitSelection) {
    return normalizeEnabledCliPlatforms(enabledCliPlatforms, allowedKeys, fallback);
  }

  const allowed = normalizeAllowedPlatformKeys(allowedKeys);
  const legacyInput = Array.isArray(homeCliColumns)
    ? homeCliColumns
    : dashboardChannelOrder;
  const normalizedLegacyInput = Array.isArray(legacyInput)
    ? legacyInput.map(normalizePlatformKey)
    : [];
  const normalizedLegacy = normalizeEnabledCliPlatforms(legacyInput, allowedKeys, []);
  const isExactOldDefault = normalizedLegacyInput.length === DEFAULT_HOME_CLI_COLUMNS.length &&
    normalizedLegacyInput.every((key, index) => key === DEFAULT_HOME_CLI_COLUMNS[index]);

  if (isExactOldDefault) {
    return normalizeEnabledCliPlatforms(DEFAULT_ENABLED_CLI_PLATFORMS, allowedKeys, fallback);
  }

  const result = [...normalizedLegacy];
  for (const key of DEFAULT_ENABLED_CLI_PLATFORMS) {
    if (allowed.has(key) && !result.includes(key)) {
      result.push(key);
    }
  }

  if (result.length > 0) {
    return result;
  }

  const normalizedDefault = normalizeEnabledCliPlatforms(DEFAULT_ENABLED_CLI_PLATFORMS, allowedKeys, []);
  return normalizedDefault.length > 0
    ? normalizedDefault
    : normalizeEnabledCliPlatforms(fallback, allowedKeys, []);
}

function getBuiltInPlatformKeys() {
  return BUILT_IN_CLI_PLATFORMS.map(platform => platform.key);
}

function getPlatformDefinition(key) {
  const normalizedKey = normalizePlatformKey(key);
  return BUILT_IN_CLI_PLATFORMS.find(platform => platform.key === normalizedKey) || null;
}

function normalizeCustomCliPlatform(input = {}) {
  const rawKey = normalizePlatformKey(input.key);
  const key = rawKey
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!key || getPlatformDefinition(key)) {
    return null;
  }

  const name = String(input.name || input.title || key).trim() || key;
  const command = String(input.command || key).trim() || key;
  return {
    key,
    name,
    title: String(input.title || name).trim() || name,
    command,
    configDir: String(input.configDir || '').trim(),
    icon: String(input.icon || '').trim(),
    color: String(input.color || '').trim(),
    enabled: input.enabled !== false,
    custom: true,
    supportsManagedChannels: false,
    supportsManagedConfig: false,
    supportsProxy: false,
    supportsProjects: false,
    supportsSessions: false,
    supportsSkills: false,
    supportsCommands: false,
    supportsPlugins: false,
    supportsAgents: false
  };
}

function normalizeCustomCliPlatforms(input = []) {
  const result = [];
  const seen = new Set();

  if (!Array.isArray(input)) {
    return result;
  }

  input.forEach((item) => {
    const normalized = normalizeCustomCliPlatform(item);
    if (!normalized || seen.has(normalized.key)) {
      return;
    }
    seen.add(normalized.key);
    result.push(normalized);
  });

  return result;
}

// Kept only for callers that still normalize the legacy homepage setting.
// Canonical selection and defaulting are handled by the helpers above.
function normalizeHomeCliColumns(input = []) {
  return normalizeEnabledCliPlatforms(input, getBuiltInPlatformKeys(), []);
}

module.exports = {
  BUILT_IN_CLI_PLATFORMS,
  DEFAULT_HOME_CLI_COLUMNS,
  DEFAULT_ENABLED_CLI_PLATFORMS,
  getBuiltInPlatformKeys,
  getPlatformDefinition,
  normalizePlatformKey,
  normalizeEnabledCliPlatforms,
  migrateLegacyCliConfig,
  normalizeCustomCliPlatform,
  normalizeCustomCliPlatforms,
  normalizeHomeCliColumns
};
