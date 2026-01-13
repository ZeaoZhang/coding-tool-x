<template>
  <n-drawer
    v-model:show="visible"
    width="680"
    placement="right"
    :auto-focus="false"
  >
    <n-drawer-content title="技能管理">
      <SkillsPanel @back="visible = false" :hide-back="true" :in-drawer="true" />
    </n-drawer-content>
  </n-drawer>
</template>

<script setup>
import { computed } from 'vue'
import SkillsPanel from './SkillsPanel.vue'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue'])

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})
</script>
