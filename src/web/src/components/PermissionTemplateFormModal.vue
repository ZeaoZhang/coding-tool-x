<template>
  <n-modal
    :show="show"
    preset="card"
    :title="isEdit ? '编辑权限模版' : '创建权限模版'"
    style="width: 650px; max-height: 90vh"
    :mask-closable="false"
    @update:show="emit('update:show', $event)"
  >
    <n-scrollbar style="max-height: calc(90vh - 140px)">
      <n-form ref="formRef" :model="formData" :rules="formRules" label-placement="left" label-width="100">
        <!-- 基本信息 -->
        <n-card title="基本信息" size="small" style="margin-bottom: 16px">
          <n-form-item label="模版名称" path="name">
            <n-input v-model:value="formData.name" placeholder="输入模版名称" />
          </n-form-item>
          <n-form-item label="描述" path="description">
            <n-input v-model:value="formData.description" type="textarea" :rows="2" placeholder="输入模版描述（可选）" />
          </n-form-item>
        </n-card>

        <!-- 允许自动执行的规则 -->
        <n-card size="small" style="margin-bottom: 16px">
          <template #header>
            <n-space align="center">
              <n-icon :size="18" color="#18a058"><CheckmarkCircleOutline /></n-icon>
              <span>允许自动执行 (allow)</span>
            </n-space>
          </template>
          <n-text depth="3" style="font-size: 12px; margin-bottom: 12px; display: block;">
            这些工具/命令将被 AI 自动执行，无需用户确认
          </n-text>
          <n-dynamic-tags v-model:value="formData.permissions.allow" :render-tag="renderAllowTag">
            <template #input="{ submit, deactivate }">
              <n-input
                v-model:value="allowInputValue"
                size="small"
                style="width: 240px;"
                placeholder="如: Bash(npm run:*)"
                @keyup.enter="() => { if(allowInputValue.trim()) { submit(allowInputValue.trim()); allowInputValue = '' } }"
                @blur="deactivate"
              />
            </template>
            <template #trigger="{ activate, disabled }">
              <n-button size="small" type="primary" dashed :disabled="disabled" @click="activate()">
                <template #icon><n-icon><AddOutline /></n-icon></template>
                添加规则
              </n-button>
            </template>
          </n-dynamic-tags>
          <n-text depth="3" style="font-size: 11px; margin-top: 8px; display: block;">
            格式: Tool(pattern) - 如 Bash(npm:*), Read(./src/**), Edit(*.ts), mcp__*
          </n-text>
        </n-card>

        <!-- 需要确认的规则 -->
        <n-card size="small" style="margin-bottom: 16px">
          <template #header>
            <n-space align="center">
              <n-icon :size="18" color="#f0a020"><HandLeftOutline /></n-icon>
              <span>需要用户确认 (deny)</span>
            </n-space>
          </template>
          <n-text depth="3" style="font-size: 12px; margin-bottom: 12px; display: block;">
            这些工具/命令执行前将提示用户确认
          </n-text>
          <n-dynamic-tags v-model:value="formData.permissions.deny" :render-tag="renderDenyTag">
            <template #input="{ submit, deactivate }">
              <n-input
                v-model:value="denyInputValue"
                size="small"
                style="width: 240px;"
                placeholder="如: Bash(rm:*)"
                @keyup.enter="() => { if(denyInputValue.trim()) { submit(denyInputValue.trim()); denyInputValue = '' } }"
                @blur="deactivate"
              />
            </template>
            <template #trigger="{ activate, disabled }">
              <n-button size="small" type="warning" dashed :disabled="disabled" @click="activate()">
                <template #icon><n-icon><AddOutline /></n-icon></template>
                添加规则
              </n-button>
            </template>
          </n-dynamic-tags>
          <n-text depth="3" style="font-size: 11px; margin-top: 8px; display: block;">
            建议: Bash(rm:*), Bash(sudo:*), Bash(git push --force:*), Read(.env)
          </n-text>
        </n-card>
      </n-form>
    </n-scrollbar>

    <template #footer>
      <n-space justify="end">
        <n-button @click="emit('update:show', false)">取消</n-button>
        <n-button type="primary" :loading="saving" @click="handleSubmit">
          {{ isEdit ? '保存修改' : '创建模版' }}
        </n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup>
import { ref, computed, watch, h } from 'vue'
import {
  NModal, NForm, NFormItem, NInput, NCard, NButton, NIcon, NSpace,
  NDynamicTags, NTag, NText, NScrollbar, useMessage
} from 'naive-ui'
import { CheckmarkCircleOutline, HandLeftOutline, AddOutline } from '@vicons/ionicons5'
import { createPermissionTemplate, updatePermissionTemplate } from '../api/permissions'

const props = defineProps({
  show: { type: Boolean, default: false },
  template: { type: Object, default: null }
})

const emit = defineEmits(['update:show', 'success'])

const message = useMessage()
const formRef = ref(null)
const saving = ref(false)
const allowInputValue = ref('')
const denyInputValue = ref('')

const isEdit = computed(() => !!props.template?.id)

const formData = ref({
  name: '',
  description: '',
  permissions: {
    allow: [],
    deny: []
  }
})

const formRules = {
  name: { required: true, message: '请输入模版名称', trigger: 'blur' }
}

// 渲染标签
function renderAllowTag(tag, index) {
  return h(NTag, {
    type: 'success',
    closable: true,
    onClose: () => { formData.value.permissions.allow.splice(index, 1) }
  }, { default: () => tag })
}

function renderDenyTag(tag, index) {
  return h(NTag, {
    type: 'warning',
    closable: true,
    onClose: () => { formData.value.permissions.deny.splice(index, 1) }
  }, { default: () => tag })
}

// 初始化表单数据
function initFormData() {
  if (props.template) {
    formData.value = {
      name: props.template.name || '',
      description: props.template.description || '',
      permissions: {
        allow: [...(props.template.permissions?.allow || [])],
        deny: [...(props.template.permissions?.deny || [])]
      }
    }
  } else {
    formData.value = {
      name: '',
      description: '',
      permissions: { allow: [], deny: [] }
    }
  }
}

// 提交表单
async function handleSubmit() {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }

  saving.value = true
  try {
    if (isEdit.value) {
      const res = await updatePermissionTemplate(props.template.id, formData.value)
      if (res.success) {
        message.success('模版更新成功')
        emit('success')
        emit('update:show', false)
      } else {
        message.error(res.message || '更新失败')
      }
    } else {
      const res = await createPermissionTemplate(formData.value)
      if (res.success) {
        message.success('模版创建成功')
        emit('success')
        emit('update:show', false)
      } else {
        message.error(res.message || '创建失败')
      }
    }
  } catch (err) {
    message.error('操作失败: ' + err.message)
  } finally {
    saving.value = false
  }
}

watch(() => props.show, (val) => {
  if (val) {
    initFormData()
    allowInputValue.value = ''
    denyInputValue.value = ''
  }
})
</script>

<style scoped>
.n-card {
  border-radius: 8px;
}
</style>
