import { client } from './client'

// 获取可用的 OAuth 提供商列表
export async function getOAuthProviders() {
  const response = await client.get('/oauth/providers')
  return response.data
}

// 启动 OAuth 流程
export async function startOAuthFlow(provider, channelId = null, mode = 'browser') {
  const response = await client.post('/oauth/start', { provider, channelId, mode })
  return response.data
}

// 轮询 OAuth 状态
export async function pollOAuthStatus(stateId) {
  const response = await client.get(`/oauth/status/${stateId}`)
  return response.data
}

// 取消 OAuth 流程
export async function cancelOAuthFlow(stateId) {
  const response = await client.post(`/oauth/cancel/${stateId}`)
  return response.data
}

// 获取所有 OAuth Tokens
export async function getOAuthTokens() {
  const response = await client.get('/oauth/tokens')
  return response.data
}

// 获取单个 OAuth Token
export async function getOAuthToken(tokenId) {
  const response = await client.get(`/oauth/tokens/${tokenId}`)
  return response.data
}

// 删除 OAuth Token
export async function deleteOAuthToken(tokenId) {
  const response = await client.delete(`/oauth/tokens/${tokenId}`)
  return response.data
}

// 刷新 OAuth Token
export async function refreshOAuthToken(tokenId) {
  const response = await client.post(`/oauth/refresh/${tokenId}`)
  return response.data
}

// Device Flow - 启动设备授权流程
export async function startDeviceFlow(provider, channelId = null) {
  const response = await client.post('/oauth/device/start', { provider, channelId })
  return response.data
}

// Device Flow - 轮询设备授权状态
export async function pollDeviceFlowStatus(stateId) {
  const response = await client.get(`/oauth/device/status/${stateId}`)
  return response.data
}

// Device Flow - 取消设备授权流程
export async function cancelDeviceFlow(stateId) {
  const response = await client.post(`/oauth/device/cancel/${stateId}`)
  return response.data
}
