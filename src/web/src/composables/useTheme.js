import { ref, watch } from 'vue'
import api from '../api'

// 主题状态（全局单例）
const isDark = ref(false)
let isLoaded = false

// 从服务器加载主题设置
async function loadTheme() {
  if (isLoaded) return

  try {
    const response = await api.getUIConfig()
    if (response.success && response.config) {
      isDark.value = response.config.theme === 'dark'
      isLoaded = true
    } else {
      // 默认使用系统偏好
      isDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches
    }
  } catch (err) {
    console.error('Failed to load theme:', err)
    // 默认使用系统偏好
    isDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  // 应用主题到 document
  applyTheme(isDark.value)
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
    await api.updateUIConfigKey('theme', newValue ? 'dark' : 'light')
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
