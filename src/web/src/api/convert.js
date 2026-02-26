import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:19999';

/**
 * 获取支持的格式列表
 * @returns {Promise<Object>} 格式信息
 */
export async function getFormats() {
  const response = await axios.get(`${API_BASE}/api/convert/formats`);
  return response.data;
}

/**
 * 预览会话转换
 * @param {Object} params - 预览参数
 * @param {string} params.sourceType - 源格式 (claude|codex|gemini)
 * @param {string} params.sessionId - 会话 ID
 * @returns {Promise<Object>} 预览数据
 */
export async function previewConvert(params) {
  const response = await axios.post(`${API_BASE}/api/convert/preview`, params);
  return response.data;
}

/**
 * 执行会话转换
 * @param {Object} params - 转换参数
 * @param {string} params.sourceType - 源格式 (claude|codex|gemini)
 * @param {string} params.targetType - 目标格式 (claude|codex|gemini)
 * @param {string} params.sessionId - 会话 ID
 * @param {Object} params.options - 可选参数
 * @param {string} params.options.targetProject - 目标项目路径
 * @param {boolean} params.options.preserveTimestamps - 保留时间戳
 * @returns {Promise<Object>} 转换结果
 */
export async function convertSession(params) {
  const response = await axios.post(`${API_BASE}/api/convert`, params);
  return response.data;
}
