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
    default: 18
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
  if (props.disabled) return '#6b7280'
  if (props.active) return '#18a058'
  return undefined // 让 CSS 控制颜色
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
  width: 32px;
  height: 32px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: var(--bg-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
  padding: 0;
  outline: none;
}

.header-button :deep(.n-icon) {
  color: var(--text-tertiary);
  transition: all 0.2s ease;
}

.header-button:hover:not(.disabled) {
  background: var(--hover-bg);
  border-color: var(--border-primary);
}

.header-button:hover:not(.disabled) :deep(.n-icon) {
  color: var(--text-primary);
}

.header-button:active:not(.disabled) {
  transform: scale(0.95);
}

.header-button.active {
  background: rgba(24, 160, 88, 0.1);
  border-color: rgba(24, 160, 88, 0.3);
}

.header-button.active :deep(.n-icon) {
  color: #18a058 !important;
}

.header-button.disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>
