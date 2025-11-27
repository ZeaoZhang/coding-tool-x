import { client, getChannelPrefix } from './client'

export async function getProjects(channel = 'claude') {
  const prefix = getChannelPrefix(channel)
  const response = await client.get(`${prefix}/projects`)
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
