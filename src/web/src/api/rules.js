/**
 * Rules API
 *
 * 管理 Claude Code 规则文件
 */

import { client } from './client'

/**
 * 获取规则列表
 * @param {string} projectPath - 项目路径（可选，用于获取项目级规则）
 */
export async function getRules(projectPath = null) {
  const response = await client.get('/rules', {
    params: projectPath ? { projectPath } : {}
  })
  return response.data
}

/**
 * 获取规则统计
 * @param {string} projectPath - 项目路径
 */
export async function getRulesStats(projectPath = null) {
  const response = await client.get('/rules/stats', {
    params: projectPath ? { projectPath } : {}
  })
  return response.data
}

/**
 * 获取目录结构
 * @param {string} projectPath - 项目路径
 */
export async function getRulesTree(projectPath = null) {
  const response = await client.get('/rules/tree', {
    params: projectPath ? { projectPath } : {}
  })
  return response.data
}

/**
 * 获取单个规则详情
 * @param {string} relativePath - 相对路径
 * @param {string} scope - 作用域 (user/project)
 * @param {string} projectPath - 项目路径（项目级规则需要）
 */
export async function getRule(relativePath, scope, projectPath = null) {
  const params = {}
  if (projectPath) params.projectPath = projectPath

  // 移除 .md 后缀以符合 API 路由
  const pathWithoutExt = relativePath.replace(/\.md$/, '')
  const response = await client.get(`/rules/${scope}/${pathWithoutExt}`, { params })
  return response.data
}

/**
 * 创建规则
 * @param {object} data - { fileName, scope, projectPath?, directory?, paths?, body }
 */
export async function createRule(data) {
  const response = await client.post('/rules', data)
  return response.data
}

/**
 * 更新规则
 * @param {string} relativePath - 相对路径
 * @param {string} scope - 作用域
 * @param {object} data - { projectPath?, paths?, body }
 */
export async function updateRule(relativePath, scope, data) {
  // 移除 .md 后缀以符合 API 路由
  const pathWithoutExt = relativePath.replace(/\.md$/, '')
  const response = await client.put(`/rules/${scope}/${pathWithoutExt}`, data)
  return response.data
}

/**
 * 删除规则
 * @param {string} relativePath - 相对路径
 * @param {string} scope - 作用域
 * @param {string} projectPath - 项目路径
 */
export async function deleteRule(relativePath, scope, projectPath = null) {
  const params = {}
  if (projectPath) params.projectPath = projectPath

  // 移除 .md 后缀以符合 API 路由
  const pathWithoutExt = relativePath.replace(/\.md$/, '')
  const response = await client.delete(`/rules/${scope}/${pathWithoutExt}`, { params })
  return response.data
}
