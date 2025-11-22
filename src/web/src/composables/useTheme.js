import { ref, watch } from 'vue'

// 主题状态（全局单例）
const isDark = ref(false)

// 从 localStorage 加载主题设置
function loadTheme() {
  const saved = localStorage.getItem('cc-theme')
  if (saved) {
    isDark.value = saved === 'dark'
  } else {
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

// 监听主题变化并持久化
watch(isDark, (newValue) => {
  localStorage.setItem('cc-theme', newValue ? 'dark' : 'light')
  applyTheme(newValue)
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
