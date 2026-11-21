import { ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { updateUIConfigKey } from '../api/ui-config'
import { useDashboardStore } from '../stores/dashboard'
import message from '../utils/message'

// 主题状态（全局单例）
const THEME_STORAGE_KEY = 'cc-theme'
// A dashboard refresh that started before our write can still carry the old
// theme; ignore echoes of our own write for this long after it succeeds.
const THEME_ECHO_GRACE_MS = 3000
const isDark = ref(false)
let isLoaded = false
let dashboardStore = null
let dashboardDataRef = null
let uiConfigWatcherBound = false

// The server value is only authoritative while the user is not overriding it.
// `confirmedTheme` is the last theme the server accepted.
let userThemeOverride = false
let confirmedTheme = null
let lastWriteDoneAt = 0
let themeWritePending = 0

function getDashboardStore() {
  if (!dashboardStore) {
    dashboardStore = useDashboardStore()
    dashboardDataRef = storeToRefs(dashboardStore).dashboardData
  }
  return dashboardStore
}

function updateDashboardTheme(theme) {
  if (!dashboardDataRef?.value) return
  dashboardDataRef.value = {
    ...dashboardDataRef.value,
    uiConfig: {
      ...(dashboardDataRef.value.uiConfig || {}),
      theme
    }
  }
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
        confirmedTheme = theme
        isDark.value = shouldDark
        applyTheme(shouldDark)
        return
      }
      // Our own write is in flight, or the value is the echo of it: never let
      // server sync undo a click the user just made.
      if (themeWritePending > 0) return
      if (confirmedTheme === theme && Date.now() - lastWriteDoneAt < THEME_ECHO_GRACE_MS) return
      if (isDark.value !== shouldDark) {
        confirmedTheme = theme
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
    // A click during loading is the newest intent; the fetched value predates
    // it (and that click's write may already be in flight), so never overwrite.
    if (!userThemeOverride) {
      if (!theme && !storedTheme) {
        isDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches
      } else if (theme) {
        isDark.value = theme === 'dark'
      }
      confirmedTheme = isDark.value ? 'dark' : 'light'
    }
  } catch (err) {
    console.error('Failed to load theme:', err)
    if (!storedTheme && !userThemeOverride) {
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
// 串行写入并丢弃已被后续点击取代的旧请求，避免快速切换时服务端/本地状态错序。
let themeWriteChain = Promise.resolve()
let themeWriteVersion = 0

watch(isDark, (newValue) => {
  applyTheme(newValue)
  try {
    window.localStorage?.setItem(THEME_STORAGE_KEY, newValue ? 'dark' : 'light')
  } catch (err) {
    // ignore storage errors
  }

  // Initialization (server/local storage) must never write back.
  if (!userThemeOverride) return

  const theme = newValue ? 'dark' : 'light'
  const version = ++themeWriteVersion
  themeWritePending += 1
  themeWriteChain = themeWriteChain
    .catch(() => {})
    .then(async () => {
      try {
        if (version !== themeWriteVersion) return
        await updateUIConfigKey('theme', theme)
        confirmedTheme = theme
        lastWriteDoneAt = Date.now()
        getDashboardStore()
        bindUiConfigWatcher()
        updateDashboardTheme(theme)
      } catch (err) {
        console.error('Failed to save theme:', err)
        message.warning('主题保存失败，已恢复上一个主题')
        // Revert without re-persisting: clear the override first so the watch
        // does not queue another write.
        const revertTheme = confirmedTheme
          || (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light')
        userThemeOverride = false
        isDark.value = revertTheme === 'dark'
      } finally {
        themeWritePending = Math.max(0, themeWritePending - 1)
      }
    })
})

// 切换主题
function toggleTheme() {
  userThemeOverride = true
  isDark.value = !isDark.value
}

// 显式设置主题（用户操作）
function setTheme(theme) {
  const next = theme === 'dark'
  userThemeOverride = true
  if (isDark.value !== next) {
    isDark.value = next
  }
}

// 导出 composable
export function useTheme() {
  return {
    isDark,
    toggleTheme,
    setTheme,
    loadTheme
  }
}
