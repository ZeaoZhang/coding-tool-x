<template>
  <div class="panel-card">
    <div class="panel-header">
      <n-icon :size="20" color="#18a058">
        <TrendingUpOutline />
      </n-icon>
      <h3 class="panel-title">Today's Overview</h3>
      <n-button text size="tiny" @click="refresh" :loading="loading">
        <template #icon>
          <n-icon><RefreshOutline /></n-icon>
        </template>
      </n-button>
    </div>

    <div class="stats-grid">
      <div class="stat-item">
        <div class="stat-icon requests">
          <n-icon :size="24">
            <PulseOutline />
          </n-icon>
        </div>
        <div class="stat-info">
          <div class="stat-label">Requests</div>
          <div class="stat-value">{{ formatNumber(stats.requests) }}</div>
          <div class="stat-change" :class="{ positive: stats.requestsChange > 0, negative: stats.requestsChange < 0 }">
            <n-icon :size="14">
              <component :is="stats.requestsChange > 0 ? ArrowUpOutline : ArrowDownOutline" />
            </n-icon>
            <span>{{ Math.abs(stats.requestsChange) }}%</span>
          </div>
        </div>
      </div>

      <div class="stat-item">
        <div class="stat-icon tokens">
          <n-icon :size="24">
            <FlashOutline />
          </n-icon>
        </div>
        <div class="stat-info">
          <div class="stat-label">Tokens</div>
          <div class="stat-value">{{ formatTokens(stats.tokens) }}</div>
          <div class="stat-change" :class="{ positive: stats.tokensChange > 0, negative: stats.tokensChange < 0 }">
            <n-icon :size="14">
              <component :is="stats.tokensChange > 0 ? ArrowUpOutline : ArrowDownOutline" />
            </n-icon>
            <span>{{ Math.abs(stats.tokensChange) }}%</span>
          </div>
        </div>
      </div>

      <div class="stat-item">
        <div class="stat-icon cost">
          <n-icon :size="24">
            <CashOutline />
          </n-icon>
        </div>
        <div class="stat-info">
          <div class="stat-label">Cost</div>
          <div class="stat-value">${{ stats.cost.toFixed(2) }}</div>
          <div class="stat-change" :class="{ positive: stats.costChange > 0, negative: stats.costChange < 0 }">
            <n-icon :size="14">
              <component :is="stats.costChange > 0 ? ArrowUpOutline : ArrowDownOutline" />
            </n-icon>
            <span>{{ Math.abs(stats.costChange) }}%</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { NIcon, NButton } from 'naive-ui'
import { TrendingUpOutline, PulseOutline, FlashOutline, CashOutline, RefreshOutline, ArrowUpOutline, ArrowDownOutline } from '@vicons/ionicons5'
import axios from 'axios'

const loading = ref(false)
const stats = ref({
  requests: 0,
  tokens: 0,
  cost: 0,
  requestsChange: 0,
  tokensChange: 0,
  costChange: 0
})

function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M'
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K'
  }
  return num.toString()
}

function formatTokens(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M'
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K'
  }
  return num.toString()
}

async function loadTodayStats() {
  loading.value = true
  try {
    const response = await axios.get('/api/statistics/today')

    stats.value.requests = response.data.summary?.requests || 0
    stats.value.tokens = response.data.summary?.tokens || 0
    stats.value.cost = response.data.summary?.cost || 0

    // 获取昨天的数据来计算变化百分比
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().split('T')[0]

    try {
      const yesterdayResponse = await axios.get(`/api/statistics/daily/${yesterdayStr}`)
      const yesterdayStats = yesterdayResponse.data.summary || { requests: 0, tokens: 0, cost: 0 }

      if (yesterdayStats.requests > 0) {
        stats.value.requestsChange = Math.round(((stats.value.requests - yesterdayStats.requests) / yesterdayStats.requests) * 100)
      }
      if (yesterdayStats.tokens > 0) {
        stats.value.tokensChange = Math.round(((stats.value.tokens - yesterdayStats.tokens) / yesterdayStats.tokens) * 100)
      }
      if (yesterdayStats.cost > 0) {
        stats.value.costChange = Math.round(((stats.value.cost - yesterdayStats.cost) / yesterdayStats.cost) * 100)
      }
    } catch (error) {
      // 昨天没有数据，忽略
    }
  } catch (error) {
    console.error('Failed to load today stats:', error)
  } finally {
    loading.value = false
  }
}

function refresh() {
  loadTodayStats()
}

onMounted(() => {
  loadTodayStats()
  // 定时刷新
  setInterval(loadTodayStats, 30000) // 30秒刷新一次
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
  flex: 1;
  color: var(--text-primary);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.stat-item {
  display: flex;
  gap: 12px;
  padding: 16px;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  transition: all 0.2s ease;
}

.stat-item:hover {
  border-color: #18a058;
  transform: translateY(-2px);
}

.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stat-icon.requests {
  background: rgba(24, 160, 88, 0.1);
  color: #18a058;
}

.stat-icon.tokens {
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
}

.stat-icon.cost {
  background: rgba(168, 85, 247, 0.1);
  color: #a855f7;
}

.stat-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  font-size: 12px;
  color: var(--text-tertiary);
}

.stat-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
}

.stat-change {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 500;
}

.stat-change.positive {
  color: #18a058;
}

.stat-change.negative {
  color: #d03050;
}

/* 响应式 */
@media (max-width: 1400px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }
}
</style>
