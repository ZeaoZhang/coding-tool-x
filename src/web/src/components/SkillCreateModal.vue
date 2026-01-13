<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    title="创建自定义技能"
    :bordered="false"
    :closable="true"
    style="width: 560px; max-width: 90vw;"
    @close="handleClose"
  >
    <n-form
      ref="formRef"
      :model="formData"
      :rules="rules"
      label-placement="top"
      label-width="auto"
    >
      <n-form-item label="目录名称" path="directory">
        <n-input
          v-model:value="formData.directory"
          placeholder="例如: my-custom-skill"
          :maxlength="50"
        />
        <template #feedback>
          只能包含英文、数字、横杠和下划线
        </template>
      </n-form-item>

      <n-form-item label="技能名称" path="name">
        <n-input
          v-model:value="formData.name"
          placeholder="显示名称，可以是中文"
          :maxlength="100"
        />
      </n-form-item>

      <n-form-item label="描述" path="description">
        <n-input
          v-model:value="formData.description"
          type="textarea"
          placeholder="简短描述这个技能的用途"
          :rows="2"
          :maxlength="200"
        />
      </n-form-item>

      <n-form-item label="技能内容 (提示词，支持 Markdown)" path="content">
        <MarkdownEditor
          v-model="formData.content"
          :rows="10"
          :min-height="200"
          placeholder="输入技能的详细指令内容，支持 Markdown 格式..."
          :default-editing="true"
        />
      </n-form-item>
    </n-form>

    <template #footer>
      <div class="modal-footer">
        <n-button @click="handleClose">取消</n-button>
        <n-button type="primary" :loading="submitting" @click="handleSubmit">
          创建
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { NModal, NForm, NFormItem, NInput, NButton } from 'naive-ui'
import { createCustomSkill } from '../api/skills'
import message from '../utils/message'
import MarkdownEditor from './MarkdownEditor.vue'

const props = defineProps({
  visible: Boolean
})

const emit = defineEmits(['update:visible', 'created'])

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

const formRef = ref(null)
const submitting = ref(false)

const formData = ref({
  directory: '',
  name: '',
  description: '',
  content: ''
})

const rules = {
  directory: [
    { required: true, message: '请输入目录名称', trigger: 'blur' },
    {
      pattern: /^[a-zA-Z0-9_-]+$/,
      message: '只能包含英文、数字、横杠和下划线',
      trigger: 'blur'
    }
  ],
  content: [
    { required: true, message: '请输入技能内容', trigger: 'blur' }
  ]
}

async function handleSubmit() {
  try {
    await formRef.value?.validate()
  } catch (err) {
    return
  }

  submitting.value = true
  try {
    const result = await createCustomSkill({
      name: formData.value.name || formData.value.directory,
      directory: formData.value.directory,
      description: formData.value.description,
      content: formData.value.content
    })

    if (result.success) {
      message.success('技能创建成功')
      emit('created')
      handleClose()
    } else {
      message.error(result.message || '创建失败')
    }
  } catch (err) {
    message.error('创建失败: ' + (err.response?.data?.message || err.message))
  } finally {
    submitting.value = false
  }
}

function handleClose() {
  emit('update:visible', false)
}

// 关闭时重置表单
watch(() => props.visible, (val) => {
  if (!val) {
    formData.value = {
      directory: '',
      name: '',
      description: '',
      content: ''
    }
  }
})
</script>

<style scoped>
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
