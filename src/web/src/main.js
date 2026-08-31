import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import { initializeGlobalState } from './composables/useGlobalState'
import { useUIConfig } from './composables/useUIConfig'
import { usePlatformStore } from './stores/platforms'

// Naive UI - no need to import CSS, it's built-in
async function bootstrap() {
  const app = createApp(App)
  const pinia = createPinia()

  app.use(pinia)
  const platformStore = usePlatformStore(pinia)
  const { loadUIConfig } = useUIConfig()

  // Resolve both singleton startup resources before installing the router or
  // mounting components. Guards and initial views therefore see one catalog
  // and one canonical selection from their first render.
  await Promise.all([platformStore.load(), loadUIConfig()])

  app.use(router)
  app.mount('#app')

  // 初始化全局状态（WebSocket 连接和状态管理）
  initializeGlobalState()
}

void bootstrap()
