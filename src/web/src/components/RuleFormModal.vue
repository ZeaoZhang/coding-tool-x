<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    :title="isEdit ? '编辑规则' : '创建规则'"
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
          placeholder="如: coding-style, api-guidelines"
        >
          <template #suffix>.md</template>
        </n-input>
      </n-form-item>

      <n-form-item label="作用域" path="scope">
        <n-radio-group v-model:value="formData.scope" :disabled="isEdit">
          <n-radio value="user">用户级 (~/.claude/rules/)</n-radio>
          <n-radio value="project">项目级 (.claude/rules/)</n-radio>
        </n-radio-group>
      </n-form-item>

      <n-form-item label="子目录" path="directory">
        <n-input
          v-model:value="formData.directory"
          :disabled="isEdit"
          placeholder="可选，如: frontend, backend"
        />
        <template #feedback>
          用于组织规则文件，如 frontend/react.md
        </template>
      </n-form-item>

      <n-form-item label="条件路径" path="paths">
        <n-input
          v-model:value="formData.paths"
          placeholder="如: src/api/**/*.ts, **/*.test.js"
        />
        <template #feedback>
          设置后，此规则仅在编辑匹配的文件时生效
        </template>
      </n-form-item>

      <n-form-item label="规则内容" path="body">
        <MarkdownEditor
          v-model="formData.body"
          :rows="12"
          :min-height="200"
          placeholder="规则内容，用 Markdown 格式编写&#10;&#10;示例:&#10;# 代码风格&#10;&#10;- 使用 2 空格缩进&#10;- 函数命名使用 camelCase&#10;- 组件命名使用 PascalCase"
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
import { createRule, updateRule } from '../api/rules'
import message from '../utils/message'
import MarkdownEditor from './MarkdownEditor.vue'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  rule: {
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

const isEdit = computed(() => !!props.rule)

const formRef = ref(null)
const saving = ref(false)

const formData = ref({
  fileName: '',
  scope: 'user',
  directory: '',
  paths: '',
  body: ''
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
  }
}

// 监听 rule 变化，填充表单
watch(() => props.rule, (rule) => {
  if (rule) {
    formData.value = {
      fileName: rule.fileName || rule.name || '',
      scope: rule.scope || 'user',
      directory: rule.directory || '',
      paths: rule.paths || '',
      body: rule.body || ''
    }
  } else {
    resetForm()
  }
}, { immediate: true })

function resetForm() {
  formData.value = {
    fileName: '',
    scope: 'user',
    directory: '',
    paths: '',
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
      await updateRule(props.rule.path, formData.value.scope, data)
      message.success('规则更新成功')
    } else {
      await createRule(data)
      message.success('规则创建成功')
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
