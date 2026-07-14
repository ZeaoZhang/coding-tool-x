import { client } from './client'

export async function getDashboardInit(options = {}) {
  const response = await client.get('/dashboard/init', {
    params: options.fresh ? { fresh: '1' } : undefined
  })
  return response.data
}
