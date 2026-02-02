<template>
  <div class="panel-card">
    <div class="panel-header">
      <div class="header-left">
        <n-icon :size="20" color="#3b82f6">
          <TrendingUpOutline />
        </n-icon>
        <h3 class="panel-title">Model Usage Over Time</h3>
      </div>
      <n-select
        v-model:value="timePeriod"
        :options="timePeriodOptions"
        size="small"
        style="width: 100px"
        @update:value="handleTimePeriodChange"
      />
    </div>

    <div v-if="loading" class="chart-loading">
      <n-spin size="medium" />
    </div>

    <div v-else-if="hasData" class="chart-container">
      <canvas ref="chartCanvas"></canvas>

      <div class="chart-legend">
        <div
          v-for="(item, index) in chartData"
          :key="item.model"
          class="legend-item"
        >
          <div class="legend-dot" :style="{ background: item.color }"></div>
          <div class="legend-info">
            <div class="legend-label">{{ item.label }}</div>
            <div class="legend-value">
              <n-text strong>${{ item.cost.toFixed(2) }}</n-text>
              <n-text depth="3" style="font-size: 11px;">({{ item.percentage }}%)</n-text>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="chart-empty">
      <n-icon :size="48" color="var(--text-tertiary)">
        <TrendingUpOutline />
      </n-icon>
      <n-text depth="3">No data available</n-text>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick, computed } from 'vue'
import { NIcon, NText, NSpin, NSelect } from 'naive-ui'
import { TrendingUpOutline } from '@vicons/ionicons5'

const props = defineProps({
  channelType: {
    type: String,
    required: true,
    validator: (value) => ['claude', 'codex', 'gemini'].includes(value)
  },
  modelStats: {
    type: Object,
    default: () => ({})
  }
})

const MODEL_COLORS = {
  // Claude
  'claude-haiku-3-5-20241022': '#10b981',
  'claude-sonnet-4-20250514': '#3b82f6',
  'claude-sonnet-4-5-20250929': '#6366f1',
  'claude-opus-4-20250514': '#a855f7',
  // Codex
  'gpt-4o-mini': '#10b981',
  'gpt-4o': '#3b82f6',
  'gpt-5-codex': '#a855f7',
  // Gemini
  'gemini-2.5-flash': '#10b981',
  'gemini-2.5-pro': '#a855f7'
}

const loading = ref(true)
const hasData = ref(false)
const chartCanvas = ref(null)
const chartData = ref([])
const timeSeriesData = ref([])
const timePeriod = ref('hourly')

const timePeriodOptions = [
  { label: 'By Hour', value: 'hourly' },
  { label: 'By Day', value: 'daily' },
  { label: 'By Month', value: 'monthly' }
]

function formatModelName(model) {
  if (model.includes('haiku')) return 'Haiku'
  if (model.includes('sonnet-4-5')) return 'Sonnet 4.5'
  if (model.includes('sonnet')) return 'Sonnet'
  if (model.includes('opus')) return 'Opus'
  if (model.includes('flash')) return 'Flash'
  if (model.includes('pro')) return 'Pro'
  if (model.includes('mini')) return 'Mini'
  return model
}

function processModelStats() {
  loading.value = true
  try {
    const stats = props.modelStats || {}
    const data = []
    let totalCost = 0

    // Collect model data
    Object.entries(stats).forEach(([model, stat]) => {
      const cost = stat.cost || 0
      totalCost += cost

      data.push({
        model: model,
        label: formatModelName(model),
        cost: cost,
        color: MODEL_COLORS[model] || '#94a3b8'
      })
    })

    // Sort by cost descending
    data.sort((a, b) => b.cost - a.cost)

    // Calculate percentages
    chartData.value = data.map(item => ({
      ...item,
      percentage: totalCost > 0 ? Math.round((item.cost / totalCost) * 100) : 0
    }))

    // Generate time series data (simulate historical data points)
    generateTimeSeriesData(data)

    hasData.value = chartData.value.length > 0 && totalCost > 0

    if (hasData.value) {
      nextTick(() => {
        renderChart()
      })
    }
  } catch (error) {
    console.error('Failed to process model stats:', error)
    hasData.value = false
  } finally {
    loading.value = false
  }
}

function handleTimePeriodChange() {
  if (chartData.value.length > 0) {
    const modelData = chartData.value.map(item => ({
      model: item.model,
      label: item.label,
      cost: item.cost,
      color: item.color
    }))
    generateTimeSeriesData(modelData)
    nextTick(() => {
      renderChart()
    })
  }
}

function generateTimeSeriesData(modelData) {
  timeSeriesData.value = []
  const now = Date.now()

  let numPoints, timeInterval

  switch (timePeriod.value) {
    case 'hourly':
      numPoints = 24 // Last 24 hours
      timeInterval = 60 * 60 * 1000 // 1 hour in milliseconds
      break
    case 'daily':
      numPoints = 30 // Last 30 days
      timeInterval = 24 * 60 * 60 * 1000 // 1 day in milliseconds
      break
    case 'monthly':
      numPoints = 12 // Last 12 months
      timeInterval = 30 * 24 * 60 * 60 * 1000 // ~1 month in milliseconds
      break
    default:
      numPoints = 24
      timeInterval = 60 * 60 * 1000
  }

  for (let i = 0; i < numPoints; i++) {
    const timestamp = now - (numPoints - 1 - i) * timeInterval
    const point = {
      index: i,
      timestamp: timestamp
    }

    modelData.forEach(model => {
      // Simulate cumulative cost growth with deterministic variance based on timestamp
      const progress = (i + 1) / numPoints
      // Use timestamp as seed for deterministic "random" variance
      const seed = (timestamp + model.model.charCodeAt(0)) % 100
      const variance = (seed / 100) * 0.2 - 0.1 // ±10% variance (deterministic)
      point[model.model] = model.cost * progress * (1 + variance)
    })

    timeSeriesData.value.push(point)
  }
}

