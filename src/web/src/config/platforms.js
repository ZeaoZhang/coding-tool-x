import {
  ChatboxEllipsesOutline,
  CodeSlashOutline,
  SparklesOutline,
  ExtensionPuzzleOutline,
  PlanetOutline,
  TerminalOutline
} from '@vicons/ionicons5'

export const BUILT_IN_CLI_PLATFORMS = [
  {
    key: 'claude',
    title: 'ClaudeCode',
    label: 'Claude Code',
    command: 'claude',
    icon: ChatboxEllipsesOutline,
    color: '#18a058',
    defaultVisible: true,
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
    icon: CodeSlashOutline,
    color: '#3b82f6',
    defaultVisible: true,
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
    icon: SparklesOutline,
    color: '#a855f7',
    defaultVisible: true,
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
    icon: ExtensionPuzzleOutline,
    color: '#ea580c',
    defaultVisible: true,
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
    icon: PlanetOutline,
    color: '#0f9f9a',
    defaultVisible: false,
    supportsManagedConfig: true,
    supportsProxy: true,
    supportsProjects: true,
    supportsSessions: true,
    supportsSkills: true,
    supportsCommands: true,
    supportsPlugins: true,
    supportsAgents: false
  }
]

export const DEFAULT_HOME_CLI_COLUMNS = ['claude', 'codex', 'gemini', 'opencode']
export const MAX_HOME_CLI_COLUMNS = 4

export function normalizeCustomCliPlatform(input = {}) {
  const rawKey = String(input.key || '').trim().toLowerCase()
  const key = rawKey
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  if (!key || BUILT_IN_CLI_PLATFORMS.some(platform => platform.key === key)) {
    return null
  }

  const name = String(input.name || input.title || key).trim() || key
  const command = String(input.command || key).trim() || key
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
    supportsManagedConfig: false,
    supportsProxy: false,
    supportsProjects: false,
    supportsSessions: false,
    supportsSkills: false,
    supportsCommands: false,
    supportsPlugins: false,
    supportsAgents: false
  }
}

export function normalizeCustomCliPlatforms(input = []) {
  const result = []
  const seen = new Set()

  if (!Array.isArray(input)) return result

  input.forEach((item) => {
    const normalized = normalizeCustomCliPlatform(item)
    if (!normalized || seen.has(normalized.key)) return
    seen.add(normalized.key)
    result.push(normalized)
  })

  return result
}

export function getAllCliPlatforms(customCliPlatforms = []) {
  return [
    ...BUILT_IN_CLI_PLATFORMS,
    ...normalizeCustomCliPlatforms(customCliPlatforms).filter(platform => platform.enabled !== false)
  ]
}

export function getPlatformConfig(key, customCliPlatforms = []) {
  return getAllCliPlatforms(customCliPlatforms).find(platform => platform.key === key) || {
    key,
    title: key,
    label: key,
    command: key,
    icon: TerminalOutline,
    custom: true,
    supportsManagedConfig: false,
    supportsProxy: false,
    supportsProjects: false,
    supportsSessions: false,
    supportsSkills: false,
    supportsCommands: false,
    supportsPlugins: false,
    supportsAgents: false
  }
}

export function normalizeHomeCliColumns(input = [], customCliPlatforms = []) {
  const allowed = new Set(getAllCliPlatforms(customCliPlatforms).map(platform => platform.key))
  const result = []

  if (Array.isArray(input)) {
    input.forEach((value) => {
      const key = String(value || '').trim().toLowerCase()
      if (!key || result.includes(key) || !allowed.has(key)) return
      result.push(key)
    })
  }

  DEFAULT_HOME_CLI_COLUMNS.forEach((key) => {
    if (result.length < MAX_HOME_CLI_COLUMNS && !result.includes(key)) {
      result.push(key)
    }
  })

  return result.slice(0, MAX_HOME_CLI_COLUMNS)
}

export function buildCliPlatformOptions(customCliPlatforms = []) {
  return getAllCliPlatforms(customCliPlatforms).map(platform => ({
    label: platform.label || platform.title || platform.key,
    value: platform.key
  }))
}
