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
