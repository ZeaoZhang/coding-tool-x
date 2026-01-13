<template>
  <n-drawer
    v-model:show="visible"
    :width="drawerWidth"
    placement="right"
    :auto-focus="false"
    :native-scrollbar="false"
  >
    <n-drawer-content title="技能管理">
      <SkillsPanel @back="visible = false" :hide-back="true" :in-drawer="true" />
    </n-drawer-content>
  </n-drawer>
</template>

<script setup>
import { computed } from 'vue'
import SkillsPanel from './SkillsPanel.vue'
import { useResponsiveDrawer } from '../composables/useResponsiveDrawer'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue'])

const { drawerWidth } = useResponsiveDrawer(800, 700)

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})
</script>
