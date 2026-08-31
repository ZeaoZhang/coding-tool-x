import { resolveIconToken } from './iconTokens'

export const DEFAULT_ENABLED_CLI_PLATFORMS = ['claude', 'codex', 'opencode', 'omp']
export const MINIMAL_PLATFORM_FALLBACK = [
  { key: 'claude', label: 'Claude Code', capabilities: { channels: true, projects: true, sessions: true, proxy: true, statistics: true, resourceSync: true, skills: true, commands: true, agents: true, nativeConfig: true } },
  { key: 'codex', label: 'Codex', capabilities: { channels: true, projects: true, sessions: true, proxy: true, statistics: true, resourceSync: true, skills: true, commands: true, agents: true, nativeConfig: true } },
  { key: 'gemini', label: 'Gemini', capabilities: { channels: true, projects: true, sessions: true, proxy: true, statistics: true, resourceSync: true, skills: true, commands: true, agents: true, nativeConfig: true } },
  { key: 'opencode', label: 'OpenCode', capabilities: { channels: true, projects: true, sessions: true, proxy: true, statistics: true, resourceSync: true, skills: true, commands: true, agents: true, nativeConfig: true } },
  { key: 'omp', label: 'OMP', capabilities: { channels: true, projects: true, sessions: true, proxy: true, statistics: true, resourceSync: true, skills: true, commands: true, plugins: true, agents: false, nativeConfig: true } }
]

function normalizeCapabilities(platform = {}) {
  if (platform?.capabilities && typeof platform.capabilities === 'object' && !Array.isArray(platform.capabilities)) {
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
    platform?.[key] !== false
  ]))
}

function normalizeResourceTypes(resourceTypes) {
  if (!resourceTypes || typeof resourceTypes !== 'object' || Array.isArray(resourceTypes)) return {}
  return Object.fromEntries(Object.entries(resourceTypes).filter(([, value]) => typeof value === 'boolean'))
}

export function normalizePublicPlatform(platform = {}) {
  if (!platform || typeof platform !== 'object' || Array.isArray(platform)) return null
  const key = String(platform?.key || '').trim().toLowerCase()
  const capabilities = normalizeCapabilities(platform)
  const iconToken = String(platform?.iconToken || platform?.icon || 'terminal').trim()
  return {
    key,
    label: String(platform?.label || platform?.name || platform?.title || key).trim(),
    title: String(platform?.title || platform?.label || platform?.name || key).trim(),
    command: String(platform?.command || key).trim(),
    iconToken,
    icon: resolveIconToken(iconToken),
    color: String(platform?.color || '#64748b').trim(),
    defaultVisible: platform?.defaultVisible !== false,
    enabled: platform?.enabled !== false,
    custom: false,
    capabilities,
    resourceTypes: normalizeResourceTypes(platform.resourceTypes),
    promptLabel: typeof platform?.promptLabel === 'string' ? platform.promptLabel.trim() : '',
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
    if (!platform || !platform.key || seen.has(platform.key)) return false
    seen.add(platform.key)
    return true
  })
}

// Compatibility lookup for existing panels. Platform metadata always comes
// from the public catalog; the optional legacy argument is intentionally gone.
export function getPlatformConfig(key, platforms = []) {
  const normalizedKey = String(key || '').trim().toLowerCase()
  const catalog = normalizePublicPlatforms(platforms)
  return catalog.find(platform => platform.key === normalizedKey) || normalizePublicPlatform({
    key: normalizedKey,
    capabilities: {}
  })
}

// Compatibility options for settings code that has not migrated to catalog
// navigation yet. No custom platform metadata is merged into the result.
export function buildCliPlatformOptions(platforms = []) {
  return normalizePublicPlatforms(platforms).map(platform => ({
    label: platform.label || platform.title || platform.key,
    value: platform.key
  }))
}
