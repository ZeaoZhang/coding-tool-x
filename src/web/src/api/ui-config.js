import { client } from './client'

export async function getUIConfig() {
  const response = await client.get('/ui-config')
  return response.data
}

export async function saveUIConfig(config) {
  const current = await getUIConfig()
  const existingConfig = current?.success && current.config && typeof current.config === 'object'
    ? current.config
    : {}
  const response = await client.post('/ui-config', {
    config: { ...existingConfig, ...config }
  })
  return response.data
}

export async function updateUIConfigKey(key, value) {
  const response = await client.put(`/ui-config/${key}`, { value })
  return response.data
}

export async function updateNestedUIConfig(parentKey, childKey, value) {
  const response = await client.put(`/ui-config/${parentKey}/${childKey}`, { value })
  return response.data
}
