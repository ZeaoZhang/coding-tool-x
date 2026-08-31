import { defineStore } from 'pinia'
import { ref, reactive, computed, toRef } from 'vue'
import axios from 'axios'
import { requestKey, requestSingleflight } from '../api/request-singleflight'
import { getPlatformApiPrefix, isLegacyPlatformKey, createPlatformApiError } from '../api/client'
import { useEnabledCliPlatforms } from '../composables/useEnabledCliPlatforms'
const ADVANCED_CONFIG_FLAG = '__ccAdvancedConfigBound__'
let ws = null
let reconnectAttempts = 0
let isReceivingHistory = false
let historyTimer = null
const channelSourceByName = Object.create(null)

function globalRequest(resource, platform, endpoint, params = {}, fallback) {
  const key = requestKey(resource, platform, '', '')
  return requestSingleflight(
    key,
    signal => axios.get(endpoint, { params, signal }),
    resource,
    `${resource}:${platform}`
  )
    .catch(() => fallback)
}

function computeTodayRange() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return {
    start: start.getTime(),
    end: start.getTime() + 24 * 60 * 60 * 1000
  }
}

function resolveLogTotal(source, data) {
  if (data.usageMissing) {
    return null
  }

  if (data.totalTokens !== undefined && data.totalTokens !== null) {
    return Number(data.totalTokens) || 0
  }

  const input = Number(data.inputTokens) || 0
  const output = Number(data.outputTokens) || 0
  const cacheCreation = Number(data.cacheCreation) || 0
  const cacheRead = Number(data.cacheRead) || 0

  if (source === 'claude') {
    return input + output + cacheCreation + cacheRead
  }

  return input + output
}

