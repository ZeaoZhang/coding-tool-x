import { client } from './client'

export async function getAllFavorites() {
  const response = await client.get('/favorites')
  return response.data
}

export async function getFavorites(channel) {
  const response = await client.get(`/favorites/${channel}`)
  return response.data
}

export async function addFavorite(channel, sessionData) {
  const response = await client.post('/favorites', { channel, sessionData })
  return response.data
}

export async function removeFavorite(channel, projectName, sessionId) {
  const response = await client.delete(`/favorites/${channel}/${encodeURIComponent(projectName)}/${sessionId}`)
  return response.data
}

export async function checkFavorite(channel, projectName, sessionId) {
  const response = await client.get(`/favorites/check/${channel}/${encodeURIComponent(projectName)}/${sessionId}`)
  return response.data
}
