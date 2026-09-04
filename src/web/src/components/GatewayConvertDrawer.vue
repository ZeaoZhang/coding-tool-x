<template>
  <n-drawer v-model:show="visible" :width="drawerWidth" placement="right" :show-mask="true">
    <n-drawer-content closable :native-scrollbar="false">
      <template #header>
        <div class="drawer-header">
          <div class="header-icon-wrapper">
            <n-icon :size="18">
              <GitCompareOutline />
            </n-icon>
          </div>
          <span>OpenCode 请求转换</span>
        </div>
      </template>

      <div class="convert-container">
        <n-form label-placement="top">
          <n-form-item label="来源渠道">
            <n-select
              v-model:value="sourceType"
              :options="sourceTypeOptions"
              placeholder="选择来源渠道"
            />
          </n-form-item>

          <n-form-item label="目标 API">
            <n-select
              v-model:value="targetApi"
              :options="targetApiOptions"
              placeholder="选择目标 API"
            />
          </n-form-item>

          <n-form-item label="原始请求 JSON">
            <n-input
              v-model:value="payloadText"
              type="textarea"
              :autosize="{ minRows: 10, maxRows: 18 }"
              placeholder="粘贴原始请求 JSON"
            />
          </n-form-item>
        </n-form>

        <div class="action-row">
          <n-button quaternary @click="fillSamplePayload">填充示例</n-button>
          <n-space>
            <n-button @click="handleClear">清空结果</n-button>
            <n-button type="primary" :loading="converting" @click="handleConvert">开始转换</n-button>
          </n-space>
        </div>

        <n-alert v-if="errorText" type="error" :show-icon="true" style="margin-top: 12px;">
          {{ errorText }}
        </n-alert>

        <div v-if="result" class="result-section">
          <div class="result-meta">
            <div class="meta-row">
              <span class="meta-label">转换端点</span>
              <n-tag type="success" size="small" :bordered="false">{{ result.endpoint }}</n-tag>
            </div>
            <div class="meta-row">
              <span class="meta-label">目标协议</span>
              <n-tag type="info" size="small" :bordered="false">{{ result.targetApi }}</n-tag>
            </div>
            <div class="meta-row">
              <span class="meta-label">消息数量</span>
              <n-tag size="small" :bordered="false">{{ result.meta?.messageCount ?? 0 }}</n-tag>
            </div>
          </div>

          <n-alert
            v-if="Array.isArray(result.warnings) && result.warnings.length > 0"
            type="warning"
            :show-icon="true"
            style="margin-top: 12px;"
          >
            <div class="warning-title">转换警告</div>
            <ul class="warning-list">
              <li v-for="(warning, idx) in result.warnings" :key="idx">{{ warning }}</li>
            </ul>
          </n-alert>

          <n-form-item label="转换后请求 JSON" style="margin-top: 12px;">
            <n-input
              :value="formattedRequestBody"
              type="textarea"
              readonly
              :autosize="{ minRows: 10, maxRows: 18 }"
            />
          </n-form-item>

          <div class="action-row">
            <div />
            <n-button size="small" @click="copyResult">复制转换结果</n-button>
          </div>
        </div>
      </div>
    </n-drawer-content>
  </n-drawer>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import {
  NDrawer,
  NDrawerContent,
  NIcon,
  NForm,
  NFormItem,
  NSelect,
  NInput,
  NButton,
  NAlert,
  NSpace,
  NTag
} from 'naive-ui'
import { GitCompareOutline } from '@vicons/ionicons5'
import { useResponsiveDrawer } from '../composables/useResponsiveDrawer'
import {
  convertClaudeToOpenCode,
  convertCodexToOpenCode,
  convertGeminiToOpenCode,
  getOpenCodeGatewayFormats
} from '../api/convert'
import message from '../utils/message'

const { drawerWidth } = useResponsiveDrawer(620, 520)

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:visible'])

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

const sourceTypeOptions = ref([
  { label: 'Claude Code', value: 'claude' },
  { label: 'Codex', value: 'codex' },
  { label: 'Gemini', value: 'gemini' }
])
const targetApiOptions = ref([
  { label: 'Responses API (/v1/responses)', value: 'responses' },
  { label: 'Chat Completions (/v1/chat/completions)', value: 'chat.completions' }
])

