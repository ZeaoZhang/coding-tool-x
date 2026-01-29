/**
 * Plugins API
 *
 * 管理 Claude Code 插件
 */

import { client } from './client'

/**
 * 获取插件列表
 */
export async function getPlugins() {
  const response = await client.get('/plugins')
  return response.data
}

/**
 * 获取单个插件详情
 * @param {string} name - 插件名称
 */
export async function getPlugin(name) {
  const response = await client.get(`/plugins/${encodeURIComponent(name)}`)
  return response.data
}

/**
 * 安装插件
 * @param {string} gitUrl - Git 仓库地址
 */
export async function installPlugin(gitUrl) {
  const response = await client.post('/plugins/install', { gitUrl })
  return response.data
}

/**
 * 卸载插件
 * @param {string} name - 插件名称
 */
export async function uninstallPlugin(name) {
  const response = await client.delete(`/plugins/${encodeURIComponent(name)}`)
  return response.data
}

/**
 * 切换插件启用状态
 * @param {string} name - 插件名称
 * @param {boolean} enabled - 是否启用
 */
export async function togglePlugin(name, enabled) {
  const response = await client.put(`/plugins/${encodeURIComponent(name)}/toggle`, { enabled })
  return response.data
}

/**
 * 更新插件配置
 * @param {string} name - 插件名称
 * @param {object} config - 配置对象
 */
export async function updatePluginConfig(name, config) {
  const response = await client.put(`/plugins/${encodeURIComponent(name)}/config`, { config })
  return response.data
}

// ==================== 仓库管理 ====================

/**
 * 获取插件仓库列表
 */
export async function getPluginRepos() {
  const response = await client.get('/plugins/repos')
  return response.data
}

/**
 * 添加插件仓库
 * @param {object} repo - { url, name, description }
 */
export async function addPluginRepo(repo) {
  const response = await client.post('/plugins/repos', repo)
  return response.data
}

/**
 * 删除插件仓库
 * @param {string} id - 仓库ID
 */
export async function removePluginRepo(id) {
  const response = await client.delete(`/plugins/repos/${encodeURIComponent(id)}`)
  return response.data
}
