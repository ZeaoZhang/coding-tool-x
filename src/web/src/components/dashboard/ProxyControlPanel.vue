<template>
  <div class="panel-card">
    <div class="panel-header">
      <n-icon :size="20" color="#18a058">
        <PowerOutline />
      </n-icon>
      <h3 class="panel-title">Proxy Management</h3>
    </div>

    <div class="proxy-list">
      <!-- Claude Proxy -->
      <div class="proxy-item">
        <div class="proxy-header">
          <div class="proxy-info">
            <div class="proxy-name">
              <div class="status-dot" :class="{ active: claudeStatus.running }"></div>
              <span>Claude Proxy</span>
            </div>
            <div class="proxy-meta">
              <n-text depth="3" style="font-size: 12px;">Port: {{ claudePort }}</n-text>
            </div>
          </div>
          <n-switch
            v-model:value="claudeStatus.running"
            @update:value="toggleClaudeProxy"
            :loading="claudeStatus.loading"
            size="small"
          />
        </div>
        <div v-if="claudeStatus.running && claudeStatus.activeChannel" class="proxy-active">
          <n-text depth="3" style="font-size: 12px;">
            Active: {{ claudeStatus.activeChannel }}
          </n-text>
        </div>
      </div>

      <!-- Codex Proxy -->
      <div class="proxy-item">
        <div class="proxy-header">
          <div class="proxy-info">
            <div class="proxy-name">
              <div class="status-dot" :class="{ active: codexStatus.running }"></div>
              <span>Codex Proxy</span>
            </div>
            <div class="proxy-meta">
              <n-text depth="3" style="font-size: 12px;">Port: {{ codexPort }}</n-text>
            </div>
          </div>
          <n-switch
            v-model:value="codexStatus.running"
            @update:value="toggleCodexProxy"
            :loading="codexStatus.loading"
            size="small"
          />
        </div>
        <div v-if="codexStatus.running && codexStatus.activeChannel" class="proxy-active">
          <n-text depth="3" style="font-size: 12px;">
            Active: {{ codexStatus.activeChannel }}
          </n-text>
        </div>
      </div>

      <!-- Gemini Proxy -->
      <div class="proxy-item">
        <div class="proxy-header">
          <div class="proxy-info">
            <div class="proxy-name">
              <div class="status-dot" :class="{ active: geminiStatus.running }"></div>
              <span>Gemini Proxy</span>
            </div>
            <div class="proxy-meta">
              <n-text depth="3" style="font-size: 12px;">Port: {{ geminiPort }}</n-text>
            </div>
          </div>
          <n-switch
            v-model:value="geminiStatus.running"
            @update:value="toggleGeminiProxy"
            :loading="geminiStatus.loading"
            size="small"
          />
        </div>
        <div v-if="geminiStatus.running && geminiStatus.activeChannel" class="proxy-active">
          <n-text depth="3" style="font-size: 12px;">
            Active: {{ geminiStatus.activeChannel }}
          </n-text>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { NSwitch, NText, NIcon, useMessage } from 'naive-ui'
import { PowerOutline } from '@vicons/ionicons5'
import axios from 'axios'

const message = useMessage()

// 端口配置
const claudePort = ref(10088)
const codexPort = ref(10089)
const geminiPort = ref(10090)

// 状态
const claudeStatus = ref({ running: false, loading: false, activeChannel: '' })
const codexStatus = ref({ running: false, loading: false, activeChannel: '' })
const geminiStatus = ref({ running: false, loading: false, activeChannel: '' })

// 加载配置
async function loadConfig() {
  try {
    const response = await axios.get('/api/config/advanced')
    if (response.data.ports) {
      claudePort.value = response.data.ports.proxy || 10088
      codexPort.value = response.data.ports.codexProxy || 10089
      geminiPort.value = response.data.ports.geminiProxy || 10090
    }
  } catch (error) {
    console.error('Failed to load config:', error)
  }
}

