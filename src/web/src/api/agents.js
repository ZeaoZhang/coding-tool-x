/**
 * Agents API
 *
 * 管理 Claude Code 自定义代理
 */

import { client } from './client'

/**
 * 获取代理列表
 * @param {string} projectPath - 项目路径（可选，用于获取项目级代理）
 */
export async function getAgents(projectPath = null) {
  const response = await client.get('/agents', {
    params: projectPath ? { projectPath } : {}
  })
  return response.data
}

/**
 * 获取所有代理（包括远程仓库）
 * @param {string} projectPath - 项目路径（可选）
 * @param {boolean} forceRefresh - 是否强制刷新缓存
 */
export async function getAllAgents(projectPath = null, forceRefresh = false) {
  const params = {}
  if (projectPath) params.projectPath = projectPath
  if (forceRefresh) params.refresh = '1'

  const response = await client.get('/agents/all', { params })
  return response.data
}

/**
 * 获取代理统计
 * @param {string} projectPath - 项目路径
 */
export async function getAgentsStats(projectPath = null) {
  const response = await client.get('/agents/stats', {
    params: projectPath ? { projectPath } : {}
  })
  return response.data
}

/**
 * 获取单个代理详情
 * @param {string} fileName - 文件名
 * @param {string} scope - 作用域 (user/project)
 * @param {string} projectPath - 项目路径（项目级代理需要）
 */
export async function getAgent(fileName, scope, projectPath = null) {
  const params = {}
  if (projectPath) params.projectPath = projectPath

  const response = await client.get(`/agents/${scope}/${fileName}`, { params })
  return response.data
}

/**
 * 创建代理
 * @param {object} data - { fileName, scope, projectPath?, name, description, tools?, model?, permissionMode?, skills?, systemPrompt? }
 */
export async function createAgent(data) {
  const response = await client.post('/agents', data)
  return response.data
}

/**
 * 更新代理
 * @param {string} fileName - 文件名
 * @param {string} scope - 作用域
 * @param {object} data - { projectPath?, name?, description?, tools?, model?, permissionMode?, skills?, systemPrompt? }
 */
export async function updateAgent(fileName, scope, data) {
  const response = await client.put(`/agents/${scope}/${fileName}`, data)
  return response.data
}

/**
 * 删除代理
 * @param {string} fileName - 文件名
 * @param {string} scope - 作用域
 * @param {string} projectPath - 项目路径
 */
export async function deleteAgent(fileName, scope, projectPath = null) {
  const params = {}
  if (projectPath) params.projectPath = projectPath

  const response = await client.delete(`/agents/${scope}/${fileName}`, { params })
  return response.data
}

// ==================== 仓库管理 ====================

/**
 * 获取仓库列表
 */
export async function getAgentRepos() {
  const response = await client.get('/agents/repos')
  return response.data
}

/**
 * 添加仓库
 * @param {object} repo - { owner, name, branch, directory, enabled }
 */
export async function addAgentRepo(repo) {
  const response = await client.post('/agents/repos', repo)
  return response.data
}

/**
 * 删除仓库
 * @param {string} owner
 * @param {string} name
 * @param {string} [directory] - 子目录路径
 */
export async function removeAgentRepo(owner, name, directory = '') {
  const response = await client.delete(`/agents/repos/${owner}/${name}`, {
    params: { directory }
  })
  return response.data
}

/**
 * 切换仓库启用状态
 * @param {string} owner
 * @param {string} name
 * @param {boolean} enabled
 * @param {string} [directory] - 子目录路径
 */
export async function toggleAgentRepo(owner, name, enabled, directory = '') {
  const response = await client.put(`/agents/repos/${owner}/${name}/toggle`, { enabled, directory })
  return response.data
}

/**
 * 从远程仓库安装代理
 * @param {object} agent - 代理对象
 */
export async function installAgent(agent) {
  const response = await client.post('/agents/install', agent)
  return response.data
}

/**
 * 卸载代理
 * @param {string} fileName - 代理的文件名（不含扩展名）
 */
export async function uninstallAgent(fileName) {
  const response = await client.post('/agents/uninstall', { fileName })
  return response.data
}
