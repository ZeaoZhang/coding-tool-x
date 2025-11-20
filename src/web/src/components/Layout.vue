<template>
  <div class="layout">
    <!-- Global Header -->
    <header class="header">
      <div class="logo-section" @click="goHome">
        <img src="/logo.png" alt="CC-Tool Logo" class="logo-image" />
        <div class="title-group">
          <h1 class="title-main">CC-TOOL</h1>
          <span class="title-divider">-</span>
          <span class="title-sub">ClaudeCode增强工作助手</span>
        </div>
      </div>

      <div class="header-actions">
        <!-- Proxy Toggle -->
        <n-tooltip placement="bottom" :style="{ maxWidth: '280px' }">
          <template #trigger>
            <div class="proxy-control">
              <span class="proxy-label">动态切换</span>
              <n-switch
                v-model:value="proxyRunning"
                @update:value="toggleProxy"
                :loading="proxyLoading"
                size="medium"
              />
            </div>
          </template>
          <div style="line-height: 1.6;">
            开启后会在本地启动代理服务，让您可以在右侧面板快速切换渠道，无需修改配置文件。
            <br/>
            <span style="color: #f59e0b;">注意：开启期间请勿关闭 CC 进程窗口。</span>
          </div>
        </n-tooltip>

        <!-- Recent Sessions -->
        <n-tooltip placement="bottom">
          <template #trigger>
            <n-button text @click="showRecentDrawer = true">
              <n-icon size="24" color="#18a058">
                <ChatbubblesOutline />
              </n-icon>
            </n-button>
          </template>
          最新对话
        </n-tooltip>

        <!-- Toggle Channels Panel -->
        <n-tooltip placement="bottom">
          <template #trigger>
            <n-button text @click="toggleChannels">
              <n-icon size="24" :color="showChannels ? '#18a058' : '#999'">
                <ServerOutline />
              </n-icon>
            </n-button>
          </template>
          {{ showChannels ? '隐藏渠道列表' : '显示渠道列表' }}
        </n-tooltip>

        <!-- Toggle Logs Panel -->
        <n-tooltip placement="bottom">
          <template #trigger>
            <n-button text @click="toggleLogs" :disabled="!proxyRunning">
              <n-icon size="24" :color="!proxyRunning ? '#ccc' : (showLogs ? '#18a058' : '#999')">
                <TerminalOutline />
              </n-icon>
            </n-button>
          </template>
          {{ !proxyRunning ? '开启动态切换后才能展示实时日志' : (showLogs ? '隐藏实时日志' : '显示实时日志') }}
        </n-tooltip>
      </div>
    </header>

    <div class="main-container">
      <!-- Global Loading Overlay -->
      <div v-if="globalLoading" class="global-loading-overlay">
        <n-spin size="large">
          <template #description>
            加载配置中...
          </template>
        </n-spin>
      </div>

      <!-- Left Content Area (Router View) - Always mounted -->
      <div class="left-content">
        <router-view />
      </div>

      <!-- Right Panel (Global) - Only show if at least one panel is enabled -->
      <transition name="slide-right">
        <RightPanel
          v-if="showChannels || (showLogs && proxyRunning)"
          :show-channels="showChannels"
          :show-logs="showLogs"
        />
      </transition>
    </div>

    <!-- Recent Sessions Drawer -->
    <RecentSessionsDrawer v-model:visible="showRecentDrawer" />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { NIcon, NButton, NTooltip, NSwitch, NSpin } from 'naive-ui'
import { ChatbubblesOutline, ServerOutline, TerminalOutline } from '@vicons/ionicons5'
import RightPanel from './RightPanel.vue'
import RecentSessionsDrawer from './RecentSessionsDrawer.vue'
import api from '../api'
import message from '../utils/message'

const router = useRouter()
const showRecentDrawer = ref(false)
const proxyRunning = ref(false)
const proxyLoading = ref(false)
const globalLoading = ref(true) // 全局 loading 状态
let statusCheckInterval = null

// Panel visibility settings (with localStorage persistence)
const showChannels = ref(true)
const showLogs = ref(true)

