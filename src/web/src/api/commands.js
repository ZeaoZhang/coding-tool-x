/**
 * Commands API
 *
 * 管理 Claude Code 自定义命令
 */

import { client } from './client'

/**
 * 获取命令列表
 * @param {string} projectPath - 项目路径（可选，用于获取项目级命令）
 */
export async function getCommands(projectPath = null) {
  const response = await client.get('/commands', {
    params: projectPath ? { projectPath } : {}
  })
  return response.data
}

/**
 * 获取所有命令（包括远程仓库）
 * @param {string} projectPath - 项目路径（可选）
 * @param {boolean} forceRefresh - 是否强制刷新缓存
 */
export async function getAllCommands(projectPath = null, forceRefresh = false) {
  const params = {}
  if (projectPath) params.projectPath = projectPath
  if (forceRefresh) params.refresh = '1'

  const response = await client.get('/commands/all', { params })
  return response.data
}

/**
 * 获取命令统计
 * @param {string} projectPath - 项目路径
 */
export async function getCommandsStats(projectPath = null) {
  const response = await client.get('/commands/stats', {
    params: projectPath ? { projectPath } : {}
  })
  return response.data
}

/**
 * 获取单个命令详情
 * @param {string} name - 命令名
 * @param {string} scope - 作用域 (user/project)
 * @param {string} projectPath - 项目路径（项目级命令需要）
 * @param {string} namespace - 命名空间（可选）
 */
export async function getCommand(name, scope, projectPath = null, namespace = null) {
  const params = {}
  if (projectPath) params.projectPath = projectPath
  if (namespace) params.namespace = namespace

  const response = await client.get(`/commands/${scope}/${name}`, { params })
  return response.data
}

/**
 * 创建命令
 * @param {object} data - { name, scope, projectPath?, namespace?, description?, allowedTools?, argumentHint?, body }
 */
export async function createCommand(data) {
  const response = await client.post('/commands', data)
  return response.data
}

/**
 * 更新命令
 * @param {string} name - 命令名
 * @param {string} scope - 作用域
 * @param {object} data - { projectPath?, namespace?, description?, allowedTools?, argumentHint?, body }
 */
export async function updateCommand(name, scope, data) {
  const response = await client.put(`/commands/${scope}/${name}`, data)
  return response.data
}

/**
 * 删除命令
 * @param {string} name - 命令名
 * @param {string} scope - 作用域
 * @param {string} projectPath - 项目路径
 * @param {string} namespace - 命名空间
 */
export async function deleteCommand(name, scope, projectPath = null, namespace = null) {
  const params = {}
  if (projectPath) params.projectPath = projectPath
  if (namespace) params.namespace = namespace

  const response = await client.delete(`/commands/${scope}/${name}`, { params })
  return response.data
}

// ==================== 仓库管理 ====================

/**
 * 获取仓库列表
 */
export async function getCommandRepos() {
  const response = await client.get('/commands/repos')
  return response.data
}

/**
 * 添加仓库
 * @param {object} repo - { owner, name, branch, directory, enabled }
 */
export async function addCommandRepo(repo) {
  const response = await client.post('/commands/repos', repo)
  return response.data
}

/**
 * 删除仓库
 * @param {string} owner
 * @param {string} name
 * @param {string} [directory] - 子目录路径
 */
export async function removeCommandRepo(owner, name, directory = '') {
  const response = await client.delete(`/commands/repos/${owner}/${name}`, {
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
export async function toggleCommandRepo(owner, name, enabled, directory = '') {
  const response = await client.put(`/commands/repos/${owner}/${name}/toggle`, { enabled, directory })
  return response.data
}

/**
 * 从远程仓库安装命令
 * @param {object} command - 命令对象
 */
export async function installCommand(command) {
  const response = await client.post('/commands/install', command)
  return response.data
}

/**
 * 卸载命令
 * @param {string} path - 命令的相对路径
 */
export async function uninstallCommand(path) {
  const response = await client.post('/commands/uninstall', { path })
  return response.data
}

/**
 * 转换命令格式
 * @param {string} content - 命令内容
 * @param {string} targetFormat - 目标格式 ('claude' | 'codex')
 */
export async function convertCommandFormat(content, targetFormat) {
  const response = await client.post('/commands/convert', { content, targetFormat })
  return response.data
}

/**
 * 检测命令格式
 * @param {string} content - 命令内容
 */
export async function detectCommandFormat(content) {
  const response = await client.post('/commands/detect-format', { content })
  return response.data
}
