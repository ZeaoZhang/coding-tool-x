<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    :title="isEdit ? '编辑代理' : '创建代理'"
    style="width: 650px; max-width: 95vw;"
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
      <n-form-item label="文件名" path="fileName">
        <n-input
          v-model:value="formData.fileName"
          :disabled="isEdit"
          placeholder="如: code-reviewer, deploy-helper"
        />
      </n-form-item>

      <n-form-item label="作用域" path="scope">
        <n-radio-group v-model:value="formData.scope" :disabled="isEdit">
          <n-radio value="user">{{ userScopeLabel }}</n-radio>
          <n-radio value="project">{{ projectScopeLabel }}</n-radio>
        </n-radio-group>
      </n-form-item>

      <n-form-item label="代理名称" path="name">
        <n-input
          v-model:value="formData.name"
          placeholder="代理的显示名称"
        />
      </n-form-item>

      <n-form-item label="描述" path="description">
        <n-input
          v-model:value="formData.description"
          type="textarea"
          :rows="2"
          placeholder="代理用途描述（必填）"
        />
      </n-form-item>

      <n-form-item label="可用工具" path="tools">
        <n-input
          v-model:value="formData.tools"
          placeholder="如: Read, Edit, Bash (逗号分隔)"
        />
      </n-form-item>

      <n-form-item label="模型" path="model">
        <n-select
          v-model:value="formData.model"
          :options="modelOptions"
          placeholder="选择模型"
          clearable
        />
      </n-form-item>

      <n-form-item v-if="props.platform !== 'opencode'" label="权限模式" path="permissionMode">
        <n-select
          v-model:value="formData.permissionMode"
          :options="permissionOptions"
          placeholder="选择权限模式"
          clearable
        />
      </n-form-item>

      <n-form-item v-if="props.platform !== 'opencode'" label="技能" path="skills">
        <n-input
          v-model:value="formData.skills"
          placeholder="自动加载的技能 (逗号分隔)"
        />
      </n-form-item>

      <n-form-item label="系统提示词" path="systemPrompt">
        <MarkdownEditor
          v-model="formData.systemPrompt"
          :rows="8"
          :min-height="180"
          placeholder="代理的系统提示词，定义代理的行为和能力"
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
import { NModal, NForm, NFormItem, NInput, NRadioGroup, NRadio, NSelect, NButton } from 'naive-ui'
import { createAgent, updateAgent } from '../api/agents'
import message from '../utils/message'
import MarkdownEditor from './MarkdownEditor.vue'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  agent: {
    type: Object,
    default: null
  },
  projectPath: {
    type: String,
    default: null
  },
  platform: {
    type: String,
    default: 'claude'
  }
})

const emit = defineEmits(['update:visible', 'saved'])

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

const isEdit = computed(() => !!props.agent)
const userScopeLabel = computed(() =>
  props.platform === 'opencode'
    ? '用户级 (~/.config/opencode/agents/)'
    : '用户级 (~/.claude/agents/)'
)
const projectScopeLabel = computed(() =>
  props.platform === 'opencode'
    ? '项目级 (.opencode/agents/)'
    : '项目级 (.claude/agents/)'
)

const formRef = ref(null)
const saving = ref(false)

const modelOptions = [
  { label: 'Sonnet', value: 'sonnet' },
  { label: 'Opus', value: 'opus' },
  { label: 'Haiku', value: 'haiku' },
  { label: '继承 (inherit)', value: 'inherit' }
]

const permissionOptions = [
  { label: '默认 (default)', value: 'default' },
  { label: '宽松 (permissive)', value: 'permissive' },
  { label: '严格 (strict)', value: 'strict' }
]

const formData = ref({
  fileName: '',
  scope: 'user',
  name: '',
  description: '',
  tools: '',
  model: '',
  permissionMode: '',
  skills: '',
  systemPrompt: ''
})

const rules = {
  fileName: {
    required: true,
    message: '请输入文件名',
    trigger: 'blur'
  },
  scope: {
    required: true,
    message: '请选择作用域',
    trigger: 'change'
  },
  name: {
    required: true,
    message: '请输入代理名称',
    trigger: 'blur'
  },
  description: {
    required: true,
    message: '请输入代理描述',
    trigger: 'blur'
  }
}

// 监听 agent 变化，填充表单
watch(() => props.agent, (agent) => {
  if (agent) {
    formData.value = {
      fileName: agent.fileName || '',
      scope: agent.scope || 'user',
      name: agent.name || '',
      description: agent.description || '',
      tools: agent.tools || '',
      model: agent.model || '',
      permissionMode: agent.permissionMode || '',
      skills: agent.skills || '',
      systemPrompt: agent.systemPrompt || ''
    }
  } else {
    resetForm()
  }
}, { immediate: true })

function resetForm() {
  formData.value = {
    fileName: '',
    scope: 'user',
    name: '',
    description: '',
    tools: '',
    model: '',
    permissionMode: '',
    skills: '',
    systemPrompt: ''
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
      await updateAgent(formData.value.fileName, formData.value.scope, data, props.platform)
      message.success('代理更新成功')
    } else {
      await createAgent(data, props.platform)
      message.success('代理创建成功')
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