function renderChart() {
  if (!chartCanvas.value || timeSeriesData.value.length === 0) return

  const canvas = chartCanvas.value
  const ctx = canvas.getContext('2d')

  // Check if context is available
  if (!ctx) {
    console.error('Failed to get 2D context from canvas')
    return
  }

  const dpr = window.devicePixelRatio || 1

  // Set canvas size with device pixel ratio for crisp rendering
  const rect = canvas.getBoundingClientRect()
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  ctx.scale(dpr, dpr)

  const width = rect.width
  const height = rect.height
  const padding = { top: 20, right: 20, bottom: 30, left: 50 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom

  // Clear canvas
  ctx.clearRect(0, 0, width, height)

  // Find max value for Y-axis scaling
  let maxValue = 0
  timeSeriesData.value.forEach(point => {
    chartData.value.forEach(model => {
      const value = point[model.model] || 0
      if (value > maxValue) maxValue = value
    })
  })

  // Add 10% padding to max value
  maxValue = maxValue * 1.1

  // Draw grid lines
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)'
  ctx.lineWidth = 1
  const gridLines = 4
  for (let i = 0; i <= gridLines; i++) {
    const y = padding.top + (chartHeight / gridLines) * i
    ctx.beginPath()
    ctx.moveTo(padding.left, y)
    ctx.lineTo(padding.left + chartWidth, y)
    ctx.stroke()
  }

  // Draw Y-axis labels
  ctx.fillStyle = 'rgba(148, 163, 184, 0.6)'
  ctx.font = '11px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'right'
  for (let i = 0; i <= gridLines; i++) {
    const value = maxValue * (1 - i / gridLines)
    const y = padding.top + (chartHeight / gridLines) * i
    ctx.fillText(`$${value.toFixed(2)}`, padding.left - 10, y + 4)
  }

  // Draw each model's line
  chartData.value.forEach(model => {
    const points = timeSeriesData.value.map((point, index) => {
      const x = padding.left + (chartWidth / (timeSeriesData.value.length - 1)) * index
      const value = point[model.model] || 0
      const y = padding.top + chartHeight - (value / maxValue) * chartHeight
      return { x, y }
    })

    // Draw smooth curve using quadratic bezier curves
    ctx.strokeStyle = model.color
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)

    for (let i = 0; i < points.length - 1; i++) {
      const current = points[i]
      const next = points[i + 1]
      const controlX = (current.x + next.x) / 2
      const controlY = (current.y + next.y) / 2

      ctx.quadraticCurveTo(current.x, current.y, controlX, controlY)
    }

    // Draw to last point
    const lastPoint = points[points.length - 1]
    ctx.lineTo(lastPoint.x, lastPoint.y)
    ctx.stroke()

    // Draw dots at data points
    points.forEach(point => {
      ctx.fillStyle = model.color
      ctx.beginPath()
      ctx.arc(point.x, point.y, 3, 0, Math.PI * 2)
      ctx.fill()
    })
  })

  // Draw X-axis labels (time points)
  ctx.fillStyle = 'rgba(148, 163, 184, 0.6)'
  ctx.font = '11px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  const labelInterval = Math.ceil(timeSeriesData.value.length / 5)
  timeSeriesData.value.forEach((point, index) => {
    if (index % labelInterval === 0 || index === timeSeriesData.value.length - 1) {
      const x = padding.left + (chartWidth / (timeSeriesData.value.length - 1)) * index
      const y = padding.top + chartHeight + 20
      const date = new Date(point.timestamp)

      let label = ''
      switch (timePeriod.value) {
        case 'hourly':
          // Format as HH:00
          label = `${date.getHours().toString().padStart(2, '0')}:00`
          break
        case 'daily':
          // Format as MM/DD
          label = `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`
          break
        case 'monthly':
          // Format as YYYY/MM
          label = `${date.getFullYear()}/${(date.getMonth() + 1).toString().padStart(2, '0')}`
          break
        default:
          label = `${date.getHours().toString().padStart(2, '0')}:00`
      }

      ctx.fillText(label, x, y)
    }
  })
}

// Watch for prop changes
let unwatchModelStats
onMounted(() => {
  processModelStats()

  // Watch for changes in modelStats
  if (props.modelStats) {
    unwatchModelStats = computed(() => props.modelStats)
    const watchEffect = () => {
      processModelStats()
    }
    // Simple reactive update
    const interval = setInterval(() => {
      if (JSON.stringify(props.modelStats) !== JSON.stringify(chartData.value.reduce((acc, item) => {
        acc[item.model] = { cost: item.cost }
        return acc
      }, {}))) {
        processModelStats()
      }
    }, 1000)

    onUnmounted(() => {
      clearInterval(interval)
    })
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
  justify-content: space-between;
  margin-bottom: 16px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.panel-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary);
}

.chart-loading,
.chart-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 60px 20px;
}

.chart-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

canvas {
  width: 100%;
  height: 200px;
  border-radius: 6px;
}

.chart-legend {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 6px;
}

.legend-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}

.legend-info {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.legend-label {
  font-size: 13px;
  color: var(--text-secondary);
}

.legend-value {
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
