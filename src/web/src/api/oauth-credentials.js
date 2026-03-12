import { client } from './client'

export async function getOAuthCredentialSummaries() {
  const response = await client.get('/oauth-credentials')
  return response.data
}

export async function importOAuthCredential(tool, payload = {}) {
  const response = await client.post(`/oauth-credentials/${tool}/import`, payload)
  return response.data
}

export async function syncLocalOAuthCredential(tool) {
  const response = await client.post(`/oauth-credentials/${tool}/sync-local`)
  return response.data
}

export async function setDefaultOAuthCredential(tool, credentialId) {
  const response = await client.post(`/oauth-credentials/${tool}/${credentialId}/default`)
  return response.data
}

export async function applyOAuthCredential(tool, credentialId) {
  const response = await client.post(`/oauth-credentials/${tool}/${credentialId}/apply`)
  return response.data
}

export async function deleteOAuthCredential(tool, credentialId) {
  const response = await client.delete(`/oauth-credentials/${tool}/${credentialId}`)
  return response.data
}

export async function fetchOAuthCredentialUsage(tool, credentialId) {
  const response = await client.get(`/oauth-credentials/${tool}/${credentialId}/usage`)
  return response.data
}
