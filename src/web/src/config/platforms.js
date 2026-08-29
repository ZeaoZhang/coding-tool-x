import { resolveIconToken } from './iconTokens'

export const DEFAULT_HOME_CLI_COLUMNS = ['claude', 'codex', 'gemini', 'opencode']
export const MAX_HOME_CLI_COLUMNS = 4
export const MINIMAL_PLATFORM_FALLBACK = [
  { key: 'claude', label: 'Claude Code', capabilities: { channels: true, projects: true, sessions: true, skills: true, commands: true, plugins: true, agents: true, nativeConfig: true } },
  { key: 'codex', label: 'Codex', capabilities: { channels: true, projects: true, sessions: true, skills: true, commands: true, plugins: true, agents: true, nativeConfig: true } },
  { key: 'gemini', label: 'Gemini', capabilities: { channels: true, projects: true, sessions: true, skills: true, commands: true, plugins: false, agents: true, nativeConfig: true } },
  { key: 'opencode', label: 'OpenCode', capabilities: { channels: true, projects: true, sessions: true, skills: true, commands: true, plugins: true, agents: true, nativeConfig: true } },
  { key: 'omp', label: 'OMP', defaultVisible: false, capabilities: { channels: true, projects: true, sessions: true, skills: true, commands: true, plugins: true, agents: false, nativeConfig: true } }
]
const BUILT_IN_PLATFORM_KEYS = new Set(['claude', 'codex', 'gemini', 'opencode', 'omp'])

function normalizeCapabilities(platform = {}) {
  if (platform.capabilities && typeof platform.capabilities === 'object' && !Array.isArray(platform.capabilities)) {
    return { ...platform.capabilities }
  }

  const supportKeys = {
    proxy: 'supportsProxy',
    projects: 'supportsProjects',
    sessions: 'supportsSessions',
    skills: 'supportsSkills',
    commands: 'supportsCommands',
    plugins: 'supportsPlugins',
    agents: 'supportsAgents'
  }
  return Object.fromEntries(Object.entries(supportKeys).map(([capability, key]) => [
    capability,
    platform[key] !== false
  ]))
}

export function normalizePublicPlatform(platform = {}) {
  const key = String(platform?.key || '').trim().toLowerCase()
  const capabilities = normalizeCapabilities(platform)
  return {
    key,
    label: String(platform?.label || platform?.name || platform?.title || key).trim(),
    title: String(platform?.title || platform?.label || platform?.name || key).trim(),
    command: String(platform?.command || key).trim(),
    iconToken: String(platform?.iconToken || platform?.icon || 'terminal').trim(),
    icon: resolveIconToken(platform?.iconToken || platform?.icon || 'terminal'),
    color: String(platform?.color || '#64748b').trim(),
    defaultVisible: platform?.defaultVisible !== false,
    enabled: platform?.enabled !== false,
    custom: platform?.custom === true,
    capabilities,
    supportsManagedConfig: capabilities.nativeConfig === true,
    supportsProxy: capabilities.proxy === true,
    supportsProjects: capabilities.projects === true,
    supportsSessions: capabilities.sessions === true,
    supportsSkills: capabilities.skills === true,
    supportsCommands: capabilities.commands === true,
    supportsPlugins: capabilities.plugins === true,
    supportsAgents: capabilities.agents === true
  }
}

export function normalizePublicPlatforms(platforms = []) {
  const seen = new Set()
  if (!Array.isArray(platforms)) return []
  return platforms.map(normalizePublicPlatform).filter(platform => {
    if (!platform.key || seen.has(platform.key)) return false
    seen.add(platform.key)
    return true
  })
}

// Kept for old settings callers while the catalog migration is in progress.
export function normalizeCustomCliPlatform(input = {}) {
  const normalized = normalizePublicPlatform({
    ...input,
    label: input.label || input.name,
    iconToken: input.iconToken || input.icon || 'terminal',
    custom: true
  })
  if (!normalized.key || !normalized.custom || BUILT_IN_PLATFORM_KEYS.has(normalized.key)) return null
  return {
    ...input,
    key: normalized.key,
    name: String(input.name || normalized.label || normalized.key).trim(),
    title: normalized.title,
    command: normalized.command,
    icon: String(input.icon || input.iconToken || '').trim(),
    iconToken: normalized.iconToken,
    color: normalized.color,
    enabled: input.enabled !== false,
    custom: true,
    capabilities: normalized.capabilities
  }
}

export function normalizeCustomCliPlatforms(input = []) {
  if (!Array.isArray(input)) return []
  const result = []
  const seen = new Set()
  for (const item of input) {
    const normalized = normalizeCustomCliPlatform(item)
    if (!normalized || seen.has(normalized.key)) continue
    seen.add(normalized.key)
    result.push(normalized)
  }
  return result
}

export function getAllCliPlatforms(customCliPlatforms = [], platforms = []) {
  const publicPlatforms = normalizePublicPlatforms(platforms)
  const customPlatforms = normalizeCustomCliPlatforms(customCliPlatforms)
    .filter(platform => platform.enabled !== false)
  const seen = new Set(publicPlatforms.map(platform => platform.key))
  return [
    ...publicPlatforms,
    ...customPlatforms.filter(platform => !seen.has(platform.key))
  ]
}

export function getPlatformConfig(key, platforms = [], customCliPlatforms = []) {
  const normalizedKey = String(key || '').trim().toLowerCase()
  const allPlatforms = getAllCliPlatforms(customCliPlatforms, platforms)
  return allPlatforms.find(platform => platform.key === normalizedKey) || normalizePublicPlatform({
    key: normalizedKey,
    custom: true,
    capabilities: {}
  })
}

export function normalizeHomeCliColumns(input = [], platforms = [], customCliPlatforms = []) {
  const available = getAllCliPlatforms(customCliPlatforms, platforms)
  const allowed = new Set([
    ...DEFAULT_HOME_CLI_COLUMNS,
    ...available.map(platform => platform.key)
  ])
  const result = []
  if (Array.isArray(input)) {
    for (const value of input) {
      const key = String(value || '').trim().toLowerCase()
      if (key && allowed.has(key) && !result.includes(key)) result.push(key)
    }
  }
  for (const key of DEFAULT_HOME_CLI_COLUMNS) {
    if (result.length >= MAX_HOME_CLI_COLUMNS) break
    if (!result.includes(key)) result.push(key)
  }
  return result.slice(0, MAX_HOME_CLI_COLUMNS)
}

export function buildCliPlatformOptions(platforms = [], customCliPlatforms = []) {
  return getAllCliPlatforms(customCliPlatforms, platforms).map(platform => ({
    label: platform.label || platform.title || platform.key,
    value: platform.key
  }))
}
