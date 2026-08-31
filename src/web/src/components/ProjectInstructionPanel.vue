<template>
  <div class="project-instruction-panel">
    <div v-if="!instruction?.supported" class="unsupported-state">
      当前平台不提供项目指令文件
    </div>
    <template v-else>
      <div class="resource-path">目标文件：{{ instruction.path }}</div>
      <n-input
        v-model:value="content"
        type="textarea"
        :rows="16"
        placeholder="输入项目指令"
        :disabled="saving"
      />
      <n-space justify="end" class="actions">
        <n-button
          v-if="instruction.exists"
          data-action="delete-instruction"
          type="error"
          secondary
          :loading="deleting"
          @click="handleDelete"
        >
          删除文件
        </n-button>
        <n-button
          data-action="save-instruction"
          type="primary"
          :loading="saving"
          @click="handleSave"
        >
          保存
        </n-button>
      </n-space>
      <n-text depth="3" class="hint">
        写入项目原生文件；修改后通常需要重新启动对应 CLI。
      </n-text>
    </template>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { NButton, NInput, NSpace, NText, useDialog, useMessage } from 'naive-ui'
import { deleteProjectInstruction, saveProjectInstruction } from '../api/project-config'

const props = defineProps({
  projectPath: { type: String, required: true },
  platform: { type: String, required: true },
  instruction: { type: Object, default: () => ({ supported: false, path: null, exists: false, content: '' }) }
})

const emit = defineEmits(['updated'])
const message = useMessage()
const dialog = useDialog()
const content = ref(props.instruction.content || '')
const saving = ref(false)
const deleting = ref(false)

watch(() => props.instruction, nextInstruction => {
  content.value = nextInstruction?.content || ''
}, { deep: true })

async function handleSave() {
  saving.value = true
  try {
    const result = await saveProjectInstruction(props.projectPath, props.platform, content.value)
    content.value = result.content ?? content.value
    emit('updated', result)
    message.success('项目指令已保存')
  } catch (error) {
    message.error(`保存项目指令失败：${error.message}`)
  } finally {
    saving.value = false
  }
}

function handleDelete() {
  dialog.warning({
    title: '删除项目指令',
    content: `确定删除 ${props.instruction.path} 吗？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      deleting.value = true
      try {
        const result = await deleteProjectInstruction(props.projectPath, props.platform)
        content.value = ''
        emit('updated', result)
        message.success('项目指令已删除')
      } catch (error) {
        message.error(`删除项目指令失败：${error.message}`)
      } finally {
        deleting.value = false
      }
    }
  })
}
</script>

<style scoped>
.project-instruction-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.resource-path {
  color: var(--text-tertiary);
  font-family: monospace;
  font-size: 12px;
}
.actions { margin-top: 4px; }
.hint { font-size: 11px; }
.unsupported-state {
  padding: 28px 12px;
  color: var(--text-tertiary);
  text-align: center;
}
</style>
