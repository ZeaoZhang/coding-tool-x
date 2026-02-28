/**
 * Skills API
 */

import { client } from './client'

/**
 * 获取技能列表
 * @param {boolean} forceRefresh - 是否强制刷新缓存
 * @param {string} platform - 平台: claude | codex | opencode
 */
export async function getSkills(forceRefresh = false, platform = 'claude') {
  const response = await client.get('/skills', {
    params: { refresh: forceRefresh ? '1' : '', platform }
  })
  return response.data
}

/**
 * 获取已安装的技能
 */
export async function getInstalledSkills(platform = 'claude') {
  const response = await client.get('/skills/installed', { params: { platform } })
  return response.data
}

/**
 * 获取技能详情
 * @param {string} directory - 技能目录
 */
export async function getSkillDetail(directory, platform = 'claude') {
  const response = await client.get(`/skills/detail/${directory}`, { params: { platform } })
  return response.data
}

/**
 * 安装技能
 * @param {string} directory - 本地安装目录
 * @param {object} repo - 仓库信息 { owner, name, branch }
 * @param {string} [fullDirectory] - 仓库中的完整路径（当指定了仓库子目录时使用）
 */
export async function installSkill(directory, repo, fullDirectory = null, platform = 'claude') {
  const response = await client.post('/skills/install', { directory, repo, fullDirectory, platform })
  return response.data
}

/**
 * 卸载技能
 * @param {string} directory - 技能目录
 */
export async function uninstallSkill(directory, platform = 'claude') {
  const response = await client.post('/skills/uninstall', { directory, platform })
  return response.data
}

/**
 * 创建自定义技能
 * @param {object} skill - { name, directory, description, content }
 */
export async function createCustomSkill(skill, platform = 'claude') {
  const response = await client.post('/skills/create', { ...skill, platform })
  return response.data
}

/**
 * 获取仓库列表
 */
export async function getSkillRepos(platform = 'claude') {
  const response = await client.get('/skills/repos', { params: { platform } })
  return response.data
}

/**
 * 添加仓库
 * @param {object} repo - { owner, name, branch, directory, enabled }
 */
export async function addSkillRepo(repo, platform = 'claude') {
  const response = await client.post('/skills/repos', { ...repo, platform })
  return response.data
}

/**
 * 删除仓库
 * @param {string} owner
 * @param {string} name
 * @param {string} [directory] - 子目录路径
 */
export async function removeSkillRepo(owner, name, directory = '', platform = 'claude') {
  const response = await client.delete(`/skills/repos/${owner}/${name}`, {
    params: { directory, platform }
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
export async function toggleSkillRepo(owner, name, enabled, directory = '', platform = 'claude') {
  const response = await client.put(`/skills/repos/${owner}/${name}/toggle`, { enabled, directory, platform })
  return response.data
}

// ==================== 多文件技能管理 ====================

/**
 * 创建带多文件的技能
 * @param {object} data - { directory, files: [{path, content, isBase64?}] }
 */
export async function createSkillWithFiles(data, platform = 'claude') {
  const response = await client.post('/skills/create-with-files', { ...data, platform })
  return response.data
}

/**
 * 获取技能文件列表
 * @param {string} directory - 技能目录
 */
export async function getSkillFiles(directory, platform = 'claude') {
  const response = await client.get(`/skills/${directory}/files`, { params: { platform } })
  return response.data
}

/**
 * 获取技能文件内容
 * @param {string} directory - 技能目录
 * @param {string} filePath - 文件路径
 */
export async function getSkillFileContent(directory, filePath, platform = 'claude') {
  const response = await client.get(`/skills/${directory}/file/${filePath}`, { params: { platform } })
  return response.data
}

/**
 * 添加文件到技能
 * @param {string} directory - 技能目录
 * @param {Array<{path, content, isBase64?}>} files - 文件列表
 */
export async function addSkillFiles(directory, files, platform = 'claude') {
  const response = await client.post(`/skills/${directory}/files`, { files, platform })
  return response.data
}

/**
 * 删除技能中的文件
 * @param {string} directory - 技能目录
 * @param {string} filePath - 文件路径
 */
export async function deleteSkillFile(directory, filePath, platform = 'claude') {
  const response = await client.delete(`/skills/${directory}/file/${filePath}`, { params: { platform } })
  return response.data
}

/**
 * 更新技能文件
 * @param {string} directory - 技能目录
 * @param {string} filePath - 文件路径
 * @param {string} content - 文件内容
 * @param {boolean} [isBase64] - 是否 base64 编码
 */
export async function updateSkillFile(directory, filePath, content, isBase64 = false, platform = 'claude') {
  const response = await client.put(`/skills/${directory}/file/${filePath}`, { content, isBase64, platform })
  return response.data
}
