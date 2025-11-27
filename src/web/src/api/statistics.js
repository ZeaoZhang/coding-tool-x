import { client } from './client'

export async function getStatistics() {
  const response = await client.get('/statistics/summary')
  return response.data
}

export async function getTodayStatistics() {
  const response = await client.get('/statistics/today')
  return response.data
}

export async function getCodexTodayStatistics() {
  const response = await client.get('/codex/statistics/today')
  return response.data
}

export async function getGeminiTodayStatistics() {
  const response = await client.get('/gemini/statistics/today')
  return response.data
}

export async function getDailyStatistics(date) {
  const response = await client.get(`/statistics/daily/${date}`)
  return response.data
}

export async function getRecentStatistics(days = 7) {
  const response = await client.get('/statistics/recent', { params: { days } })
  return response.data
}
