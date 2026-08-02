/**
 * Plugins API
 *
 * 管理 Claude Code 插件
 */

import { client } from './client'

/**
 * 获取插件列表
 */
function withPluginContext(payload = {}, options = {}) {
  return {
    ...payload,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.scope ? { scope: options.scope } : {})
  }
}

export async function getPlugins(platform = 'claude', options = {}) {
  const response = await client.get('/plugins', {
    params: withPluginContext({ platform }, options)
  })
  return response.data
}

/**
 * 获取平台插件能力
 */
export async function getPluginCapabilities(platform = 'claude') {
  const response = await client.get('/plugins/capabilities', { params: { platform } })
  return response.data
}

/**
 * 获取市场插件列表
 */
export async function getMarketPlugins(platform = 'claude', forceRefresh = false, options = {}) {
  const response = await client.get('/plugins/market', {
    params: withPluginContext({ platform, refresh: forceRefresh ? '1' : '' }, options)
  })
  return response.data
}

/**
 * 获取单个插件详情
 * @param {string} name - 插件名称
 */
export async function getPlugin(pluginId, platform = 'claude', options = {}) {
  const response = await client.get(`/plugins/${encodeURIComponent(pluginId)}`, {
    params: withPluginContext({ platform, pluginId }, options)
  })
  return response.data
}

/**
 * 安装插件
 * @param {string} directory - 插件目录路径
 * @param {object} repo - 仓库信息 { owner, name, branch }
 * @param {string} source - 直接安装源（npm 包名或 GitHub tree URL）
 */
export async function installPlugin(directory, repo, platform = 'claude', source = '', options = {}, metadata = {}) {
  const body = withPluginContext({ platform }, options)
  if (source) {
    body.source = source
    Object.assign(body, {
      pluginId: metadata.pluginId || source,
      name: metadata.name,
      pluginKind: metadata.pluginKind,
      marketplace: metadata.marketplace,
      installSource: metadata.installSource,
      version: metadata.version,
      description: metadata.description,
      resourceTypes: metadata.resourceTypes
    })
  }
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
export async function uninstallPlugin(pluginId, platform = 'claude', options = {}) {
  const response = await client.delete(`/plugins/${encodeURIComponent(pluginId)}`, {
    params: withPluginContext({ platform, pluginId }, options)
  })
  return response.data
}

/**
 * 切换插件启用状态
 * @param {string} name - 插件名称
 * @param {boolean} enabled - 是否启用
 */
export async function togglePlugin(pluginId, enabled, platform = 'claude', options = {}) {
  const response = await client.put(`/plugins/${encodeURIComponent(pluginId)}/toggle`, withPluginContext({
    pluginId,
    enabled,
    platform
  }, options))
  return response.data
}

/**
 * 更新插件配置
 * @param {string} name - 插件名称
 * @param {object} config - 配置对象
 */
export async function updatePluginConfig(pluginId, config, platform = 'claude', options = {}) {
  const response = await client.put(`/plugins/${encodeURIComponent(pluginId)}/config`, withPluginContext({
    pluginId,
    config,
    platform
  }, options))
  return response.data
}

// ==================== 仓库管理 ====================

/**
 * 获取插件仓库列表
 */
export async function getPluginRepos(platform = 'claude', options = {}) {
  const response = await client.get('/plugins/repos', {
    params: withPluginContext({ platform }, options)
  })
  return response.data
}

/**
 * 添加插件仓库
 * @param {object} repo - { url, name, description }
 */
export async function addPluginRepo(repo, platform = 'claude', options = {}) {
  const response = await client.post('/plugins/repos', withPluginContext({ ...repo, platform }, options))
  return response.data
}

/**
 * 删除插件仓库
 * @param {object} repo - 仓库对象
 */
export async function removePluginRepo(repo, platform = 'claude', options = {}) {
  const response = await client.delete('/plugins/repos', {
    params: withPluginContext({
      platform,
      id: repo.id || '',
      owner: repo.owner || '',
      name: repo.name || ''
    }, options)
  })
  return response.data
}

/**
 * 切换插件仓库启用状态
 * @param {object} repo - 仓库对象
 * @param {boolean} enabled - 是否启用
 */
export async function togglePluginRepo(repo, enabled, platform = 'claude') {
  const response = await client.put('/plugins/repos/toggle', {
    id: repo.id || '',
    owner: repo.owner || '',
    name: repo.name || '',
    enabled,
    platform
  })
  return response.data
}

/**
 * 更新插件仓库级认证信息
 * @param {object} repo - 仓库对象
 * @param {object} auth - { token?: string, clearToken?: boolean }
 */
export async function updatePluginRepoAuth(repo, auth = {}, platform = 'claude') {
  const response = await client.put('/plugins/repos/auth', {
    id: repo.id || '',
    owner: repo.owner || '',
    name: repo.name || '',
    token: auth.token || '',
    clearToken: !!auth.clearToken,
    platform
  })
  return response.data
}

/**
 * 同步仓库到 Claude Code marketplace
 */
export async function syncPluginRepos(platform = 'claude', options = {}) {
  const response = await client.post('/plugins/repos/sync', withPluginContext({ platform }, options))
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
  if (repoInfo.repoId) params.append('repoId', repoInfo.repoId)
  if (repoInfo.repoProvider) params.append('repoProvider', repoInfo.repoProvider)
  if (repoInfo.repoHost) params.append('repoHost', repoInfo.repoHost)
  if (repoInfo.repoOwner) params.append('repoOwner', repoInfo.repoOwner)
  if (repoInfo.repoName) params.append('repoName', repoInfo.repoName)
  if (repoInfo.repoBranch) params.append('repoBranch', repoInfo.repoBranch)
  if (repoInfo.directory) params.append('directory', repoInfo.directory)
  if (repoInfo.source) params.append('source', repoInfo.source)
  if (repoInfo.repoUrl) params.append('repoUrl', repoInfo.repoUrl)
  if (repoInfo.repoProjectPath) params.append('repoProjectPath', repoInfo.repoProjectPath)
  if (repoInfo.repoLocalPath) params.append('repoLocalPath', repoInfo.repoLocalPath)
  if (repoInfo.installPath) params.append('installPath', repoInfo.installPath)

  const response = await client.get(`/plugins/${encodeURIComponent(name)}/readme?${params.toString()}`)
  return response.data
}
