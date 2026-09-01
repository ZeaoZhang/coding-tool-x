/**
 * Skills API
 */

import { client } from './client'
import { requestKey, requestSingleflight } from './request-singleflight'


function scopeParams(options = {}) {
  return {
    ...(options.platform ? { platform: options.platform } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.scope ? { scope: options.scope } : {})
  };
}
/**
 * 获取本地 Skill 列表。此函数永不触发远程刷新。
 */
export async function getSkills(platform = 'claude', options = {}) {
  const key = requestKey('skills', platform, options.scope || 'user', options.cwd || '');
  return requestSingleflight(key, signal => client.get('/skills', {
    params: {
      platform,
      scope: options.scope || 'user',
      ...scopeParams(options)
    },
    signal
  }).then(response => response.data), 'skills', `skills:${platform}`);
}

/**
 * 手动启动 Skill 远程刷新任务。
 */
export async function refreshSkills(platform = 'claude', options = {}) {
  const response = await client.post('/skills/refresh', {
    platform,
    scope: options.scope || 'user',
    ...(options.cwd ? { cwd: options.cwd } : {})
  });
  return response.data;
}

export async function getSkillRefreshTask(taskId, options = {}) {
  const response = await client.get(`/skills/refresh/${encodeURIComponent(taskId)}`, {
    params: scopeParams(options)
  });
  return response.data;
}

export async function toggleSkill(controlKey, enabled, platform = 'claude', options = {}) {
  const response = await client.put('/skills/toggle', {
    controlKey,
    enabled,
    platform,
    scope: options.scope || 'user',
    ...(options.cwd ? { cwd: options.cwd } : {})
  });
  return response.data;
}

export async function setSkillTrust(controlKey, trust, platform = 'claude', options = {}) {
  const response = await client.put('/skills/trust', {
    controlKey,
    trust,
    platform,
    scope: options.scope || 'user',
    ...(options.cwd ? { cwd: options.cwd } : {})
  });
  return response.data;
}

/**
 * 获取 OMP 技能扫描设置
 */
export async function getOmpSkillSettings() {
  const response = await client.get('/skills/omp-settings')
  return response.data
}

/**
 * 更新 OMP 技能扫描设置
 * @param {object} settings - OMP 技能扫描设置
 */
export async function updateOmpSkillSettings(settings) {
  const response = await client.put('/skills/omp-settings', settings)
  return response.data
}

/**
 * 获取已安装的技能
 */
export async function getInstalledSkills(platform = 'claude', options = {}) {
  const response = await client.get('/skills/installed', { params: { platform, ...scopeParams(options) } })
  return response.data
}

/**
 * 获取技能详情
 * @param {string} directory - 技能目录
 * @param {object|null} repo - 仓库上下文
 * @param {string|null} fullDirectory - 仓库中的完整路径
 */
export async function getSkillDetail(directory, platform = 'claude', repo = null, fullDirectory = null, options = {}) {
  const params = { platform, ...scopeParams(options) }
  if (fullDirectory) params.fullDirectory = fullDirectory
  if (repo) {
    if (repo.id) params.repoId = repo.id
    if (repo.provider) params.provider = repo.provider
    if (repo.host) params.host = repo.host
    if (repo.owner) params.owner = repo.owner
    if (repo.name) params.name = repo.name
    if (repo.branch) params.branch = repo.branch
    if (repo.directory) params.directory = repo.directory
    if (repo.projectPath) params.projectPath = repo.projectPath
    if (repo.localPath) params.localPath = repo.localPath
    if (repo.repoUrl) params.repoUrl = repo.repoUrl
  }
  const key = requestKey(
    `skill-detail:${directory}:${fullDirectory || ''}`,
    platform,
    options.scope || '',
    `${options.cwd || ''}:${repo?.localPath || repo?.projectPath || ''}`
  )
  return requestSingleflight(key, signal => client.get(`/skills/detail/${directory}`, { params, signal })
    .then(response => response.data), 'skill-detail', `skill-detail:${platform}`)
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
 * @param {object} repo - { provider, owner, name, host, projectPath, localPath, branch, directory, enabled }
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
export async function removeSkillRepo(repo, platform = 'claude') {
  const response = await client.delete('/skills/repos', {
    params: {
      platform,
      id: repo.id || '',
      owner: repo.owner || '',
      name: repo.name || '',
      directory: repo.directory || ''
    }
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
export async function toggleSkillRepo(repo, enabled, platform = 'claude') {
  const response = await client.put('/skills/repos/toggle', {
    id: repo.id || '',
    owner: repo.owner || '',
    name: repo.name || '',
    enabled,
    directory: repo.directory || '',
    platform
  })
  return response.data
}

/**
 * 更新仓库级认证信息
 * @param {object} repo - 仓库信息
 * @param {object} auth - { token?: string, clearToken?: boolean }
 */
export async function updateSkillRepoAuth(repo, auth = {}, platform = 'claude') {
  const response = await client.put('/skills/repos/auth', {
    id: repo.id || '',
    owner: repo.owner || '',
    name: repo.name || '',
    directory: repo.directory || '',
    token: auth.token || '',
    clearToken: !!auth.clearToken,
    platform
  })
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
export async function getSkillFiles(directory, platform = 'claude', options = {}) {
  const response = await client.get(`/skills/${directory}/files`, { params: { platform, ...scopeParams(options) } })
  return response.data
}

/**
 * 获取技能文件内容
 * @param {string} directory - 技能目录
 * @param {string} filePath - 文件路径
 */
export async function getSkillFileContent(directory, filePath, platform = 'claude', options = {}) {
  const response = await client.get(`/skills/${directory}/file/${filePath}`, { params: { platform, ...scopeParams(options) } })
  return response.data
}

/**
 * 添加文件到技能
 * @param {string} directory - 技能目录
 * @param {Array<{path, content, isBase64?}>} files - 文件列表
 */
export async function addSkillFiles(directory, files, platform = 'claude', options = {}) {
  const response = await client.post(`/skills/${directory}/files`, { files, platform, ...scopeParams(options) })
  return response.data
}

/**
 * 删除技能中的文件
 * @param {string} directory - 技能目录
 * @param {string} filePath - 文件路径
 */
export async function deleteSkillFile(directory, filePath, platform = 'claude', options = {}) {
  const response = await client.delete(`/skills/${directory}/file/${filePath}`, { params: { platform, ...scopeParams(options) } })
  return response.data
}

/**
 * 更新技能文件
 * @param {string} directory - 技能目录
 * @param {string} filePath - 文件路径
 * @param {string} content - 文件内容
 * @param {boolean} [isBase64] - 是否 base64 编码
 */
export async function updateSkillFile(directory, filePath, content, isBase64 = false, platform = 'claude', options = {}) {
  const response = await client.put(`/skills/${directory}/file/${filePath}`, { content, isBase64, platform, ...scopeParams(options) })
  return response.data
}
