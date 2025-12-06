<template>
  <n-drawer v-model:show="visible" :width="drawerWidth" placement="right" :show-mask="true">
    <n-drawer-content closable :native-scrollbar="false">
      <template #header>
        <div class="drawer-header">
          <div class="header-icon-wrapper">
            <n-icon :size="18">
              <SpeedometerOutline />
            </n-icon>
          </div>
          <span>渠道速度测试</span>
        </div>
      </template>

      <div class="speed-test-container">
        <!-- 测试控制 -->
        <div class="test-controls">
          <n-button
            type="primary"
            :loading="testing"
            :disabled="testing"
            @click="runAllTests"
            class="test-btn"
          >
            <template #icon>
              <n-icon><PlayOutline /></n-icon>
            </template>
            {{ testing ? '测试中...' : '开始全部测试' }}
          </n-button>
          <n-select
            v-model:value="selectedChannel"
            :options="channelOptions"
            placeholder="选择渠道类型"
            style="width: 140px;"
          />
        </div>

        <!-- 测试摘要 -->
        <div v-if="testSummary" class="test-summary">
          <div class="summary-item">
            <span class="summary-label">总计</span>
            <span class="summary-value">{{ testSummary.total }}</span>
          </div>
          <div class="summary-item success">
            <span class="summary-label">成功</span>
            <span class="summary-value">{{ testSummary.success }}</span>
          </div>
          <div class="summary-item failed">
            <span class="summary-label">失败</span>
            <span class="summary-value">{{ testSummary.failed }}</span>
          </div>
          <div class="summary-item avg">
            <span class="summary-label">平均延迟</span>
            <span class="summary-value">{{ testSummary.avgLatency ? testSummary.avgLatency + 'ms' : '-' }}</span>
          </div>
        </div>

        <!-- 测试结果列表 -->
        <div class="results-list">
          <!-- Loading 状态 - 居中显示 -->
          <div v-if="testing && results.length === 0" class="loading-state">
            <n-spin size="large" />
            <p class="loading-text">正在测试渠道连接速度和 API 可用性...</p>
          </div>

          <!-- 空状态 -->
          <div v-else-if="results.length === 0 && !testing" class="empty-state">
            <div class="empty-icon-wrapper">
              <n-icon :size="32">
                <SpeedometerOutline />
              </n-icon>
            </div>
            <p class="empty-title">暂无测试结果</p>
            <p class="empty-desc">点击上方按钮开始测试渠道连接速度</p>
          </div>

          <!-- 结果列表 -->
          <div v-else class="result-cards">
            <div
              v-for="result in results"
              :key="result.channelId"
              class="result-card"
              :class="[
                result.success ? 'success' : 'failed',
                result.testing ? 'testing' : ''
              ]"
            >
              <div class="result-header">
                <div class="channel-info">
                  <span class="channel-type-badge" :class="getChannelTypeClass(result.channelType)">
                    {{ getChannelTypeLabel(result.channelType) }}
                  </span>
                  <span class="channel-name">{{ getCleanChannelName(result.channelName) }}</span>
                </div>
                <div class="result-status">
                  <n-spin v-if="result.testing" :size="14" />
                  <template v-else>
                    <span v-if="result.success" class="latency-badge" :class="result.level">
                      {{ result.latency }}ms
                    </span>
                    <span v-else class="status-badge failed">失败</span>
                  </template>
                </div>
              </div>

              <div v-if="!result.testing" class="result-details">
                <template v-if="result.success">
                  <div class="latency-bar">
                    <div
                      class="latency-fill"
                      :class="result.level"
                      :style="{ width: getLatencyWidth(result.latency) + '%' }"
                    ></div>
                  </div>
                  <span class="latency-level" :class="result.level">
                    {{ getLevelText(result.level) }}
                  </span>
                </template>
                <template v-else>
                  <div class="error-info">
                    <div class="error-container">
                      <n-icon :size="14" class="error-icon"><AlertCircleOutline /></n-icon>
                      <span class="error-msg">{{ result.error }}</span>
                    </div>
                    <!-- 失败时也显示延迟，表明网络是通的 -->
                    <span v-if="result.latency" class="error-latency">
                      响应 {{ result.latency }}ms
                    </span>
                  </div>
                </template>
              </div>

              <!-- 显示网络和 API 状态指示器 -->
              <div v-if="!result.testing" class="result-meta">
                <span class="meta-item status-indicator">
                  <span :class="['status-dot', result.networkOk ? 'ok' : 'fail']"></span>
                  网络{{ result.networkOk ? '正常' : '异常' }}
                </span>
                <span class="meta-item status-indicator">
                  <span :class="['status-dot', result.apiOk ? 'ok' : 'fail']"></span>
                  API{{ result.apiOk ? '可用' : '不可用' }}
                </span>
                <span v-if="result.statusCode" class="meta-item http-code">HTTP {{ result.statusCode }}</span>
                <span v-if="result.testedAt" class="meta-item time">{{ formatTime(result.testedAt) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 缓存提示 -->
        <div v-if="hasCachedResults && !testing" class="cache-hint">
          <n-icon :size="14"><TimeOutline /></n-icon>
          <span>显示的是缓存的测试结果，点击按钮重新测试</span>
        </div>
      </div>
    </n-drawer-content>
  </n-drawer>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { NDrawer, NDrawerContent, NButton, NIcon, NSpin, NTag, NSelect } from 'naive-ui'
import { SpeedometerOutline, PlayOutline, TimeOutline, AlertCircleOutline } from '@vicons/ionicons5'
import {
  testAllClaudeChannelsSpeed,
  testAllCodexChannelsSpeed,
  testAllGeminiChannelsSpeed
} from '../api/channels'
import message from '../utils/message'
import { useResponsiveDrawer } from '../composables/useResponsiveDrawer'

const { drawerWidth } = useResponsiveDrawer(520)

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:visible'])

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

const testing = ref(false)
const results = ref([])
const testSummary = ref(null)
const selectedChannel = ref('all')
const hasCachedResults = ref(false)

// localStorage 缓存 key
const CACHE_KEY = 'speedTestResults'
const CACHE_SUMMARY_KEY = 'speedTestSummary'
const CACHE_TIME_KEY = 'speedTestTime'
const CACHE_DURATION = 5 * 60 * 1000 // 5 分钟缓存

const channelOptions = [
  { label: '全部渠道', value: 'all' },
  { label: 'Claude', value: 'claude' },
  { label: 'Codex', value: 'codex' },
  { label: 'Gemini', value: 'gemini' }
]

// 从缓存加载结果
function loadFromCache() {
  try {
    const cachedTime = localStorage.getItem(CACHE_TIME_KEY)
    if (cachedTime && Date.now() - parseInt(cachedTime) < CACHE_DURATION) {
      const cachedResults = localStorage.getItem(CACHE_KEY)
      const cachedSummary = localStorage.getItem(CACHE_SUMMARY_KEY)
      if (cachedResults) {
        results.value = JSON.parse(cachedResults)
        hasCachedResults.value = true
      }
      if (cachedSummary) {
        testSummary.value = JSON.parse(cachedSummary)
      }
      return true
    }
  } catch (e) {
    console.error('Failed to load speed test cache:', e)
  }
  return false
}

// 保存到缓存
function saveToCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(results.value))
    localStorage.setItem(CACHE_SUMMARY_KEY, JSON.stringify(testSummary.value))
    localStorage.setItem(CACHE_TIME_KEY, Date.now().toString())
  } catch (e) {
    console.error('Failed to save speed test cache:', e)
  }
}

