import { client } from './client'

export async function getAutoStartStatus() {
  const response = await client.get('/pm2-autostart')
  return response.data
}

export async function enableAutoStart() {
  const response = await client.post('/pm2-autostart', { action: 'enable' })
  return response.data
}

export async function disableAutoStart() {
  const response = await client.post('/pm2-autostart', { action: 'disable' })
  return response.data
}
