<template>
  <div class="proxy-logs">
    <div class="logs-header">
      <div class="header-left">
        <h3 class="title">实时日志</h3>
        <div class="today-stats">
          <n-tag size="tiny" :bordered="false" type="info">
            今日请求: {{ todayStats.requests }}
          </n-tag>
          <n-tag size="tiny" :bordered="false" type="success">
            今日Token: {{ formatNumber(todayStats.tokens) }}
          </n-tag>
        </div>
      </div>
      <n-button text size="small" @click="clearLogs">
        <n-icon size="16"><TrashOutline /></n-icon>
        清空
      </n-button>
    </div>

    <div class="logs-table">
      <!-- 表头 -->
      <div class="table-header" :class="`table-header-${source}`">
        <div class="col col-channel" :class="`col-channel-${source}`">渠道</div>
        <div class="col col-token" :class="`col-token-${source}`">请求</div>
        <div class="col col-token" :class="`col-token-${source}`">回复</div>
        <template v-if="source === 'claude'">
          <div class="col col-token" :class="`col-token-${source}`">写入</div>
          <div class="col col-token" :class="`col-token-${source}`">命中</div>
        </template>
        <template v-else-if="source === 'codex'">
          <div class="col col-token" :class="`col-token-${source}`">推理</div>
          <div class="col col-token" :class="`col-token-${source}`">缓存</div>
          <div class="col col-token" :class="`col-token-${source}`">总计</div>
        </template>
        <template v-else-if="source === 'gemini'">
          <div class="col col-token" :class="`col-token-${source}`">缓存</div>
          <div class="col col-token" :class="`col-token-${source}`">总计</div>
        </template>
        <div class="col col-time" :class="`col-time-${source}`">时间</div>
      </div>

      <!-- 内容区域（可滚动） -->
      <div class="table-body" ref="tableBody">
        <div v-if="filteredLogs.length === 0" class="empty-state">
          暂无日志
        </div>

        <!-- 行为日志 - 占一整行 -->
        <div
          v-for="log in filteredLogs"
          :key="log.id"
          :class="[
            log.type === 'action' ? 'action-row' : 'table-row',
            { 'new-log': log.isNew }
          ]"
        >
          <!-- 行为日志样式 -->
          <template v-if="log.type === 'action'">
            <n-icon size="16" style="color: #18a058; margin-right: 8px;">
              <CheckmarkCircle />
            </n-icon>
            <span class="action-message">{{ log.message }}</span>
            <span class="action-time">{{ log.time }}</span>
          </template>

          <!-- 普通日志样式 -->
          <template v-else>
            <n-tooltip placement="top" :style="{ maxWidth: '300px' }">
              <template #trigger>
                <div class="table-row-content" :class="`table-row-content-${source}`">
                  <div class="col col-channel" :class="`col-channel-${source}`" :title="log.channel">
                    <n-tag size="small" type="success">{{ log.channel }}</n-tag>
                  </div>
                  <div class="col col-token" :class="`col-token-${source}`">{{ log.tokens?.input || 0 }}</div>
                  <div class="col col-token" :class="`col-token-${source}`">{{ log.tokens?.output || 0 }}</div>
                  <template v-if="source === 'claude'">
                    <div class="col col-token" :class="`col-token-${source}`">{{ log.tokens?.cacheCreation || 0 }}</div>
                    <div class="col col-token" :class="`col-token-${source}`">{{ log.tokens?.cacheRead || 0 }}</div>
                  </template>
                  <template v-else-if="source === 'codex'">
                    <div class="col col-token" :class="`col-token-${source}`">{{ log.tokens?.reasoning || 0 }}</div>
                    <div class="col col-token" :class="`col-token-${source}`">{{ log.tokens?.cached || 0 }}</div>
                    <div class="col col-token" :class="`col-token-${source}`">{{ log.tokens?.total || 0 }}</div>
                  </template>
                  <template v-else-if="source === 'gemini'">
                    <div class="col col-token" :class="`col-token-${source}`">{{ log.tokens?.cached || 0 }}</div>
                    <div class="col col-token" :class="`col-token-${source}`">{{ log.tokens?.total || 0 }}</div>
                  </template>
                  <div class="col col-time" :class="`col-time-${source}`">{{ log.time }}</div>
                </div>
              </template>
              <div v-if="log.model">
                <div style="font-weight: 600; margin-bottom: 4px;">模型信息</div>
                <div style="font-family: monospace; font-size: 12px;">{{ log.model }}</div>
              </div>
              <div v-else>暂无模型信息</div>
            </n-tooltip>
          </template>
        </div>
      </div>
    </div>

    <div class="logs-footer">
      <span class="status" :class="{ connected: wsConnected }">
        <n-icon size="14">
          <component :is="wsConnected ? CheckmarkCircle : CloseCircle" />
        </n-icon>
        {{ wsConnected ? '已连接' : '未连接' }}
      </span>
      <span class="count">共 {{ filteredLogs.length }} 条</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { NButton, NIcon, NTag, NTooltip } from 'naive-ui'
