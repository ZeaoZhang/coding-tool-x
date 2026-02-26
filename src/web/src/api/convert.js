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

/**
 * 获取 OpenCode 网关转换支持信息
 * @returns {Promise<Object>}
 */
export async function getOpenCodeGatewayFormats() {
  const response = await axios.get(`${API_BASE}/api/convert/opencode/formats`);
  return response.data;
}

/**
 * 将请求转换为 OpenCode 可处理格式
 * @param {Object} params
 * @param {string} params.sourceType - 源渠道 (claude|codex|gemini)
 * @param {Object} params.payload - 原始请求体
 * @param {Object} params.options - 转换选项
 * @param {string} params.options.targetApi - responses|chat.completions
 * @returns {Promise<Object>}
 */
export async function convertToOpenCode(params) {
  const response = await axios.post(`${API_BASE}/api/convert/opencode`, params);
  return response.data;
}

/**
 * Claude Code 请求转换为 OpenCode
 * @param {Object} params
 * @param {Object} params.payload - 原始请求体
 * @param {Object} params.options - 转换选项
 * @returns {Promise<Object>}
 */
export async function convertClaudeToOpenCode(params) {
  const response = await axios.post(`${API_BASE}/api/convert/opencode/claude`, params);
  return response.data;
}

/**
 * Codex 请求转换为 OpenCode
 * @param {Object} params
 * @param {Object} params.payload - 原始请求体
 * @param {Object} params.options - 转换选项
 * @returns {Promise<Object>}
 */
export async function convertCodexToOpenCode(params) {
  const response = await axios.post(`${API_BASE}/api/convert/opencode/codex`, params);
  return response.data;
}

/**
 * Gemini 请求转换为 OpenCode
 * @param {Object} params
 * @param {Object} params.payload - 原始请求体
 * @param {Object} params.options - 转换选项
 * @returns {Promise<Object>}
 */
export async function convertGeminiToOpenCode(params) {
  const response = await axios.post(`${API_BASE}/api/convert/opencode/gemini`, params);
  return response.data;
}
