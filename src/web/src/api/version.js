import { client } from './client'

export async function checkForUpdates() {
  const response = await client.get('/version/check')
  return response.data
}

export async function getCurrentVersion() {
  const response = await client.get('/version/current')
  return response.data
}

export async function getChangelog(version) {
  const response = await client.get(`/version/changelog/${version}`)
  return response.data
}

export async function getAllChangelog() {
  const response = await client.get('/version/changelog')
  return response.data
}
