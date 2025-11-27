import { client, getChannelPrefix } from './client'

export async function getSessions(projectName, channel = 'claude') {
  const prefix = getChannelPrefix(channel)
  const response = await client.get(`${prefix}/sessions/${projectName}`)
  return response.data
}

export async function setAlias(sessionId, alias) {
  const response = await client.post('/aliases', { sessionId, alias })
  return response.data
}

export async function deleteAlias(sessionId) {
  const response = await client.delete(`/aliases/${sessionId}`)
  return response.data
}

export async function deleteSession(projectName, sessionId, channel = 'claude') {
  const prefix = getChannelPrefix(channel)
  const response = await client.delete(`${prefix}/sessions/${projectName}/${sessionId}`)
  return response.data
}

export async function forkSession(projectName, sessionId, channel = 'claude') {
  const prefix = getChannelPrefix(channel)
  const response = await client.post(`${prefix}/sessions/${projectName}/${sessionId}/fork`)
  return response.data
}

export async function launchSession(projectName, sessionId, fork = false, channel = 'claude') {
  const prefix = getChannelPrefix(channel)
  const response = await client.post(`${prefix}/sessions/${projectName}/${sessionId}/launch`, { fork })
  return response.data
}

export async function saveSessionOrder(projectName, order, channel = 'claude') {
  const prefix = getChannelPrefix(channel)
  const response = await client.post(`${prefix}/sessions/${projectName}/order`, { order })
  return response.data
}

export async function searchSessions(projectName, keyword, contextLength = 15, channel = 'claude') {
  const prefix = getChannelPrefix(channel)
  const response = await client.get(`${prefix}/sessions/${projectName}/search`, {
    params: { keyword, context: contextLength }
  })
  return response.data
}

export async function searchSessionsGlobally(keyword, contextLength = 35, channel = 'claude') {
  const prefix = getChannelPrefix(channel)
  const response = await client.get(`${prefix}/sessions/search/global`, {
    params: { keyword, context: contextLength }
  })
  return response.data
}

export async function launchTerminal(projectName, sessionId, channel = 'claude') {
  const prefix = getChannelPrefix(channel)
  const response = await client.post(`${prefix}/sessions/${projectName}/${sessionId}/launch`)
  return response.data
}

export async function getSessionMessages(projectName, sessionId, page = 1, limit = 20, order = 'desc', channel = 'claude') {
  const prefix = getChannelPrefix(channel)
  const response = await client.get(`${prefix}/sessions/${projectName}/${sessionId}/messages`, {
    params: { page, limit, order }
  })
  return response.data
}

export async function getRecentSessions(limit = 5, channel = 'claude') {
  const prefix = getChannelPrefix(channel)
  const response = await client.get(`${prefix}/sessions/recent/list?limit=${limit}`)
  return response.data
}
