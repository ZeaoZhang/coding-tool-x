import { client } from './client'

export async function getSecurityStatus() {
  const response = await client.get('/security')
  return response.data
}

export async function verifySecurityPassword(password) {
  const response = await client.post('/security/verify', { password })
  return response.data
}

export async function setSecurityPassword(payload) {
  const response = await client.post('/security/password', payload)
  return response.data
}
