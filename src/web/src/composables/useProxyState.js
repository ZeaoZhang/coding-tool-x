import { ref, watch } from 'vue'
import axios from 'axios'

// 全局代理状态（单例模式）
const claudeProxy = ref({
  running: false,
  loading: false,
  activeChannel: null,
  port: 10088
})

const codexProxy = ref({
  running: false,
  loading: false,
  activeChannel: null,
  port: 10089
})

const geminiProxy = ref({
  running: false,
  loading: false,
  activeChannel: null,
  port: 10090
})

let isInitialized = false
let statusCheckInterval = null

/**
 * 代理状态管理 Composable
 */
export function useProxyState() {
  // 检查 Claude 代理状态
  async function checkClaudeStatus() {
    try {
      const response = await axios.get('/api/proxy/status')
      claudeProxy.value.running = response.data.proxy?.running || false
      claudeProxy.value.activeChannel = response.data.activeChannel || null
      claudeProxy.value.runtime = response.data.proxy?.runtime || null
      claudeProxy.value.startTime = response.data.proxy?.startTime || null
      // 如果代理运行中但没有activeChannel，尝试获取当前启用的渠道
      if (claudeProxy.value.running && !claudeProxy.value.activeChannel) {
        try {
          const channelRes = await axios.get('/api/channels')
          const enabledChannels = channelRes.data.channels?.filter(ch => ch.enabled !== false)
          if (enabledChannels && enabledChannels.length > 0) {
            claudeProxy.value.activeChannel = enabledChannels[0]
          }
        } catch (e) {}
      }
    } catch (error) {
      claudeProxy.value.running = false
      claudeProxy.value.activeChannel = null
      claudeProxy.value.runtime = null
      claudeProxy.value.startTime = null
    }
  }

  // 检查 Codex 代理状态
  async function checkCodexStatus() {
    try {
      const response = await axios.get('/api/codex/proxy/status')
      codexProxy.value.running = response.data.proxy?.running || false
      codexProxy.value.activeChannel = response.data.activeChannel || null
      codexProxy.value.runtime = response.data.proxy?.runtime || null
      codexProxy.value.startTime = response.data.proxy?.startTime || null
      if (codexProxy.value.running && !codexProxy.value.activeChannel) {
        try {
          const channelRes = await axios.get('/api/codex/channels/enabled')
          const enabledChannels = channelRes.data.channels
          if (enabledChannels && enabledChannels.length > 0) {
            codexProxy.value.activeChannel = enabledChannels[0]
          }
        } catch (e) {}
      }
    } catch (error) {
      codexProxy.value.running = false
      codexProxy.value.activeChannel = null
      codexProxy.value.runtime = null
      codexProxy.value.startTime = null
    }
  }

  // 检查 Gemini 代理状态
  async function checkGeminiStatus() {
    try {
      const response = await axios.get('/api/gemini/proxy/status')
      geminiProxy.value.running = response.data.proxy?.running || false
      geminiProxy.value.activeChannel = response.data.activeChannel || null
      geminiProxy.value.runtime = response.data.proxy?.runtime || null
      geminiProxy.value.startTime = response.data.proxy?.startTime || null
      if (geminiProxy.value.running && !geminiProxy.value.activeChannel) {
        try {
          const channelRes = await axios.get('/api/gemini/channels/enabled')
          const enabledChannels = channelRes.data.channels
          if (enabledChannels && enabledChannels.length > 0) {
            geminiProxy.value.activeChannel = enabledChannels[0]
          }
        } catch (e) {}
      }
    } catch (error) {
      geminiProxy.value.running = false
      geminiProxy.value.activeChannel = null
      geminiProxy.value.runtime = null
      geminiProxy.value.startTime = null
    }
  }

  // 检查所有代理状态
  async function checkAllStatus() {
    await Promise.all([
      checkClaudeStatus(),
      checkCodexStatus(),
      checkGeminiStatus()
    ])
  }

  // 切换 Claude 代理
  async function toggleClaudeProxy(value) {
    claudeProxy.value.loading = true
    try {
      if (value) {
        const response = await axios.post('/api/proxy/start')
        if (response.data.success) {
          claudeProxy.value.running = true
          claudeProxy.value.activeChannel = response.data.activeChannel
          return { success: true }
        } else {
          claudeProxy.value.running = false
          return { success: false, error: response.data.error }
        }
      } else {
        await axios.post('/api/proxy/stop')
        claudeProxy.value.running = false
        claudeProxy.value.activeChannel = null
        return { success: true }
      }
    } catch (error) {
      claudeProxy.value.running = !value
      return { success: false, error: error.response?.data?.error || error.message }
    } finally {
      claudeProxy.value.loading = false
    }
  }

  // 切换 Codex 代理
  async function toggleCodexProxy(value) {
    codexProxy.value.loading = true
    try {
      if (value) {
        const response = await axios.post('/api/codex/proxy/start')
        if (response.data.success) {
          codexProxy.value.running = true
          codexProxy.value.activeChannel = response.data.activeChannel
          return { success: true }
        } else {
          codexProxy.value.running = false
          return { success: false, error: response.data.error }
        }
      } else {
        await axios.post('/api/codex/proxy/stop')
        codexProxy.value.running = false
        codexProxy.value.activeChannel = null
        return { success: true }
      }
    } catch (error) {
      codexProxy.value.running = !value
      return { success: false, error: error.response?.data?.error || error.message }
    } finally {
      codexProxy.value.loading = false
    }
  }

  // 切换 Gemini 代理
  async function toggleGeminiProxy(value) {
    geminiProxy.value.loading = true
    try {
      if (value) {
        const response = await axios.post('/api/gemini/proxy/start')
        if (response.data.success) {
          geminiProxy.value.running = true
          geminiProxy.value.activeChannel = response.data.activeChannel
          return { success: true }
        } else {
          geminiProxy.value.running = false
          return { success: false, error: response.data.error }
        }
      } else {
        await axios.post('/api/gemini/proxy/stop')
        geminiProxy.value.running = false
        geminiProxy.value.activeChannel = null
        return { success: true }
      }
    } catch (error) {
      geminiProxy.value.running = !value
      return { success: false, error: error.response?.data?.error || error.message }
    } finally {
      geminiProxy.value.loading = false
    }
  }

  // 加载端口配置
  async function loadPorts() {
    try {
      const response = await axios.get('/api/config/advanced')
      if (response.data.ports) {
        claudeProxy.value.port = response.data.ports.proxy || 10088
        codexProxy.value.port = response.data.ports.codexProxy || 10089
        geminiProxy.value.port = response.data.ports.geminiProxy || 10090
      }
    } catch (error) {
      console.error('Failed to load ports:', error)
    }
  }

  // 初始化（只执行一次）
  function initialize() {
    if (!isInitialized) {
      loadPorts()
      checkAllStatus()

      // 定时检查状态（30秒一次，与全局设置保持一致）
      statusCheckInterval = setInterval(checkAllStatus, 30000)

      isInitialized = true
    }
  }

  // 清理
  function cleanup() {
    if (statusCheckInterval) {
      clearInterval(statusCheckInterval)
      statusCheckInterval = null
    }
  }

  return {
    // 状态
    claudeProxy,
    codexProxy,
    geminiProxy,

    // 方法
    checkClaudeStatus,
    checkCodexStatus,
    checkGeminiStatus,
    checkAllStatus,
    toggleClaudeProxy,
    toggleCodexProxy,
    toggleGeminiProxy,
    initialize,
    cleanup
  }
}
