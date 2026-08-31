import axios from 'axios'

export const API_TIMEOUT_MS = 30000
export const SPEED_TEST_API_TIMEOUT_MS = 180000

export const client = axios.create({
  baseURL: '/api',
  timeout: API_TIMEOUT_MS
})

// 响应拦截器：统一处理错误响应
client.interceptors.response.use(
  response => response,
  error => {
    // 如果有响应数据，提取错误信息
    if (error.response && error.response.data) {
      const errorData = error.response.data
      // 创建一个新的错误对象，保留原始错误信息
      const enhancedError = new Error(errorData.message || error.message)
      enhancedError.response = error.response
      enhancedError.status = error.response.status
      enhancedError.data = errorData
      return Promise.reject(enhancedError)
    }
    return Promise.reject(error)
  }
)
export const LEGACY_PLATFORM_PREFIXES = Object.freeze({
  claude: '',
  codex: '/codex',
  gemini: '/gemini',
  opencode: '/opencode',
  omp: '/omp'
})

export function normalizePlatformKey(platform) {
  return String(platform || '').trim().toLowerCase()
}

export function isLegacyPlatformKey(platform) {
  return Object.prototype.hasOwnProperty.call(
    LEGACY_PLATFORM_PREFIXES,
    normalizePlatformKey(platform)
  )
}

export function createPlatformApiError(platform, code = 'not_found') {
  const key = normalizePlatformKey(platform)
  const error = new Error(code === 'not_found'
    ? `Unknown platform: ${key || '(empty)'}`
    : `Unsupported platform capability: ${key || '(empty)'}`)
  error.code = code
  error.status = 404
  error.platform = key
  return error
}

export function getPlatformApiPrefix(platform = 'claude') {
  const key = normalizePlatformKey(platform)
  if (!key) throw createPlatformApiError(platform)
  if (isLegacyPlatformKey(key)) return LEGACY_PLATFORM_PREFIXES[key]
  return `/platforms/${encodeURIComponent(key)}`
}

export function getChannelPrefix(channel = 'claude') {
  return getPlatformApiPrefix(channel)
}