function resolveLogModel(data = {}) {
  const candidates = [
    data.model,
    data.redirectedModel,
    data.modelFromUrl,
    data.originalModel
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return ''
}
export const useGlobalStore = defineStore('global', () => {
  const { catalog, enabledKeys } = useEnabledCliPlatforms()
  const proxyStateByPlatform = reactive({})
  const channelsByPlatform = reactive({})
  const schedulerStateByPlatform = reactive({})
  const logsBySource = reactive({})
  const proxyStateRefs = new Map()
  const channelRefs = new Map()
  const shownBrowserNotificationIds = new Set()

  function normalizePlatformKey(value) {
    return String(value || '').trim().toLowerCase()
  }

  function isKnownPlatform(key) {
    const normalized = normalizePlatformKey(key)
    return Boolean(normalized) && catalog.value.some(platform => platform.key === normalized)
  }

  function isEnabledPlatform(key) {
    const normalized = normalizePlatformKey(key)
    return enabledKeys.value.includes(normalized)
  }

  function hasPlatformCapability(key, capability) {
    const normalized = normalizePlatformKey(key)
    return isKnownPlatform(normalized)
      && catalog.value.some(platform => (
        platform.key === normalized
        && platform.capabilities?.[capability] === true
      ))
  }

  function resolveEnabledKeys(keys) {
    const requested = Array.isArray(keys) ? keys : enabledKeys.value
    const allowed = new Set(enabledKeys.value)
    const result = []
    const seen = new Set()
    requested.forEach((value) => {
      const key = normalizePlatformKey(value)
      if (!key || seen.has(key) || !allowed.has(key)) return
      seen.add(key)
      result.push(key)
    })
    return result
  }

  function ensurePlatformState(platform) {
    const key = normalizePlatformKey(platform)
    if (!isKnownPlatform(key)) return null

    if (!proxyStateByPlatform[key]) {
      proxyStateByPlatform[key] = {
        running: false,
        loading: false,
        activeChannel: null,
        port: null,
        runtime: null,
        startTime: null,
        defaultPort: null
      }
    }
    if (!channelsByPlatform[key]) channelsByPlatform[key] = []
    if (!schedulerStateByPlatform[key]) {
      schedulerStateByPlatform[key] = { channels: [], pending: 0 }
    }
    if (!logsBySource[key]) logsBySource[key] = []
    return key
  }

  function getProxyState(platform) {
    const key = ensurePlatformState(platform)
    if (!key) return null
    if (!proxyStateRefs.has(key)) {
      proxyStateRefs.set(key, toRef(proxyStateByPlatform, key))
    }
    return proxyStateRefs.get(key)
  }

  function getChannels(platform) {
    const key = ensurePlatformState(platform)
    if (!key) return null
    if (!channelRefs.has(key)) {
      channelRefs.set(key, toRef(channelsByPlatform, key))
    }
    return channelRefs.get(key)
  }

  function getSchedulerState(platform) {
    const key = ensurePlatformState(platform)
    return key ? schedulerStateByPlatform[key] : null
  }

  function getSourceLogs(platform) {
    const key = ensurePlatformState(platform)
    return key ? logsBySource[key] : []
  }

  function rebuildChannelSourceCache() {
    Object.keys(channelSourceByName).forEach((key) => {
      delete channelSourceByName[key]
    })
    Object.entries(channelsByPlatform).forEach(([platform, channels]) => {
      channels.forEach((channel) => {
        if (channel?.name) channelSourceByName[channel.name] = platform
      })
    })
  }

  enabledKeys.value.forEach(ensurePlatformState)

  // 调度状态（实时并发信息）和日志均按平台 key 存储。
  const wsConnected = ref(false)
  const dashboardHydrated = ref(false)
  let hydratedPlatformSignature = ''
  let channelsHydratedSignature = ''
  const logLimit = ref(100)
  const statsInterval = ref(30)
  let loadChannelsPromise = null
  let maxLogsLimit = 100
  let todayRange = computeTodayRange()

  function ensureTodayRange() {
    const now = Date.now()
    if (now < todayRange.start || now >= todayRange.end) {
      todayRange = computeTodayRange()
      clearLogsState()
    }
  }

  function isToday(timestamp) {
    ensureTodayRange()
    return timestamp >= todayRange.start && timestamp < todayRange.end
  }

  function trimBuffer(buffer) {
    while (buffer.length > maxLogsLimit) {
      buffer.pop()
    }
  }

  function setMaxLogsLimit(limit) {
    maxLogsLimit = limit
    logLimit.value = limit
    Object.values(logsBySource).forEach(trimBuffer)
  }

  function setStatsIntervalValue(interval) {
    const parsed = parseInt(interval, 10)
    if (Number.isNaN(parsed)) return
    const clamped = Math.min(Math.max(parsed, 10), 300)
    if (statsInterval.value !== clamped) {
      statsInterval.value = clamped
    }
  }

  async function loadAdvancedConfig() {
    try {
      const response = await fetch('/api/config/advanced')
      if (response.ok) {
        const data = await response.json()
        setMaxLogsLimit(data.maxLogs || 100)
        if (data.statsInterval) {
          setStatsIntervalValue(data.statsInterval)
        }
      }
    } catch (err) {
      console.error('Failed to load advanced config:', err)
    }
  }

  function detectLogSource(data) {
    if (data.source) return normalizePlatformKey(data.source)

    if (data.toolType) {
      const toolType = normalizePlatformKey(data.toolType)
      return isKnownPlatform(toolType) ? toolType : ''
    }

    if (data.channel) {
      return channelSourceByName[data.channel] || ''
    }

    if (data.model) {
      const model = data.model.toLowerCase()
      if (model.includes('claude')) return 'claude'
      if (model.includes('gpt') || model.includes('o1') || model.includes('o3')) return 'codex'
      if (model.includes('gemini')) return 'gemini'
      if (model.includes('opencode') || model.includes('deepseek') || model.includes('qwen')) return 'opencode'
      if (model.includes('omp')) return 'omp'
    }

    if (data.action?.includes('opencode')) return 'opencode'
    if (data.action?.includes('omp')) return 'omp'
    if (data.action?.includes('codex')) return 'codex'
    if (data.action?.includes('gemini')) return 'gemini'
    if (data.action?.includes('claude')) return 'claude'
    return ''
  }


  function appendLogEntry(data) {
    const source = detectLogSource(data)
    if (!isKnownPlatform(source) || !isEnabledPlatform(source)) {
      console.warn('[GlobalState] 未识别或未启用来源日志，丢弃: ', data)
      return
    }
    const buffer = getSourceLogs(source)
    if (!buffer) {
      console.warn('[GlobalState] 未识别来源日志，丢弃: ', data)
      return
    }


    const timestamp = data.timestamp || Date.now()
    if (!isToday(timestamp)) {
      console.warn('[GlobalState] 丢弃非今日日志:', new Date(timestamp).toISOString())
      return
    }
    const time = data.time || new Date(timestamp).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })

    const entry = {
      id: data.id || `${Date.now()}-${Math.random()}`,
      source,
      type: data.type || (data.action ? 'action' : 'log'),
      status: data.status || (data.error ? 'error' : 'success'),
      action: data.action || null,
      channel: data.channel || data.channelName || 'Unknown',
      model: resolveLogModel(data),
      originalModel: data.originalModel || null,
      redirectedModel: data.redirectedModel || null,
      message: data.message,
      error: data.error || null,
      statusCode: data.statusCode || null,
      stage: data.stage || null,
      usageMissing: Boolean(data.usageMissing),
      timestamp,
      time,
      tokens: {
        input: data.inputTokens || 0,
        output: data.outputTokens || 0,
        cacheCreation: data.cacheCreation || 0,
        cacheRead: data.cacheRead || 0,
        cached: data.cachedTokens || 0,
        reasoning: data.reasoningTokens || 0,
        total: resolveLogTotal(source, data)
      },
      cost: data.cost || 0,
      isHistory: isReceivingHistory,
      isNew: !isReceivingHistory
    }

    buffer.unshift(entry)
    trimBuffer(buffer)

    if (entry.isNew) {
      setTimeout(() => {
        entry.isNew = false
      }, 4500)
    }
  }

  function clearLogsState() {
    Object.keys(logsBySource).forEach((key) => {
      logsBySource[key].splice(0, logsBySource[key].length)
    })
  }

  function getLogs(source) {
    return computed(() => getSourceLogs(source))
  }

  function clearLogsForSource(source) {
    if (logsBySource[source]) {
      logsBySource[source].splice(0, logsBySource[source].length)
    }
  }

  function patchProxyState(targetRef, proxy = {}, activeChannel) {
    targetRef.value = {
      ...targetRef.value,
      ...proxy,
      activeChannel: activeChannel || targetRef.value.activeChannel
    }
  }

  function mergeProxyChannels(existingChannels = [], incomingChannels = []) {
    if (!Array.isArray(incomingChannels)) {
      return existingChannels
    }

    const existingById = new Map(
      existingChannels
        .filter(channel => channel?.id)
        .map(channel => [channel.id, channel])
    )

    return incomingChannels.map((incoming) => {
      const existing = existingById.get(incoming?.id)
      if (!existing) {
        return incoming
      }
      if (!Object.prototype.hasOwnProperty.call(incoming, 'apiKey') && existing.apiKey) {
        return {
          ...existing,
          ...incoming,
          apiKey: existing.apiKey
        }
      }
      return {
        ...existing,
        ...incoming
      }
    })
  }

  function normalizeDashboardChannels(payload) {
    if (Array.isArray(payload)) return payload
    if (Array.isArray(payload?.channels)) return payload.channels
    return []
  }

  function setChannelsForSource(source, channels) {
    const channelRef = getChannels(source)
    if (!channelRef) return
    const normalized = normalizeDashboardChannels(channels)
    channelRef.value = mergeProxyChannels(channelRef.value, normalized)
  }

  function hydrateFromDashboard(data = {}) {
    const channelData = data.channels || {}
    Object.entries(channelData).forEach(([source, channels]) => {
      if (isEnabledPlatform(source)) {
        setChannelsForSource(source, channels)
      }
    })
    rebuildChannelSourceCache()

    const proxyStatus = data.proxyStatus || {}
    Object.entries(proxyStatus).forEach(([source, status]) => {
      if (!isEnabledPlatform(source) || !status || typeof status !== 'object') return
      const proxyRef = getProxyState(source)
      if (proxyRef) patchProxyState(proxyRef, status, status.activeChannel)
    })
    hydratedPlatformSignature = enabledKeys.value.join(',')
    dashboardHydrated.value = true
  }

  if (typeof window !== 'undefined' && !window[ADVANCED_CONFIG_FLAG]) {
    window.addEventListener('advanced-config-change', (event) => {
      if (event.detail?.maxLogs) {
        setMaxLogsLimit(event.detail.maxLogs)
      }
      if (event.detail?.statsInterval) {
        setStatsIntervalValue(event.detail.statsInterval)
      }
    })
    window[ADVANCED_CONFIG_FLAG] = true
  }

  function handleProxyStateUpdate(data) {
    const source = normalizePlatformKey(data?.source)
    if (!source || !isEnabledPlatform(source)) return

    const proxyRef = getProxyState(source)
    if (!proxyRef) return
    patchProxyState(proxyRef, data.proxy, data.activeChannel)
    if (data.channels) {
      setChannelsForSource(source, data.channels)
      rebuildChannelSourceCache()
    }
  }

  function handleSchedulerStateUpdate(data) {
    const source = normalizePlatformKey(data?.source)
    if (!source || !isEnabledPlatform(source) || !data.scheduler) return
    const state = getSchedulerState(source)
    if (state) {
      schedulerStateByPlatform[source] = data.scheduler
    }
  }
  function showBrowserNotification(data) {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') {
      return
    }

    if (Notification.permission !== 'granted') {
      return
    }

    const notificationId = data.id || `${data.source || 'claude'}-${data.timestamp || Date.now()}`
    if (shownBrowserNotificationIds.has(notificationId)) {
      return
    }
    shownBrowserNotificationIds.add(notificationId)

    const notification = new Notification(data.title || 'coding-tool-x', {
      body: data.message || '任务已完成',
      tag: notificationId,
      icon: '/logo.png'
    })

    notification.onclick = () => {
      try {
        window.focus()
        if (data.url) {
          window.location.assign(data.url)
        }
      } catch (err) {
        console.error('Failed to handle browser notification click:', err)
      }
    }
  }

  async function initializeState() {
    const platformSignature = enabledKeys.value.join(',')
    if (dashboardHydrated.value && hydratedPlatformSignature === platformSignature) return
    const keys = resolveEnabledKeys().filter(key => hasPlatformCapability(key, 'proxy'))
    try {
      const responses = await Promise.all(keys.map((key) => {
        const prefix = getPlatformApiPrefix(key)
        return globalRequest(
          'proxy-status',
          key,
          `/api${prefix}/proxy/status`,
          {},
          { data: {} }
        )
      }))
      responses.forEach((response, index) => {
        const payload = response?.data || {}
        const proxyRef = getProxyState(keys[index])
        if (proxyRef && payload.proxy) {
          patchProxyState(proxyRef, payload.proxy, payload.activeChannel)
        }
      })
      hydratedPlatformSignature = platformSignature
      dashboardHydrated.value = true
    } catch (error) {
      console.error('Failed to initialize global state:', error)
    }
  }

  async function loadChannels(options = {}) {
    const keys = resolveEnabledKeys(options.keys).filter(key => hasPlatformCapability(key, 'channels'))
    if (channelsHydratedSignature === enabledKeys.value.join(',') && !options.force) {
      return {
        success: true,
        channels: Object.fromEntries(keys.map(key => [key, getChannels(key)?.value || []]))
      }
    }
    const requestSignature = enabledKeys.value.join(',')
    const hydrateAllChannels = !Array.isArray(options.keys)
    if (loadChannelsPromise) return loadChannelsPromise
    loadChannelsPromise = _loadChannels(keys).then((result) => {
      if (hydrateAllChannels) channelsHydratedSignature = requestSignature
      return result
    }).finally(() => {
      loadChannelsPromise = null
    })
    return loadChannelsPromise
  }

  async function _loadChannels(keys) {
    try {
      const responses = await Promise.all(keys.map(async (key) => {
        const prefix = getPlatformApiPrefix(key)
        const channelResponse = globalRequest(
          'channels',
          key,
          `/api${prefix}/channels`,
          {},
          { data: { channels: [] } }
        )
        const poolResponse = isLegacyPlatformKey(key)
          ? globalRequest(
            'channel-pool',
            key,
            `/api${prefix}/channels/pool/status?source=${encodeURIComponent(key)}`,
            {},
            { data: null }
          )
          : Promise.resolve({ data: null })
        return {
          key,
          channelResponse: await channelResponse,
          poolResponse: await poolResponse
        }
      }))

      responses.forEach(({ key, channelResponse, poolResponse }) => {
        const payload = channelResponse?.data
        setChannelsForSource(key, Array.isArray(payload) ? payload : payload?.channels)
        if (poolResponse?.data?.scheduler) {
          schedulerStateByPlatform[key] = poolResponse.data.scheduler
        }
      })
      rebuildChannelSourceCache()
      return {
        success: true,
        channels: Object.fromEntries(keys.map(key => [key, getChannels(key)?.value || []]))
      }
    } catch (error) {
      console.error('Failed to load channels:', error)
      return {
        success: false,
        channels: Object.fromEntries(keys.map(key => [key, getChannels(key)?.value || []]))
      }
    }
  }

  async function startProxy(type) {
    const key = normalizePlatformKey(type)
    if (!isEnabledPlatform(key) || !hasPlatformCapability(key, 'proxy')) {
      throw createPlatformApiError(key, 'unsupported')
    }
    const proxyRef = getProxyState(key)
    if (!proxyRef) throw createPlatformApiError(key, 'not_found')
    const response = await axios.post(`/api${getPlatformApiPrefix(key)}/proxy/start`)
    if (response.data.success) {
      proxyRef.value.running = true
      proxyRef.value.activeChannel = response.data.activeChannel
      proxyRef.value.startTime = Date.now()
    }
    return response.data
  }

  async function stopProxy(type, options = {}) {
    const key = normalizePlatformKey(type)
    if (!isEnabledPlatform(key) || !hasPlatformCapability(key, 'proxy')) {
      throw createPlatformApiError(key, 'unsupported')
    }
    const proxyRef = getProxyState(key)
    if (!proxyRef) throw createPlatformApiError(key, 'not_found')
    const response = await axios.post(`/api${getPlatformApiPrefix(key)}/proxy/stop`)
    proxyRef.value.running = false
    proxyRef.value.activeChannel = null
    proxyRef.value.startTime = null
    proxyRef.value.runtime = null

    if (response.data?.success !== false) {
      await loadChannels({ force: true, keys: [key] })
    }

    if (options.refreshChannelsDrawer && response.data?.success !== false && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('channel-management-refresh', {
        detail: { channel: key, reason: 'proxy-stop' }
      }))
    }

    return response.data
  }

  function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      return
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`

    try {
      ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        reconnectAttempts = 0
        wsConnected.value = true
        isReceivingHistory = true
        clearTimeout(historyTimer)
        historyTimer = setTimeout(() => {
          isReceivingHistory = false
        }, 2000)
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'proxy-state') {
            handleProxyStateUpdate(data)
          } else if (data.type === 'scheduler-state') {
            handleSchedulerStateUpdate(data)
          } else if (data.type === 'browser-notification') {
            showBrowserNotification(data)
          } else {
            appendLogEntry(data)
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err)
        }
      }

      ws.onclose = () => {
        wsConnected.value = false
        ws = null
        isReceivingHistory = false
        clearTimeout(historyTimer)
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000)
        reconnectAttempts += 1
        setTimeout(connectWebSocket, delay)
      }

      ws.onerror = (error) => {
        wsConnected.value = false
        console.error('WebSocket error:', error)
      }
    } catch (error) {
      wsConnected.value = false
      console.error('Failed to connect WebSocket:', error)
    }
  }

  return {
    proxyStateByPlatform,
    channelsByPlatform,
    schedulerStateByPlatform,
    logsBySource,
    ensurePlatformState,
    connectWebSocket,
    initializeState,
    loadChannels,
    getProxyState,
    getChannels,
    getSchedulerState,
    handleProxyStateUpdate,
    hydrateFromDashboard,
    startProxy,
    stopProxy,
    getLogs,
    wsConnected,
    dashboardHydrated,
    clearLogsState,
    clearLogsForSource,
    logLimit,
    statsInterval,
    loadAdvancedConfig
  }
})

let isInitialized = false

export function initializeGlobalStore() {
  if (isInitialized) return
  const store = useGlobalStore()
  store.connectWebSocket()
  queueMicrotask(() => {
    const runDeferredLoads = () => {
      store.loadAdvancedConfig()
    }

    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(runDeferredLoads, { timeout: 1000 })
      return
    }
    setTimeout(runDeferredLoads, 0)
  })
  isInitialized = true
}
