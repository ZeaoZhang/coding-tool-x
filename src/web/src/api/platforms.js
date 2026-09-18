import { client, getPlatformApiPrefix, isLegacyPlatformKey } from './client'

export async function getPlatforms() {
  const response = await client.get('/platforms')
  return Array.isArray(response.data?.platforms) ? response.data.platforms : []
}

export async function getPlatformProjects(platform, options = {}) {
  const params = {}
  if (options.page != null) params.page = options.page
  if (options.limit != null) params.limit = options.limit
  if (options.q || options.search) params.q = options.q || options.search
  if (options.fresh) params.fresh = '1'
  const response = await client.get(`${getPlatformApiPrefix(platform)}/projects`, {
    params
  })
  return response.data
}

export async function getPlatformSessions(platform, projectName, options = {}) {
  const params = {}
  if (options.page != null) params.page = options.page
  if (options.limit != null) params.limit = options.limit
  if (options.q || options.search) params.q = options.q || options.search
  if (options.fresh) params.fresh = '1'
  const response = await client.get(
    `${getPlatformApiPrefix(platform)}/sessions/${encodeURIComponent(projectName)}`,
    { params }
  )
  return response.data
}

export function usesLegacyPlatformApi(platform) {
  return isLegacyPlatformKey(platform)
}