// 检查代理状态
async function checkProxyStatus() {
  // Claude
  try {
    const response = await axios.get('/api/proxy/status')
    claudeStatus.value.running = response.data.running
    claudeStatus.value.activeChannel = response.data.activeChannel?.name || ''
  } catch (error) {
    claudeStatus.value.running = false
  }

  // Codex
  try {
    const response = await axios.get('/api/codex/proxy/status')
    codexStatus.value.running = response.data.running
    codexStatus.value.activeChannel = response.data.activeChannel?.name || ''
  } catch (error) {
    codexStatus.value.running = false
  }

  // Gemini
  try {
    const response = await axios.get('/api/gemini/proxy/status')
    geminiStatus.value.running = response.data.running
    geminiStatus.value.activeChannel = response.data.activeChannel?.name || ''
  } catch (error) {
    geminiStatus.value.running = false
  }
}

// 切换 Claude 代理
async function toggleClaudeProxy(value) {
  claudeStatus.value.loading = true
  try {
    if (value) {
      const response = await axios.post('/api/proxy/start')
      if (response.data.success) {
        message.success('Claude Proxy started')
        claudeStatus.value.activeChannel = response.data.activeChannel?.name || ''
      } else {
        claudeStatus.value.running = false
        message.error(response.data.error || 'Failed to start proxy')
      }
    } else {
      await axios.post('/api/proxy/stop')
      message.success('Claude Proxy stopped')
      claudeStatus.value.activeChannel = ''
    }
  } catch (error) {
    claudeStatus.value.running = !value
    message.error(error.response?.data?.error || 'Failed to toggle proxy')
  } finally {
    claudeStatus.value.loading = false
  }
}

// 切换 Codex 代理
async function toggleCodexProxy(value) {
  codexStatus.value.loading = true
  try {
    if (value) {
      const response = await axios.post('/api/codex/proxy/start')
      if (response.data.success) {
        message.success('Codex Proxy started')
        codexStatus.value.activeChannel = response.data.activeChannel?.name || ''
      } else {
        codexStatus.value.running = false
        message.error(response.data.error || 'Failed to start proxy')
      }
    } else {
      await axios.post('/api/codex/proxy/stop')
      message.success('Codex Proxy stopped')
      codexStatus.value.activeChannel = ''
    }
  } catch (error) {
    codexStatus.value.running = !value
    message.error(error.response?.data?.error || 'Failed to toggle proxy')
  } finally {
    codexStatus.value.loading = false
  }
}

// 切换 Gemini 代理
async function toggleGeminiProxy(value) {
  geminiStatus.value.loading = true
  try {
    if (value) {
      const response = await axios.post('/api/gemini/proxy/start')
      if (response.data.success) {
        message.success('Gemini Proxy started')
        geminiStatus.value.activeChannel = response.data.activeChannel?.name || ''
      } else {
        geminiStatus.value.running = false
        message.error(response.data.error || 'Failed to start proxy')
      }
    } else {
      await axios.post('/api/gemini/proxy/stop')
      message.success('Gemini Proxy stopped')
      geminiStatus.value.activeChannel = ''
    }
  } catch (error) {
    geminiStatus.value.running = !value
    message.error(error.response?.data?.error || 'Failed to toggle proxy')
  } finally {
    geminiStatus.value.loading = false
  }
}

onMounted(() => {
  loadConfig()
  checkProxyStatus()
  // 定时刷新状态
  setInterval(checkProxyStatus, 5000)
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

.proxy-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.proxy-item {
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  padding: 12px;
  transition: all 0.2s ease;
}

.proxy-item:hover {
  border-color: #18a058;
}

.proxy-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.proxy-info {
  flex: 1;
}

.proxy-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--border-secondary);
  transition: all 0.3s ease;
}

.status-dot.active {
  background: #18a058;
  box-shadow: 0 0 8px rgba(24, 160, 88, 0.5);
}

.proxy-meta {
  display: flex;
  gap: 8px;
}

.proxy-active {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-primary);
}
</style>
