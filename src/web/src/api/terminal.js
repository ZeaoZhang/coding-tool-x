import { client } from './client'

export async function getAvailableTerminals() {
  const response = await client.get('/settings/terminals')
  return response.data
}

export async function getTerminalConfig() {
  const response = await client.get('/settings/terminal-config')
  return response.data
}

export async function saveTerminalConfig(selectedTerminal, customCommand = null) {
  const response = await client.post('/settings/terminal-config', {
    selectedTerminal,
    customCommand
  })
  return response.data
}