// 运行所有测试
async function runAllTests() {
  testing.value = true
  results.value = []
  testSummary.value = null
  hasCachedResults.value = false

  const testFunctions = []

  if (selectedChannel.value === 'all' || selectedChannel.value === 'claude') {
    testFunctions.push({ type: 'claude', fn: testAllClaudeChannelsSpeed })
  }
  if (selectedChannel.value === 'all' || selectedChannel.value === 'codex') {
    testFunctions.push({ type: 'codex', fn: testAllCodexChannelsSpeed })
  }
  if (selectedChannel.value === 'all' || selectedChannel.value === 'gemini') {
    testFunctions.push({ type: 'gemini', fn: testAllGeminiChannelsSpeed })
  }

  let allResults = []
  let totalSummary = { total: 0, success: 0, failed: 0, avgLatency: null }
  let totalLatency = 0
  let latencyCount = 0

  try {
    for (const { type, fn } of testFunctions) {
      try {
        const response = await fn(10000)
        if (response.results) {
          const typedResults = response.results.map(r => ({
            ...r,
            channelType: type,
            channelName: `[${type.toUpperCase()}] ${r.channelName}`,
            testedAt: Date.now()
          }))
          allResults = allResults.concat(typedResults)
          results.value = [...allResults]

          // 累加统计
          if (response.summary) {
            totalSummary.total += response.summary.total || 0
            totalSummary.success += response.summary.success || 0
            totalSummary.failed += response.summary.failed || 0
            if (response.summary.avgLatency) {
              totalLatency += response.summary.avgLatency * (response.summary.success || 0)
              latencyCount += response.summary.success || 0
            }
          }
        }
      } catch (err) {
        console.error(`Failed to test ${type} channels:`, err)
      }
    }

    // 计算总平均延迟
    totalSummary.avgLatency = latencyCount > 0 ? Math.round(totalLatency / latencyCount) : null

    // 按延迟排序
    results.value = allResults.sort((a, b) => {
      if (a.success && !b.success) return -1
      if (!a.success && b.success) return 1
      if (a.success && b.success) return (a.latency || Infinity) - (b.latency || Infinity)
      return 0
    })

    testSummary.value = totalSummary

    // 保存到缓存
    saveToCache()

    if (totalSummary.total === 0) {
      message.info('没有找到可测试的渠道')
    } else {
      message.success(`测试完成: ${totalSummary.success}/${totalSummary.total} 成功`)
    }
  } catch (err) {
    console.error('Speed test failed:', err)
    message.error('测试失败: ' + err.message)
  } finally {
    testing.value = false
  }
}

