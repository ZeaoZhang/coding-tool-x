<template>
  <div class="analytics-page">
    <!-- Header toolbar -->
    <div class="analytics-header">
      <h2 class="page-title">用量分析</h2>
      <div class="toolbar">
        <!-- Time range presets -->
        <div class="range-buttons">
          <button
            v-for="r in rangePresets"
            :key="r.value"
            class="range-btn"
            :class="{ active: timeRange === r.value }"
            @click="setTimeRange(r.value)"
          >{{ r.label }}</button>
          <div class="custom-range-wrapper">
            <n-date-picker
              v-if="timeRange === 'custom'"
              v-model:value="customRange"
              type="daterange"
              size="small"
              clearable
              :is-date-disabled="isDateDisabled"
              :on-update:value="onCustomRangeChange"
              style="width: 220px"
            />
          </div>
        </div>

        <!-- Filter: toolType -->
        <n-select
          v-model:value="filterToolType"
          :options="filterToolTypeOptions"
          size="small"
          clearable
          placeholder="全部工具"
          style="width: 120px"
          @update:value="onFilterToolTypeChange"
        />

        <!-- Filter: channel -->
        <n-select
          v-model:value="filterChannel"
          :options="filterChannelOptions"
          size="small"
          clearable
          placeholder="全部渠道"
          style="width: 120px"
          @update:value="fetchData"
        />

        <!-- Filter: model -->
        <n-select
          v-model:value="filterModel"
          :options="filterModelOptions"
          size="small"
          clearable
          placeholder="全部模型"
          style="width: 160px"
          @update:value="fetchData"
        />

        <!-- Metric selector -->
        <n-select
          v-model:value="metric"
          :options="metricOptions"
          size="small"
          style="width: 120px"
          @update:value="fetchData"
        />

        <!-- Export dropdown -->
        <n-dropdown :options="exportOptions" @select="handleExport">
          <n-button size="small" :disabled="loading">
            导出
            <template #icon>
              <n-icon><DownloadOutline /></n-icon>
            </template>
          </n-button>
        </n-dropdown>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="loading-overlay">
      <n-spin size="medium" />
    </div>

    <!-- Summary cards -->
    <div class="summary-cards">
      <div class="summary-card">
        <div class="summary-label">总 Token</div>
        <div class="summary-value">{{ formatTokens(summaryStats.tokens) }}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">总费用</div>
        <div class="summary-value">{{ formatCost(summaryStats.cost) }}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">总请求数</div>
        <div class="summary-value">{{ summaryStats.requests.toLocaleString() }}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">日均用量</div>
        <div class="summary-value">{{ formatMetric(summaryStats.avgPerDay) }}</div>
      </div>
    </div>

    <!-- Main stacked bar chart -->
    <div class="chart-section" :class="{ fullscreen: isFullscreen }">
      <div class="chart-section-header">
        <span class="chart-title">按{{ groupByLabel }}用量分布</span>
        <div class="chart-controls">
          <div class="chart-type-toggle">
            <button
              class="toggle-btn"
              :class="{ active: chartType === 'bar' }"
              @click="chartType = 'bar'"
            >柱状图</button>
            <button
              class="toggle-btn"
              :class="{ active: chartType === 'line' }"
              @click="chartType = 'line'"
            >折线图</button>
          </div>
          <button class="icon-btn" @click="toggleFullscreen" :title="isFullscreen ? '退出全屏' : '全屏'">
            <n-icon :size="16"><ExpandOutline v-if="!isFullscreen" /><ContractOutline v-else /></n-icon>
          </button>
        </div>
      </div>
      <v-chart
        v-if="trendData.series.length > 0"
        class="main-chart"
        :option="barOption"
        autoresize
      />
      <div v-else-if="!loading" class="empty-state">暂无数据</div>
    </div>

    <!-- Cumulative line chart -->
    <div class="chart-section cumulative-section">
      <div class="chart-section-header">
        <span class="chart-title">{{ metricLabel }}累计趋势</span>
      </div>
      <v-chart
        v-if="trendData.series.length > 0"
        class="cumulative-chart"
        :option="lineOption"
        autoresize
      />
      <div v-else-if="!loading" class="empty-state">暂无数据</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { NSelect, NButton, NDropdown, NIcon, NSpin, NDatePicker, useMessage } from 'naive-ui'
