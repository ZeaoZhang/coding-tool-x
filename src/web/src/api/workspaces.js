// 工作区 API
import axios from 'axios';

const API_BASE = '/api/workspaces';

/**
 * 获取所有工作区列表
 */
export async function getWorkspaces() {
  const response = await axios.get(API_BASE);
  return response.data;
}

/**
 * 获取单个工作区详情
 */
export async function getWorkspace(id) {
  const response = await axios.get(`${API_BASE}/${id}`);
  return response.data;
}

/**
 * 创建工作区
 */
export async function createWorkspace(data) {
  const response = await axios.post(API_BASE, data);
  return response.data;
}

/**
 * 删除工作区
 */
export async function deleteWorkspace(id, removeFiles = false) {
  const response = await axios.delete(`${API_BASE}/${id}`, {
    params: { removeFiles }
  });
  return response.data;
}

/**
 * 更新工作区最后使用时间
 */
export async function updateWorkspaceLastUsed(id) {
  const response = await axios.put(`${API_BASE}/${id}/last-used`);
  return response.data;
}

/**
 * 向工作区添加项目
 */
export async function addProjectToWorkspace(workspaceId, projectData) {
  const response = await axios.post(`${API_BASE}/${workspaceId}/projects`, projectData);
  return response.data;
}

/**
 * 从工作区移除项目
 */
export async function removeProjectFromWorkspace(workspaceId, projectName, removeWorktrees = false) {
  const response = await axios.delete(`${API_BASE}/${workspaceId}/projects/${projectName}`, {
    params: { removeWorktrees }
  });
  return response.data;
}

/**
 * 检查项目是否是 git 仓库并获取 worktrees
 */
export async function checkGitRepo(projectPath) {
  const encodedPath = encodeURIComponent(projectPath);
  const response = await axios.get(`${API_BASE}/check-git/${encodedPath}`);
  return response.data;
}

/**
 * 获取所有渠道的可用项目（并集）
 */
export async function getAvailableProjects() {
  const response = await axios.get(`${API_BASE}/available-projects`);
  return response.data;
}

/**
 * 获取在工作区启动 CLI 工具的命令
 * @param {string} workspaceId 工作区 ID
 * @param {string} tool 工具名称 (claude/codex/gemini)
 * @param {string} projectName 可选，工作区内的项目名
 */
export async function getLaunchCommand(workspaceId, tool, projectName = null) {
  const response = await axios.post(`${API_BASE}/${workspaceId}/launch`, {
    tool,
    projectName
  });
  return response.data;
}
