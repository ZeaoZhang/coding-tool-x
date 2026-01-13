// 配置模板 API
import axios from 'axios';

const API_BASE = '/api/config-templates';

/**
 * 获取所有配置模板
 */
export async function getAllTemplates() {
  const response = await axios.get(API_BASE);
  return response.data;
}

/**
 * 获取单个配置模板详情
 */
export async function getTemplateById(id) {
  const response = await axios.get(`${API_BASE}/${id}`);
  return response.data;
}

/**
 * 创建自定义配置模板
 */
export async function createTemplate(data) {
  const response = await axios.post(API_BASE, data);
  return response.data;
}

/**
 * 更新自定义配置模板
 */
export async function updateTemplate(id, data) {
  const response = await axios.put(`${API_BASE}/${id}`, data);
  return response.data;
}

/**
 * 删除自定义配置模板
 */
export async function deleteTemplate(id) {
  const response = await axios.delete(`${API_BASE}/${id}`);
  return response.data;
}

/**
 * 获取可用的配置项（用于模板编辑器选择）
 */
export async function getAvailableConfigs() {
  const response = await axios.get(`${API_BASE}/available-configs`);
  return response.data;
}

/**
 * 应用模板到项目目录
 */
export async function applyTemplate(id, targetPath) {
  const response = await axios.post(`${API_BASE}/${id}/apply`, { targetPath });
  return response.data;
}

/**
 * 预览模板应用效果
 */
export async function previewTemplate(id, targetPath) {
  const response = await axios.post(`${API_BASE}/${id}/preview`, { targetPath });
  return response.data;
}
