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
import { ref, onMounted, onUnmounted } from 'vue'
import draggable from 'vuedraggable'
import ChannelColumn from '../components/dashboard/ChannelColumn.vue'
import { useUIConfig } from '../composables/useUIConfig'
import { useEnabledCliPlatforms } from '../composables/useEnabledCliPlatforms'
import { usePlatformStore } from '../stores/platforms'

const { uiConfig, updateConfig, loadUIConfig } = useUIConfig()
const platformStore = usePlatformStore()
const { enabledKeys } = useEnabledCliPlatforms({
  platformStore,
  configRef: uiConfig
})
const channelList = ref([])

function applyEnabledPlatforms(keys = enabledKeys.value) {
  channelList.value = keys.map(type => ({ type }))
}

async function onDragEnd() {
  const order = channelList.value.map(item => item.type)
  applyEnabledPlatforms(order)
  await updateConfig('enabledCliPlatforms', order)
}

function handleEnabledCliPlatformsChange(event) {
  const keys = event?.detail?.enabledCliPlatforms
  if (Array.isArray(keys)) {
    uiConfig.value = {
      ...uiConfig.value,
      enabledCliPlatforms: [...keys]
    }
  }
  applyEnabledPlatforms()
}

onMounted(async () => {
  window.addEventListener('enabled-cli-platforms-change', handleEnabledCliPlatformsChange)
  await Promise.all([loadUIConfig(), platformStore.load()])
  applyEnabledPlatforms()
})

onUnmounted(() => {
  window.removeEventListener('enabled-cli-platforms-change', handleEnabledCliPlatformsChange)
})
</script>


<style scoped>
.dashboard-container {
  height: 100%;
  background: var(--gradient-bg);
  overflow: hidden;
  padding: 18px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

.dashboard-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
  flex-shrink: 0;
}

.analytics-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--primary-color, #18a058);
  text-decoration: none;
  padding: 4px 10px;
  border-radius: 4px;
  background: rgba(24, 160, 88, 0.08);
  transition: background 0.2s;
}

.analytics-link:hover {
  background: rgba(24, 160, 88, 0.15);
}

.analytics-link-icon {
  font-size: 14px;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  box-sizing: border-box;
  align-items: stretch;
}

/* 拖拽时的占位符样式 */
.dashboard-grid :deep(.sortable-ghost) {
  opacity: 0.4;
}

.dashboard-grid :deep(.sortable-chosen) {
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
}

/* 响应式设计 */
@media (max-width: 1240px) {
  .dashboard-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 960px) {
  .dashboard-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 1024px) {
  .dashboard-container {
    padding: 14px;
  }

  .dashboard-grid {
    gap: 12px;
  }
}

@media (max-width: 900px) {
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .dashboard-container {
    padding: 10px;
    overflow-y: auto;
  }

  .dashboard-grid {
    gap: 10px;
    overflow: visible;
    min-height: auto;
  }
}

@media (max-width: 640px) {
  .dashboard-container {
    padding: 6px;
  }

  .dashboard-grid {
    gap: 6px;
  }
}

@media (max-width: 480px) {
  .dashboard-container {
    padding: 4px;
  }

  .dashboard-grid {
    gap: 4px;
  }
}
</style>
