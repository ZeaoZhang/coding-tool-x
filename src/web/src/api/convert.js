import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:19999'

/**
 * 获取支持的格式列表
 * @returns {Promise<Object>} 格式信息
 */
export async function getFormats() {
  const response = await axios.get(`${API_BASE}/api/convert/formats`)
  return response.data
}

/**
 * 获取 OpenCode 网关转换支持信息
 * @returns {Promise<Object>}
 */
export async function getOpenCodeGatewayFormats() {
  const response = await axios.get(`${API_BASE}/api/convert/opencode/formats`)
  return response.data
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
  const response = await axios.post(`${API_BASE}/api/convert/opencode`, params)
  return response.data
}

/**
 * Claude Code 请求转换为 OpenCode
 * @param {Object} params
 * @param {Object} params.payload - 原始请求体
 * @param {Object} params.options - 转换选项
 * @returns {Promise<Object>}
 */
export async function convertClaudeToOpenCode(params) {
  const response = await axios.post(`${API_BASE}/api/convert/opencode/claude`, params)
  return response.data
}

/**
 * Codex 请求转换为 OpenCode
 * @param {Object} params
 * @param {Object} params.payload - 原始请求体
 * @param {Object} params.options - 转换选项
 * @returns {Promise<Object>}
 */
export async function convertCodexToOpenCode(params) {
  const response = await axios.post(`${API_BASE}/api/convert/opencode/codex`, params)
  return response.data
}

/**
 * Gemini 请求转换为 OpenCode
 * @param {Object} params
 * @param {Object} params.payload - 原始请求体
 * @param {Object} params.options - 转换选项
 * @returns {Promise<Object>}
 */
export async function convertGeminiToOpenCode(params) {
  const response = await axios.post(`${API_BASE}/api/convert/opencode/gemini`, params)
  return response.data
}
