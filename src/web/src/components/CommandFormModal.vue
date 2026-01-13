<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    :title="isEdit ? '编辑命令' : '创建命令'"
    style="width: 600px; max-width: 95vw;"
    :mask-closable="false"
  >
    <n-form
      ref="formRef"
      :model="formData"
      :rules="rules"
      label-placement="left"
      label-width="auto"
      require-mark-placement="right-hanging"
    >
      <n-form-item label="命令名" path="name">
        <n-input
          v-model:value="formData.name"
          :disabled="isEdit"
          placeholder="如: deploy, test, build"
        >
          <template #prefix>/</template>
        </n-input>
      </n-form-item>

      <n-form-item label="作用域" path="scope">
        <n-radio-group v-model:value="formData.scope" :disabled="isEdit">
          <n-radio value="user">用户级 (~/.claude/commands/)</n-radio>
          <n-radio value="project">项目级 (.claude/commands/)</n-radio>
        </n-radio-group>
      </n-form-item>

      <n-form-item label="命名空间" path="namespace">
        <n-input
          v-model:value="formData.namespace"
          :disabled="isEdit"
          placeholder="可选，如: frontend, backend"
        />
      </n-form-item>

      <n-form-item label="描述" path="description">
        <n-input
          v-model:value="formData.description"
          placeholder="命令功能描述"
        />
      </n-form-item>

      <n-form-item label="允许的工具" path="allowedTools">
        <n-input
          v-model:value="formData.allowedTools"
          placeholder="如: Bash, Edit, Read (逗号分隔)"
        />
      </n-form-item>

      <n-form-item label="参数提示" path="argumentHint">
        <n-input
          v-model:value="formData.argumentHint"
          placeholder="如: add [id] | remove [id]"
        />
      </n-form-item>

      <n-form-item label="命令内容" path="body">
        <MarkdownEditor
          v-model="formData.body"
          :rows="8"
          :min-height="180"
          placeholder="命令的提示词内容，可使用 $ARGUMENTS、$1、$2 等变量&#10;&#10;示例:&#10;请执行以下操作: $ARGUMENTS&#10;&#10;! 开头的行会作为 bash 命令执行&#10;@ 开头的行会引用指定文件"
          :default-editing="!isEdit"
        />
      </n-form-item>
    </n-form>

    <template #footer>
      <div class="modal-footer">
        <n-button @click="handleCancel">取消</n-button>
        <n-button type="primary" :loading="saving" @click="handleSubmit">
          {{ isEdit ? '保存' : '创建' }}
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { NModal, NForm, NFormItem, NInput, NRadioGroup, NRadio, NButton } from 'naive-ui'
import { createCommand, updateCommand } from '../api/commands'
import message from '../utils/message'
import MarkdownEditor from './MarkdownEditor.vue'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  command: {
    type: Object,
    default: null
  },
  projectPath: {
    type: String,
    default: null
  }
})

const emit = defineEmits(['update:visible', 'saved'])

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

const isEdit = computed(() => !!props.command)

const formRef = ref(null)
const saving = ref(false)

const formData = ref({
  name: '',
  scope: 'user',
  namespace: '',
  description: '',
  allowedTools: '',
  argumentHint: '',
  body: ''
})

const rules = {
  name: {
    required: true,
    message: '请输入命令名',
    trigger: 'blur'
  },
  scope: {
    required: true,
    message: '请选择作用域',
    trigger: 'change'
  }
}

// 监听 command 变化，填充表单
watch(() => props.command, (cmd) => {
  if (cmd) {
    formData.value = {
      name: cmd.name || '',
      scope: cmd.scope || 'user',
      namespace: cmd.namespace || '',
      description: cmd.description || '',
      allowedTools: cmd.allowedTools || '',
      argumentHint: cmd.argumentHint || '',
      body: cmd.body || ''
    }
  } else {
    resetForm()
  }
}, { immediate: true })

function resetForm() {
  formData.value = {
    name: '',
    scope: 'user',
    namespace: '',
    description: '',
    allowedTools: '',
    argumentHint: '',
    body: ''
  }
}

function handleCancel() {
  visible.value = false
  resetForm()
}

async function handleSubmit() {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }

  saving.value = true
  try {
    const data = {
      ...formData.value,
      projectPath: props.projectPath
    }

    if (isEdit.value) {
      await updateCommand(formData.value.name, formData.value.scope, data)
      message.success('命令更新成功')
    } else {
      await createCommand(data)
      message.success('命令创建成功')
    }

    emit('saved')
    visible.value = false
    resetForm()
  } catch (err) {
    message.error('操作失败: ' + err.message)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
