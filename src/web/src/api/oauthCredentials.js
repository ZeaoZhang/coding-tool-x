import { client } from './client'

export async function getOAuthToolSummary(tool) {
  const response = await client.get(`/oauth-credentials/${encodeURIComponent(tool)}`)
  return response.data
}

export async function syncLocalOAuth(tool) {
  const response = await client.post(`/oauth-credentials/${encodeURIComponent(tool)}/sync-local`)
  return response.data
}

export async function applyOAuthCredential(tool, credentialId) {
  const response = await client.post(
    `/oauth-credentials/${encodeURIComponent(tool)}/${encodeURIComponent(credentialId)}/apply`
  )
  return response.data
}

export async function disableNativeOAuthCredential(tool, credentialId) {
  const response = await client.post(
    `/oauth-credentials/${encodeURIComponent(tool)}/${encodeURIComponent(credentialId)}/disable-native`
  )
  return response.data
}

export async function clearNativeOAuth(tool) {
  const response = await client.post(`/oauth-credentials/${encodeURIComponent(tool)}/clear-native`)
  return response.data
}

export async function getOAuthCredentials() {
  const response = await client.get('/oauth-credentials')
  return response.data
}
