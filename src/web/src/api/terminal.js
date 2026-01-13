import { client } from './client'

// ============ 本地终端配置 API ============

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

// ============ Web 终端 API ============

/**
 * 获取所有活跃 Web 终端
 */
export async function listWebTerminals() {
  const response = await client.get('/terminal/list')
  return response.data
}

/**
 * 获取 Web 终端详情
 */
export async function getWebTerminal(terminalId) {
  const response = await client.get(`/terminal/${terminalId}`)
  return response.data
}

/**
 * 创建 Web 终端 (REST fallback)
 */
export async function createWebTerminal(options = {}) {
  const response = await client.post('/terminal/create', options)
  return response.data
}

/**
 * 销毁 Web 终端
 */
export async function destroyWebTerminal(terminalId) {
  const response = await client.delete(`/terminal/${terminalId}`)
  return response.data
}

/**
 * 调整 Web 终端大小
 */
export async function resizeWebTerminal(terminalId, cols, rows) {
  const response = await client.post(`/terminal/${terminalId}/resize`, { cols, rows })
  return response.data
}

/**
 * 获取 CLI 命令配置
 */
export async function getTerminalCommands() {
  const response = await client.get('/terminal/commands/config')
  return response.data
}

/**
 * 保存 CLI 命令配置
 */
export async function saveTerminalCommands(commands) {
  const response = await client.put('/terminal/commands/config', { commands })
  return response.data
}

/**
 * 重置为默认命令配置
 */
export async function resetTerminalCommands() {
  const response = await client.post('/terminal/commands/reset')
  return response.data
}
