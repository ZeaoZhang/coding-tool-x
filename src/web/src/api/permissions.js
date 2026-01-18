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
 * 获取单个权限模版
 * @param {string} id - 模版 ID
 */
export async function getPermissionTemplate(id) {
  const response = await client.get(`/permissions/templates/${id}`)
  return response.data
}

/**
 * 创建自定义权限模版
 * @param {object} template - 模版数据
 */
export async function createPermissionTemplate(template) {
  const response = await client.post('/permissions/templates', template)
  return response.data
}

/**
 * 更新自定义权限模版
 * @param {string} id - 模版 ID
 * @param {object} updates - 更新数据
 */
export async function updatePermissionTemplate(id, updates) {
  const response = await client.put(`/permissions/templates/${id}`, updates)
  return response.data
}

/**
 * 删除自定义权限模版
 * @param {string} id - 模版 ID
 */
export async function deletePermissionTemplate(id) {
  const response = await client.delete(`/permissions/templates/${id}`)
  return response.data
}

/**
 * 获取各 CLI 工具的配置说明
 */
export async function getCliConfigs() {
  const response = await client.get('/permissions/cli-config')
  return response.data
}
