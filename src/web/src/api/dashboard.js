import { client } from './client'

export async function getDashboardInit() {
  const response = await client.get('/dashboard/init')
  return response.data
}
