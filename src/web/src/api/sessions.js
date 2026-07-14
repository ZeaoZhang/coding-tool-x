import { client, getChannelPrefix } from './client'
import { copyTextToClipboard } from '../utils/clipboard'

export async function getSessions(projectName, channel = 'claude', options = {}) {
  const prefix = getChannelPrefix(channel)
  const params = {}
  if (options.fresh) {
    params.fresh = '1'
  }
  const response = await client.get(`${prefix}/sessions/${projectName}`, { params })
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

export async function deleteSessions(projectName, sessionIds, channel = 'claude') {
  const prefix = getChannelPrefix(channel)
  const response = await client.post(`${prefix}/sessions/${projectName}/batch-delete`, {
    sessionIds
  })
  return response.data
}

export async function forkSession(projectName, sessionId, channel = 'claude', options = {}) {
  const prefix = getChannelPrefix(channel)
  const response = await client.post(`${prefix}/sessions/${projectName}/${sessionId}/fork`, options)
  return response.data
}

export async function createSession(projectName, toolType = 'claude') {
  // 新建会话统一走 Claude 通用 sessions API，由 toolType 区分实际 CLI 类型
  const response = await client.post(`/sessions/${projectName}/create`, { toolType })
  return response.data
}

export async function launchSession(projectName, sessionId, fork = false, channel = 'claude') {
  const prefix = getChannelPrefix(channel)
  const response = await client.post(`${prefix}/sessions/${projectName}/${sessionId}/launch`, {
    fork
  })
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

export async function getSessionLaunchCommand(projectName, sessionId, channel = 'claude') {
  const prefix = getChannelPrefix(channel)
  const response = await client.post(`${prefix}/sessions/${projectName}/${sessionId}/launch`)
  return response.data
}

function quoteForShell(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`
}

export function formatLaunchCommandForCopy(launchData) {
  if (!launchData || typeof launchData !== 'object') {
    return ''
  }

  if (typeof launchData.copyCommand === 'string' && launchData.copyCommand.trim()) {
    return launchData.copyCommand
  }

  const command = typeof launchData.command === 'string' ? launchData.command.trim() : ''
  if (!command) {
    return ''
  }

  const cwd = typeof launchData.cwd === 'string' ? launchData.cwd.trim() : ''
  return cwd ? `cd ${quoteForShell(cwd)} && ${command}` : command
}

export async function copySessionLaunchCommand(projectName, sessionId, channel = 'claude') {
  const data = await getSessionLaunchCommand(projectName, sessionId, channel)
  const text = formatLaunchCommandForCopy(data)
  if (!text) {
    throw new Error('未获取到可复制的启动命令')
  }
  const copyResult = await copyTextToClipboard(text)
  return { text, data, copyResult }
}

export async function getSessionMessages(projectName, sessionId, page = 1, limit = 20, order = 'desc', channel = 'claude') {
  const prefix = getChannelPrefix(channel)
  const response = await client.get(`${prefix}/sessions/${projectName}/${sessionId}/messages`, {
    params: { page, limit, order }
  })
  return response.data
}

export async function getSessionOutline(projectName, sessionId, channel = 'claude') {
  const prefix = getChannelPrefix(channel)
  const response = await client.get(`${prefix}/sessions/${projectName}/${sessionId}/outline`)
  return response.data
}

export async function getSessionStatus(projectName, sessionId, channel = 'claude') {
  const prefix = getChannelPrefix(channel)
  const response = await client.get(`${prefix}/sessions/${projectName}/${sessionId}/status`)
  return response.data
}

export async function getRecentSessions(limit = 5, channel = 'claude') {
  const prefix = getChannelPrefix(channel)
  const response = await client.get(`${prefix}/sessions/recent/list?limit=${limit}`)
  return response.data
}
