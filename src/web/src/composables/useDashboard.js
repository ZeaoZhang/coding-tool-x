import { ref } from 'vue'
import api from '../api'

// Dashboard 数据
const dashboardData = ref({
  uiConfig: null,
  favorites: null,
  channels: {
    claude: [],
    codex: [],
    gemini: []
  },
  proxyStatus: {
    claude: { running: false },
    codex: { running: false },
    gemini: { running: false }
  },
  todayStats: {
    claude: { total: 0, cost: 0 },
    codex: { total: 0, cost: 0 },
    gemini: { total: 0, cost: 0 }
  }
})

// 加载状态
const isLoading = ref(false)
const isLoaded = ref(false)
let loadPromise = null

// 自动刷新配置（仅在需要时启用）
let autoRefreshIntervalId = null
const AUTO_REFRESH_INTERVAL = 5 * 60 * 1000 // 5 分钟自动刷新一次

// 启用自动刷新
function enableAutoRefresh() {
  if (autoRefreshIntervalId) return
  autoRefreshIntervalId = setInterval(() => {
    loadDashboard(true); // force refresh
  }, AUTO_REFRESH_INTERVAL)
}

// 禁用自动刷新
function disableAutoRefresh() {
  if (autoRefreshIntervalId) {
    clearInterval(autoRefreshIntervalId)
    autoRefreshIntervalId = null
  }
}

// 加载 Dashboard 数据
async function loadDashboard(force = false) {
  // 如果已加载且不强制刷新，直接返回
  if (isLoaded.value && !force) {
    return dashboardData.value
  }

  // 如果正在加载，返回现有的 Promise（请求去重）
  if (loadPromise && !force) {
    return loadPromise
  }

  isLoading.value = true

  loadPromise = (async () => {
    try {
      // 前端并行加载所有数据，不依赖后端的聚合 API
      // 这样可以让快的请求快速返回，不被慢的请求拖累
      const [
        uiConfigResp,
        favoritesResp,
        channelsResp,
        codexChannelsResp,
        geminiChannelsResp,
        proxyStatusResp,
        codexProxyStatusResp,
        geminiProxyStatusResp,
        todayStatsResp
      ] = await Promise.allSettled([
        api.getUIConfig(),
        api.getAllFavorites(),
        api.getChannels(),
        api.getCodexChannels(),
        api.getGeminiChannels(),
        api.getProxyStatus(),
        api.getCodexProxyStatus(),
        api.getGeminiProxyStatus(),
        api.getTodayStatistics()
      ])

      // 处理结果，失败的部分使用默认值
      const getData = (settled, fallback = null) => {
        return settled.status === 'fulfilled' ? settled.value : fallback
      }

      const uiConfig = getData(uiConfigResp)
      const favorites = getData(favoritesResp)
      const channels = getData(channelsResp, { channels: [] })
      const codexChannels = getData(codexChannelsResp, { channels: [] })
      const geminiChannels = getData(geminiChannelsResp, { channels: [] })
      const proxyStatus = getData(proxyStatusResp, {})
      const codexProxyStatus = getData(codexProxyStatusResp, {})
      const geminiProxyStatus = getData(geminiProxyStatusResp, {})
      const todayStats = getData(todayStatsResp, {})

      // 更新仪表板数据
      dashboardData.value = {
        uiConfig,
        favorites,
        channels: {
          claude: channels?.channels || [],
          codex: codexChannels?.channels || [],
          gemini: geminiChannels?.channels || []
        },
        proxyStatus: {
          claude: proxyStatus,
          codex: codexProxyStatus,
          gemini: geminiProxyStatus
        },
        todayStats: {
          claude: todayStats && todayStats.summary
            ? {
                requests: todayStats.summary.requests || 0,
                tokens: todayStats.summary.tokens || 0,
                cost: todayStats.summary.cost || 0
              }
            : { requests: 0, tokens: 0, cost: 0 },
          codex: { requests: 0, tokens: 0, cost: 0 },
          gemini: { requests: 0, tokens: 0, cost: 0 }
        }
      }

      isLoaded.value = true
      return dashboardData.value
    } catch (err) {
      console.error('Failed to load dashboard:', err)
      throw err
    }
  })()

  loadPromise.finally(() => {
    isLoading.value = false
    loadPromise = null
  })

  return loadPromise
}

// 刷新指定类型的数据
async function refreshChannels(channelType) {
  try {
    if (channelType === 'claude') {
      const response = await api.getChannels()
      if (response.success) {
        dashboardData.value.channels.claude = response.channels
      }
    } else if (channelType === 'codex') {
      const response = await api.getCodexChannels()
      if (response.success) {
        dashboardData.value.channels.codex = response.channels
      }
    } else if (channelType === 'gemini') {
      const response = await api.getGeminiChannels()
      if (response.success) {
        dashboardData.value.channels.gemini = response.channels
      }
    }
  } catch (err) {
    console.error(`Failed to refresh ${channelType} channels:`, err)
  }
}

// 刷新代理状态
async function refreshProxyStatus(channelType) {
  try {
    if (channelType === 'claude') {
      const response = await api.getProxyStatus()
      if (response.success) {
        dashboardData.value.proxyStatus.claude = response
      }
    } else if (channelType === 'codex') {
      const response = await api.getCodexProxyStatus()
      if (response.success) {
        dashboardData.value.proxyStatus.codex = response
      }
    } else if (channelType === 'gemini') {
      const response = await api.getGeminiProxyStatus()
      if (response.success) {
        dashboardData.value.proxyStatus.gemini = response
      }
    }
  } catch (err) {
    console.error(`Failed to refresh ${channelType} proxy status:`, err)
  }
}

// 刷新统计数据
async function refreshStats(channelType) {
  try {
    if (channelType === 'claude') {
      const response = await api.getTodayStatistics()
      if (response.success) {
        dashboardData.value.todayStats.claude = {
          total: response.total || 0,
          cost: response.cost || 0
        }
      }
    } else if (channelType === 'codex') {
      const response = await api.getCodexTodayStatistics()
      if (response.success) {
        dashboardData.value.todayStats.codex = {
          total: response.total || 0,
          cost: response.cost || 0
        }
      }
    } else if (channelType === 'gemini') {
      const response = await api.getGeminiTodayStatistics()
      if (response.success) {
        dashboardData.value.todayStats.gemini = {
          total: response.total || 0,
          cost: response.cost || 0
        }
      }
    }
  } catch (err) {
    console.error(`Failed to refresh ${channelType} stats:`, err)
  }
}

export function useDashboard() {
  return {
    dashboardData,
    isLoading,
    isLoaded,
    loadDashboard,
    enableAutoRefresh,
    disableAutoRefresh,
    refreshChannels,
    refreshProxyStatus,
    refreshStats
  }
}
