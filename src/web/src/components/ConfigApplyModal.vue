<template>
  <n-modal
    :show="show"
    preset="card"
    :title="`应用模版: ${template?.name || ''}`"
    style="width: 600px"
    :mask-closable="false"
    @update:show="emit('update:show', $event)"
  >
    <n-form ref="formRef" :model="formData" :rules="formRules">
      <n-form-item label="目标项目路径" path="targetPath">
        <n-input
          v-model:value="formData.targetPath"
          placeholder="输入项目目录路径，如 /path/to/project"
        />
      </n-form-item>
    </n-form>

    <!-- 预览按钮 -->
    <n-space style="margin-bottom: 16px">
      <n-button @click="handlePreview" :loading="loadingPreview" :disabled="!formData.targetPath">
        预览应用效果
      </n-button>
    </n-space>

    <!-- 预览结果 -->
    <n-card v-if="previewData" size="small" title="应用预览">
      <n-space vertical>
        <div v-if="previewData.summary">
          <n-text depth="3">将应用：</n-text>
          <n-space style="margin-top: 8px">
            <n-tag v-if="previewData.summary.claudeMd" type="success" size="small">CLAUDE.md</n-tag>
            <n-tag v-if="previewData.summary.skills" type="info" size="small">{{ previewData.summary.skills }} Skills</n-tag>
            <n-tag v-if="previewData.summary.agents" type="info" size="small">{{ previewData.summary.agents }} Agents</n-tag>
            <n-tag v-if="previewData.summary.commands" type="info" size="small">{{ previewData.summary.commands }} Commands</n-tag>
            <n-tag v-if="previewData.summary.rules" type="info" size="small">{{ previewData.summary.rules }} Rules</n-tag>
            <n-tag v-if="previewData.summary.mcpServers" type="warning" size="small">{{ previewData.summary.mcpServers }} MCP</n-tag>
          </n-space>
        </div>

        <n-divider style="margin: 12px 0" />

        <div v-if="previewData.willCreate?.length">
          <n-text type="success">将创建：</n-text>
          <n-ul style="margin: 4px 0">
            <n-li v-for="file in previewData.willCreate" :key="file">
              <n-text code>{{ file }}</n-text>
            </n-li>
          </n-ul>
        </div>

        <div v-if="previewData.willOverwrite?.length">
          <n-text type="warning">将覆盖：</n-text>
          <n-ul style="margin: 4px 0">
            <n-li v-for="file in previewData.willOverwrite" :key="file">
              <n-text code>{{ file }}</n-text>
              <n-tag type="warning" size="tiny" style="margin-left: 8px">已存在</n-tag>
            </n-li>
          </n-ul>
        </div>

        <n-alert
          v-if="previewData.willOverwrite?.length"
          type="warning"
          style="margin-top: 8px"
        >
          以上文件将被覆盖，请确认后再应用
        </n-alert>
      </n-space>
    </n-card>

    <template #footer>
      <n-space justify="end">
        <n-button @click="emit('update:show', false)">取消</n-button>
        <n-button
          type="primary"
          :loading="applying"
          :disabled="!formData.targetPath"
          @click="handleApply"
        >
          确认应用
        </n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup>
import { ref, watch } from 'vue'
import {
  NModal, NForm, NFormItem, NInput, NButton, NSpace, NCard,
  NTag, NText, NDivider, NUl, NLi, NAlert,
  useMessage
} from 'naive-ui'
import { applyTemplate, previewTemplate } from '@/api/config-templates'

const props = defineProps({
  show: Boolean,
  template: Object
})

const emit = defineEmits(['update:show', 'success'])
const message = useMessage()

const formRef = ref(null)
const loadingPreview = ref(false)
const applying = ref(false)
const previewData = ref(null)

const formData = ref({
  targetPath: ''
})

const formRules = {
  targetPath: { required: true, message: '请输入目标路径', trigger: 'blur' }
}

// 重置状态
watch(() => props.show, (newVal) => {
  if (newVal) {
    formData.value.targetPath = ''
    previewData.value = null
  }
})

// 预览
async function handlePreview() {
  if (!formData.value.targetPath || !props.template) return

  loadingPreview.value = true
  try {
    const res = await previewTemplate(props.template.id, formData.value.targetPath)
    if (res.success) {
      previewData.value = res.data
    } else {
      message.error(res.message || '预览失败')
    }
  } catch (error) {
    message.error('预览失败: ' + error.message)
  } finally {
    loadingPreview.value = false
  }
}

// 应用
async function handleApply() {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }

  if (!props.template) return

  applying.value = true
  try {
    const res = await applyTemplate(props.template.id, formData.value.targetPath)
    if (res.success) {
      message.success('模版应用成功')
      emit('success')
    } else {
      message.error(res.message || '应用失败')
    }
  } catch (error) {
    message.error('应用失败: ' + error.message)
  } finally {
    applying.value = false
  }
}
</script>