import { DownloadOutline, ExpandOutline, ContractOutline } from '@vicons/ionicons5'
import '../plugins/echarts'
import VChart from 'vue-echarts'
import { getTrendStatistics, getTrendExportUrl, getAvailableFilters } from '../api/statistics'

const COLORS = ['#3b82f6','#10b981','#a855f7','#f59e0b','#ef4444','#06b6d4','#ec4899','#8b5cf6','#14b8a6','#94a3b8']

const message = useMessage()

// State
const timeRange = ref('7d')
const metric = ref('tokens')
const customRange = ref(null)
const loading = ref(false)
const chartType = ref('bar')
const isFullscreen = ref(false)
const trendData = ref({ labels: [], series: [], totals: {} })
const allMetricsTotals = ref({ tokens: 0, cost: 0, requests: 0 })

// Filter state
const filterToolType = ref(null)
const filterChannel = ref(null)
const filterModel = ref(null)
const availableFilters = ref({ toolTypes: [], channels: [], models: [] })

// Auto-infer groupBy from active filters:
// - filtering by channel → show model breakdown
// - filtering by model  → show channel breakdown
// - filtering by both   → show toolType breakdown
// - filtering by tool only → show model breakdown
// - no filter           → show model breakdown (default)
const groupBy = computed(() => {
  if (filterChannel.value && filterModel.value) return 'toolType'
  if (filterChannel.value) return 'model'
  if (filterModel.value) return 'channel'
  return 'model'
})

const filterToolTypeOptions = computed(() =>
  availableFilters.value.toolTypes.map(t => ({ label: t, value: t }))
)

const filterChannelOptions = computed(() =>
  availableFilters.value.channels.map(c => ({ label: c, value: c }))
)

const filterModelOptions = computed(() =>
  availableFilters.value.models.map(m => ({ label: m, value: m }))
)

async function loadFilters() {
  const { startDate, endDate } = getDateRange()
  try {
    const result = await getAvailableFilters({ startDate, endDate })
    availableFilters.value = result
    const toolTypes = new Set(result?.toolTypes || [])
    const channels = new Set(result?.channels || [])
    const models = new Set(result?.models || [])
    if (filterToolType.value && !toolTypes.has(filterToolType.value)) {
      filterToolType.value = null
    }
    if (filterChannel.value && !channels.has(filterChannel.value)) {
      filterChannel.value = null
    }
    if (filterModel.value && !models.has(filterModel.value)) {
      filterModel.value = null
    }
  } catch (err) {
    console.error('Failed to load available filters:', err)
  }
}

function onFilterToolTypeChange() {
  filterChannel.value = null
  filterModel.value = null
  fetchData()
}

const rangePresets = [
  { value: '1d', label: '1d' },
  { value: '3d', label: '3d' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'custom', label: '自定义' }
]

const metricOptions = [
  { label: 'Token 用量', value: 'tokens' },
  { label: '费用', value: 'cost' },
  { label: '请求数', value: 'requests' }
]

const exportOptions = [
  { label: '导出 CSV', key: 'csv' },
  { label: '导出 JSON', key: 'json' }
]

const groupByLabel = computed(() => {
  const map = { model: '模型', channel: '渠道', toolType: '工具' }
  return map[groupBy.value] || groupBy.value
})

const metricLabel = computed(() => {
  const opt = metricOptions.find(o => o.value === metric.value)
  return opt ? opt.label : metric.value
})

const CST_OFFSET_MS = 8 * 60 * 60 * 1000

function toCSTDateString(value) {
  const ts = value instanceof Date ? value.getTime() : Number(value)
  const base = Number.isFinite(ts) ? ts : Date.now()
  return new Date(base + CST_OFFSET_MS).toISOString().split('T')[0]
}

function shiftDateString(dateStr, deltaDays) {
  const base = new Date(`${dateStr}T00:00:00Z`)
  base.setUTCDate(base.getUTCDate() + deltaDays)
  return base.toISOString().split('T')[0]
}

function clampRangeToToday({ startDate, endDate }) {
  const todayStr = toCSTDateString(Date.now())
  const clampedEnd = endDate > todayStr ? todayStr : endDate
  const clampedStart = startDate > clampedEnd ? clampedEnd : startDate
  return { startDate: clampedStart, endDate: clampedEnd }
}

