<template>
  <div class="tool-card">
    <div class="tool-header">
      <h3 class="tool-name">{{ tool.name }}</h3>
      <n-button
        size="small"
        type="primary"
        quaternary
        @click="$emit('test')"
      >
        <template #icon>
          <n-icon><FlaskOutline /></n-icon>
        </template>
        测试工具
      </n-button>
    </div>

    <p v-if="tool.description" class="tool-description">
      {{ tool.description }}
    </p>

    <div v-if="hasParameters" class="tool-parameters">
      <div class="params-header">
        <n-icon :size="14" class="params-icon">
          <SettingsOutline />
        </n-icon>
        <span class="params-label">参数列表</span>
      </div>

      <div class="params-list">
        <div
          v-for="(param, key) in parameters"
          :key="key"
          class="param-item"
        >
          <div class="param-info">
            <span class="param-name">{{ key }}</span>
            <n-tag
              :type="isRequired(key) ? 'error' : 'default'"
              size="tiny"
              :bordered="false"
            >
              {{ isRequired(key) ? '必填' : '可选' }}
            </n-tag>
            <n-tag
              v-if="param.type"
              size="tiny"
              :bordered="false"
              type="info"
            >
              {{ formatType(param.type) }}
            </n-tag>
          </div>
          <p v-if="param.description" class="param-description">
            {{ param.description }}
          </p>
        </div>
      </div>
    </div>

    <div v-else class="no-parameters">
      <n-text depth="3">无需参数</n-text>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { NButton, NIcon, NTag, NText } from 'naive-ui'
import { FlaskOutline, SettingsOutline } from '@vicons/ionicons5'

const props = defineProps({
  tool: {
    type: Object,
    required: true
  }
})

defineEmits(['test'])

const parameters = computed(() => {
  return props.tool.inputSchema?.properties || {}
})

const requiredFields = computed(() => {
  return props.tool.inputSchema?.required || []
})

const hasParameters = computed(() => {
  return Object.keys(parameters.value).length > 0
})

function isRequired(key) {
  return requiredFields.value.includes(key)
}

function formatType(type) {
  if (Array.isArray(type)) {
    return type.filter(t => t !== 'null').join(' | ')
  }
  return type
}
</script>

<style scoped>
.tool-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0;
}

.tool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.tool-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
}

.tool-description {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
  margin: 0;
}

.tool-parameters {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.params-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.params-icon {
  color: #18a058;
}

.params-label {
  color: var(--text-tertiary);
}

.params-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-left: 20px;
}

.param-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.param-info {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.param-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  font-family: 'SF Mono', Monaco, Consolas, monospace;
}

.param-description {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-tertiary);
  margin: 0;
  padding-left: 2px;
}

.no-parameters {
  text-align: center;
  padding: 8px 0;
}

/* Dark mode adjustments */
[data-theme="dark"] .tool-name {
  color: rgba(255, 255, 255, 0.92);
}

[data-theme="dark"] .param-name {
  color: rgba(255, 255, 255, 0.85);
}
</style>
