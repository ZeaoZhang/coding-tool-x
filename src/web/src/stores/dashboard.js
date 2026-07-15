import { ref } from 'vue'
import { defineStore } from 'pinia'
import { getDashboardInit } from '../api/dashboard'
import api from '../api'
import { useGlobalStore } from './global'

const emptyCounts = () => ({ projectCount: 0, sessionCount: 0 })
const emptyStats = () => ({ requests: 0, tokens: 0, cost: 0, byModel: {}, byChannel: {} })

function normalizeChannels(value) {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.channels)) return value.channels
  return []
}

function normalizeChannelStats(byChannel = {}) {
  if (!byChannel || typeof byChannel !== 'object') return {}
  return Object.fromEntries(Object.entries(byChannel).map(([channelId, item = {}]) => {
    const tokenValue = typeof item.tokens === 'object'
      ? item.tokens?.total
      : item.tokens
    return [channelId, {
      ...item,
      requests: item.requests || 0,
      tokens: tokenValue || 0,
      cost: item.cost || 0
    }]
  }))
}

function normalizeStats(stats = {}) {
  return {
    requests: stats.requests || 0,
    tokens: stats.tokens || 0,
    cost: stats.cost || 0,
    byModel: stats.byModel || {},
    byChannel: normalizeChannelStats(stats.byChannel)
  }
}

export const useDashboardStore = defineStore('dashboard', () => {
  const dashboardData = ref({
    uiConfig: null,
    favorites: null,
    channels: {
      claude: [],
      codex: [],
      gemini: [],
      opencode: [],
      omp: []
    },
    proxyStatus: {
      claude: {},
      codex: {},
      gemini: {},
      opencode: {},
      omp: {}
    },
    todayStats: {
      claude: emptyStats(),
      codex: emptyStats(),
      gemini: emptyStats(),
      opencode: emptyStats(),
      omp: emptyStats()
    },
    counts: {
      claude: emptyCounts(),
      codex: emptyCounts(),
      gemini: emptyCounts(),
      opencode: emptyCounts(),
      omp: emptyCounts()
    },
    meta: null
  })

  const isLoading = ref(false)
  const isLoaded = ref(false)
  let loadPromise = null
  let snapshotRefreshTimer = null
  let snapshotRefreshAttempt = 0

  let autoRefreshIntervalId = null
  const AUTO_REFRESH_INTERVAL = 5 * 60 * 1000
  const MAX_SNAPSHOT_REFRESH_ATTEMPTS = 8

  function clearSnapshotRefreshTimer() {
    if (snapshotRefreshTimer) {
      clearTimeout(snapshotRefreshTimer)
      snapshotRefreshTimer = null
    }
  }

  function scheduleSnapshotRefresh(meta) {
    if (!meta?.refreshing) {
      snapshotRefreshAttempt = 0
      clearSnapshotRefreshTimer()
      return
    }
    if (snapshotRefreshAttempt >= MAX_SNAPSHOT_REFRESH_ATTEMPTS || snapshotRefreshTimer) return

    const attempt = snapshotRefreshAttempt
    snapshotRefreshAttempt += 1
    snapshotRefreshTimer = setTimeout(() => {
      snapshotRefreshTimer = null
      loadDashboard(true, { fresh: false }).catch(() => {})
    }, Math.min(1200 + attempt * 1200, 5000))
  }

  function ensureAutoRefreshDisabled() {
    if (autoRefreshIntervalId) {
      clearInterval(autoRefreshIntervalId)
      autoRefreshIntervalId = null
    }
  }

  function enableAutoRefresh() {
    if (autoRefreshIntervalId) return
    autoRefreshIntervalId = setInterval(() => {
      loadDashboard(true, { fresh: true }).catch(() => {})
    }, AUTO_REFRESH_INTERVAL)
  }

  function disableAutoRefresh() {
    ensureAutoRefreshDisabled()
  }

  async function loadDashboard(force = false, options = {}) {
    if (isLoaded.value && !force) {
      return dashboardData.value
    }
    if (loadPromise) {
      return loadPromise
    }

    isLoading.value = true
    loadPromise = (async () => {
      try {
        const response = await getDashboardInit({ fresh: options.fresh === true })
        if (!response || response.success === false) {
          throw new Error(response?.message || 'Failed to load dashboard')
        }

        const data = response.data || {}

        dashboardData.value = {
          uiConfig: data.uiConfig || null,
          favorites: data.favorites || null,
          channels: {
            claude: normalizeChannels(data.channels?.claude),
            codex: normalizeChannels(data.channels?.codex),
            gemini: normalizeChannels(data.channels?.gemini),
            opencode: normalizeChannels(data.channels?.opencode),
            omp: normalizeChannels(data.channels?.omp)
          },
          proxyStatus: {
            claude: data.proxyStatus?.claude || {},
            codex: data.proxyStatus?.codex || {},
            gemini: data.proxyStatus?.gemini || {},
            opencode: data.proxyStatus?.opencode || {},
            omp: data.proxyStatus?.omp || {}
          },
          todayStats: {
            claude: normalizeStats(data.todayStats?.claude),
            codex: normalizeStats(data.todayStats?.codex),
            gemini: normalizeStats(data.todayStats?.gemini),
            opencode: normalizeStats(data.todayStats?.opencode),
            omp: normalizeStats(data.todayStats?.omp)
          },
          counts: {
            claude: data.counts?.claude || emptyCounts(),
            codex: data.counts?.codex || emptyCounts(),
            gemini: data.counts?.gemini || emptyCounts(),
            opencode: data.counts?.opencode || emptyCounts(),
            omp: data.counts?.omp || emptyCounts()
          },
          meta: data.meta || null
        }

        try {
          useGlobalStore().hydrateFromDashboard(dashboardData.value)
        } catch (err) {
          console.error('Failed to hydrate global store from dashboard:', err)
        }
        scheduleSnapshotRefresh(dashboardData.value.meta)

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
      } else if (channelType === 'omp') {
        const response = await api.getOmpChannels()
        if (response.success) dashboardData.value.channels.omp = response.channels
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
      } else if (channelType === 'omp') {
        const response = await api.getOmpProxyStatus()
        if (response.success) dashboardData.value.proxyStatus.omp = response
      }
    } catch (err) {
      console.error(`Failed to refresh ${channelType} proxy status:`, err)
    }
  }

  async function refreshStats(channelType) {
    try {
      const parseStats = (response = {}) => {
        const summary = response.summary || {}
        return normalizeStats({
          requests: summary.requests || 0,
          tokens: summary.tokens || 0,
          cost: summary.cost || 0,
          byModel: response.byModel || {},
          byChannel: response.byChannel || {}
        })
      }

      if (channelType === 'claude') {
        const response = await api.getClaudeTodayStatistics()
        dashboardData.value.todayStats.claude = parseStats(response)
      } else if (channelType === 'codex') {
        const response = await api.getCodexTodayStatistics()
        dashboardData.value.todayStats.codex = parseStats(response)
      } else if (channelType === 'gemini') {
        const response = await api.getGeminiTodayStatistics()
        dashboardData.value.todayStats.gemini = parseStats(response)
      } else if (channelType === 'opencode') {
        const response = await api.getOpenCodeTodayStatistics()
        dashboardData.value.todayStats.opencode = parseStats(response)
      } else if (channelType === 'omp') {
        const response = await api.getOmpTodayStatistics()
        dashboardData.value.todayStats.omp = parseStats(response)
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