function getDateRange() {
  const todayStr = toCSTDateString(Date.now())
  if (timeRange.value === 'custom' && customRange.value) {
    const startDate = toCSTDateString(customRange.value[0])
    const endDate = toCSTDateString(customRange.value[1])
    return clampRangeToToday({ startDate, endDate })
  }
  const dayMap = { '1d': 1, '3d': 3, '7d': 7, '30d': 30, '90d': 90 }
  const days = dayMap[timeRange.value] || 7
  const startDate = shiftDateString(todayStr, -(days - 1))
  return { startDate, endDate: todayStr }
}

function isDateDisabled(ts) {
  const candidate = toCSTDateString(ts)
  const todayStr = toCSTDateString(Date.now())
  return candidate > todayStr
}

function getGranularity(startDate, endDate) {
  const diff = (new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)
  if (diff <= 1) return { granularity: 'hour', step: 4 }   // 1d: 每4小时
  if (diff <= 3) return { granularity: 'hour', step: 12 }  // 3d: 每12小时
  return { granularity: 'day', step: 1 }
}

async function fetchData() {
  const { startDate, endDate } = getDateRange()
  const { granularity, step } = getGranularity(startDate, endDate)
  loading.value = true
  try {
    const filterParams = {}
    if (filterToolType.value) filterParams.filterToolType = filterToolType.value
    if (filterChannel.value) filterParams.filterChannel = filterChannel.value
    if (filterModel.value) filterParams.filterModel = filterModel.value

    const params = { startDate, endDate, granularity, step, groupBy: groupBy.value, ...filterParams }
    // Always fetch all 3 metrics for summary cards; reuse mainResult when metric matches
    const needTokens = metric.value !== 'tokens'
    const needCost = metric.value !== 'cost'
    const needRequests = metric.value !== 'requests'
    const [mainResult, tokensResult, costResult, requestsResult] = await Promise.all([
      getTrendStatistics({ ...params, metric: metric.value }),
      needTokens ? getTrendStatistics({ ...params, metric: 'tokens' }) : Promise.resolve(null),
      needCost ? getTrendStatistics({ ...params, metric: 'cost' }) : Promise.resolve(null),
      needRequests ? getTrendStatistics({ ...params, metric: 'requests' }) : Promise.resolve(null),
    ])
    const normalizeTrendResult = (result) => {
      const labels = Array.isArray(result?.labels) ? result.labels : []
      const labelCount = labels.length
      const series = Array.isArray(result?.series) ? result.series : []
      const normalizedSeries = series.map((s) => {
        const data = Array.isArray(s?.data) ? s.data.slice(0, labelCount) : []
        if (data.length < labelCount) {
          data.push(...new Array(labelCount - data.length).fill(0))
        }
        const normalizedData = data.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0))
        return { ...s, data: normalizedData }
      })
      return { ...result, labels, series: normalizedSeries }
    }

    const normalizedMain = normalizeTrendResult(mainResult)
    const normalizedTokens = normalizeTrendResult(needTokens ? tokensResult : normalizedMain)
    const normalizedCost = normalizeTrendResult(needCost ? costResult : normalizedMain)
    const normalizedRequests = normalizeTrendResult(needRequests ? requestsResult : normalizedMain)

    trendData.value = normalizedMain
    const sumSeries = (r) => (r.series || []).reduce((sum, s) => sum + (s.data || []).reduce((a, b) => a + (Number.isFinite(Number(b)) ? Number(b) : 0), 0), 0)
    allMetricsTotals.value = {
      tokens: sumSeries(metric.value === 'tokens' ? normalizedMain : normalizedTokens),
      cost: sumSeries(metric.value === 'cost' ? normalizedMain : normalizedCost),
      requests: sumSeries(metric.value === 'requests' ? normalizedMain : normalizedRequests),
    }
  } catch (err) {
    console.error('Failed to fetch trend statistics:', err)
    message.error('加载统计数据失败，请稍后重试')
    trendData.value = { labels: [], series: [], totals: {} }
  } finally {
    loading.value = false
  }
}

async function setTimeRange(val) {
  timeRange.value = val
  if (val !== 'custom') {
    await loadFilters()
    fetchData()
  }
}

