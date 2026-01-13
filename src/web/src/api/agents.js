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
