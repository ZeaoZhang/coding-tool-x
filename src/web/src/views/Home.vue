<template>
  <div class="dashboard-container">
    <draggable
      v-model="channelList"
      class="dashboard-grid"
      item-key="type"
      :animation="200"
      handle=".drag-handle"
      @end="onDragEnd"
    >
      <template #item="{ element }">
        <ChannelColumn :channel-type="element.type" :key="element.type" />
      </template>
    </draggable>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import draggable from 'vuedraggable'
import ChannelColumn from '../components/dashboard/ChannelColumn.vue'
import { useUIConfig } from '../composables/useUIConfig'

const STORAGE_KEY = 'dashboardChannelOrder'
const DEFAULT_ORDER = ['claude', 'codex', 'gemini']

const { uiConfig, updateConfig, loadUIConfig } = useUIConfig()

// 从 localStorage 获取初始顺序
function getOrderFromStorage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const order = JSON.parse(stored)
      if (Array.isArray(order) && order.length === 3) {
        return order
      }
    }
  } catch (e) {}
  return DEFAULT_ORDER
}

// 保存顺序到 localStorage
function saveOrderToStorage(order) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order))
  } catch (e) {}
}

// 初始化使用 localStorage 的顺序
const channelList = ref(getOrderFromStorage().map(type => ({ type })))

// 拖拽结束后保存
async function onDragEnd() {
  const order = channelList.value.map(item => item.type)

  // 同时保存到 localStorage 和服务端
  saveOrderToStorage(order)
  await updateConfig('dashboardChannelOrder', order)
}

// 组件挂载时从服务端加载配置并同步
onMounted(async () => {
  await loadUIConfig()

  // 如果服务端有保存的顺序，使用服务端的
  if (uiConfig.value.dashboardChannelOrder && Array.isArray(uiConfig.value.dashboardChannelOrder) && uiConfig.value.dashboardChannelOrder.length === 3) {
    const serverOrder = uiConfig.value.dashboardChannelOrder
    channelList.value = serverOrder.map(type => ({ type }))
    // 同步到 localStorage
    saveOrderToStorage(serverOrder)
  }
})
</script>

<style scoped>
.dashboard-container {
  height: 100%;
  background: var(--bg-primary);
  overflow: hidden;
  padding: 12px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  box-sizing: border-box;
}

/* 拖拽时的占位符样式 */
.dashboard-grid :deep(.sortable-ghost) {
  opacity: 0.4;
}

.dashboard-grid :deep(.sortable-chosen) {
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
}

/* 响应式设计 */
@media (max-width: 1400px) {
  .dashboard-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 900px) {
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
}
</style>