async function onCustomRangeChange(val) {
  customRange.value = val
  if (val) {
    const startDate = toCSTDateString(val[0])
    const endDate = toCSTDateString(val[1])
    const diffDays = Math.round((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1
    if (diffDays > 365) {
      message.error('自定义时间范围不能超过 365 天')
      customRange.value = null
      return
    }
    await loadFilters()
    fetchData()
  }
}

onMounted(async () => {
  await loadFilters()
  fetchData()
})

// Summary stats
const summaryStats = computed(() => {
  const labels = trendData.value.labels || []
  const uniqueDays = new Set(labels.map(l => l.split(' ')[0])).size || 1
  const { tokens, cost, requests } = allMetricsTotals.value
  const avgPerDay = metric.value === 'tokens' ? tokens / uniqueDays
    : metric.value === 'cost' ? cost / uniqueDays
    : requests / uniqueDays
  return { tokens, cost, requests, avgPerDay }
})

// Format helpers
function formatTokens(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return n.toLocaleString()
}

function formatCost(n) {
  return '$' + (n || 0).toFixed(4)
}

function formatMetric(n) {
  if (metric.value === 'cost') return formatCost(n)
  if (metric.value === 'requests') return Math.round(n).toLocaleString()
  return formatTokens(n)
}

function formatAxisValue(n) {
  if (metric.value === 'cost') return '$' + n.toFixed(2)
  if (metric.value === 'requests') return n >= 1000 ? (n / 1000).toFixed(1) + 'K' : n
  return formatTokens(n)
}

// 格式化 x 轴标签：2026-02-06 → 02/06，2026-02-06 14:00 → 02/06 14:00，2026-02-06 14:00-18:00 → 02/06 14:00
function formatLabel(val) {
  if (!val) return ''
  // 带时间区间：2026-02-06 14:00-18:00
  const rangeMatch = val.match(/^\d{4}-(\d{2})-(\d{2}) (\d{2}:\d{2})-\d{2}:\d{2}$/)
  if (rangeMatch) return `${rangeMatch[1]}/${rangeMatch[2]} ${rangeMatch[3]}`
  // 带小时：2026-02-06 14:00
  const hourMatch = val.match(/^\d{4}-(\d{2})-(\d{2}) (\d{2}:\d{2})$/)
  if (hourMatch) return `${hourMatch[1]}/${hourMatch[2]} ${hourMatch[3]}`
  // 纯日期：2026-02-06
  const dayMatch = val.match(/^\d{4}-(\d{2})-(\d{2})$/)
  if (dayMatch) return `${dayMatch[1]}/${dayMatch[2]}`
  return val
}

// ECharts bar/line option
const barOption = computed(() => ({
  tooltip: {
    trigger: 'axis',
    axisPointer: { type: 'shadow' },
    formatter: (params) => {
      const title = params[0]?.axisValue || ''
      const lines = params.filter(p => p.value !== 0 && p.value != null).map(p => {
        const val = formatMetric(p.value)
        return `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${p.color};margin-right:6px"></span>${p.seriesName}: <b>${val}</b>`
      })
      if (lines.length === 0) return ''
      return `<div style="font-size:12px"><b>${title}</b><br>${lines.join('<br>')}</div>`
    }
  },
  legend: {
    type: 'plain',
    orient: 'horizontal',
    bottom: 8,
    left: 'center',
    itemWidth: 14,
    itemHeight: 14,
    itemGap: 32,
    textStyle: { fontSize: 12, lineHeight: 22 },
  },
  grid: { left: '3%', right: '4%', bottom: 140, top: '5%', containLabel: true },
  xAxis: {
    type: 'category',
    data: trendData.value.labels,
    axisLabel: { fontSize: 11, formatter: formatLabel, rotate: trendData.value.labels.length > 20 ? 45 : 0 }
  },
  yAxis: {
    type: 'value',
    axisLabel: { fontSize: 11, formatter: formatAxisValue }
  },
  dataZoom: trendData.value.labels.length > 30 ? [{ type: 'inside' }] : [],
  series: trendData.value.series.map((s, i) => ({
    name: s.name,
    type: chartType.value,
    stack: chartType.value === 'bar' ? 'total' : undefined,
    data: s.data,
    itemStyle: { color: COLORS[i % COLORS.length] },
    ...(chartType.value === 'line' ? {
      areaStyle: { opacity: 0.15, color: COLORS[i % COLORS.length] },
      smooth: true,
      lineStyle: { width: 2 },
      symbol: 'none'
    } : {})
  }))
}))

// Cumulative line option
const lineOption = computed(() => {
  const series = trendData.value.series || []
  const labels = trendData.value.labels || []

  // Build cumulative total across all series per label
  const cumulative = []
  let running = 0
  labels.forEach((_, i) => {
    const point = series.reduce((sum, s) => sum + (s.data[i] || 0), 0)
    running += point
    cumulative.push(running)
  })

  return {
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        const p = params[0]
        return `<b>${p.axisValue}</b><br>Cumulative: <b>${formatMetric(p.value)}</b>`
      }
    },
    grid: { left: '3%', right: '4%', bottom: '10%', top: '5%', containLabel: true },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { fontSize: 11, formatter: formatLabel, rotate: labels.length > 20 ? 45 : 0 }
    },
    yAxis: {
      type: 'value',
      axisLabel: { fontSize: 11, formatter: formatAxisValue }
    },
    series: [{
      name: `Cumulative ${metricLabel.value}`,
      type: 'line',
      data: cumulative,
      smooth: true,
      symbol: 'none',
      lineStyle: { width: 2, color: '#3b82f6' },
      areaStyle: { color: '#3b82f6', opacity: 0.1 },
      itemStyle: { color: '#3b82f6' }
    }]
  }
})

