import { createDiscreteApi, darkTheme, lightTheme } from 'naive-ui'

// 动态获取当前主题
function getCurrentTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
  return isDark ? darkTheme : lightTheme
}

// 创建带主题配置的 discrete API
function createThemedDiscreteApi() {
  return createDiscreteApi(
    ['message', 'dialog'],
    {
      configProviderProps: {
        theme: getCurrentTheme()
      }
    }
  )
}

let discreteApi = createThemedDiscreteApi()

// 监听主题变化，重新创建 API
const observer = new MutationObserver(() => {
  discreteApi = createThemedDiscreteApi()
})

observer.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme']
})

// 导出动态获取的 API
export default {
  success: (...args) => discreteApi.message.success(...args),
  error: (...args) => discreteApi.message.error(...args),
  warning: (...args) => discreteApi.message.warning(...args),
  info: (...args) => discreteApi.message.info(...args),
  loading: (...args) => discreteApi.message.loading(...args)
}

export const dialog = {
  success: (...args) => discreteApi.dialog.success(...args),
  error: (...args) => discreteApi.dialog.error(...args),
  warning: (...args) => discreteApi.dialog.warning(...args),
  info: (...args) => discreteApi.dialog.info(...args),
  create: (...args) => discreteApi.dialog.create(...args)
}
