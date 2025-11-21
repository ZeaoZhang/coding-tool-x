<template>
  <n-tooltip :placement="tooltipPlacement">
    <template #trigger>
      <button
        class="header-button"
        :class="{
          active: active,
          disabled: disabled
        }"
        :disabled="disabled"
        @click="handleClick"
      >
        <n-icon :size="iconSize" :color="iconColor">
          <component :is="icon" />
        </n-icon>
      </button>
    </template>
    <slot>{{ tooltip }}</slot>
  </n-tooltip>
</template>

<script setup>
import { computed } from 'vue'
import { NIcon, NTooltip } from 'naive-ui'

const props = defineProps({
  icon: {
    type: Object,
    required: true
  },
  tooltip: {
    type: String,
    default: ''
  },
  tooltipPlacement: {
    type: String,
    default: 'bottom'
  },
  iconSize: {
    type: Number,
    default: 22
  },
  active: {
    type: Boolean,
    default: false
  },
  disabled: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['click'])

const iconColor = computed(() => {
  if (props.disabled) return '#d1d5db'
  if (props.active) return '#18a058'
  return '#9ca3af'
})

function handleClick() {
  if (!props.disabled) {
    emit('click')
  }
}
</script>

<style scoped>
.header-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  transition: background 0.2s ease;
  padding: 0;
  outline: none;
}

.header-button:hover:not(.disabled) {
  background: rgba(24, 160, 88, 0.08);
}

.header-button.disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.header-button :deep(.n-icon) {
  transition: color 0.2s ease;
}

.header-button:hover:not(.disabled) :deep(.n-icon) {
  color: #18a058 !important;
}
</style>
