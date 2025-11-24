import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import { initializeGlobalState } from './composables/useGlobalState'

// Naive UI - no need to import CSS, it's built-in
const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.mount('#app')

// 初始化全局状态（WebSocket 连接和状态管理）
initializeGlobalState()
