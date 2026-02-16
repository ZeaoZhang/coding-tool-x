/**
 * Plugins API
 *
 * 管理 Claude Code 插件
 */

import { client } from './client'

/**
 * 获取插件列表
 */
export async function getPlugins(platform = 'claude') {
  const response = await client.get('/plugins', { params: { platform } })
  return response.data
}

/**
 * 获取市场插件列表
 */
export async function getMarketPlugins(platform = 'claude') {
  const response = await client.get('/plugins/market', { params: { platform } })
  return response.data
}

/**
 * 获取单个插件详情
 * @param {string} name - 插件名称
 */
export async function getPlugin(name, platform = 'claude') {
  const response = await client.get(`/plugins/${encodeURIComponent(name)}`, { params: { platform } })
  return response.data
}

/**
 * 安装插件
 * @param {string} directory - 插件目录路径
 * @param {object} repo - 仓库信息 { owner, name, branch }
 * @param {string} source - 直接安装源（npm 包名或 GitHub tree URL）
 */
export async function installPlugin(directory, repo, platform = 'claude', source = '') {
  const body = { platform }
  if (source) body.source = source
  else {
    body.directory = directory
    body.repo = repo
  }
  const response = await client.post('/plugins/install', body)
  return response.data
}

/**
 * 卸载插件
 * @param {string} name - 插件名称
 */
export async function uninstallPlugin(name, platform = 'claude') {
  const response = await client.delete(`/plugins/${encodeURIComponent(name)}`, { params: { platform } })
  return response.data
}

/**
 * 切换插件启用状态
 * @param {string} name - 插件名称
 * @param {boolean} enabled - 是否启用
 */
export async function togglePlugin(name, enabled, platform = 'claude') {
  const response = await client.put(`/plugins/${encodeURIComponent(name)}/toggle`, { enabled, platform })
  return response.data
}

/**
 * 更新插件配置
 * @param {string} name - 插件名称
 * @param {object} config - 配置对象
 */
export async function updatePluginConfig(name, config, platform = 'claude') {
  const response = await client.put(`/plugins/${encodeURIComponent(name)}/config`, { config, platform })
  return response.data
}

// ==================== 仓库管理 ====================

/**
 * 获取插件仓库列表
 */
export async function getPluginRepos(platform = 'claude') {
  const response = await client.get('/plugins/repos', { params: { platform } })
  return response.data
}

/**
 * 添加插件仓库
 * @param {object} repo - { url, name, description }
 */
export async function addPluginRepo(repo, platform = 'claude') {
  const response = await client.post('/plugins/repos', { ...repo, platform })
  return response.data
}

/**
 * 删除插件仓库
 * @param {string} owner - 仓库所有者
 * @param {string} name - 仓库名称
 */
export async function removePluginRepo(owner, name, platform = 'claude') {
  const response = await client.delete(`/plugins/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, { params: { platform } })
  return response.data
}

/**
 * 切换插件仓库启用状态
 * @param {string} owner - 仓库所有者
 * @param {string} name - 仓库名称
 * @param {boolean} enabled - 是否启用
 */
export async function togglePluginRepo(owner, name, enabled, platform = 'claude') {
  const response = await client.put(`/plugins/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/toggle`, { enabled, platform })
  return response.data
}

/**
 * 同步仓库到 Claude Code marketplace
 */
export async function syncPluginRepos(platform = 'claude') {
  const response = await client.post('/plugins/repos/sync', { platform })
  return response.data
}

/**
 * 同步本地插件列表
 */
export async function syncPlugins(platform = 'claude') {
  const response = await client.post('/plugins/sync', { platform })
  return response.data
}

/**
 * 获取插件 README
 * @param {string} name - 插件名称
 * @param {object} repoInfo - 仓库信息 { repoOwner, repoName, repoBranch, directory, source, repoUrl }
 */
export async function getPluginReadme(name, repoInfo = {}, platform = 'claude') {
  const params = new URLSearchParams()
  if (platform) params.append('platform', platform)
  if (repoInfo.repoOwner) params.append('repoOwner', repoInfo.repoOwner)
  if (repoInfo.repoName) params.append('repoName', repoInfo.repoName)
  if (repoInfo.repoBranch) params.append('repoBranch', repoInfo.repoBranch)
  if (repoInfo.directory) params.append('directory', repoInfo.directory)
  if (repoInfo.source) params.append('source', repoInfo.source)
  if (repoInfo.repoUrl) params.append('repoUrl', repoInfo.repoUrl)

  const response = await client.get(`/plugins/${encodeURIComponent(name)}/readme?${params.toString()}`)
  return response.data
}