// 获取延迟等级对应的类型
function getLevelType(level) {
  switch (level) {
    case 'excellent': return 'success'
    case 'good': return 'info'
    case 'fair': return 'warning'
    case 'poor': return 'error'
    default: return 'default'
  }
}

// 获取延迟等级文字
function getLevelText(level) {
  switch (level) {
    case 'excellent': return '优秀'
    case 'good': return '良好'
    case 'fair': return '一般'
    case 'poor': return '较差'
    default: return '-'
  }
}

// 计算延迟条宽度（最大 3000ms）
function getLatencyWidth(latency) {
  if (!latency) return 0
  return Math.min((latency / 3000) * 100, 100)
}

// 格式化时间
function formatTime(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// 获取渠道类型标签
function getChannelTypeLabel(type) {
  switch (type) {
    case 'claude': return 'Claude'
    case 'codex': return 'Codex'
    case 'gemini': return 'Gemini'
    default: return type?.toUpperCase() || ''
  }
}

// 获取渠道类型样式类
function getChannelTypeClass(type) {
  switch (type) {
    case 'claude': return 'type-claude'
    case 'codex': return 'type-codex'
    case 'gemini': return 'type-gemini'
    default: return ''
  }
}

// 清理渠道名称（移除类型前缀）
function getCleanChannelName(name) {
  if (!name) return ''
  return name.replace(/^\[(CLAUDE|CODEX|GEMINI)\]\s*/i, '')
}

// 抽屉打开时加载缓存
watch(() => props.visible, (val) => {
  if (val) {
    // 尝试从缓存加载
    loadFromCache()
  }
})
</script>

<style scoped>
.drawer-header {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.header-icon-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%);
  border-radius: 8px;
  color: white;
}

.speed-test-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.test-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.test-btn {
  border-radius: 6px;
}

.test-summary {
  display: flex;
  gap: 8px;
  padding: 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 10px;
}

.summary-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 8px;
  background: var(--bg-primary);
  border-radius: 8px;
}

.summary-label {
  font-size: 11px;
  color: var(--text-tertiary);
  font-weight: 500;
}

.summary-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
}

.summary-item.success .summary-value {
  color: #18a058;
}

.summary-item.failed .summary-value {
  color: #f56c6c;
}

.summary-item.avg .summary-value {
  color: #f59e0b;
  font-size: 16px;
}

.results-list {
  min-height: 200px;
}

/* Loading 状态 */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  gap: 16px;
}

.loading-text {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
  min-height: 300px;
}

