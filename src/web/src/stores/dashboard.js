import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useGlobalStore } from './global'
import { getDashboardInit } from '../api/dashboard'
import { getPlatformChannels } from '../api/channels'
import { getPlatformProxyStatus } from '../api/proxy'
import { getPlatformTodayStatistics } from '../api/statistics'
import { useEnabledCliPlatforms } from '../composables/useEnabledCliPlatforms'
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
  const { enabledKeys, getPlatform } = useEnabledCliPlatforms()
  const dashboardData = ref({
    uiConfig: null,
    favorites: null,
    channels: {},
    proxyStatus: {},
    todayStats: {},
    counts: {},
    meta: null
  })
  const isLoading = ref(false)
  const isLoaded = ref(false)

  let loadPromise = null
  let loadedPlatformSignature = ''
  let refreshWindowPromise = null
  let refreshWindowUntil = 0
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

  function enabledPlatformKeys() {
    return enabledKeys.value
  }

  function mapEnabledPlatforms(source, normalize = value => value) {
    const input = source && typeof source === 'object' ? source : {}
    return Object.fromEntries(
      enabledPlatformKeys().map(key => [key, normalize(input[key])])
    )
  }

  function hasEnabledPlatform(channelType) {
    const key = String(channelType || '').trim().toLowerCase()
    return enabledPlatformKeys().includes(key) ? key : null
  }
  function hasEnabledCapability(channelType, capability) {
    const key = hasEnabledPlatform(channelType)
    return key && getPlatform(key)?.capabilities?.[capability] === true ? key : null
  }
  async function loadDashboard(force = false, options = {}) {
    const platformSignature = enabledPlatformKeys().join(',')
    if (isLoaded.value && !force && loadedPlatformSignature === platformSignature) {
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
        const selectedKeys = enabledPlatformKeys()

        dashboardData.value = {
          uiConfig: data.uiConfig || null,
          favorites: data.favorites || null,
          channels: mapEnabledPlatforms(data.channels, normalizeChannels),
          proxyStatus: mapEnabledPlatforms(
            data.proxyStatus,
            value => value && typeof value === 'object' ? value : {}
          ),
          todayStats: mapEnabledPlatforms(data.todayStats, normalizeStats),
          counts: mapEnabledPlatforms(
            data.counts,
            value => value && typeof value === 'object' ? value : emptyCounts()
          ),
          meta: data.meta || null
        }

        // Keep this local assertion useful when the selection is empty: the
        // maps above intentionally remain empty rather than restoring defaults.
        if (selectedKeys.length === 0) {
          dashboardData.value.channels = {}
          dashboardData.value.proxyStatus = {}
          dashboardData.value.todayStats = {}
          dashboardData.value.counts = {}
        }

        try {
          useGlobalStore().hydrateFromDashboard(dashboardData.value)
        } catch (err) {
          console.error('Failed to hydrate global store from dashboard:', err)
        }
        scheduleSnapshotRefresh(dashboardData.value.meta)

        loadedPlatformSignature = platformSignature
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

  function scheduleRefresh(options = {}) {
    const now = Date.now()
    if (refreshWindowPromise) return refreshWindowPromise
    if (now < refreshWindowUntil) return Promise.resolve(dashboardData.value)

    refreshWindowUntil = now + 5000
    refreshWindowPromise = loadDashboard(true, options).finally(() => {
      refreshWindowPromise = null
    })
    return refreshWindowPromise
  }

  async function refreshChannels(channelType) {
    const key = hasEnabledCapability(channelType, 'channels')
    if (!key) return
    try {
      const response = await getPlatformChannels(key)
      dashboardData.value.channels[key] = normalizeChannels(response)
    } catch (err) {
      console.error(`Failed to refresh ${key} channels:`, err)
    }
  }

  async function refreshProxyStatus(channelType) {
    const key = hasEnabledCapability(channelType, 'proxy')
    if (!key) return
    try {
      dashboardData.value.proxyStatus[key] = await getPlatformProxyStatus(key)
    } catch (err) {
      console.error(`Failed to refresh ${key} proxy status:`, err)
    }
  }

  async function refreshStats(channelType) {
    const key = hasEnabledCapability(channelType, 'statistics')
    if (!key) return
    try {
      const response = await getPlatformTodayStatistics(key)
      const summary = response?.summary || {}
      dashboardData.value.todayStats[key] = normalizeStats({
        requests: summary.requests || 0,
        tokens: summary.tokens || 0,
        cost: summary.cost || 0,
        byModel: response?.byModel || {},
        byChannel: response?.byChannel || {}
      })
    } catch (err) {
      console.error(`Failed to refresh ${key} stats:`, err)
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
