import axios from 'axios'

export const client = axios.create({
  baseURL: '/api',
  timeout: 30000
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

export function getChannelPrefix(channel = 'claude') {
  if (channel === 'codex') return '/codex'
  if (channel === 'gemini') return '/gemini'
  if (channel === 'opencode') return '/opencode'
  if (channel === 'pi') return '/pi'
  return ''
}
