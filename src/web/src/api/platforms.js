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

export function usesLegacyPlatformApi(platform) {
  return isLegacyPlatformKey(platform)
}
