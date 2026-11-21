<template>
  <n-drawer
    v-model:show="visible"
    :width="drawerWidth"
    placement="right"
    :mask-closable="true"
  >
    <n-drawer-content closable :native-scrollbar="false" :body-content-style="bodyStyle">
      <template #header>
        <div class="drawer-header">
          <span class="drawer-title">命令管理</span>
          <span v-if="platformLabel" class="asset-platform-pill drawer-platform-pill">{{ platformLabel }}</span>
        </div>
      </template>
      <CommandsPanel
        @back="visible = false"
        :hide-back="true"
        :in-drawer="true"
        :platform="props.platform"
      />
    </n-drawer-content>
  </n-drawer>
</template>

<script setup>
import { computed } from 'vue'
import { NDrawer, NDrawerContent } from 'naive-ui'
import CommandsPanel from './CommandsPanel.vue'
import { useResponsiveDrawer } from '../composables/useResponsiveDrawer'
import { usePlatformStore } from '../stores/platforms'
import { getPlatformConfig } from '../config/platforms'

const props = defineProps({
  visible: Boolean,
  platform: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['update:visible'])

const platformStore = usePlatformStore()
// 抽屉从首页平台列打开时需要标明资源来源平台，和资源面板的平台标签保持一致。
const platformLabel = computed(() => {
  const key = String(props.platform || '').trim().toLowerCase()
  if (!key) return ''
  const platform = platformStore.get(key) || getPlatformConfig(key)
  return platform?.label || platform?.title || key
})

const { drawerWidth } = useResponsiveDrawer(720)

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

const bodyStyle = {
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden'
}
</script>

<style scoped>
.drawer-header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.drawer-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-platform-pill {
  font-weight: 500;
}
</style>
