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
          <span>插件管理</span>
        </div>
      </template>
      <PluginsPanel
        @back="visible = false"
        :hide-back="true"
        :in-drawer="true"
        :drawer-visible="visible"
        :platform="props.platform"
        :project-path="props.projectPath"
      />
    </n-drawer-content>
  </n-drawer>
</template>

<script setup>
import { computed } from 'vue'
import { NDrawer, NDrawerContent } from 'naive-ui'
import PluginsPanel from './PluginsPanel.vue'
import { useResponsiveDrawer } from '../composables/useResponsiveDrawer'

const props = defineProps({
  visible: Boolean,
  platform: { type: String, default: '' },
  projectPath: { type: String, default: '' }
})

const emit = defineEmits(['update:visible'])

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
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}
</style>
