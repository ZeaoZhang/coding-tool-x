<template>
  <div class="panel-card">
    <div class="panel-header">
      <n-icon :size="20" color="#18a058">
        <BarChartOutline />
      </n-icon>
      <h3 class="panel-title">Requests by Channel (Last 7 Days)</h3>
    </div>

    <div v-if="loading" class="chart-loading">
      <n-spin size="medium" />
    </div>

    <div v-else-if="hasData" class="chart-container">
      <div class="bar-chart">
        <div
          v-for="(item, index) in chartData"
          :key="item.channel"
          class="bar-item"
        >
          <div class="bar-info">
            <div class="bar-label">{{ item.label }}</div>
            <div class="bar-value">
              <n-text strong>{{ item.requests }}</n-text>
              <n-text depth="3" style="font-size: 11px;">requests</n-text>
            </div>
          </div>
          <div class="bar-wrapper">
            <div
              class="bar-fill"
              :style="{
                width: item.percentage + '%',
                background: colors[index]
              }"
            >
              <div class="bar-percentage">{{ item.percentage }}%</div>
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
import { ref, onMounted, onUnmounted } from 'vue'
import { NIcon, NText, NSpin } from 'naive-ui'
import { BarChartOutline } from '@vicons/ionicons5'
import axios from 'axios'

const loading = ref(true)
const hasData = ref(false)
const chartData = ref([])
const colors = ['#18a058', '#3b82f6', '#a855f7']

async function loadData() {
  loading.value = true
  try {
    const response = await axios.get('/api/statistics/recent?days=7')

    // 按渠道汇总请求数
    const channelStats = {}

    response.data.forEach(day => {
      const byChannel = day.byChannel || {}

      Object.entries(byChannel).forEach(([id, channel]) => {
        let label = 'Unknown'
        if (channel.toolType === 'claude-code' || channel.toolType === 'claude') {
          label = 'Claude'
        } else if (channel.toolType === 'codex') {
          label = 'Codex'
        } else if (channel.toolType === 'gemini') {
          label = 'Gemini'
        }

        if (!channelStats[label]) {
          channelStats[label] = {
            channel: id,
            label: label,
            requests: 0
          }
        }

        channelStats[label].requests += channel.requests || 0
      })
    })

    // 转换为数组并排序
    const data = Object.values(channelStats).sort((a, b) => b.requests - a.requests)

    // 找出最大值用于计算百分比
    const maxRequests = data.length > 0 ? data[0].requests : 1

    // 计算百分比
    chartData.value = data.map(item => ({
      ...item,
      percentage: Math.round((item.requests / maxRequests) * 100)
    }))

    hasData.value = chartData.value.length > 0
  } catch (error) {
    console.error('Failed to load request comparison data:', error)
    hasData.value = false
  } finally {
    loading.value = false
  }
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
  padding: 8px 0;
}

.bar-chart {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.bar-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.bar-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.bar-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

.bar-value {
  display: flex;
  align-items: center;
  gap: 6px;
}

.bar-wrapper {
  height: 32px;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 6px;
  overflow: hidden;
  position: relative;
}

.bar-fill {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 12px;
  transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
}

.bar-percentage {
  font-size: 12px;
  font-weight: 600;
  color: white;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}
</style>
