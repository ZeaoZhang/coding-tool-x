<template>
  <n-drawer
    v-model:show="visible"
    :width="drawerWidth"
    placement="right"
    :mask-closable="true"
  >
    <n-drawer-content closable>
      <template #header>
        <div class="drawer-header">
          <span>Custom Agents</span>
        </div>
      </template>
      <AgentsPanel
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
import AgentsPanel from './AgentsPanel.vue'
import { useResponsiveDrawer } from '../composables/useResponsiveDrawer'

const props = defineProps({
  visible: Boolean,
  platform: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['update:visible'])

const { drawerWidth } = useResponsiveDrawer(600)

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})
</script>

<style scoped>
.drawer-header {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}
</style>
