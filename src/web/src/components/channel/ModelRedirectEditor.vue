<template>
  <div class="model-redirect-editor">
    <div v-for="(rule, index) in modelValue" :key="index" class="redirect-row">
      <div class="redirect-input">
        <n-auto-complete
          :value="rule.from"
          :options="getFilteredOptions(rule.from)"
          placeholder="源模型"
          clearable
          :get-show="() => true"
          @update:value="(val) => updateRule(index, 'from', val)"
        />
      </div>
      <div class="redirect-arrow">
        <n-icon size="16" color="#999">
          <ArrowForwardOutline />
        </n-icon>
      </div>
      <div class="redirect-input">
        <n-auto-complete
          :value="rule.to"
          :options="getFilteredOptions(rule.to)"
          placeholder="目标模型"
          clearable
          :get-show="() => true"
          @update:value="(val) => updateRule(index, 'to', val)"
        />
      </div>
      <n-button quaternary circle size="small" @click="removeRule(index)">
        <template #icon>
          <n-icon><CloseOutline /></n-icon>
        </template>
      </n-button>
    </div>
    <n-button dashed size="small" @click="addRule" class="add-btn">
      <template #icon>
        <n-icon><AddOutline /></n-icon>
      </template>
      添加重定向规则
    </n-button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { NAutoComplete, NButton, NIcon } from 'naive-ui'
import { AddOutline, CloseOutline, ArrowForwardOutline } from '@vicons/ionicons5'

const props = defineProps({
  modelValue: {
    type: Array,
    default: () => []
  },
  availableModels: {
    type: Array,
    default: () => []
  },
  channelType: {
    type: String,
    default: 'claude'
  }
})

const emit = defineEmits(['update:modelValue'])

// 各渠道类型的默认模型列表
const defaultModelsByType = {
  claude: [
    'claude-opus-4-5-20251101',
    'claude-sonnet-4-5-20250929',
    'claude-haiku-4-5-20251001',
    'claude-sonnet-4-20250514',
    'claude-opus-4-20250514'
  ],
  codex: [
    'gpt-5.2-codex',
    'gpt-5.1-codex-max',
    'gpt-5.1-codex-mini',
    'gpt-5.1-codex',
    'gpt-5-codex',
    'gpt-5.2',
    'gpt-5.1',
    'gpt-5'
  ],
  gemini: [
    'gemini-3-pro',
    'gemini-3-flash',
    'gemini-3-deep-think',
    'gemini-2.5-pro',
    'gemini-2.5-flash'
  ]
}

const allOptions = computed(() => {
  if (props.availableModels && props.availableModels.length > 0) {
    return props.availableModels
  }
  const defaults = defaultModelsByType[props.channelType] || defaultModelsByType.claude
  return defaults.map(m => ({ label: m, value: m }))
})

// 根据输入值过滤选项
function getFilteredOptions(inputValue) {
  if (!inputValue) {
    return allOptions.value
  }
  const searchTerm = inputValue.toLowerCase()
  return allOptions.value.filter(opt => {
    const label = (opt.label || opt.value || '').toLowerCase()
    return label.includes(searchTerm)
  })
}

function updateRule(index, field, value) {
  const newRules = [...props.modelValue]
  newRules[index] = { ...newRules[index], [field]: value }
  emit('update:modelValue', newRules)
}

function addRule() {
  emit('update:modelValue', [...props.modelValue, { from: '', to: '' }])
}

function removeRule(index) {
  const newRules = props.modelValue.filter((_, i) => i !== index)
  emit('update:modelValue', newRules)
}
</script>

<style scoped>
.model-redirect-editor {
  width: 100%;
}

.redirect-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.redirect-input {
  flex: 1;
  min-width: 0;
}

.redirect-arrow {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
}

.add-btn {
  width: 100%;
  margin-top: 4px;
}
</style>
