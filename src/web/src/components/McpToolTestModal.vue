<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    :title="tool?.name || '测试工具'"
    style="width: 700px; max-width: 90vw;"
    :segmented="{
      content: 'soft',
      footer: 'soft'
    }"
  >
    <div class="modal-content">
      <!-- Tool description -->
      <div v-if="tool?.description" class="tool-info">
        <n-alert type="info" :bordered="false">
          {{ tool.description }}
        </n-alert>
      </div>

      <!-- Parameters form -->
      <div v-if="hasParameters" class="params-section">
        <div class="section-header">
          <n-icon :size="16" class="section-icon">
            <SettingsOutline />
          </n-icon>
          <span class="section-title">输入参数</span>
        </div>

        <McpDynamicForm
          v-model="formData"
          :schema="tool.inputSchema"
        />
      </div>

      <div v-else class="no-params">
        <n-text depth="3">此工具无需参数，可直接执行</n-text>
      </div>

      <!-- Result display -->
      <div v-if="hasResult" class="result-section">
        <div class="section-header">
          <n-icon :size="16" class="section-icon" :class="{ error: result.isError }">
            <CheckmarkCircleOutline v-if="!result.isError" />
            <CloseCircleOutline v-else />
          </n-icon>
          <span class="section-title">执行结果</span>
          <span v-if="result.duration != null" class="result-duration">
            {{ result.duration }}ms
          </span>
        </div>

        <!-- Success result -->
        <div v-if="!result.isError" class="result-display">
          <n-code
            :code="formatResult(result.result)"
            language="json"
            :word-wrap="true"
          />
        </div>

        <!-- Error result -->
        <div v-else class="result-error">
          <n-alert type="error" :bordered="false">
            <template #header>执行失败</template>
            {{ result.result?.message || result.result || '未知错误' }}
          </n-alert>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="modal-footer">
        <n-button @click="visible = false">关闭</n-button>
        <n-button
          type="primary"
          :loading="executing"
          :disabled="!serverId || !tool"
          @click="handleExecute"
        >
          <template #icon>
            <n-icon><PlayOutline /></n-icon>
          </template>
          {{ executing ? '执行中...' : '执行工具' }}
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import {
  NModal, NButton, NIcon, NAlert, NCode, NText
} from 'naive-ui'
import {
  SettingsOutline, CheckmarkCircleOutline, CloseCircleOutline, PlayOutline
} from '@vicons/ionicons5'
import { testServerTool } from '../api/mcp'
import message from '../utils/message'
import { resolveMcpErrorMessage, showMcpError } from '../utils/mcp-error'
import McpDynamicForm from './McpDynamicForm.vue'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  serverId: {
    type: String,
    default: ''
  },
  tool: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['update:visible'])

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

const formData = ref({})
const executing = ref(false)
const result = ref(null)

const hasParameters = computed(() => {
  const properties = props.tool?.inputSchema?.properties
  return properties && Object.keys(properties).length > 0
})

const hasResult = computed(() => {
  return result.value !== null
})

// Execute tool
async function handleExecute() {
  if (!props.serverId || !props.tool) {
    message.error('缺少必要参数')
    return
  }

  executing.value = true
  result.value = null

  try {
    const response = await testServerTool(
      props.serverId,
      props.tool.name,
      formData.value
    )

    if (response.success) {
      const responseErrorMessage = resolveMcpErrorMessage(response.result, '工具执行失败')
      result.value = {
        result: response.result,
        duration: response.duration,
        isError: response.isError || false
      }

      if (!response.isError) {
        message.success(`工具执行成功 (${response.duration}ms)`)
      } else {
        result.value.result = responseErrorMessage
        showMcpError(message, response.result, '工具执行失败', `${props.tool.name}: `)
      }
    } else {
      result.value = {
        result: resolveMcpErrorMessage(response, '执行失败'),
        isError: true
      }
      showMcpError(message, response, '执行失败', `${props.tool.name}: `)
    }
  } catch (err) {
    console.error('Tool execution error:', err)
    const errorMsg = resolveMcpErrorMessage(err, '执行失败')
    result.value = {
      result: errorMsg,
      isError: true
    }
    showMcpError(message, err, '执行失败', `${props.tool.name}: `)
  } finally {
    executing.value = false
  }
}

// Format result for display
function formatResult(data) {
  if (!data) return 'null'
  if (typeof data === 'string') return data
  try {
    return JSON.stringify(data, null, 2)
  } catch (e) {
    return String(data)
  }
}

// Reset state when modal opens/closes or tool changes
watch(() => [props.visible, props.tool], ([newVisible, newTool]) => {
  if (newVisible && newTool) {
    // Reset form data with defaults from schema
    formData.value = {}
    result.value = null
  }
})
</script>

<style scoped>
.modal-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.tool-info {
  margin-bottom: 4px;
}

.params-section,
.result-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-primary);
}

.section-icon {
  color: #18a058;
  flex-shrink: 0;
}

.section-icon.error {
  color: #f56c6c;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.result-duration {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-tertiary);
  font-family: 'SF Mono', Monaco, Consolas, monospace;
}

.no-params {
  text-align: center;
  padding: 16px 0;
}

.result-display {
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border-primary);
}

.result-error {
  margin-top: 4px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

/* Naive UI overrides */
:deep(.n-card__content) {
  padding: 20px;
}

:deep(.n-card__footer) {
  padding: 16px 20px;
}

:deep(.n-code) {
  font-size: 12px;
  max-height: 400px;
  overflow: auto;
}

:deep(.n-alert) {
  border-radius: 8px;
}

/* Mobile responsive */
@media (max-width: 640px) {
  .modal-content {
    gap: 16px;
  }

  :deep(.n-card__content) {
    padding: 16px;
  }

  :deep(.n-code) {
    max-height: 300px;
  }
}
</style>
