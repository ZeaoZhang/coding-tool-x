import { ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { updateUIConfigKey } from '../api/ui-config'
import { useDashboardStore } from '../stores/dashboard'

// 主题状态（全局单例）
const THEME_STORAGE_KEY = 'cc-theme'
const isDark = ref(false)
let isLoaded = false
let dashboardStore = null
let dashboardDataRef = null
let uiConfigWatcherBound = false

function getDashboardStore() {
  if (!dashboardStore) {
    dashboardStore = useDashboardStore()
    dashboardDataRef = storeToRefs(dashboardStore).dashboardData
  }
  return dashboardStore
}

function bindUiConfigWatcher() {
  if (uiConfigWatcherBound) return
  if (!dashboardDataRef) return
  watch(
    () => dashboardDataRef.value?.uiConfig?.theme,
    (theme) => {
      if (!theme) return
      const shouldDark = theme === 'dark'
      if (!isLoaded) {
        isLoaded = true
        isDark.value = shouldDark
        applyTheme(shouldDark)
        return
      }
      if (isDark.value !== shouldDark) {
        isDark.value = shouldDark
        applyTheme(shouldDark)
      }
    }
  )
  uiConfigWatcherBound = true
}

// 从服务器加载主题设置
async function loadTheme() {
  if (isLoaded) return

  const storedTheme = typeof window !== 'undefined'
    ? window.localStorage?.getItem(THEME_STORAGE_KEY)
    : null
  if (storedTheme === 'dark' || storedTheme === 'light') {
    isDark.value = storedTheme === 'dark'
    applyTheme(isDark.value)
  }

  try {
    const store = getDashboardStore()
    bindUiConfigWatcher()
    let theme = dashboardDataRef?.value?.uiConfig?.theme
    if (!theme) {
      const data = await store.loadDashboard().catch(() => null)
      theme = data?.uiConfig?.theme
    }
    if (!theme && !storedTheme) {
      isDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches
    } else if (theme) {
      isDark.value = theme === 'dark'
    }
  } catch (err) {
    console.error('Failed to load theme:', err)
    if (!storedTheme) {
      isDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches
    }
  }

  applyTheme(isDark.value)
  isLoaded = true
}

// 应用主题到 document
function applyTheme(dark) {
  if (dark) {
    document.documentElement.setAttribute('data-theme', 'dark')
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
}

// 监听主题变化并持久化到服务器
watch(isDark, async (newValue) => {
  applyTheme(newValue)
  try {
    window.localStorage?.setItem(THEME_STORAGE_KEY, newValue ? 'dark' : 'light')
  } catch (err) {
    // ignore storage errors
  }
  try {
    await updateUIConfigKey('theme', newValue ? 'dark' : 'light')
    const store = getDashboardStore()
    bindUiConfigWatcher()
    if (dashboardDataRef.value) {
      dashboardDataRef.value = {
        ...dashboardDataRef.value,
        uiConfig: {
          ...(dashboardDataRef.value.uiConfig || {}),
          theme: newValue ? 'dark' : 'light'
        }
      }
    }
  } catch (err) {
    console.error('Failed to save theme:', err)
  }
})

// 切换主题
function toggleTheme() {
  isDark.value = !isDark.value
}

// 导出 composable
export function useTheme() {
  return {
    isDark,
    toggleTheme,
    loadTheme
  }
}