import { TrashOutline, CheckmarkCircle, CloseCircle } from '@vicons/ionicons5'
import { getTodayStatistics } from '../api/statistics'
import { clearProxyLogs } from '../api/proxy'
import message from '../utils/message'
import { useGlobalState } from '../composables/useGlobalState'

// Props
const props = defineProps({
  source: {
    type: String,
    default: 'claude' // 'claude' or 'codex'
  }
})

const { getLogs, wsConnected, clearLogsState, logLimit } = useGlobalState()
const logStreams = {
  claude: getLogs('claude'),
  codex: getLogs('codex'),
  gemini: getLogs('gemini')
}

const filteredLogs = computed(() => {
  const stream = logStreams[props.source] || logStreams.claude
  const list = stream.value || []
  return list.slice(0, logLimit.value)
})
const logsBefore = ref(filteredLogs.value.length)
const tableBody = ref(null)
const todayStats = ref({
  requests: 0,
  tokens: 0
})
let statsUpdateTimer = null // 统计数据更新定时器
let latestRenderedId = null

// 格式化数字（添加千位分隔符）
function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M'
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K'
  }
  return num.toString()
}

// 加载今日统计数据（根据 source 过滤）
async function loadTodayStats() {
  try {
    const stats = await getTodayStatistics()

    // 根据 source 获取对应工具类型的统计
    // Claude 的 toolType 是 'claude-code'，Codex 的是 'codex'，Gemini 的是 'gemini'
    let toolType = 'claude-code'
    if (props.source === 'codex') {
      toolType = 'codex'
    } else if (props.source === 'gemini') {
      toolType = 'gemini'
    }

    const toolStats = stats.byToolType?.[toolType]

    if (toolStats) {
      todayStats.value = {
        requests: toolStats.requests || 0,
        tokens: toolStats.tokens?.total || 0
      }
    } else {
      todayStats.value = {
        requests: 0,
        tokens: 0
      }
    }
  } catch (err) {
    // 静默失败，不影响日志功能
    console.error('Failed to load today statistics:', err)
  }
}

// 启动定时更新统计数据（每30秒更新一次）
function startStatsUpdate() {
  loadTodayStats()
  statsUpdateTimer = setInterval(() => {
    loadTodayStats()
  }, 30000)
}

watch(filteredLogs, (newLogs) => {
  const newestId = newLogs[0]?.id || null
  if (!newestId || newestId === latestRenderedId) {
    latestRenderedId = newestId
    return
  }

  latestRenderedId = newestId
  const isNearTop = tableBody.value ? tableBody.value.scrollTop < 20 : true
  if (isNearTop) {
    nextTick(() => {
      if (tableBody.value) {
        tableBody.value.scrollTop = 0
      }
    })
  }
})

// 清空日志
async function clearLogs() {
  try {
    await clearProxyLogs()
    clearLogsState()
    message.success('日志已清空')
  } catch (err) {
    message.error('清空失败: ' + err.message)
  }
}

// 监听 source 变化，重新加载统计数据
watch(() => props.source, () => {
  loadTodayStats()
  latestRenderedId = filteredLogs.value[0]?.id || null
})

onMounted(() => {
  startStatsUpdate() // 启动统计数据更新
})

onUnmounted(() => {
  // 清除统计数据更新定时器
  if (statsUpdateTimer) {
    clearInterval(statsUpdateTimer)
    statsUpdateTimer = null
  }
})
</script>

<style scoped>
.proxy-logs {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #ffffff;
  border-top: 1px solid #e5e7eb;
}

[data-theme="dark"] .proxy-logs {
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-primary);
}

.logs-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
}

[data-theme="dark"] .logs-header {
  border-bottom: 1px solid var(--border-primary);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #18181b;
}

