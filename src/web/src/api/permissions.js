/**
 * Command Permissions API
 *
 * 管理 Claude Code / Codex / Gemini CLI 命令执行权限
 */

import { client } from './client'

/**
 * 获取项目的命令执行权限设置
 * @param {string} projectPath - 项目路径
 * @param {string} cliType - CLI 类型 (claude/codex/gemini)
 */
export async function getPermissions(projectPath, cliType = 'claude') {
  const response = await client.get('/permissions', {
    params: { projectPath, cliType }
  })
  return response.data
}

/**
 * 保存项目的命令执行权限设置
 * @param {string} projectPath - 项目路径
 * @param {object} settings - 权限设置
 *   - allow: string[] - 允许自动执行的命令（Claude Code 格式）
 *   - deny: string[] - 需要用户确认的命令
 * @param {boolean} isLocal - 是否保存到 settings.local.json
 */
export async function savePermissions(projectPath, settings, isLocal = false) {
  const response = await client.post('/permissions', {
    projectPath,
    settings,
    isLocal
  })
  return response.data
}

/**
 * 获取全局 all-allow 模式状态
 */
export async function getAllAllowStatus() {
  const response = await client.get('/permissions/all-allow')
  return response.data
}

/**
 * 设置全局 all-allow 模式
 * @param {boolean} enabled - 是否启用
 */
export async function setAllAllowStatus(enabled) {
  const response = await client.post('/permissions/all-allow', { enabled })
  return response.data
}

/**
 * 获取权限模版
 */
export async function getPermissionTemplates() {
  const response = await client.get('/permissions/templates')
  return response.data
}

/**
 * 获取各 CLI 工具的配置说明
 */
export async function getCliConfigs() {
  const response = await client.get('/permissions/cli-config')
  return response.data
}
