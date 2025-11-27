import { client } from './client'

// Claude channels
export async function getChannels() {
  const response = await client.get('/channels')
  return response.data
}

export async function getCurrentChannel() {
  const response = await client.get('/channels/current')
  return response.data
}

export async function createChannel(name, baseUrl, apiKey, websiteUrl, extra = {}) {
  const payload = {
    name,
    baseUrl,
    apiKey,
    websiteUrl,
    ...extra
  }
  const response = await client.post('/channels', payload)
  return response.data
}

export async function updateChannel(id, updates) {
  const response = await client.put(`/channels/${id}`, updates)
  return response.data
}

export async function deleteChannel(id) {
  const response = await client.delete(`/channels/${id}`)
  return response.data
}

export async function applyChannelToSettings(id) {
  const response = await client.post(`/channels/${id}/apply-to-settings`)
  return response.data
}

export async function getBestChannelForRestore() {
  const response = await client.get('/channels/best-for-restore')
  return response.data
}

export async function saveChannelOrder(order) {
  const response = await client.post('/channels/order', { order })
  return response.data
}

// Codex channels
export async function getCodexChannels() {
  const response = await client.get('/codex/channels')
  return response.data
}

export async function getActiveCodexChannel() {
  const response = await client.get('/codex/channels/active')
  return response.data
}

export async function createCodexChannel(name, providerKey, baseUrl, apiKey, websiteUrl) {
  const response = await client.post('/codex/channels', {
    name,
    providerKey,
    baseUrl,
    apiKey,
    websiteUrl
  })
  return response.data
}

export async function updateCodexChannel(channelId, updates) {
  const response = await client.put(`/codex/channels/${channelId}`, updates)
  return response.data
}

export async function deleteCodexChannel(channelId) {
  const response = await client.delete(`/codex/channels/${channelId}`)
  return response.data
}

export async function activateCodexChannel(channelId) {
  const response = await client.post(`/codex/channels/${channelId}/activate`)
  return response.data
}

export async function saveCodexChannelOrder(order) {
  const response = await client.post('/codex/channels/order', { order })
  return response.data
}

// Gemini channels
export async function getGeminiChannels() {
  const response = await client.get('/gemini/channels')
  return response.data
}

export async function getActiveGeminiChannel() {
  const response = await client.get('/gemini/channels/active')
  return response.data
}

export async function createGeminiChannel(name, baseUrl, apiKey, model, websiteUrl) {
  const response = await client.post('/gemini/channels', {
    name,
    baseUrl,
    apiKey,
    model,
    websiteUrl
  })
  return response.data
}

export async function updateGeminiChannel(channelId, updates) {
  const response = await client.put(`/gemini/channels/${channelId}`, updates)
  return response.data
}

export async function deleteGeminiChannel(channelId) {
  const response = await client.delete(`/gemini/channels/${channelId}`)
  return response.data
}

export async function activateGeminiChannel(channelId) {
  const response = await client.post(`/gemini/channels/${channelId}/activate`)
  return response.data
}

export async function saveGeminiChannelOrder(order) {
  const response = await client.post('/gemini/channels/order', { order })
  return response.data
}