const sourceType = ref('claude')
const targetApi = ref('responses')
const payloadText = ref('')
const converting = ref(false)
const result = ref(null)
const errorText = ref('')
const formatsLoaded = ref(false)

const SAMPLE_PAYLOADS = {
  claude: {
    model: 'claude-sonnet-4-5',
    system: [{ type: 'text', text: 'You are a concise assistant.' }],
    messages: [
      { role: 'user', content: [{ type: 'text', text: '请用三点总结这个需求。' }] }
    ],
    max_tokens: 256,
    stream: false
  },
  codex: {
    model: 'gpt-5-codex',
    instructions: 'You are Codex.',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'ping' }]
      }
    ],
    stream: false,
    store: false
  },
  gemini: {
    model: 'gemini-2.5-pro',
    system_instruction: {
      parts: [{ text: 'You are a concise assistant.' }]
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: '请将以下文本转换为要点列表。' }]
      }
    ],
    generationConfig: {
      maxOutputTokens: 256,
      temperature: 0.2
    }
  }
}

const formattedRequestBody = computed(() => {
  if (!result.value?.requestBody) return ''
  return JSON.stringify(result.value.requestBody, null, 2)
})

function fillSamplePayload() {
  const sample = SAMPLE_PAYLOADS[sourceType.value] || SAMPLE_PAYLOADS.claude
  payloadText.value = JSON.stringify(sample, null, 2)
}

async function loadFormats() {
  if (formatsLoaded.value) return
  try {
    const data = await getOpenCodeGatewayFormats()
    if (Array.isArray(data.sourceTypes) && data.sourceTypes.length > 0) {
      sourceTypeOptions.value = data.sourceTypes.map(item => ({
        label: item.name || item.id,
        value: item.id
      }))
    }
    if (Array.isArray(data.targetApis) && data.targetApis.length > 0) {
      targetApiOptions.value = data.targetApis.map(item => {
        if (item === 'chat.completions') {
          return { label: 'Chat Completions (/v1/chat/completions)', value: item }
        }
        return { label: 'Responses API (/v1/responses)', value: item }
      })
    }
    if (data.defaultTargetApi) {
      targetApi.value = data.defaultTargetApi
    }
    formatsLoaded.value = true
  } catch (error) {
    console.error('Failed to load opencode gateway formats:', error)
  }
}

function handleClear() {
  errorText.value = ''
  result.value = null
}

async function handleConvert() {
  errorText.value = ''
  result.value = null

  let parsedPayload
  try {
    parsedPayload = JSON.parse(payloadText.value || '{}')
  } catch (error) {
    errorText.value = '原始请求 JSON 解析失败，请检查格式'
    return
  }

  converting.value = true
  try {
    const converterMap = {
      claude: convertClaudeToOpenCode,
      codex: convertCodexToOpenCode,
      gemini: convertGeminiToOpenCode
    }

    const converter = converterMap[sourceType.value]
    if (!converter) {
      throw new Error(`Unsupported sourceType: ${sourceType.value}`)
    }

    const data = await converter({
      payload: parsedPayload,
      options: {
        targetApi: targetApi.value
      }
    })

    if (data.success === false) {
      throw new Error(data.error || '转换失败')
    }

    result.value = data
    message.success('转换完成')
  } catch (error) {
    const msg = error.response?.data?.error || error.message || '转换失败'
    errorText.value = msg
  } finally {
    converting.value = false
  }
}

async function copyResult() {
  if (!result.value) return

  const payload = {
    endpoint: result.value.endpoint,
    requestBody: result.value.requestBody
  }

  try {
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
    message.success('已复制转换结果')
  } catch (error) {
    message.error('复制失败，请手动复制')
  }
}

watch(() => sourceType.value, () => {
  fillSamplePayload()
})

watch(() => props.visible, async (val) => {
  if (val) {
    await loadFormats()
    if (!payloadText.value) {
      fillSamplePayload()
    }
  }
}, { immediate: true })
</script>

<style scoped>
.drawer-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-icon-wrapper {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  color: var(--primary-color);
}

.convert-container {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-bottom: 8px;
}

.action-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.result-section {
  padding: 12px;
  border-radius: 8px;
  border: 1px solid var(--border-primary);
  background: var(--bg-secondary);
}

.result-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.meta-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.warning-title {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 4px;
}

.warning-list {
  margin: 0;
  padding-left: 16px;
  font-size: 12px;
  line-height: 1.5;
}
</style>
