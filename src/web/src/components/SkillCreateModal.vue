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
        <n-tabs type="line" size="small" class="content-tabs">
          <n-tab-pane name="edit" tab="编辑">
            <n-input
              v-model:value="formData.content"
              type="textarea"
              placeholder="输入技能的详细指令内容，支持 Markdown 格式..."
              :rows="10"
            />
          </n-tab-pane>
          <n-tab-pane name="preview" tab="预览">
            <div class="preview-content" v-html="renderedContent"></div>
          </n-tab-pane>
        </n-tabs>
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
import { NModal, NForm, NFormItem, NInput, NButton, NTabs, NTabPane } from 'naive-ui'
import { createCustomSkill } from '../api/skills'
import message from '../utils/message'
import { marked } from 'marked'

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

// Markdown 预览
const renderedContent = computed(() => {
  if (!formData.value.content) return '<span style="color: var(--text-tertiary)">预览区域</span>'
  try {
    return marked(formData.value.content, { breaks: true, gfm: true })
  } catch (e) {
    return formData.value.content
  }
})

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

.content-tabs {
  width: 100%;
}

.preview-content {
  min-height: 200px;
  max-height: 300px;
  overflow-y: auto;
  padding: 12px;
  background: var(--bg-tertiary);
  border-radius: 4px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-primary);
}

.preview-content :deep(h1),
.preview-content :deep(h2),
.preview-content :deep(h3),
.preview-content :deep(h4) {
  margin: 12px 0 6px 0;
  font-weight: 600;
}

.preview-content :deep(h1) { font-size: 18px; }
.preview-content :deep(h2) { font-size: 16px; }
.preview-content :deep(h3) { font-size: 14px; }

.preview-content :deep(p) {
  margin: 6px 0;
}

.preview-content :deep(ul),
.preview-content :deep(ol) {
  margin: 6px 0;
  padding-left: 20px;
}

.preview-content :deep(code) {
  background: var(--bg-secondary);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 12px;
}

.preview-content :deep(pre) {
  background: var(--bg-secondary);
  padding: 10px 12px;
  border-radius: 4px;
  overflow-x: auto;
  margin: 8px 0;
}

.preview-content :deep(pre code) {
  background: none;
  padding: 0;
}

.preview-content :deep(blockquote) {
  border-left: 3px solid #18a058;
  padding-left: 12px;
  margin: 8px 0;
  color: var(--text-secondary);
}
</style>
