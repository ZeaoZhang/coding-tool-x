import { client, getChannelPrefix } from './client'
import { getPlatformProjects, usesLegacyPlatformApi } from './platforms'

export async function getProjects(channel = 'claude', options = {}) {
  if (!usesLegacyPlatformApi(channel)) {
    return getPlatformProjects(channel, options)
  }
  const prefix = getChannelPrefix(channel)
  const params = {}
  if (options.page != null) params.page = options.page
  if (options.limit != null) params.limit = options.limit
  if (options.q || options.search) params.q = options.q || options.search
  if (options.fresh) params.fresh = '1'
  const response = await client.get(`${prefix}/projects`, {
    params
  })
  return response.data
}

export async function createProject(projectName, projectPath, channel = 'claude') {
  const prefix = getChannelPrefix(channel)
  const response = await client.post(`${prefix}/projects/create`, {
    projectName,
    projectPath
  })
  return response.data
}

export async function saveProjectOrder(order, channel = 'claude') {
  const prefix = getChannelPrefix(channel)
  const response = await client.post(`${prefix}/projects/order`, { order })
  return response.data
}

export async function deleteProject(projectName, channel = 'claude') {
  const prefix = getChannelPrefix(channel)
  const response = await client.delete(`${prefix}/projects/${projectName}`)
  return response.data
}
