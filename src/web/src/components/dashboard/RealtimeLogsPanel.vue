<template>
  <div class="panel-card logs-panel">
    <div class="panel-header">
      <n-icon :size="20" color="#18a058">
        <RadioOutline />
      </n-icon>
      <h3 class="panel-title">Real-time Logs</h3>
      <div class="header-actions">
        <n-checkbox v-model:checked="autoScroll" size="small">
          Auto Scroll
        </n-checkbox>
        <n-button text size="tiny" @click="clearLogs">
          <template #icon>
            <n-icon><TrashOutline /></n-icon>
          </template>
        </n-button>
      </div>
    </div>

    <div class="logs-container" ref="logsContainer">
      <div v-if="logs.length === 0" class="empty-state">
        <n-icon :size="48" color="var(--text-tertiary)">
          <DocumentTextOutline />
        </n-icon>
        <n-text depth="3">No logs yet</n-text>
        <n-text depth="3" style="font-size: 12px;">Logs will appear here when requests are made</n-text>
      </div>

      <div v-for="log in logs" :key="log.id" class="log-entry" :class="log.type">
        <div class="log-header">
          <div class="log-status" :class="log.status">
            <div class="status-dot"></div>
          </div>
          <div class="log-time">{{ formatTime(log.timestamp) }}</div>
          <div class="log-channel" :class="log.channel">
            <span class="channel-badge">{{ log.channelType }}</span>
            <span class="channel-name">{{ log.channelName }}</span>
          </div>
        </div>

        <div class="log-content">
          <div class="log-method">
            <n-tag :type="log.status === 'success' ? 'success' : 'error'" size="small">
              {{ log.method }}
            </n-tag>
            <span class="log-path">{{ log.path }}</span>
            <n-tag :type="log.status === 'success' ? 'success' : 'error'" size="small">
              {{ log.statusCode }}
            </n-tag>
          </div>

          <div class="log-details">
            <div class="detail-item">
              <n-text depth="3" style="font-size: 11px;">Input: {{ formatTokens(log.tokens?.input || 0) }}</n-text>
            </div>
            <div class="detail-item">
              <n-text depth="3" style="font-size: 11px;">Output: {{ formatTokens(log.tokens?.output || 0) }}</n-text>
            </div>
            <div class="detail-item">
              <n-text depth="3" style="font-size: 11px;">Cost: ${{ (log.cost || 0).toFixed(4) }}</n-text>
            </div>
            <div class="detail-item">
              <n-text depth="3" style="font-size: 11px;">Duration: {{ log.duration }}ms</n-text>
            </div>
          </div>

          <div v-if="log.error" class="log-error">
            <n-text type="error" style="font-size: 12px;">{{ log.error }}</n-text>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, watch } from 'vue'
import { NIcon, NText, NTag, NCheckbox, NButton } from 'naive-ui'
import { RadioOutline, TrashOutline, DocumentTextOutline } from '@vicons/ionicons5'
import { useGlobalState } from '../../composables/useGlobalState'

const { getLogs, clearLogsState, logLimit } = useGlobalState()
const claudeLogs = getLogs('claude')
const codexLogs = getLogs('codex')
const geminiLogs = getLogs('gemini')

const autoScroll = ref(true)
const logsContainer = ref(null)

function normalizeLog(log) {
  return {
    id: log.id,
    timestamp: log.timestamp || Date.now(),
    channelType: log.source || 'claude',
    channelName: log.channel || 'Unknown',
    method: 'REQUEST',
    path: log.model || 'N/A',
    status: 'success',
    statusCode: '200',
    tokens: log.tokens || {},
    cost: log.cost || 0,
    duration: log.duration || 0,
    error: log.type === 'action' ? null : log.error || null,
    type: log.type || 'log'
  }
}

const logs = computed(() => {
  const merged = [
    ...claudeLogs.value.map(normalizeLog),
    ...codexLogs.value.map(normalizeLog),
    ...geminiLogs.value.map(normalizeLog)
  ]
  return merged
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, logLimit.value)
})

function formatTime(timestamp) {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('en-US', { hour12: false })
}

function formatTokens(num) {
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K'
  }
  return num.toString()
}

watch(logs, () => {
  if (!autoScroll.value) return
  nextTick(() => {
    if (logsContainer.value) {
      logsContainer.value.scrollTop = 0
    }
  })
})

function clearLogs() {
  clearLogsState()
}
</script>

<style scoped>
.panel-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 12px;
  padding: 20px;
}

.logs-panel {
  display: flex;
  flex-direction: column;
  height: 600px;
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
  flex: 1;
  color: var(--text-primary);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logs-container {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 8px;
}

.logs-container::-webkit-scrollbar {
  width: 6px;
}

.logs-container::-webkit-scrollbar-track {
  background: transparent;
}

.logs-container::-webkit-scrollbar-thumb {
  background: var(--border-primary);
  border-radius: 3px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 60px 20px;
  text-align: center;
}

.log-entry {
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-left: 3px solid var(--border-primary);
  border-radius: 6px;
  padding: 12px;
  transition: all 0.2s ease;
}

.log-entry:hover {
  border-left-color: #18a058;
}

.log-entry.success {
  border-left-color: #18a058;
}

.log-entry.error {
  border-left-color: #d03050;
}

.log-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.log-status {
  display: flex;
  align-items: center;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--border-secondary);
}

.log-status.success .status-dot {
  background: #18a058;
  box-shadow: 0 0 8px rgba(24, 160, 88, 0.5);
}

.log-status.error .status-dot {
  background: #d03050;
  box-shadow: 0 0 8px rgba(208, 48, 80, 0.5);
}

.log-time {
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: 'Monaco', 'Courier New', monospace;
}

.log-channel {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.channel-badge {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--border-primary);
  color: var(--text-secondary);
}

.log-channel.claude .channel-badge {
  background: rgba(24, 160, 88, 0.2);
  color: #18a058;
}

.log-channel.codex .channel-badge {
  background: rgba(59, 130, 246, 0.2);
  color: #3b82f6;
}

.log-channel.gemini .channel-badge {
  background: rgba(168, 85, 247, 0.2);
  color: #a855f7;
}

.channel-name {
  font-size: 11px;
  color: var(--text-tertiary);
}

.log-content {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.log-method {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.log-path {
  font-family: 'Monaco', 'Courier New', monospace;
  color: var(--text-secondary);
  flex: 1;
}

.log-details {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.detail-item {
  display: flex;
  align-items: center;
}

.log-error {
  margin-top: 4px;
  padding: 6px 8px;
  background: rgba(208, 48, 80, 0.1);
  border-radius: 4px;
}
</style>