[data-theme="dark"] .title {
  color: var(--text-primary);
}

.today-stats {
  display: flex;
  align-items: center;
  gap: 6px;
}

.today-stats :deep(.n-tag) {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
}

.logs-table {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.table-header {
  flex-shrink: 0;
  display: flex;
  padding: 8px 12px;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  font-size: 11px;
  font-weight: 600;
  color: #6b7280;
  white-space: nowrap;
}

[data-theme="dark"] .table-header {
  background: rgba(255, 255, 255, 0.02);
  border-bottom: 1px solid var(--border-primary);
  color: var(--text-tertiary);
}

.table-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding-bottom: 40px;
  scroll-padding-bottom: 40px;
}

.table-row {
  display: flex;
  padding: 8px 12px;
  border-bottom: 1px solid #f3f4f6;
  font-size: 12px;
  transition: background-color 0.2s;
  cursor: pointer;
  position: relative;
}

[data-theme="dark"] .table-row {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.table-row:hover {
  background: #f9fafb;
}

[data-theme="dark"] .table-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

/* 新日志高亮动画 - 柔和版本 */
.table-row.new-log {
  animation: newLogPulse 4.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
  border-left: 3px solid #18a058;
  padding-left: 9px;
}

.action-row.new-log {
  animation: newLogPulse 4.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
  border-left: 3px solid #18a058;
  padding-left: 9px;
}

@keyframes newLogPulse {
  0% {
    background: linear-gradient(90deg, rgba(24, 160, 88, 0.15) 0%, rgba(24, 160, 88, 0.06) 100%);
    box-shadow: 0 0 8px 0 rgba(24, 160, 88, 0.2);
  }
  5% {
    background: linear-gradient(90deg, rgba(24, 160, 88, 0.18) 0%, rgba(24, 160, 88, 0.08) 100%);
    box-shadow: 0 0 12px 1px rgba(24, 160, 88, 0.25);
  }
  15% {
    background: linear-gradient(90deg, rgba(24, 160, 88, 0.16) 0%, rgba(24, 160, 88, 0.07) 100%);
    box-shadow: 0 0 10px 1px rgba(24, 160, 88, 0.2);
  }
  30% {
    background: linear-gradient(90deg, rgba(24, 160, 88, 0.12) 0%, rgba(24, 160, 88, 0.05) 100%);
    box-shadow: 0 0 6px 0 rgba(24, 160, 88, 0.15);
  }
  50% {
    background: linear-gradient(90deg, rgba(24, 160, 88, 0.08) 0%, rgba(24, 160, 88, 0.03) 100%);
    box-shadow: 0 0 4px 0 rgba(24, 160, 88, 0.1);
  }
  70% {
    background: linear-gradient(90deg, rgba(24, 160, 88, 0.04) 0%, rgba(24, 160, 88, 0.015) 100%);
    box-shadow: 0 0 2px 0 rgba(24, 160, 88, 0.06);
  }
  85% {
    background: linear-gradient(90deg, rgba(24, 160, 88, 0.02) 0%, rgba(24, 160, 88, 0.008) 100%);
    box-shadow: 0 0 1px 0 rgba(24, 160, 88, 0.03);
  }
  100% {
    background: transparent;
    box-shadow: 0 0 0 0 rgba(24, 160, 88, 0);
    border-left-color: transparent;
  }
}

/* 暗色主题下的新日志高亮 - 柔和版本 */
[data-theme="dark"] .table-row.new-log,
[data-theme="dark"] .action-row.new-log {
  animation: newLogPulseDark 4.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
}

@keyframes newLogPulseDark {
  0% {
    background: linear-gradient(90deg, rgba(24, 160, 88, 0.2) 0%, rgba(24, 160, 88, 0.08) 100%);
    box-shadow: 0 0 10px 0 rgba(24, 160, 88, 0.25);
  }
  5% {
    background: linear-gradient(90deg, rgba(24, 160, 88, 0.24) 0%, rgba(24, 160, 88, 0.1) 100%);
    box-shadow: 0 0 14px 2px rgba(24, 160, 88, 0.3);
  }
  15% {
    background: linear-gradient(90deg, rgba(24, 160, 88, 0.21) 0%, rgba(24, 160, 88, 0.09) 100%);
    box-shadow: 0 0 12px 1px rgba(24, 160, 88, 0.25);
  }
  30% {
    background: linear-gradient(90deg, rgba(24, 160, 88, 0.16) 0%, rgba(24, 160, 88, 0.07) 100%);
    box-shadow: 0 0 8px 1px rgba(24, 160, 88, 0.18);
  }
  50% {
    background: linear-gradient(90deg, rgba(24, 160, 88, 0.11) 0%, rgba(24, 160, 88, 0.045) 100%);
    box-shadow: 0 0 5px 0 rgba(24, 160, 88, 0.12);
  }
  70% {
    background: linear-gradient(90deg, rgba(24, 160, 88, 0.06) 0%, rgba(24, 160, 88, 0.024) 100%);
    box-shadow: 0 0 3px 0 rgba(24, 160, 88, 0.08);
  }
  85% {
    background: linear-gradient(90deg, rgba(24, 160, 88, 0.03) 0%, rgba(24, 160, 88, 0.012) 100%);
    box-shadow: 0 0 1px 0 rgba(24, 160, 88, 0.04);
  }
  100% {
    background: transparent;
    box-shadow: 0 0 0 0 rgba(24, 160, 88, 0);
    border-left-color: transparent;
  }
}

.table-row-content {
  display: flex;
  width: 100%;
}

/* 行为日志样式 */
.action-row {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid #f3f4f6;
  background: #f0fdf4;
  font-size: 13px;
  color: #166534;
  border-left: 3px solid #18a058;
}

[data-theme="dark"] .action-row {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  background: rgba(24, 160, 88, 0.12);
  color: #4ade80;
}

.action-message {
  flex: 1;
  font-weight: 500;
}

.action-time {
  font-size: 11px;
  font-family: monospace;
  color: #6b7280;
  margin-left: 12px;
  margin-right: 22px;
}

[data-theme="dark"] .action-time {
  color: var(--text-tertiary);
}

.col {
  display: flex;
  align-items: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Claude 渠道列宽 (6列) */
.col-channel-claude {
  flex: 0 0 90px;
  min-width: 0;
  overflow: hidden;
}

.col-token-claude {
  flex: 0 0 68px;
  justify-content: center;
  min-width: 0;
}

.col-time-claude {
  flex: 0 0 100px;
  min-width: 100px;
  font-family: monospace;
  font-size: 11px;
  justify-content: flex-end;
  padding-left: 10px;
  padding-right: 6px;
}

/* Codex 渠道列宽 (7列，需要压缩) */
.col-channel-codex {
  flex: 0 0 75px;
  min-width: 0;
  overflow: hidden;
}

.col-token-codex {
  flex: 0 0 58px;
  justify-content: center;
  min-width: 0;
}

.col-time-codex {
  flex: 0 0 92px;
  min-width: 92px;
  font-family: monospace;
  font-size: 11px;
  justify-content: flex-end;
  padding-left: 10px;
  padding-right: 6px;
}

/* Gemini 渠道列宽 (6列) */
.col-channel-gemini {
  flex: 0 0 90px;
  min-width: 0;
  overflow: hidden;
}

.col-token-gemini {
  flex: 0 0 68px;
  justify-content: center;
  min-width: 0;
}

.col-time-gemini {
  flex: 0 0 100px;
  min-width: 100px;
  font-family: monospace;
  font-size: 11px;
  justify-content: flex-end;
  padding-left: 10px;
  padding-right: 6px;
}

/* 通用样式（保留以防兼容性问题） */
.col-channel {
  min-width: 0;
  overflow: hidden;
}

.col-channel .n-tag {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.col-token {
  justify-content: center;
  min-width: 0;
}

.col-time {
  font-family: monospace;
  font-size: 11px;
  justify-content: flex-end;
}

.empty-state {
  padding: 40px 16px;
  text-align: center;
  font-size: 13px;
  color: #9ca3af;
}

[data-theme="dark"] .empty-state {
  color: var(--text-tertiary);
}

.logs-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-top: 1px solid #e5e7eb;
  font-size: 12px;
  color: #6b7280;
}

[data-theme="dark"] .logs-footer {
  border-top: 1px solid var(--border-primary);
  color: var(--text-tertiary);
}

.status {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #ef4444;
}

.status.connected {
  color: #10b981;
}

[data-theme="dark"] .status.connected {
  color: #4ade80;
}

.count {
  color: #6b7280;
}

[data-theme="dark"] .count {
  color: var(--text-tertiary);
}
</style>