function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value
}

function handleExport(key) {
  const { startDate, endDate } = getDateRange()
  const { granularity, step } = getGranularity(startDate, endDate)
  const url = getTrendExportUrl({ startDate, endDate, granularity, step, groupBy: groupBy.value, metric: metric.value, format: key })
  window.open(url, '_blank')
}
</script>

<style scoped>
.analytics-page {
  height: 100%;
  background: var(--bg-primary);
  overflow-y: auto;
  padding: 16px 20px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* Header */
.analytics-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  flex-wrap: wrap;
  gap: 10px;
}

.page-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.range-buttons {
  display: flex;
  align-items: center;
  gap: 4px;
}

.range-btn {
  padding: 4px 10px;
  font-size: 12px;
  border: 1px solid var(--border-color, #e0e0e6);
  background: transparent;
  color: var(--text-secondary);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}

.range-btn:hover {
  border-color: var(--primary-color, #18a058);
  color: var(--primary-color, #18a058);
}

.range-btn.active {
  background: var(--primary-color, #18a058);
  border-color: var(--primary-color, #18a058);
  color: #fff;
}

.custom-range-wrapper {
  margin-left: 4px;
}

/* Loading overlay */
.loading-overlay {
  display: flex;
  justify-content: center;
  padding: 20px 0;
}

/* Summary cards */
.summary-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  flex-shrink: 0;
}

.summary-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color, #e0e0e6);
  border-radius: 8px;
  padding: 14px 16px;
}

.summary-label {
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.summary-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
}

/* Chart sections */
.chart-section {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color, #e0e0e6);
  border-radius: 8px;
  padding: 14px 16px;
  flex-shrink: 0;
}

.chart-section.fullscreen {
  position: fixed;
  inset: 0;
  z-index: 1000;
  border-radius: 0;
  padding: 20px;
  background: var(--bg-secondary);
  overflow: auto;
}

.cumulative-section {
  margin-bottom: 8px;
}

.chart-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.chart-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.chart-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.chart-type-toggle {
  display: flex;
  border: 1px solid var(--border-color, #e0e0e6);
  border-radius: 4px;
  overflow: hidden;
}

.toggle-btn {
  padding: 3px 10px;
  font-size: 12px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}

.toggle-btn.active {
  background: var(--primary-color, #18a058);
  color: #fff;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-color, #e0e0e6);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  color: var(--text-secondary);
  transition: all 0.15s;
}

.icon-btn:hover {
  border-color: var(--primary-color, #18a058);
  color: var(--primary-color, #18a058);
}

.main-chart {
  height: 560px;
  width: 100%;
}

.chart-section.fullscreen .main-chart {
  height: calc(100vh - 100px);
}

.cumulative-chart {
  height: 200px;
  width: 100%;
}

.empty-state {
  height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  font-size: 13px;
}

/* Responsive */
@media (max-width: 768px) {
  .analytics-page { padding: 10px 12px; }
  .summary-cards { grid-template-columns: repeat(2, 1fr); }
  .analytics-header { flex-direction: column; align-items: flex-start; }
  .toolbar { width: 100%; }
}

@media (max-width: 480px) {
  .summary-cards { grid-template-columns: 1fr 1fr; }
  .summary-value { font-size: 18px; }
}
</style>