.empty-icon-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  background: var(--bg-tertiary);
  border-radius: 16px;
  color: var(--text-tertiary);
  margin-bottom: 16px;
}

.empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 6px 0;
}

.empty-desc {
  font-size: 13px;
  color: var(--text-tertiary);
  margin: 0;
}

/* 结果卡片 */
.result-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.result-card {
  padding: 12px 14px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 10px;
  transition: all 0.2s ease;
}

.result-card:hover {
  border-color: var(--border-secondary);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.result-card.success {
  border-left: 3px solid #18a058;
}

.result-card.failed {
  border-left: 3px solid #f56c6c;
}

.result-card.testing {
  border-left: 3px solid #f59e0b;
  opacity: 0.8;
}

.result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.channel-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.channel-type-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  font-size: 10px;
  font-weight: 600;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.channel-type-badge.type-claude {
  background: linear-gradient(135deg, #d97706 0%, #f59e0b 100%);
  color: white;
}

.channel-type-badge.type-codex {
  background: linear-gradient(135deg, #059669 0%, #10b981 100%);
  color: white;
}

.channel-type-badge.type-gemini {
  background: linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%);
  color: white;
}

.channel-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.result-status {
  display: flex;
  align-items: center;
}

.latency-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 6px;
  font-family: 'SF Mono', Monaco, monospace;
}

.latency-badge.excellent {
  background: rgba(24, 160, 88, 0.1);
  color: #18a058;
}

.latency-badge.good {
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
}

.latency-badge.fair {
  background: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
}

.latency-badge.poor {
  background: rgba(245, 108, 108, 0.1);
  color: #f56c6c;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 6px;
}

.status-badge.failed {
  background: rgba(245, 108, 108, 0.1);
  color: #f56c6c;
}

.result-details {
  display: flex;
  align-items: center;
  gap: 12px;
}

.latency-bar {
  flex: 1;
  height: 4px;
  background: var(--bg-tertiary);
  border-radius: 2px;
  overflow: hidden;
}

.latency-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s ease;
}

.latency-fill.excellent {
  background: linear-gradient(90deg, #18a058, #34d399);
}

.latency-fill.good {
  background: linear-gradient(90deg, #3b82f6, #60a5fa);
}

.latency-fill.fair {
  background: linear-gradient(90deg, #f59e0b, #fbbf24);
}

.latency-fill.poor {
  background: linear-gradient(90deg, #f56c6c, #ff8c8c);
}

.latency-level {
  font-size: 11px;
  font-weight: 600;
  min-width: 32px;
  text-align: right;
}

.latency-level.excellent { color: #18a058; }
.latency-level.good { color: #3b82f6; }
.latency-level.fair { color: #f59e0b; }
.latency-level.poor { color: #f56c6c; }

/* 错误信息 */
.error-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
}

.error-container {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 10px;
  background: rgba(245, 108, 108, 0.06);
  border-radius: 6px;
  flex: 1;
}

.error-icon {
  color: #f56c6c;
  flex-shrink: 0;
  margin-top: 1px;
}

.error-msg {
  font-size: 12px;
  color: #f56c6c;
  line-height: 1.4;
  word-break: break-word;
}

.error-latency {
  font-size: 11px;
  font-family: 'SF Mono', Monaco, monospace;
  color: var(--text-tertiary);
  background: var(--bg-tertiary);
  padding: 3px 6px;
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
}

/* 元信息 */
.result-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--border-primary);
}

.meta-item {
  font-size: 11px;
  color: var(--text-tertiary);
}

.meta-item.status-indicator {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-secondary);
  font-family: inherit;
}

.meta-item.http-code {
  font-family: 'SF Mono', Monaco, monospace;
  background: var(--bg-tertiary);
  padding: 1px 5px;
  border-radius: 3px;
}

.meta-item.time {
  font-family: 'SF Mono', Monaco, monospace;
  color: var(--text-quaternary);
}

.status-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.status-dot.ok {
  background-color: #18a058;
  box-shadow: 0 0 4px rgba(24, 160, 88, 0.5);
}

.status-dot.fail {
  background-color: #f56c6c;
  box-shadow: 0 0 4px rgba(245, 108, 108, 0.5);
}

/* 缓存提示 */
.cache-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.15);
  border-radius: 8px;
  font-size: 12px;
  color: #d97706;
}
</style>
