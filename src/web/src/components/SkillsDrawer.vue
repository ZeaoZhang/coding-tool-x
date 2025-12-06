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
          <span>Skills 技能管理</span>
        </div>
      </template>
      <SkillsPanel @back="visible = false" :hide-back="true" :in-drawer="true" />
    </n-drawer-content>
  </n-drawer>
</template>

<script setup>
import { computed } from 'vue'
import { NDrawer, NDrawerContent } from 'naive-ui'
import SkillsPanel from './SkillsPanel.vue'
import { useResponsiveDrawer } from '../composables/useResponsiveDrawer'

const props = defineProps({
  visible: Boolean
})

const emit = defineEmits(['update:visible'])

const { drawerWidth } = useResponsiveDrawer(520)

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
