import axios from 'axios'

export const client = axios.create({
  baseURL: '/api',
  timeout: 30000
})

export function getChannelPrefix(channel = 'claude') {
  if (channel === 'codex') return '/codex'
  if (channel === 'gemini') return '/gemini'
  return ''
}
