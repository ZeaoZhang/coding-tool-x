/**
 * Config Registry API
 * Unified config management for skills, commands, agents, and plugins
 */

import { client } from './client'

/**
 * Get statistics for all config types
 */
export async function getStats() {
  const response = await client.get('/config-registry/stats')
  return response.data
}

/**
 * List all items for a config type
 * @param {string} type - 'skills' | 'commands' | 'agents' | 'plugins'
 */
export async function listItems(type) {
  const response = await client.get(`/config-registry/${type}`)
  return response.data
}

/**
 * Import configs from Claude Code native directories
 * @param {string} type - 'skills' | 'commands' | 'agents' | 'plugins'
 */
export async function importFromClaude(type) {
  const response = await client.post(`/config-registry/${type}/import`)
  return response.data
}

/**
 * Toggle enabled/disabled status
 * @param {string} type - 'skills' | 'commands' | 'agents' | 'plugins'
 * @param {string} name - item name/path
 * @param {boolean} enabled - new enabled state
 */
export async function toggleEnabled(type, name, enabled) {
  const encodedName = encodeURIComponent(name)
  const response = await client.put(`/config-registry/${type}/${encodedName}/toggle`, { enabled })
  return response.data
}

/**
 * Toggle platform for an item
 * @param {string} type - 'skills' | 'commands' | 'agents' | 'plugins'
 * @param {string} name - item name/path
 * @param {string} platform - 'claude' | 'codex' | 'gemini' | 'opencode'
 * @param {boolean} enabled - new platform state
 */
export async function togglePlatform(type, name, platform, enabled) {
  const encodedName = encodeURIComponent(name)
  const response = await client.put(`/config-registry/${type}/${encodedName}/platform/${platform}`, { enabled })
  return response.data
}

/**
 * Force sync all items of a type
 * @param {string} type - 'skills' | 'commands' | 'agents' | 'plugins'
 */
export async function syncAll(type) {
  const response = await client.post(`/config-registry/${type}/sync`)
  return response.data
}

// Default export for convenience
export default {
  getStats,
  listItems,
  importFromClaude,
  toggleEnabled,
  togglePlatform,
  syncAll
}
