<template>
  <div class="panel-card">
    <div class="panel-header">
      <n-icon :size="20" color="#3b82f6">
        <BarChartOutline />
      </n-icon>
      <h3 class="panel-title">Model Usage</h3>
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
        <BarChartOutline />
      </n-icon>
      <n-text depth="3">No data available</n-text>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick, computed } from 'vue'
import { NIcon, NText, NSpin } from 'naive-ui'
import { BarChartOutline } from '@vicons/ionicons5'

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

function renderChart() {
  if (!chartCanvas.value) return

  const canvas = chartCanvas.value
  const ctx = canvas.getContext('2d')
  const width = canvas.width
  const height = 40 // Bar height
  const padding = 2

  // Clear canvas
  ctx.clearRect(0, 0, width, height)

  let currentX = padding

  chartData.value.forEach((item) => {
    const barWidth = ((item.percentage / 100) * (width - padding * 2))

    // Draw bar segment
    ctx.fillStyle = item.color
    ctx.fillRect(currentX, padding, barWidth, height - padding * 2)

    currentX += barWidth
  })

  // Draw border
  ctx.strokeStyle = 'var(--border-primary)'
  ctx.lineWidth = 1
  ctx.strokeRect(padding, padding, width - padding * 2, height - padding * 2)
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
  gap: 10px;
  margin-bottom: 16px;
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
  height: 40px;
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
