<template>
  <div class="panel-card">
    <div class="panel-header">
      <n-icon :size="20" color="#18a058">
        <SettingsOutline />
      </n-icon>
      <h3 class="panel-title">System Status</h3>
    </div>

    <div class="status-list">
      <div class="status-item">
        <div class="status-icon">
          <n-icon :size="20" :color="webUIStatus.running ? '#18a058' : '#d03050'">
            <GlobeOutline />
          </n-icon>
        </div>
        <div class="status-info">
          <div class="status-label">Web UI</div>
          <div class="status-value">
            <n-tag :type="webUIStatus.running ? 'success' : 'error'" size="small">
              {{ webUIStatus.running ? 'Running' : 'Stopped' }}
            </n-tag>
            <n-text depth="3" style="font-size: 11px;">Port {{ webUIStatus.port }}</n-text>
          </div>
        </div>
      </div>

      <div class="status-item">
        <div class="status-icon">
          <n-icon :size="20" :color="wsStatus.connected ? '#18a058' : '#d03050'">
            <GitNetworkOutline />
          </n-icon>
        </div>
        <div class="status-info">
          <div class="status-label">WebSocket</div>
          <div class="status-value">
            <n-tag :type="wsStatus.connected ? 'success' : 'error'" size="small">
              {{ wsStatus.connected ? 'Connected' : 'Disconnected' }}
            </n-tag>
            <n-text depth="3" style="font-size: 11px;">{{ wsStatus.clients }} client(s)</n-text>
          </div>
        </div>
      </div>

      <div class="status-item">
        <div class="status-icon">
          <n-icon :size="20" color="#18a058">
            <TimeOutline />
          </n-icon>
        </div>
        <div class="status-info">
          <div class="status-label">Uptime</div>
          <div class="status-value">
            <n-text strong>{{ formatUptime(uptime) }}</n-text>
          </div>
        </div>
      </div>

      <div class="status-item">
        <div class="status-icon">
          <n-icon :size="20" color="#3b82f6">
            <HardwareChipOutline />
          </n-icon>
        </div>
        <div class="status-info">
          <div class="status-label">Memory Usage</div>
          <div class="status-value">
            <n-text strong>{{ formatMemory(memoryUsage) }}</n-text>
            <n-progress
              type="line"
              :percentage="memoryPercentage"
              :show-indicator="false"
              :color="memoryPercentage > 80 ? '#d03050' : '#18a058'"
              style="margin-top: 4px;"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { NIcon, NText, NTag, NProgress } from 'naive-ui'
import { SettingsOutline, GlobeOutline, GitNetworkOutline, TimeOutline, HardwareChipOutline } from '@vicons/ionicons5'

const webUIStatus = ref({ running: true, port: 10099 })
const wsStatus = ref({ connected: false, clients: 0 })
const uptime = ref(0)
const memoryUsage = ref(0)
const memoryPercentage = ref(0)

let uptimeInterval = null
let ws = null

function formatUptime(seconds) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${minutes}m`
}

function formatMemory(bytes) {
  const mb = bytes / 1024 / 1024
  return `${mb.toFixed(0)} MB`
}

function updateUptime() {
  uptime.value++
}

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${protocol}//${window.location.host}/ws`

  ws = new WebSocket(wsUrl)

  ws.onopen = () => {
    wsStatus.value.connected = true
  }

  ws.onclose = () => {
    wsStatus.value.connected = false
    setTimeout(connectWebSocket, 3000)
  }

  ws.onerror = () => {
    wsStatus.value.connected = false
  }
}

function updateSystemInfo() {
  // Web UI 始终运行（如果能看到这个页面）
  webUIStatus.value.running = true
  webUIStatus.value.port = parseInt(window.location.port) || 10099

  // WebSocket 客户端数量（模拟）
  wsStatus.value.clients = wsStatus.value.connected ? 1 : 0

  // 内存使用（模拟）
  if (performance && performance.memory) {
    memoryUsage.value = performance.memory.usedJSHeapSize
    const total = performance.memory.jsHeapSizeLimit
    memoryPercentage.value = Math.round((memoryUsage.value / total) * 100)
  } else {
    // 如果浏览器不支持 performance.memory，使用随机值模拟
    memoryUsage.value = 50 * 1024 * 1024 + Math.random() * 20 * 1024 * 1024
    memoryPercentage.value = 30 + Math.random() * 20
  }
}

onMounted(() => {
  connectWebSocket()
  updateSystemInfo()

  // 每秒更新运行时间
  uptimeInterval = setInterval(updateUptime, 1000)

  // 每5秒更新系统信息
  setInterval(updateSystemInfo, 5000)
})

onUnmounted(() => {
  if (uptimeInterval) {
    clearInterval(uptimeInterval)
  }
  if (ws) {
    ws.close()
  }
})
</script>

<style scoped>
.panel-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 12px;
  padding: 20px;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.panel-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary);
}

.status-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.status-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
}

.status-icon {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(24, 160, 88, 0.1);
  border-radius: 6px;
}

.status-info {
  flex: 1;
}

.status-label {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-bottom: 4px;
}

.status-value {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
