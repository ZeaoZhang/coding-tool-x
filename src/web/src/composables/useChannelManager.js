import { reactive, watch, onUnmounted } from 'vue'
import message, { dialog } from '../utils/message'
import { getUIConfig, updateNestedUIConfig } from '../api/ui-config'
import { useGlobalStore } from '../stores/global'

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

export default function useChannelManager(config) {
  const globalStore = useGlobalStore()
  let healthRefreshTimer = null

  const state = reactive({
    channels: [],
    loading: false,
    toggling: {},
    collapsed: getLocalCollapse(config.storageKeys.localCollapse),
    showDialog: false,
    editingChannel: null,
    formData: config.getInitialForm()
  })

  const validation = reactive({})

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

  async function loadChannels() {
    state.loading = true
    try {
      const list = await config.api.fetch()
      state.channels = Array.isArray(list) ? [...list] : []
      await applyChannelOrder()
      // 应用实时健康状态
      updateChannelHealth()
      scheduleFrozenChannelRefresh()
    } catch (error) {
      message.error(resolveError(error, `${config.displayName} 渠道加载失败`))
    } finally {
      state.loading = false
    }
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
  const UI_CONFIG_TTL = 60000

  async function fetchUIConfig() {
    const now = Date.now()
    if (lastUIConfig && now - lastUIConfigTime < UI_CONFIG_TTL) {
      return lastUIConfig
    }
    try {
      const response = await getUIConfig()
      if (response.success && response.config) {
        lastUIConfig = response.config
        lastUIConfigTime = now
        return lastUIConfig
      }
    } catch (error) {
      console.error('Failed to fetch UI config:', error)
    }
    return null
  }

  async function applyChannelOrder() {
    try {
      if (state.channels.length > 0) {
        // 按更新时间排序（最新的在前）
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

  async function saveOrder() {
    try {
      const order = state.channels.map(ch => ch.id)
      await updateNestedUIConfig('channelOrder', config.storageKeys.orderConfigKey, order)
    } catch (error) {
      console.error('Failed to save channel order:', error)
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
    clearValidation()
    state.showDialog = true
  }

  function closeDialog() {
    state.showDialog = false
    state.editingChannel = null
    state.formData = config.getInitialForm()
    clearValidation()
  }

  function handleEdit(channel) {
    state.editingChannel = channel
    state.formData = config.mapChannelToForm(channel)
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
      if (state.editingChannel) {
        await config.api.update(state.editingChannel, state.formData)
        message.success(`${config.displayName} 渠道已更新`)
      } else {
        await config.api.create(state.formData)
        message.success(`${config.displayName} 渠道已添加`)
      }
      closeDialog()
      await loadChannels()
    } catch (error) {
      message.error(resolveError(error))
    }
  }

  async function handleToggleEnabled(channel, value) {
    if (!channel || state.toggling[channel.id]) return
    state.toggling[channel.id] = true
    try {
      const enabled = typeof value === 'boolean' ? value : channel.enabled === false
      await config.api.toggle(channel, enabled)
      message.success(`${config.displayName} 渠道已${enabled ? '启用' : '禁用'}`)
      if (!enabled) {
        state.collapsed[channel.id] = true
        setLocalCollapse(config.storageKeys.localCollapse, state.collapsed)
        saveCollapseSettings()
      }
      await loadChannels()
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
          message.success(`${config.displayName} 渠道已删除`)
          await loadChannels()
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
          await config.api.applyToSettings(channel)
          message.success('已将渠道写入配置文件')
          await loadChannels()
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
      await config.api.resetHealth(channel)
      message.success('渠道健康状态已重置')
      await loadChannels()
    } catch (error) {
      message.error(resolveError(error))
    }
  }

  async function handleDragEnd(event) {
    // 拖拽改变顺序时，更新被移动渠道的 updatedAt
    // 这样它会自动按更新时间重新排序
    if (event && event.newIndex !== event.oldIndex) {
      const movedChannel = state.channels[event.newIndex]
      if (movedChannel) {
        try {
          // 更新渠道的 updatedAt 时间戳
          await config.api.update(movedChannel.id, {
            ...movedChannel,
            updatedAt: Date.now()
          })
          await loadChannels()
        } catch (error) {
          console.error('Failed to update channel order:', error)
        }
      }
    }
  }

  Promise.all([loadChannels(), loadCollapseSettings()])

  // 清理 watch
  onUnmounted(() => {
    clearFrozenChannelRefreshTimer()
    stopWatch()
  })

  return {
    state,
    validation,
    actions: {
      loadChannels,
      openAddDialog,
      closeDialog,
      toggleCollapse,
      handleEdit,
      handleSave,
      handleDelete,
      handleToggleEnabled,
      handleApplyToSettings,
      handleResetHealth,
      handleDragEnd
    }
  }
}
