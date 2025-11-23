<template>
  <div class="panel-card">
    <div class="panel-header">
      <n-icon :size="20" color="#18a058">
        <PieChartOutline />
      </n-icon>
      <h3 class="panel-title">Token Usage by Channel</h3>
    </div>

    <div v-if="loading" class="chart-loading">
      <n-spin size="medium" />
    </div>

    <div v-else-if="hasData" class="chart-container">
      <canvas ref="chartCanvas"></canvas>

      <div class="chart-legend">
        <div
          v-for="(item, index) in chartData"
          :key="item.channel"
          class="legend-item"
        >
          <div class="legend-dot" :style="{ background: colors[index] }"></div>
          <div class="legend-info">
            <div class="legend-label">{{ item.label }}</div>
            <div class="legend-value">
              <n-text strong>{{ formatTokens(item.tokens) }}</n-text>
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
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { NIcon, NText, NSpin } from 'naive-ui'
import { PieChartOutline, BarChartOutline } from '@vicons/ionicons5'
import axios from 'axios'

const loading = ref(true)
const hasData = ref(false)
const chartCanvas = ref(null)
const chartData = ref([])
const colors = ['#18a058', '#3b82f6', '#a855f7']

let chart = null

function formatTokens(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M'
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K'
  }
  return num.toString()
}

async function loadData() {
  loading.value = true
  try {
    const response = await axios.get('/api/statistics/today')
    const byChannel = response.data.byChannel || {}

    const data = []
    let total = 0

    // 收集所有渠道数据
    Object.entries(byChannel).forEach(([id, channel]) => {
      const tokens = channel.tokens?.total || 0
      total += tokens

      let label = 'Unknown'
      if (channel.toolType === 'claude-code' || channel.toolType === 'claude') {
        label = 'Claude'
      } else if (channel.toolType === 'codex') {
        label = 'Codex'
      } else if (channel.toolType === 'gemini') {
        label = 'Gemini'
      }

      data.push({
        channel: id,
        label: label,
        tokens: tokens
      })
    })

    // 合并相同类型的渠道
    const merged = {}
    data.forEach(item => {
      if (merged[item.label]) {
        merged[item.label].tokens += item.tokens
      } else {
        merged[item.label] = { ...item }
      }
    })

    // 计算百分比
    chartData.value = Object.values(merged).map(item => ({
      ...item,
      percentage: total > 0 ? Math.round((item.tokens / total) * 100) : 0
    }))

    hasData.value = chartData.value.length > 0 && total > 0

    if (hasData.value) {
      nextTick(() => {
        renderChart()
      })
    }
  } catch (error) {
    console.error('Failed to load token usage data:', error)
    hasData.value = false
  } finally {
    loading.value = false
  }
}

function renderChart() {
  if (!chartCanvas.value) return

  // 简单的 CSS 绘制，不依赖 Chart.js
  // 使用 conic-gradient 创建饼图效果
  const ctx = chartCanvas.value.getContext('2d')
  const centerX = chartCanvas.value.width / 2
  const centerY = chartCanvas.value.height / 2
  const radius = Math.min(centerX, centerY) - 20

  let currentAngle = -Math.PI / 2 // 从顶部开始

  chartData.value.forEach((item, index) => {
    const sliceAngle = (item.percentage / 100) * 2 * Math.PI

    // 绘制扇形
    ctx.fillStyle = colors[index]
    ctx.beginPath()
    ctx.moveTo(centerX, centerY)
    ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + sliceAngle)
    ctx.closePath()
    ctx.fill()

    // 绘制边界
    ctx.strokeStyle = 'var(--bg-secondary)'
    ctx.lineWidth = 2
    ctx.stroke()

    currentAngle += sliceAngle
  })

  // 绘制中心圆（甜甜圈效果）
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-secondary') || '#fff'
  ctx.beginPath()
  ctx.arc(centerX, centerY, radius * 0.6, 0, 2 * Math.PI)
  ctx.fill()
}

onMounted(() => {
  loadData()
  // 定时刷新
  const interval = setInterval(loadData, 30000)

  onUnmounted(() => {
    clearInterval(interval)
  })
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
  height: 200px;
  max-width: 300px;
  margin: 0 auto;
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
