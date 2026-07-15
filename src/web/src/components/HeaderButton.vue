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
  width: 40px;
  height: 40px;
  border: 1px solid var(--border-primary);
  border-radius: 999px;
  background: var(--bg-elevated);
  cursor: pointer;
  transition: all 0.2s ease;
  padding: 0;
  outline: none;
  box-shadow: 0 10px 24px rgba(15, 23, 29, 0.08);
}

.header-button :deep(.n-icon) {
  color: var(--text-tertiary);
  transition: all 0.2s ease;
}

.header-button:hover:not(.disabled) {
  background: color-mix(in srgb, var(--bg-elevated) 90%, var(--primary-color) 10%);
  border-color: rgba(24, 160, 88, 0.24);
  box-shadow: 0 14px 30px rgba(15, 23, 29, 0.12);
}

.header-button:hover:not(.disabled) :deep(.n-icon) {
  color: var(--primary-color, #18a058);
}

.header-button:active:not(.disabled) {
  transform: scale(0.95);
}

.header-button.active {
  background: linear-gradient(135deg, rgba(24, 160, 88, 0.14), rgba(24, 160, 88, 0.06));
  border-color: rgba(24, 160, 88, 0.32);
}

.header-button.active :deep(.n-icon) {
  color: #18a058 !important;
}

.header-button.disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

[data-theme="dark"] .header-button {
  background: rgba(13, 23, 30, 0.92);
  border-color: rgba(54, 76, 86, 0.9);
  box-shadow: none;
}

[data-theme="dark"] .header-button:hover:not(.disabled) {
  background: rgba(20, 34, 42, 0.98);
  border-color: rgba(24, 160, 88, 0.28);
  box-shadow: 0 0 0 1px rgba(24, 160, 88, 0.08);
}
</style>
