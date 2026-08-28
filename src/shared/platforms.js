const BUILT_IN_MANIFESTS = [
  require('../platforms/manifests/claude.json'),
  require('../platforms/manifests/codex.json'),
  require('../platforms/manifests/gemini.json'),
  require('../platforms/manifests/opencode.json'),
  require('../platforms/manifests/omp.json')
];

const DEFAULT_HOME_CLI_COLUMNS = ['claude', 'codex', 'gemini', 'opencode'];
const MAX_HOME_CLI_COLUMNS = 4;

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

function normalizeHomeCliColumns(input = [], customCliPlatforms = []) {
  const customKeys = new Set(
    normalizeCustomCliPlatforms(customCliPlatforms)
      .filter(platform => platform.enabled !== false)
      .map(platform => platform.key)
  );
  const builtInKeys = new Set(getBuiltInPlatformKeys());
  const allowed = key => builtInKeys.has(key) || customKeys.has(key);
  const result = [];

  if (Array.isArray(input)) {
    input.forEach((value) => {
      const key = normalizePlatformKey(value);
      if (!key || result.includes(key) || !allowed(key)) {
        return;
      }
      result.push(key);
    });
  }

  DEFAULT_HOME_CLI_COLUMNS.forEach((key) => {
    if (result.length >= MAX_HOME_CLI_COLUMNS) {
      return;
    }
    if (!result.includes(key)) {
      result.push(key);
    }
  });

  return result.slice(0, MAX_HOME_CLI_COLUMNS);
}

module.exports = {
  BUILT_IN_CLI_PLATFORMS,
  DEFAULT_HOME_CLI_COLUMNS,
  MAX_HOME_CLI_COLUMNS,
  getBuiltInPlatformKeys,
  getPlatformDefinition,
  normalizePlatformKey,
  normalizeCustomCliPlatform,
  normalizeCustomCliPlatforms,
  normalizeHomeCliColumns
};