// Load panel visibility from localStorage
function loadPanelSettings() {
  const saved = localStorage.getItem('cc-panel-visibility')
  if (saved) {
    try {
      const settings = JSON.parse(saved)
      showChannels.value = settings.showChannels !== false // default true
      showLogs.value = settings.showLogs !== false // default true
    } catch (e) {
      // Ignore parse errors
    }
  }
}

// Save panel visibility to localStorage
function savePanelSettings() {
  localStorage.setItem('cc-panel-visibility', JSON.stringify({
    showChannels: showChannels.value,
    showLogs: showLogs.value
  }))
}

// Toggle handlers
function toggleChannels() {
  showChannels.value = !showChannels.value
  savePanelSettings()
}

function toggleLogs() {
  showLogs.value = !showLogs.value
  savePanelSettings()
}

function goHome() {
  router.push({ name: 'projects' })
}

// 检查代理状态
async function checkProxyStatus(isInitial = false) {
  try {
    const status = await api.getProxyStatus()
    proxyRunning.value = status.proxy.running
    console.log('✅ Proxy status loaded:', status.proxy.running)
  } catch (err) {
    console.error('Failed to check proxy status:', err)
    // 即使失败也要关闭 loading
  } finally {
    // 初次加载完成后关闭全局 loading
    if (isInitial) {
      console.log('Closing global loading...')
      globalLoading.value = false
    }
  }
}

// 切换代理状态
async function toggleProxy(newValue) {
  proxyLoading.value = true

  // 保存旧值，如果失败需要恢复
  const oldValue = !newValue

  try {
    if (newValue) {
      // 启动代理
      const result = await api.startProxy()
      message.success(`代理已启动，端口: ${result.port}`)
      // 立即更新状态，让日志面板立即显示
      await checkProxyStatus()
    } else {
      // 停止代理
      await api.stopProxy()
      message.success('代理已停止并恢复配置')
      // 立即更新状态，让日志面板立即隐藏
      await checkProxyStatus()
    }
  } catch (err) {
    message.error('操作失败: ' + err.message)
    // 恢复旧值
    proxyRunning.value = oldValue
  } finally {
    proxyLoading.value = false
  }
}

onMounted(() => {
  // 加载面板可见性设置
  loadPanelSettings()

  // 初始检查状态（传入 isInitial = true）
  checkProxyStatus(true)

  // 每30秒检查一次状态（降低请求频率）
  statusCheckInterval = setInterval(() => checkProxyStatus(false), 30000)

  // 添加超时保护，确保 3 秒后无论如何都关闭 loading
  setTimeout(() => {
    if (globalLoading.value) {
      console.warn('Global loading timeout, forcing to hide')
      globalLoading.value = false
    }
  }, 3000)
})

onUnmounted(() => {
  if (statusCheckInterval) {
    clearInterval(statusCheckInterval)
  }
})
</script>

<style scoped>
.layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #ffffff;
}

.header {
  height: 64px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  z-index: 10;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 24px;
}

.proxy-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.proxy-label {
  font-size: 14px;
  color: #333;
  font-weight: 500;
  user-select: none;
}

.logo-section {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  transition: opacity 0.2s;
}

.logo-section:hover {
  opacity: 0.8;
}

.logo-image {
  width: 32px;
  height: 32px;
  object-fit: contain;
}

.title-group {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.title-main {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  color: #18a058;
  user-select: none;
  letter-spacing: -0.5px;
}

.title-divider {
  font-size: 18px;
  font-weight: 400;
  color: #d1d5db;
  user-select: none;
}

.title-sub {
  font-size: 15px;
  font-weight: 500;
  color: #6b7280;
  user-select: none;
}

.main-container {
  display: flex;
  flex: 1;
  overflow: hidden;
  position: relative;
}

.global-loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  background: rgba(255, 255, 255, 0.9);
  z-index: 1000;
  backdrop-filter: blur(4px);
}

.left-content {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  transition: all 0.3s ease-out;
}

/* Slide in from right animation */
.slide-right-enter-active,
.slide-right-leave-active {
  transition: transform 0.3s ease-out, opacity 0.3s ease-out;
}

.slide-right-enter-from {
  transform: translateX(100%);
  opacity: 0;
}

.slide-right-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

.slide-right-enter-to,
.slide-right-leave-from {
  transform: translateX(0);
  opacity: 1;
}
</style>
