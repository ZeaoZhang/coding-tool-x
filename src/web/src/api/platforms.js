import { client } from './client'

export async function getPlatforms() {
  const response = await client.get('/platforms')
  return Array.isArray(response.data?.platforms) ? response.data.platforms : []
}
