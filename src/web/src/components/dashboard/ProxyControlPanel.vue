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
              <div class="status-dot" :class="{ active: claudeRunning }"></div>
              <span>Claude Proxy</span>
            </div>
            <div class="proxy-meta">
              <n-text depth="3" style="font-size: 12px;">Port: {{ claudePort }}</n-text>
            </div>
          </div>
          <n-switch
            :value="claudeRunning"
            @update:value="toggleClaudeProxy"
            :loading="claudeLoading"
            size="small"
          />
        </div>
        <div v-if="claudeRunning && claudeActiveChannel" class="proxy-active">
          <n-text depth="3" style="font-size: 12px;">
            Active: {{ claudeActiveChannel }}
          </n-text>
        </div>
      </div>

      <!-- Codex Proxy -->
      <div class="proxy-item">
        <div class="proxy-header">
          <div class="proxy-info">
            <div class="proxy-name">
              <div class="status-dot" :class="{ active: codexRunning }"></div>
              <span>Codex Proxy</span>
            </div>
            <div class="proxy-meta">
              <n-text depth="3" style="font-size: 12px;">Port: {{ codexPort }}</n-text>
            </div>
          </div>
          <n-switch
            :value="codexRunning"
            @update:value="toggleCodexProxy"
            :loading="codexLoading"
            size="small"
          />
        </div>
        <div v-if="codexRunning && codexActiveChannel" class="proxy-active">
          <n-text depth="3" style="font-size: 12px;">
            Active: {{ codexActiveChannel }}
          </n-text>
        </div>
      </div>

      <!-- Gemini Proxy -->
      <div class="proxy-item">
        <div class="proxy-header">
          <div class="proxy-info">
            <div class="proxy-name">
              <div class="status-dot" :class="{ active: geminiRunning }"></div>
              <span>Gemini Proxy</span>
            </div>
            <div class="proxy-meta">
              <n-text depth="3" style="font-size: 12px;">Port: {{ geminiPort }}</n-text>
            </div>
          </div>
          <n-switch
            :value="geminiRunning"
            @update:value="toggleGeminiProxy"
            :loading="geminiLoading"
            size="small"
          />
        </div>
        <div v-if="geminiRunning && geminiActiveChannel" class="proxy-active">
          <n-text depth="3" style="font-size: 12px;">
            Active: {{ geminiActiveChannel }}
          </n-text>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { NSwitch, NText, NIcon, useMessage } from 'naive-ui'
import { PowerOutline } from '@vicons/ionicons5'
import axios from 'axios'
import { useGlobalState } from '../../composables/useGlobalState'

const message = useMessage()
const { claudeProxy, codexProxy, geminiProxy, startProxy, stopProxy } = useGlobalState()

// 端口配置
const claudePort = ref(10088)
const codexPort = ref(10089)
const geminiPort = ref(10090)

const claudeLoading = ref(false)
const codexLoading = ref(false)
const geminiLoading = ref(false)

function getChannelName(channel) {
  if (!channel) return ''
  if (typeof channel === 'string') return channel
  return channel.name || ''
}

const claudeRunning = computed(() => claudeProxy.value.running)
const codexRunning = computed(() => codexProxy.value.running)
const geminiRunning = computed(() => geminiProxy.value.running)

const claudeActiveChannel = computed(() => getChannelName(claudeProxy.value.activeChannel))
const codexActiveChannel = computed(() => getChannelName(codexProxy.value.activeChannel))
const geminiActiveChannel = computed(() => getChannelName(geminiProxy.value.activeChannel))

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

async function toggleProxy(type, value, loadingRef, startMsg, stopMsg) {
  loadingRef.value = true
  try {
    if (value) {
      const result = await startProxy(type)
      message.success(startMsg)

      // 如果有环境变量提示（Codex），显示额外的提示信息
      if (result.envHint && type === 'codex') {
        message.warning(result.envHint.message, {
          duration: 10000,
          closable: true
        })
      }
    } else {
      await stopProxy(type)
      message.success(stopMsg)
    }
  } catch (error) {
    message.error(error.response?.data?.error || error.message || '操作失败')
  } finally {
    loadingRef.value = false
  }
}

function toggleClaudeProxy(value) {
  toggleProxy('claude', value, claudeLoading, 'Claude Proxy started', 'Claude Proxy stopped')
}

function toggleCodexProxy(value) {
  toggleProxy('codex', value, codexLoading, 'Codex Proxy started', 'Codex Proxy stopped')
}

function toggleGeminiProxy(value) {
  toggleProxy('gemini', value, geminiLoading, 'Gemini Proxy started', 'Gemini Proxy stopped')
}

onMounted(() => {
  loadConfig()
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
