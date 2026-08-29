import { reactive, watch, onUnmounted } from 'vue'
import message, { dialog } from '../utils/message'
import { getUIConfig, updateNestedUIConfig } from '../api/ui-config'
import { getChannelBalances, refreshChannelBalance } from '../api/channels'
import { useGlobalStore } from '../stores/global'

const BALANCE_LOAD_DELAY_MS = 5000
const UI_CONFIG_TTL = 60000
const CHANNEL_META_REFRESH_DELAYS_MS = [1500, 3000, 5000, 8000]

function getLocalCollapse(storageKey) {
  try {
    const stored = localStorage.getItem(storageKey)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (err) {}
  return {}
}

function setLocalCollapse(storageKey, value) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value))
  } catch (err) {}
}

function resolveError(error, fallback) {
  if (error?.response?.data?.error) return error.response.data.error
  return fallback || error.message || '操作失败'
}

function isDocumentVisible() {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeChannelFetchResult(result) {
  if (Array.isArray(result)) {
    return { channels: result, meta: null }
  }
  if (!isPlainObject(result)) {
    return { channels: [], meta: null }
  }
  const authProvider = isPlainObject(result.authProviderMeta) ? result.authProviderMeta : null
  const meta = isPlainObject(result.meta) ? { ...result.meta } : {}
  if (authProvider) {
    meta.authProvider = authProvider
  }
  return {
    channels: Array.isArray(result.channels) ? result.channels : [],
    meta: Object.keys(meta).length > 0 ? meta : null
  }
}

function shouldRefreshChannelMeta(meta) {
  return Boolean(meta?.refreshing || meta?.authProvider?.refreshing)
}

export default function useChannelManager(config) {
  const globalStore = useGlobalStore()
  let healthRefreshTimer = null
  let balanceLoadTimer = null
  let balanceIdleCallbackId = null
  let balanceLoadPromise = null
  let uiConfigPromise = null
  let channelMetaRefreshTimer = null
  let loadPromise = null
  let channelMetaRefreshAttempt = 0

  const state = reactive({
    channels: [],
    channelMeta: null,
    balances: {},
    loading: false,
    balanceLoading: false,
    balanceError: null,
    syncing: false,
    toggling: {},
    collapsed: getLocalCollapse(config.storageKeys.localCollapse),
    showDialog: false,
    editingChannel: null,
    showChannelBalance: false,
    formData: config.getInitialForm()
  })

  const validation = reactive({})


  function extractMutationChannel(result) {
    if (isPlainObject(result?.channel) && result.channel.id) return result.channel
    if (isPlainObject(result) && result.id) return result
    return null
  }

  function applyMutationResult(result, { fallback = null, allowInsert = false } = {}) {
    const channel = extractMutationChannel(result) || fallback
    if (!channel?.id) return false

    const index = state.channels.findIndex(item => item.id === channel.id)
    if (index === -1) {
      if (!allowInsert) return false
      state.channels = [...state.channels, channel]
    } else {
      state.channels[index] = { ...state.channels[index], ...channel }
    }

    applyChannelOrder()
    updateChannelHealth()
    scheduleFrozenChannelRefresh()
    return true
  }
  // 监听 scheduler-state 更新，实时更新渠道健康状态
  function updateChannelHealth() {
    const scheduler = globalStore.schedulerState[config.schedulerSource]
    if (!scheduler?.channels?.length || !state.channels.length) return

    state.channels.forEach(channel => {
      const schedulerChannel = scheduler.channels.find(sc => sc.id === channel.id)
      if (schedulerChannel?.health) {
        channel.health = schedulerChannel.health
      }
    })

    scheduleFrozenChannelRefresh()
  }

  // 监听 schedulerState 变化
  const stopWatch = watch(
    () => globalStore.schedulerState[config.schedulerSource]?.channels,
    updateChannelHealth
  )

  function getGlobalChannels() {
    if (typeof globalStore.getChannels !== 'function') return []
    const channelRef = globalStore.getChannels(config.type)
    return Array.isArray(channelRef?.value) ? channelRef.value : []
  }

  function seedChannelsFromGlobalStore() {
    const cached = getGlobalChannels()
    if (!cached.length || state.channels.length) return
    state.channels = [...cached]
    applyChannelOrder()
    updateChannelHealth()
    scheduleFrozenChannelRefresh()
  }

  function clearChannelMetaRefreshTimer() {
    if (!channelMetaRefreshTimer) return
    clearTimeout(channelMetaRefreshTimer)
    channelMetaRefreshTimer = null
  }

  function scheduleChannelMetaRefresh(meta) {
    clearChannelMetaRefreshTimer()
    if (!shouldRefreshChannelMeta(meta)) {
      channelMetaRefreshAttempt = 0
      return
    }
    if (channelMetaRefreshAttempt >= CHANNEL_META_REFRESH_DELAYS_MS.length) {
      return
    }
    const delay = CHANNEL_META_REFRESH_DELAYS_MS[channelMetaRefreshAttempt]
    channelMetaRefreshAttempt += 1
    channelMetaRefreshTimer = setTimeout(() => {
      channelMetaRefreshTimer = null
      loadChannels({ silent: true, skipBalance: true }).catch(() => {})
    }, delay)
  }

  async function loadChannels(options = {}) {
    if (loadPromise) return loadPromise
    loadPromise = _loadChannels(options).finally(() => {
      loadPromise = null
    })
    return loadPromise
  }

  async function _loadChannels({ silent = false, skipBalance = false } = {}) {
    if (!silent) {
      channelMetaRefreshAttempt = 0
    }
    seedChannelsFromGlobalStore()
    state.loading = !silent && state.channels.length === 0
    try {
      const result = await config.api.fetch()
      const normalized = normalizeChannelFetchResult(result)
      state.channels = [...normalized.channels]
      state.channelMeta = normalized.meta
      await applyChannelOrder()
      // 应用实时健康状态
      updateChannelHealth()
      scheduleFrozenChannelRefresh()
      scheduleChannelMetaRefresh(state.channelMeta)
      if (!skipBalance) {
        scheduleChannelBalanceLoad()
      }
    } catch (error) {
      if (state.channels.length === 0) {
        message.error(resolveError(error, `${config.displayName} 渠道加载失败`))
      } else {
        console.error(`${config.displayName} channel refresh failed:`, error)
      }
    } finally {
      state.loading = false
    }
  }

  async function loadChannelBalances() {
    if (balanceLoadPromise) {
      return balanceLoadPromise
    }
    state.balanceLoading = true
    state.balanceError = null
    balanceLoadPromise = (async () => {
      try {
        const configData = await fetchUIConfig()
        if (configData?.channelBalance?.showRemaining !== true) {
          state.showChannelBalance = false
          state.formData._showChannelBalance = false
          state.balances = {}
          return null
        }

        state.showChannelBalance = true
        state.formData._showChannelBalance = true
        const response = await getChannelBalances(config.type)
        state.balances = response?.enabled && response.balances ? response.balances : {}
        return response
      } catch (error) {
        state.balanceError = resolveError(error, `${config.displayName} 余额加载失败`)
        console.error('Failed to load channel balances:', error)
        return null
      } finally {
        state.balanceLoading = false
        balanceLoadPromise = null
      }
    })()
    return balanceLoadPromise
  }

  function clearBalanceLoadTimer() {
    if (balanceLoadTimer) {
      clearTimeout(balanceLoadTimer)
      balanceLoadTimer = null
    }
    if (
      balanceIdleCallbackId !== null
      && typeof window !== 'undefined'
      && typeof window.cancelIdleCallback === 'function'
    ) {
      window.cancelIdleCallback(balanceIdleCallbackId)
    }
    balanceIdleCallbackId = null
  }

  function scheduleChannelBalanceLoad() {
    clearBalanceLoadTimer()
    if (!isDocumentVisible()) return
    const run = () => {
      if (balanceLoadTimer) {
        clearTimeout(balanceLoadTimer)
      }
      balanceIdleCallbackId = null
      balanceLoadTimer = null
      loadChannelBalances()
    }
    balanceLoadTimer = setTimeout(() => {
      if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        balanceIdleCallbackId = window.requestIdleCallback(run, { timeout: 1500 })
        return
      }
      run()
    }, BALANCE_LOAD_DELAY_MS)
  }

  function clearFrozenChannelRefreshTimer() {
    if (healthRefreshTimer) {
      clearTimeout(healthRefreshTimer)
      healthRefreshTimer = null
    }
  }

  function scheduleFrozenChannelRefresh() {
    clearFrozenChannelRefreshTimer()

    const nextFrozenChannel = state.channels
      .filter(channel => channel.health?.status === 'frozen' && Number(channel.health?.freezeRemaining) > 0)
      .sort((left, right) => Number(left.health?.freezeRemaining || 0) - Number(right.health?.freezeRemaining || 0))[0]

    if (!nextFrozenChannel) {
      return
    }

    const remainingMs = Math.max(1000, Number(nextFrozenChannel.health.freezeRemaining || 0) * 1000)
    healthRefreshTimer = setTimeout(() => {
      healthRefreshTimer = null
      loadChannels()
    }, remainingMs + 250)
  }

  let lastUIConfig = null
  let lastUIConfigTime = 0

  async function fetchUIConfig() {
    const now = Date.now()
    if (lastUIConfig && now - lastUIConfigTime < UI_CONFIG_TTL) {
      return lastUIConfig
    }
    if (uiConfigPromise) {
      return uiConfigPromise
    }
    uiConfigPromise = (async () => {
      try {
        const response = await getUIConfig()
        if (response.success && response.config) {
          lastUIConfig = response.config
          lastUIConfigTime = Date.now()
          return lastUIConfig
        }
      } catch (error) {
        console.error('Failed to fetch UI config:', error)
      } finally {
        uiConfigPromise = null
      }
      return null
    })()
    return uiConfigPromise
  }

  function invalidateUIConfigCache() {
    lastUIConfig = null
    lastUIConfigTime = 0
    uiConfigPromise = null
  }

  async function applyChannelOrder() {
    try {
      if (state.channels.length > 0) {
        // 渠道列表只保留滚动浏览，新增/新启用的渠道依赖 updatedAt 自动置前。
        const sorted = [...state.channels].sort((a, b) => {
          const aTime = a.updatedAt || a.createdAt || 0
          const bTime = b.updatedAt || b.createdAt || 0
          return bTime - aTime
        })

        const enabled = sorted.filter(ch => ch.enabled !== false)
        const disabled = sorted.filter(ch => ch.enabled === false)
        disabled.forEach(ch => {
          state.collapsed[ch.id] = true
        })
        state.channels = [...enabled, ...disabled]
      }
    } catch (error) {
      console.error('Failed to apply channel order:', error)
    }
  }

  async function loadCollapseSettings() {
    try {
      const configData = await fetchUIConfig()
      if (configData) {
        const collapse = configData.channelCollapse?.[config.storageKeys.collapseConfigKey] || {}
        state.collapsed = collapse
        setLocalCollapse(config.storageKeys.localCollapse, collapse)
      }
    } catch (error) {
      console.error('Failed to load collapse settings:', error)
    }
  }

  async function saveCollapseSettings() {
    try {
      await updateNestedUIConfig('channelCollapse', config.storageKeys.collapseConfigKey, state.collapsed)
    } catch (error) {
      console.error('Failed to save collapse settings:', error)
    }
  }

  function toggleCollapse(id) {
    state.collapsed[id] = !state.collapsed[id]
    setLocalCollapse(config.storageKeys.localCollapse, state.collapsed)
    saveCollapseSettings()
  }

  function openAddDialog() {
    state.editingChannel = null
    state.formData = config.getInitialForm()
    state.formData._showChannelBalance = state.showChannelBalance
    clearValidation()
    state.showDialog = true
  }

  function closeDialog() {
    state.showDialog = false
    state.editingChannel = null
    state.formData = config.getInitialForm()
    state.formData._showChannelBalance = state.showChannelBalance
    clearValidation()
  }

  function handleEdit(channel) {
    state.editingChannel = channel
    state.formData = config.mapChannelToForm(channel)
    state.formData._showChannelBalance = state.showChannelBalance
    clearValidation()
    state.showDialog = true
  }

  function clearValidation() {
    Object.keys(validation).forEach(key => {
      delete validation[key]
    })
  }

  function runValidation() {
    let valid = true
    const getNestedValue = (obj, path) => {
      if (!path || typeof path !== 'string' || !path.includes('.')) return obj[path]
      const keys = path.split('.')
      let value = obj
      for (const key of keys) {
        value = value?.[key]
      }
      return value
    }
    const isSectionVisible = (section) => !section.showWhen || section.showWhen(state.formData)
    const isFieldVisible = (field) => !field.showWhen || field.showWhen(state.formData)
    const clearFieldValidation = (field) => {
      const flatKey = field.key.replace(/\./g, '_')
      delete validation[field.key]
      delete validation[flatKey]
    }

    config.formSections.forEach(section => {
      const sectionVisible = isSectionVisible(section)
      section.fields.forEach(field => {
        if (!sectionVisible || !isFieldVisible(field)) {
          clearFieldValidation(field)
          return
        }

        if (field.disabledOnEdit && state.editingChannel) {
          clearFieldValidation(field)
          return
        }

        const value = getNestedValue(state.formData, field.key)
        let errorMessage = ''
        if (field.required) {
          errorMessage = field.customRequiredMessage
            ? (value === null || value === undefined || value === '' ? field.customRequiredMessage : '')
            : (value === null || value === undefined || value === '' ? `${field.label}不能为空` : '')
        }
        if (!errorMessage && typeof field.validate === 'function') {
          errorMessage = field.validate(value, state.formData) || ''
        }
        if (errorMessage) {
          validation[field.key] = {
            status: 'error',
            message: errorMessage
          }
          valid = false
        } else {
          clearFieldValidation(field)
        }
      })
    })
    return valid
  }

  async function handleSave() {
    if (!runValidation()) {
      message.error('请检查表单填写是否完整')
      return
    }

    try {
      const editing = Boolean(state.editingChannel)
      const result = editing
        ? await config.api.update(state.editingChannel, state.formData)
        : await config.api.create(state.formData)
      const applied = applyMutationResult(result, { allowInsert: !editing })
      message.success(`${config.displayName} 渠道已${editing ? '更新' : '添加'}`)
      closeDialog()
      if (!applied) {
        await loadChannels()
      }
    } catch (error) {
      message.error(resolveError(error))
    }
  }

  function formatSyncResult(result = {}) {
    const added = Number(result.added || 0)
    const updated = Number(result.updated || 0)
    const skipped = Number(result.skipped || 0)
    if (added > 0 || updated > 0) {
      const parts = []
      if (added > 0) parts.push(`新增 ${added} 个`)
      if (updated > 0) parts.push(`更新 ${updated} 个`)
      return `${config.displayName} 同步完成：${parts.join('，')}`
    }
    if (skipped > 0) {
      return `${config.displayName} 已在列表中，未重复导入`
    }
    return `${config.displayName} 无需同步`
  }

  async function handleSyncCurrentChannels() {
    if (typeof config.api.syncCurrent !== 'function') {
      message.warning(`${config.displayName} 暂不支持同步`)
      return null
    }
    if (state.syncing) return null
    state.syncing = true
    try {
      const result = await config.api.syncCurrent()
      await loadChannels()
      window.dispatchEvent(new CustomEvent('channel-management-refresh', { detail: { channel: config.type } }))
      const warnings = Array.isArray(result?.warnings) ? result.warnings.filter(Boolean) : []
      if (warnings.length > 0) {
        message.warning(warnings.join('；'))
      }
      const added = Number(result?.added || 0)
      const updated = Number(result?.updated || 0)
      if (added > 0 || updated > 0) {
        message.success(formatSyncResult(result))
      } else {
        message.info(formatSyncResult(result))
      }
      return result
    } catch (error) {
      message.error(resolveError(error, `${config.displayName} 同步失败`))
      return null
    } finally {
      state.syncing = false
    }
  }

  async function handleToggleEnabled(channel, value) {
    if (!channel || state.toggling[channel.id]) return
    state.toggling[channel.id] = true
    try {
      const enabled = typeof value === 'boolean' ? value : channel.enabled === false
      const result = await config.api.toggle(channel, enabled)
      message.success(`${config.displayName} 渠道已${enabled ? '启用' : '禁用'}`)
      if (enabled) {
        delete state.collapsed[channel.id]
        setLocalCollapse(config.storageKeys.localCollapse, state.collapsed)
        saveCollapseSettings()
      } else {
        state.collapsed[channel.id] = true
        setLocalCollapse(config.storageKeys.localCollapse, state.collapsed)
        saveCollapseSettings()
      }
      const applied = applyMutationResult(result, { fallback: { ...channel, enabled } })
      if (!applied) {
        await loadChannels()
      }
      window.dispatchEvent(new CustomEvent('channel-management-refresh', { detail: { channel: config.type } }))
    } catch (error) {
      message.error(resolveError(error))
    } finally {
      state.toggling[channel.id] = false
    }
  }

  function handleDelete(id) {
    dialog.warning({
      title: `删除 ${config.displayName} 渠道`,
      content: '确定要删除这个渠道吗？',
      positiveText: '确定',
      negativeText: '取消',
      onPositiveClick: async () => {
        try {
          await config.api.remove(id)
          state.channels = state.channels.filter(channel => channel.id !== id)
          delete state.collapsed[id]
          setLocalCollapse(config.storageKeys.localCollapse, state.collapsed)
          message.success(`${config.displayName} 渠道已删除`)
        } catch (error) {
          message.error(resolveError(error))
        }
      }
    })
  }

  function handleApplyToSettings(channel) {
    if (typeof config.api.applyToSettings !== 'function') return
    dialog.warning({
      title: '写入配置',
      content: '写入配置后会关闭动态切换并默认使用该渠道，是否继续？',
      positiveText: '确定',
      negativeText: '取消',
      onPositiveClick: async () => {
        try {
          const result = await config.api.applyToSettings(channel)
          message.success('已将渠道写入配置文件')
          if (!applyMutationResult(result) && result?.success !== false) {
            await loadChannels()
          }
          window.dispatchEvent(new CustomEvent('channel-management-refresh', { detail: { channel: config.type } }))
        } catch (error) {
          message.error(resolveError(error))
        }
      }
    })
  }

  async function handleResetHealth(channel) {
    if (typeof config.api.resetHealth !== 'function') return
    try {
      const result = await config.api.resetHealth(channel)
      if (result?.health) {
        channel.health = result.health
        updateChannelHealth()
        scheduleFrozenChannelRefresh()
      } else {
        await loadChannels()
      }
      message.success('渠道健康状态已重置')
    } catch (error) {
      message.error(resolveError(error))
    }
  }

  async function handleRefreshBalance(channel) {
    if (!channel?.id) return
    try {
      const response = await refreshChannelBalance(config.type, channel.id)
      if (response?.enabled && response.balance) {
        state.balances[channel.id] = response.balance
        state.balanceError = null
      }
    } catch (error) {
      state.balanceError = resolveError(error, `${channel.name || config.displayName} 余额刷新失败`)
      console.error('Failed to refresh channel balance:', error)
    }
  }

  async function handleBalanceVisibilityChange() {
    invalidateUIConfigCache()
    await loadChannelBalances()
    state.formData._showChannelBalance = state.showChannelBalance
  }

  function handleDocumentVisibilityChange() {
    if (isDocumentVisible()) {
      scheduleChannelBalanceLoad()
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('channel-balance-visibility-change', handleBalanceVisibilityChange)
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleDocumentVisibilityChange)
  }

  seedChannelsFromGlobalStore()
  loadChannels().catch(() => {})
  loadCollapseSettings().catch(() => {})

  // 清理 watch
  onUnmounted(() => {
    clearFrozenChannelRefreshTimer()
    clearBalanceLoadTimer()
    clearChannelMetaRefreshTimer()
    stopWatch()
    if (typeof window !== 'undefined') {
      window.removeEventListener('channel-balance-visibility-change', handleBalanceVisibilityChange)
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleDocumentVisibilityChange)
    }
  })

  return {
    state,
    validation,
    actions: {
      loadChannels,
      loadChannelBalances,
      openAddDialog,
      closeDialog,
      toggleCollapse,
      handleEdit,
      handleSave,
      handleDelete,
      handleToggleEnabled,
      handleSyncCurrentChannels,
      handleApplyToSettings,
      handleResetHealth,
      handleRefreshBalance
    }
  }
}
