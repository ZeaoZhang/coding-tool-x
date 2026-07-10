import { defineStore } from 'pinia'
import { ref, reactive, computed } from 'vue'
import axios from 'axios'

const ADVANCED_CONFIG_FLAG = '__ccAdvancedConfigBound__'
let ws = null
let reconnectAttempts = 0
let isReceivingHistory = false
let historyTimer = null
const channelSourceByName = Object.create(null)
const shownBrowserNotificationIds = new Set()

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
  const claudeProxy = ref({
    running: false,
    loading: false,
    activeChannel: null,
    port: 20088,
    runtime: null,
    startTime: null,
    defaultPort: 20088
  })

  const codexProxy = ref({
    running: false,
    loading: false,
    activeChannel: null,
    port: 20089,
    runtime: null,
    startTime: null,
    defaultPort: 20089
  })

  const geminiProxy = ref({
    running: false,
    loading: false,
    activeChannel: null,
    port: 20090,
    runtime: null,
    startTime: null,
    defaultPort: 20090
  })

  const opencodeProxy = ref({
    running: false,
    loading: false,
    activeChannel: null,
    port: 20091,
    runtime: null,
    startTime: null,
    defaultPort: 20091
  })

  const ompProxy = ref({
    running: false,
    loading: false,
    activeChannel: null,
    port: 20092,
    runtime: null,
    startTime: null,
    defaultPort: 20092
  })

  const claudeChannels = ref([])
  const codexChannels = ref([])
  const geminiChannels = ref([])
  const opencodeChannels = ref([])
  const ompChannels = ref([])

  function rebuildChannelSourceCache() {
    Object.keys(channelSourceByName).forEach((key) => {
      delete channelSourceByName[key]
    })
    claudeChannels.value.forEach((ch) => {
      if (ch?.name) channelSourceByName[ch.name] = 'claude'
    })
    codexChannels.value.forEach((ch) => {
      if (ch?.name) channelSourceByName[ch.name] = 'codex'
    })
    geminiChannels.value.forEach((ch) => {
      if (ch?.name) channelSourceByName[ch.name] = 'gemini'
    })
    opencodeChannels.value.forEach((ch) => {
      if (ch?.name) channelSourceByName[ch.name] = 'opencode'
    })
    ompChannels.value.forEach((ch) => {
      if (ch?.name) channelSourceByName[ch.name] = 'omp'
    })
  }

  // 调度状态（实时并发信息）
  const schedulerState = reactive({
    claude: { channels: [], pending: 0 },
    codex: { channels: [], pending: 0 },
    gemini: { channels: [], pending: 0 },
    opencode: { channels: [], pending: 0 },
    omp: { channels: [], pending: 0 }
  })

  const logsBySource = reactive({
    claude: [],
    codex: [],
    gemini: [],
    opencode: [],
    omp: []
  })
  const wsConnected = ref(false)
  const logLimit = ref(100)
  const statsInterval = ref(30)
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
    if (data.source) return data.source

    if (data.toolType === 'opencode') return 'opencode'
    if (data.toolType === 'omp') return 'omp'
    if (data.toolType === 'codex') return 'codex'
    if (data.toolType === 'gemini') return 'gemini'
    if (data.toolType === 'claude' || data.toolType === 'claude-code') return 'claude'

    if (data.model) {
      const model = data.model.toLowerCase()
      if (model.includes('claude')) return 'claude'
      if (model.includes('gpt') || model.includes('o1') || model.includes('o3')) return 'codex'
      if (model.includes('gemini')) return 'gemini'
      if (model.includes('opencode') || model.includes('deepseek') || model.includes('qwen')) return 'opencode'
      if (model.includes('omp')) return 'omp'
    }

    if (data.channel) {
      const source = channelSourceByName[data.channel]
      if (source) return source
    }

    if (data.action?.includes('opencode')) return 'opencode'
    if (data.action?.includes('omp')) return 'omp'
    if (data.action?.includes('codex')) return 'codex'
    if (data.action?.includes('gemini')) return 'gemini'
    return 'claude'
  }

  function appendLogEntry(data) {
    const source = detectLogSource(data)
    const buffer = logsBySource[source]
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
    return computed(() => logsBySource[source] || [])
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
    const { source, proxy, activeChannel, channels } = data

    if (source === 'claude') {
      patchProxyState(claudeProxy, proxy, activeChannel)
      if (channels) {
        claudeChannels.value = mergeProxyChannels(claudeChannels.value, channels)
        rebuildChannelSourceCache()
      }
    } else if (source === 'codex') {
      patchProxyState(codexProxy, proxy, activeChannel)
      if (channels) {
        codexChannels.value = mergeProxyChannels(codexChannels.value, channels)
        rebuildChannelSourceCache()
      }
    } else if (source === 'gemini') {
      patchProxyState(geminiProxy, proxy, activeChannel)
      if (channels) {
        geminiChannels.value = mergeProxyChannels(geminiChannels.value, channels)
        rebuildChannelSourceCache()
      }
    } else if (source === 'opencode') {
      patchProxyState(opencodeProxy, proxy, activeChannel)
      if (channels) {
        opencodeChannels.value = mergeProxyChannels(opencodeChannels.value, channels)
        rebuildChannelSourceCache()
      }
    } else if (source === 'omp') {
      patchProxyState(ompProxy, proxy, activeChannel)
      if (channels) {
        ompChannels.value = mergeProxyChannels(ompChannels.value, channels)
        rebuildChannelSourceCache()
      }
    }
  }

  function handleSchedulerStateUpdate(data) {
    const { source, scheduler } = data
    if (schedulerState[source] && scheduler) {
      schedulerState[source] = scheduler
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
    try {
      const [claudeRes, codexRes, geminiRes, opencodeRes, ompRes] = await Promise.all([
        axios.get('/api/proxy/status').catch(() => ({})),
        axios.get('/api/codex/proxy/status').catch(() => ({})),
        axios.get('/api/gemini/proxy/status').catch(() => ({})),
        axios.get('/api/opencode/proxy/status').catch(() => ({})),
        axios.get('/api/omp/proxy/status').catch(() => ({}))
      ])

      if (claudeRes.data?.proxy) {
        patchProxyState(claudeProxy, claudeRes.data.proxy, claudeRes.data.activeChannel)
      }
      if (codexRes.data?.proxy) {
        patchProxyState(codexProxy, codexRes.data.proxy, codexRes.data.activeChannel)
      }
      if (geminiRes.data?.proxy) {
        patchProxyState(geminiProxy, geminiRes.data.proxy, geminiRes.data.activeChannel)
      }
      if (opencodeRes.data?.proxy) {
        patchProxyState(opencodeProxy, opencodeRes.data.proxy, opencodeRes.data.activeChannel)
      }
      if (ompRes.data?.proxy) {
        patchProxyState(ompProxy, ompRes.data.proxy, ompRes.data.activeChannel)
      }
    } catch (error) {
      console.error('Failed to initialize global state:', error)
    }
  }

  async function loadChannels() {
    try {
      const [claudeRes, codexRes, geminiRes, opencodeRes, ompRes, claudePool, codexPool, geminiPool, opencodePool, ompPool] = await Promise.all([
        axios.get('/api/channels').catch(() => ({ data: { channels: [] } })),
        axios.get('/api/codex/channels').catch(() => ({ data: { channels: [] } })),
        axios.get('/api/gemini/channels').catch(() => ({ data: { channels: [] } })),
        axios.get('/api/opencode/channels').catch(() => ({ data: { channels: [] } })),
        axios.get('/api/omp/channels').catch(() => ({ data: { channels: [] } })),
        axios.get('/api/channels/pool/status?source=claude').catch(() => ({ data: null })),
        axios.get('/api/channels/pool/status?source=codex').catch(() => ({ data: null })),
        axios.get('/api/channels/pool/status?source=gemini').catch(() => ({ data: null })),
        axios.get('/api/channels/pool/status?source=opencode').catch(() => ({ data: null })),
        axios.get('/api/channels/pool/status?source=omp').catch(() => ({ data: null }))
      ])

      claudeChannels.value = claudeRes.data.channels || []
      codexChannels.value = codexRes.data.channels || []
      geminiChannels.value = geminiRes.data.channels || []
      opencodeChannels.value = opencodeRes.data.channels || []
      ompChannels.value = ompRes.data.channels || []
      rebuildChannelSourceCache()

      if (claudePool.data?.scheduler) {
        schedulerState.claude = claudePool.data.scheduler
      }
      if (codexPool.data?.scheduler) {
        schedulerState.codex = codexPool.data.scheduler
      }
      if (geminiPool.data?.scheduler) {
        schedulerState.gemini = geminiPool.data.scheduler
      }
      if (opencodePool.data?.scheduler) {
        schedulerState.opencode = opencodePool.data.scheduler
      }
      if (ompPool.data?.scheduler) {
        schedulerState.omp = ompPool.data.scheduler
      }
    } catch (error) {
      console.error('Failed to load channels:', error)
    }
  }

  function getProxyState(type) {
    if (type === 'codex') return codexProxy
    if (type === 'gemini') return geminiProxy
    if (type === 'opencode') return opencodeProxy
    if (type === 'omp') return ompProxy
    return claudeProxy
  }

  function getChannels(type) {
    if (type === 'codex') return codexChannels
    if (type === 'gemini') return geminiChannels
    if (type === 'opencode') return opencodeChannels
    if (type === 'omp') return ompChannels
    return claudeChannels
  }

  function getSchedulerState(type) {
    return schedulerState[type] || { channels: [], pending: 0 }
  }

  async function startProxy(type) {
    let endpoint
    if (type === 'codex') {
      endpoint = '/api/codex/proxy/start'
    } else if (type === 'gemini') {
      endpoint = '/api/gemini/proxy/start'
    } else if (type === 'opencode') {
      endpoint = '/api/opencode/proxy/start'
    } else if (type === 'omp') {
      endpoint = '/api/omp/proxy/start'
    } else {
      endpoint = '/api/proxy/start'
    }

    const response = await axios.post(endpoint)
    if (response.data.success) {
      const proxyState = getProxyState(type)
      proxyState.value.running = true
      proxyState.value.activeChannel = response.data.activeChannel
      proxyState.value.startTime = Date.now()
    }
    return response.data
  }

  async function stopProxy(type, options = {}) {
    let endpoint
    if (type === 'codex') {
      endpoint = '/api/codex/proxy/stop'
    } else if (type === 'gemini') {
      endpoint = '/api/gemini/proxy/stop'
    } else if (type === 'opencode') {
      endpoint = '/api/opencode/proxy/stop'
    } else if (type === 'omp') {
      endpoint = '/api/omp/proxy/stop'
    } else {
      endpoint = '/api/proxy/stop'
    }

    const response = await axios.post(endpoint)
    const proxyState = getProxyState(type)
    proxyState.value.running = false
    proxyState.value.activeChannel = null
    proxyState.value.startTime = null
    proxyState.value.runtime = null

    if (response.data?.success !== false) {
      await loadChannels()
    }

    if (options.refreshChannelsDrawer && response.data?.success !== false && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('channel-management-refresh', {
        detail: { channel: type, reason: 'proxy-stop' }
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
        initializeState()
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
    claudeProxy,
    codexProxy,
    geminiProxy,
    opencodeProxy,
    ompProxy,
    claudeChannels,
    codexChannels,
    geminiChannels,
    opencodeChannels,
    ompChannels,
    schedulerState,
    connectWebSocket,
    initializeState,
    loadChannels,
    getProxyState,
    getChannels,
    getSchedulerState,
    handleProxyStateUpdate,
    startProxy,
    stopProxy,
    getLogs,
    wsConnected,
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
      store.loadChannels()
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
