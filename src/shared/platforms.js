const BUILT_IN_CLI_PLATFORMS = [
  {
    key: 'claude',
    title: 'ClaudeCode',
    label: 'Claude Code',
    command: 'claude',
    color: '#18a058',
    defaultVisible: true,
    supportsManagedChannels: true,
    supportsManagedConfig: true,
    supportsProxy: true,
    supportsProjects: true,
    supportsSessions: true,
    supportsSkills: true,
    supportsCommands: true,
    supportsPlugins: true,
    supportsAgents: true
  },
  {
    key: 'codex',
    title: 'Codex-CLI',
    label: 'Codex',
    command: 'codex',
    color: '#3b82f6',
    defaultVisible: true,
    supportsManagedChannels: true,
    supportsManagedConfig: true,
    supportsProxy: true,
    supportsProjects: true,
    supportsSessions: true,
    supportsSkills: true,
    supportsCommands: true,
    supportsPlugins: true,
    supportsAgents: true
  },
  {
    key: 'gemini',
    title: 'Gemini-CLI',
    label: 'Gemini',
    command: 'gemini',
    color: '#a855f7',
    defaultVisible: true,
    supportsManagedChannels: true,
    supportsManagedConfig: true,
    supportsProxy: true,
    supportsProjects: true,
    supportsSessions: true,
    supportsSkills: true,
    supportsCommands: true,
    supportsPlugins: false,
    supportsAgents: true
  },
  {
    key: 'opencode',
    title: 'OpenCode',
    label: 'OpenCode',
    command: 'opencode',
    color: '#ea580c',
    defaultVisible: true,
    supportsManagedChannels: true,
    supportsManagedConfig: true,
    supportsProxy: true,
    supportsProjects: true,
    supportsSessions: true,
    supportsSkills: true,
    supportsCommands: true,
    supportsPlugins: true,
    supportsAgents: true
  },
  {
    key: 'pi',
    title: 'OMP',
    label: 'OMP',
    command: 'omp',
    color: '#0f9f9a',
    defaultVisible: false,
    supportsManagedChannels: true,
    supportsManagedConfig: true,
    supportsProxy: true,
    supportsProjects: true,
    supportsSessions: true,
    supportsSkills: true,
    supportsCommands: true,
    supportsPlugins: true,
    supportsAgents: false
  }
];

const DEFAULT_HOME_CLI_COLUMNS = ['claude', 'codex', 'gemini', 'opencode'];
const MAX_HOME_CLI_COLUMNS = 4;

function getBuiltInPlatformKeys() {
  return BUILT_IN_CLI_PLATFORMS.map(platform => platform.key);
}

function getPlatformDefinition(key) {
  return BUILT_IN_CLI_PLATFORMS.find(platform => platform.key === key) || null;
}

function normalizeCustomCliPlatform(input = {}) {
  const rawKey = String(input.key || '').trim().toLowerCase();
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
      const key = String(value || '').trim().toLowerCase();
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
  normalizeCustomCliPlatform,
  normalizeCustomCliPlatforms,
  normalizeHomeCliColumns
};
