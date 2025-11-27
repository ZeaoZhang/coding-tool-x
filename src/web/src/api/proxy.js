import { client } from './client'

export async function getProxyStatus() {
  const response = await client.get('/proxy/status')
  return response.data
}

export async function startProxy() {
  const response = await client.post('/proxy/start')
  return response.data
}

export async function stopProxy() {
  const response = await client.post('/proxy/stop')
  return response.data
}

export async function clearProxyLogs() {
  const response = await client.post('/proxy/logs/clear')
  return response.data
}

export async function getCodexProxyStatus() {
  const response = await client.get('/codex/proxy/status')
  return response.data
}

export async function startCodexProxy() {
  const response = await client.post('/codex/proxy/start')
  return response.data
}

export async function stopCodexProxy() {
  const response = await client.post('/codex/proxy/stop')
  return response.data
}

export async function getGeminiProxyStatus() {
  const response = await client.get('/gemini/proxy/status')
  return response.data
}

export async function startGeminiProxy() {
  const response = await client.post('/gemini/proxy/start')
  return response.data
}

export async function stopGeminiProxy() {
  const response = await client.post('/gemini/proxy/stop')
  return response.data
}
