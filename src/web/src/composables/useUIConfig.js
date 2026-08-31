import { ref } from 'vue'
import {
  getUIConfig,
  saveUIConfig,
  updateUIConfigKey,
  updateNestedUIConfig
} from '../api/ui-config'
import { DEFAULT_ENABLED_CLI_PLATFORMS } from '../config/platforms'

// UI 配置
const uiConfig = ref({
  theme: 'light',
  panelVisibility: {
    showChannels: true,
    showLogs: true
  },
  channelBalance: {
    showRemaining: false
  },
  channelLocks: {
    claude: false,
    codex: false,
    gemini: false,
    opencode: false,
    omp: false
  },
  channelCollapse: {
    claude: [],
    codex: [],
    gemini: [],
    opencode: [],
    omp: []
  },
  channelOrder: {
    claude: [],
    codex: [],
    gemini: [],
    opencode: [],
    omp: []
  },
  enabledCliPlatforms: [...DEFAULT_ENABLED_CLI_PLATFORMS]
})

let isLoaded = false
let loadSettled = false
let loadPromise = null

// 加载 UI 配置
async function loadUIConfig({ force = false } = {}) {
  if (!force && (isLoaded || loadSettled)) return uiConfig.value
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    try {
      const response = await getUIConfig()
      if (response.success && response.config) {
        uiConfig.value = response.config
        isLoaded = true
      }
      loadSettled = true
    } catch (err) {
      loadSettled = true
      console.error('Failed to load UI config:', err)
    } finally {
      loadPromise = null
    }
    return uiConfig.value
  })()

  return loadPromise
}

export function useUIConfig() {
  // 更新整个配置
  async function saveConfig(config) {
    try {
      const response = await saveUIConfig(config)
      if (response.success) {
        uiConfig.value = response.config
        return true
      }
      return false
    } catch (err) {
      console.error('Failed to save UI config:', err)
      return false
    }
  }

  // 更新单个键
  async function updateConfig(key, value) {
    try {
      const response = await updateUIConfigKey(key, value)
      if (response.success) {
        uiConfig.value = response.config
        return true
      }
      return false
    } catch (err) {
      console.error('Failed to update UI config:', err)
      return false
    }
  }

  // 更新嵌套键
  async function updateNestedConfig(parentKey, childKey, value) {
    try {
      const response = await updateNestedUIConfig(parentKey, childKey, value)
      if (response.success) {
        uiConfig.value = response.config
        return true
      }
      return false
    } catch (err) {
      console.error('Failed to update nested UI config:', err)
      return false
    }
  }

  // 初始化加载（如果还没加载）
  if (!isLoaded) {
    loadUIConfig()
  }

  return {
    uiConfig,
    loadUIConfig,
    saveConfig,
    updateConfig,
    updateNestedConfig
  }
}
