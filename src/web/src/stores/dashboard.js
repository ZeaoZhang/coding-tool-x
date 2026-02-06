import { ref } from 'vue'
import { defineStore } from 'pinia'
import { getDashboardInit } from '../api/dashboard'
import api from '../api'

const emptyCounts = () => ({ projectCount: 0, sessionCount: 0 })
const emptyStats = () => ({ requests: 0, tokens: 0, cost: 0, byModel: {} })

export const useDashboardStore = defineStore('dashboard', () => {
  const dashboardData = ref({
    uiConfig: null,
    favorites: null,
    channels: {
      claude: [],
      codex: [],
      gemini: [],
      opencode: []
    },
    proxyStatus: {
      claude: {},
      codex: {},
      gemini: {},
      opencode: {}
    },
    todayStats: {
      claude: emptyStats(),
      codex: emptyStats(),
      gemini: emptyStats(),
      opencode: emptyStats()
    },
    counts: {
      claude: emptyCounts(),
      codex: emptyCounts(),
      gemini: emptyCounts(),
      opencode: emptyCounts()
    }
  })

  const isLoading = ref(false)
  const isLoaded = ref(false)
  let loadPromise = null

  let autoRefreshIntervalId = null
  const AUTO_REFRESH_INTERVAL = 5 * 60 * 1000

  function ensureAutoRefreshDisabled() {
    if (autoRefreshIntervalId) {
      clearInterval(autoRefreshIntervalId)
      autoRefreshIntervalId = null
    }
  }

  function enableAutoRefresh() {
    if (autoRefreshIntervalId) return
    autoRefreshIntervalId = setInterval(() => {
      loadDashboard(true).catch(() => {})
    }, AUTO_REFRESH_INTERVAL)
  }

  function disableAutoRefresh() {
    ensureAutoRefreshDisabled()
  }

  async function loadDashboard(force = false) {
    if (isLoaded.value && !force) {
      return dashboardData.value
    }
    if (loadPromise && !force) {
      return loadPromise
    }

    isLoading.value = true
    loadPromise = (async () => {
      try {
        const response = await getDashboardInit()
        if (!response || response.success === false) {
          throw new Error(response?.message || 'Failed to load dashboard')
        }

        const data = response.data || {}
        const formatStats = (stats = {}) => ({
          requests: stats.requests || 0,
          tokens: stats.tokens || 0,
          cost: stats.cost || 0,
          byModel: stats.byModel || {}
        })

        dashboardData.value = {
          uiConfig: data.uiConfig || null,
          favorites: data.favorites || null,
          channels: {
            claude: data.channels?.claude || [],
            codex: data.channels?.codex || [],
            gemini: data.channels?.gemini || [],
            opencode: data.channels?.opencode || []
          },
          proxyStatus: {
            claude: data.proxyStatus?.claude || {},
            codex: data.proxyStatus?.codex || {},
            gemini: data.proxyStatus?.gemini || {},
            opencode: data.proxyStatus?.opencode || {}
          },
          todayStats: {
            claude: formatStats(data.todayStats?.claude),
            codex: formatStats(data.todayStats?.codex),
            gemini: formatStats(data.todayStats?.gemini),
            opencode: formatStats(data.todayStats?.opencode)
          },
          counts: {
            claude: data.counts?.claude || emptyCounts(),
            codex: data.counts?.codex || emptyCounts(),
            gemini: data.counts?.gemini || emptyCounts(),
            opencode: data.counts?.opencode || emptyCounts()
          }
        }

        isLoaded.value = true
        return dashboardData.value
      } finally {
        isLoading.value = false
        loadPromise = null
      }
    })().catch((err) => {
      console.error('Failed to load dashboard:', err)
      throw err
    })

    return loadPromise
  }

  async function refreshChannels(channelType) {
    try {
      if (channelType === 'claude') {
        const response = await api.getChannels()
        if (response.success) dashboardData.value.channels.claude = response.channels
      } else if (channelType === 'codex') {
        const response = await api.getCodexChannels()
        if (response.success) dashboardData.value.channels.codex = response.channels
      } else if (channelType === 'gemini') {
        const response = await api.getGeminiChannels()
        if (response.success) dashboardData.value.channels.gemini = response.channels
      } else if (channelType === 'opencode') {
        const response = await api.getOpenCodeChannels()
        if (response.success) dashboardData.value.channels.opencode = response.channels
      }
    } catch (err) {
      console.error(`Failed to refresh ${channelType} channels:`, err)
    }
  }

  async function refreshProxyStatus(channelType) {
    try {
      if (channelType === 'claude') {
        const response = await api.getProxyStatus()
        if (response.success) dashboardData.value.proxyStatus.claude = response
      } else if (channelType === 'codex') {
        const response = await api.getCodexProxyStatus()
        if (response.success) dashboardData.value.proxyStatus.codex = response
      } else if (channelType === 'gemini') {
        const response = await api.getGeminiProxyStatus()
        if (response.success) dashboardData.value.proxyStatus.gemini = response
      } else if (channelType === 'opencode') {
        const response = await api.getOpenCodeProxyStatus()
        if (response.success) dashboardData.value.proxyStatus.opencode = response
      }
    } catch (err) {
      console.error(`Failed to refresh ${channelType} proxy status:`, err)
    }
  }

  async function refreshStats(channelType) {
    try {
      if (channelType === 'claude') {
        const response = await api.getTodayStatistics()
        if (response.success) {
          const summary = response.summary || {}
          dashboardData.value.todayStats.claude = {
            requests: summary.requests || 0,
            tokens: summary.tokens || 0,
            cost: summary.cost || 0
          }
        }
      } else if (channelType === 'codex') {
        const response = await api.getCodexTodayStatistics()
        if (response.success) {
          dashboardData.value.todayStats.codex = {
            requests: response.requests || 0,
            tokens: response.tokens || 0,
            cost: response.cost || 0
          }
        }
      } else if (channelType === 'gemini') {
        const response = await api.getGeminiTodayStatistics()
        if (response.success) {
          dashboardData.value.todayStats.gemini = {
            requests: response.requests || 0,
            tokens: response.tokens || 0,
            cost: response.cost || 0
          }
        }
      } else if (channelType === 'opencode') {
        const response = await api.getOpenCodeTodayStatistics()
        if (response.success) {
          dashboardData.value.todayStats.opencode = {
            requests: response.requests || 0,
            tokens: response.tokens || 0,
            cost: response.cost || 0
          }
        }
      }
    } catch (err) {
      console.error(`Failed to refresh ${channelType} stats:`, err)
    }
  }

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
})
