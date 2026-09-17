import { client, getPlatformApiPrefix, isLegacyPlatformKey } from './client'

export async function getPlatforms() {
  const response = await client.get('/platforms')
  return Array.isArray(response.data?.platforms) ? response.data.platforms : []
}

export async function getPlatformProjects(platform, options = {}) {
  const response = await client.get(`${getPlatformApiPrefix(platform)}/projects`, {
    params: options.fresh ? { fresh: '1' } : undefined
  })
  return response.data
}

export async function getPlatformSessions(platform, projectName, options = {}) {
  const params = options.fresh ? { fresh: '1' } : undefined
  const response = await client.get(
    `${getPlatformApiPrefix(platform)}/sessions/${encodeURIComponent(projectName)}`,
    { params }
  )
  return response.data
}

export async function getDshResources(options = {}) {
  const params = {}
  if (options.profile) params.profile = options.profile
  if (options.cwd) params.cwd = options.cwd
  const response = await client.get('/platforms/dsh/config/resources', {
    params: Object.keys(params).length > 0 ? params : undefined
  })
  return response.data
}

export async function getDshSkills(options = {}) {
  const params = {
    ...(options.profile ? { profile: options.profile } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.includeContent ? { includeContent: '1' } : {})
  }
  const response = await client.get('/platforms/dsh/skills', {
    params: Object.keys(params).length > 0 ? params : undefined
  })
  return response.data
}

export async function getDshSkill(skillName, options = {}) {
  const params = {
    ...(options.profile ? { profile: options.profile } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {})
  }
  const response = await client.get(`/platforms/dsh/skills/${encodeURIComponent(skillName)}`, {
    params: Object.keys(params).length > 0 ? params : undefined
  })
  return response.data
}

export async function getDshPlugins() {
  const response = await client.get('/platforms/dsh/plugins')
  return response.data
}

export async function getDshProfilePlugins(profileName) {
  const response = await client.get(`/platforms/dsh/profiles/${encodeURIComponent(profileName)}/plugins`)
  return response.data
}

export async function getDshProfileMcp(profileName) {
  const response = await client.get(`/platforms/dsh/profiles/${encodeURIComponent(profileName)}/mcp`)
  return response.data
}

export async function getDshProfilePrompts(profileName) {
  const response = await client.get(`/platforms/dsh/profiles/${encodeURIComponent(profileName)}/prompts`)
  return response.data
}

export async function installDshPlugin(profileName, payload) {
  const response = await client.post(`/platforms/dsh/profiles/${encodeURIComponent(profileName)}/plugins/install`, payload)
  return response.data
}

export async function uninstallDshPlugin(profileName, pluginName, payload = {}) {
  const response = await client.delete(`/platforms/dsh/profiles/${encodeURIComponent(profileName)}/plugins/${encodeURIComponent(pluginName)}`, { data: payload })
  return response.data
}

export async function updateDshPlugin(profileName, payload = {}) {
  const response = await client.post(`/platforms/dsh/profiles/${encodeURIComponent(profileName)}/plugins/update`, payload)
  return response.data
}

export async function createDshSkill(payload) {
  const response = await client.post('/platforms/dsh/skills', payload)
  return response.data
}

export async function updateDshSkill(skillName, payload) {
  const response = await client.put(`/platforms/dsh/skills/${encodeURIComponent(skillName)}`, payload)
  return response.data
}

export async function deleteDshSkill(skillName, payload = {}) {
  const response = await client.delete(`/platforms/dsh/skills/${encodeURIComponent(skillName)}`, { data: payload })
  return response.data
}

export async function upsertDshMcp(profileName, payload) {
  const response = await client.post(`/platforms/dsh/profiles/${encodeURIComponent(profileName)}/mcp`, payload)
  return response.data
}

export async function deleteDshMcp(profileName, serverId, payload = {}) {
  const response = await client.delete(`/platforms/dsh/profiles/${encodeURIComponent(profileName)}/mcp/${encodeURIComponent(serverId)}`, { data: payload })
  return response.data
}

export async function upsertDshPrompt(profileName, payload) {
  const response = await client.post(`/platforms/dsh/profiles/${encodeURIComponent(profileName)}/prompts`, payload)
  return response.data
}

export async function deleteDshPrompt(profileName, promptId, payload = {}) {
  const response = await client.delete(`/platforms/dsh/profiles/${encodeURIComponent(profileName)}/prompts/${encodeURIComponent(promptId)}`, { data: payload })
  return response.data
}

export function usesLegacyPlatformApi(platform) {
  return isLegacyPlatformKey(platform)
}
