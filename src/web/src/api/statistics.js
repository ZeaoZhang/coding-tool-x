import { client } from './client'

export async function getStatistics() {
  const response = await client.get('/statistics/summary')
  return response.data
}

export async function getTodayStatistics() {
  const response = await client.get('/statistics/today')
  return response.data
}

export async function getClaudeTodayStatistics() {
  const response = await client.get('/claude/statistics/today')
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

export async function getOpenCodeTodayStatistics() {
  const response = await client.get('/opencode/statistics/today')
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

/**
 * Get model-level statistics for today
 * @returns {Promise} Statistics by model
 */
export async function getModelStats() {
  const response = await client.get('/statistics/models')
  return response.data
}

/**
 * Get model-level statistics for a specific tool type
 * @param {string} toolType - 'claude', 'codex', or 'gemini'
 * @returns {Promise} Statistics by model for tool type
 */
export async function getToolModelStats(toolType) {
  const response = await client.get(`/statistics/models/${toolType}`)
  return response.data
}

/**
 * Get historical model statistics
 * @param {number} days - Number of days to fetch
 * @returns {Promise} Historical statistics
 */
export async function getModelStatsHistory(days = 7) {
  const response = await client.get('/statistics/models/history', { params: { days } })
  return response.data
}

export async function getTrendStatistics(params) {
  const response = await client.get('/statistics/trend', { params })
  return response.data
}

export async function getAvailableFilters(params) {
  const response = await client.get('/statistics/filters', { params })
  return response.data
}

export function getTrendExportUrl(params) {
  const query = new URLSearchParams(params).toString()
  return `/api/statistics/trend/export?${query}`
}
