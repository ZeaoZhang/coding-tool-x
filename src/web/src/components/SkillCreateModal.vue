<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    title="创建自定义技能"
    :bordered="false"
    :closable="true"
    style="width: 680px; max-width: 90vw;"
    @close="handleClose"
  >
    <!-- 模式切换 -->
    <n-tabs v-model:value="createMode" type="line" animated>
      <n-tab-pane name="simple" tab="简单模式">
        <n-form
          ref="simpleFormRef"
          :model="simpleFormData"
          :rules="simpleRules"
          label-placement="top"
          label-width="auto"
        >
          <n-form-item label="目录名称" path="directory">
            <n-input
              v-model:value="simpleFormData.directory"
              placeholder="例如: my-custom-skill"
              :maxlength="50"
            />
            <template #feedback>
              {{ isOpenCode ? 'OpenCode 要求小写字母/数字，可用单个 - 连接（如 my-skill）' : '只能包含英文、数字、横杠和下划线' }}
            </template>
          </n-form-item>

          <n-form-item v-if="!isOpenCode" label="技能名称" path="name">
            <n-input
              v-model:value="simpleFormData.name"
              placeholder="显示名称，可以是中文"
              :maxlength="100"
            />
          </n-form-item>

          <n-form-item label="描述" path="description">
            <n-input
              v-model:value="simpleFormData.description"
              type="textarea"
              placeholder="简短描述这个技能的用途"
              :rows="2"
              :maxlength="200"
            />
          </n-form-item>

          <n-form-item label="技能内容 (提示词，支持 Markdown)" path="content">
            <MarkdownEditor
              v-model="simpleFormData.content"
              :rows="10"
              :min-height="200"
              placeholder="输入技能的详细指令内容，支持 Markdown 格式..."
            />
          </n-form-item>
        </n-form>
      </n-tab-pane>

      <n-tab-pane name="advanced" tab="高级模式 (多文件)">
        <n-form
          ref="advancedFormRef"
          :model="advancedFormData"
          :rules="advancedRules"
          label-placement="top"
          label-width="auto"
        >
          <n-form-item label="目录名称" path="directory">
            <n-input
              v-model:value="advancedFormData.directory"
              placeholder="例如: my-custom-skill"
              :maxlength="50"
            />
            <template #feedback>
              {{ isOpenCode ? 'OpenCode 要求小写字母/数字，可用单个 - 连接（如 my-skill）' : '只能包含英文、数字、横杠和下划线' }}
            </template>
          </n-form-item>

          <n-form-item label="文件上传">
            <n-upload
              multiple
              directory-dnd
              :show-file-list="false"
              :custom-request="handleFileUpload"
              @before-upload="handleBeforeUpload"
            >
              <n-upload-dragger>
                <div style="margin-bottom: 12px">
                  <n-icon size="48" :depth="3">
                    <FolderOpenOutline />
                  </n-icon>
                </div>
                <n-text style="font-size: 16px">
                  拖放文件或文件夹到此处，或点击选择
                </n-text>
                <n-p depth="3" style="margin: 8px 0 0 0">
                  必须包含 SKILL.md 文件
                </n-p>
              </n-upload-dragger>
            </n-upload>
          </n-form-item>

          <!-- 文件列表 -->
          <n-form-item v-if="advancedFormData.files.length > 0" label="已添加的文件">
            <div class="file-list">
              <n-card 
                v-for="(file, index) in advancedFormData.files" 
                :key="file.path"
                size="small"
                :class="{ 'skill-md': file.path === 'SKILL.md' }"
              >
                <div class="file-item">
                  <div class="file-info">
                    <n-icon :size="16" class="file-icon">
                      <DocumentOutline v-if="!file.isDirectory" />
                      <FolderOutline v-else />
                    </n-icon>
                    <span class="file-path">{{ file.path }}</span>
                    <n-tag v-if="file.path === 'SKILL.md'" size="small" type="primary">必需</n-tag>
                    <span class="file-size" v-if="file.size">{{ formatSize(file.size) }}</span>
                  </div>
                  <div class="file-actions">
                    <n-button 
                      v-if="isTextFile(file.path)" 
                      size="small" 
                      text
                      @click="editFile(index)"
                    >
                      编辑
                    </n-button>
                    <n-button 
                      v-if="file.path !== 'SKILL.md'"
                      size="small" 
                      text 
                      type="error"
                      @click="removeFile(index)"
                    >
                      删除
                    </n-button>
                  </div>
                </div>
              </n-card>
            </div>
          </n-form-item>

          <!-- 添加新文件按钮 -->
          <n-form-item>
            <n-space>
              <n-button @click="showAddFileModal = true">
                <template #icon><n-icon><AddOutline /></n-icon></template>
                添加文件
              </n-button>
              <n-button @click="addSkillMdTemplate" v-if="!hasSkillMd">
                <template #icon><n-icon><DocumentTextOutline /></n-icon></template>
                添加 SKILL.md 模板
              </n-button>
            </n-space>
          </n-form-item>
        </n-form>
      </n-tab-pane>
    </n-tabs>

    <template #footer>
      <div class="modal-footer">
        <n-button @click="handleClose">取消</n-button>
        <n-button type="primary" :loading="submitting" @click="handleSubmit">
          创建
        </n-button>
      </div>
    </template>

    <!-- 文件编辑弹窗 -->
    <n-modal
      v-model:show="showEditModal"
      preset="card"
      title="编辑文件"
      style="width: 600px; max-width: 90vw;"
    >
      <n-form-item :label="editingFile?.path || '文件内容'">
        <n-input
          v-model:value="editingContent"
          type="textarea"
          :rows="15"
          placeholder="输入文件内容..."
          style="font-family: monospace;"
        />
      </n-form-item>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showEditModal = false">取消</n-button>
          <n-button type="primary" @click="saveEditedFile">保存</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 添加新文件弹窗 -->
    <n-modal
      v-model:show="showAddFileModal"
      preset="card"
      title="添加新文件"
      style="width: 600px; max-width: 90vw;"
    >
      <n-form label-placement="top">
        <n-form-item label="文件路径">
          <n-input
            v-model:value="newFilePath"
            placeholder="例如: scripts/helper.sh 或 README.md"
          />
          <template #feedback>
            可以包含子目录，如 scripts/helper.sh
          </template>
        </n-form-item>
        <n-form-item label="文件内容">
          <n-input
            v-model:value="newFileContent"
            type="textarea"
            :rows="10"
            placeholder="输入文件内容..."
            style="font-family: monospace;"
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showAddFileModal = false">取消</n-button>
          <n-button type="primary" @click="addNewFile">添加</n-button>
        </n-space>
      </template>
    </n-modal>
  </n-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { 
  NModal, NForm, NFormItem, NInput, NButton, NTabs, NTabPane,
  NUpload, NUploadDragger, NIcon, NText, NP, NCard, NTag, NSpace
} from 'naive-ui'
import { 
  FolderOpenOutline, DocumentOutline, FolderOutline, 
  AddOutline, DocumentTextOutline 
} from '@vicons/ionicons5'
import { createCustomSkill, createSkillWithFiles } from '../api/skills'
import message from '../utils/message'
import MarkdownEditor from './MarkdownEditor.vue'

const props = defineProps({
  visible: Boolean,
  platform: {
    type: String,
    default: 'claude'
  }
})

const emit = defineEmits(['update:visible', 'created'])

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

// 创建模式
const createMode = ref('simple')

// 简单模式表单
const simpleFormRef = ref(null)
const simpleFormData = ref({
  directory: '',
  name: '',
  description: '',
  content: ''
})

const simpleRules = {
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

// 高级模式表单
const advancedFormRef = ref(null)
const advancedFormData = ref({
  directory: '',
  files: []
})

const advancedRules = {
  directory: [
    { required: true, message: '请输入目录名称', trigger: 'blur' },
    {
      pattern: /^[a-zA-Z0-9_-]+$/,
      message: '只能包含英文、数字、横杠和下划线',
      trigger: 'blur'
    }
  ]
}

const submitting = ref(false)

// 文件编辑相关
const showEditModal = ref(false)
const editingFile = ref(null)
const editingContent = ref('')
const editingIndex = ref(-1)

// 添加文件相关
const showAddFileModal = ref(false)
const newFilePath = ref('')
const newFileContent = ref('')

// 计算是否有 SKILL.md
const hasSkillMd = computed(() => {
  return advancedFormData.value.files.some(f => f.path === 'SKILL.md')
})
const isOpenCode = computed(() => props.platform === 'opencode')
const OPENCODE_SKILL_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/

// 判断是否是文本文件
function isTextFile(path) {
  const textExtensions = ['.md', '.txt', '.json', '.js', '.ts', '.py', '.sh', '.yaml', '.yml', '.toml', '.xml', '.html', '.css']
  const ext = path.toLowerCase().substring(path.lastIndexOf('.'))
  return textExtensions.includes(ext)
}

// 格式化文件大小
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// 处理文件上传
function handleBeforeUpload({ file }) {
  return true
}

async function handleFileUpload({ file, onFinish, onError }) {
  try {
    const reader = new FileReader()
    reader.onload = (e) => {
      const isText = isTextFile(file.name)
      
      // 处理文件路径，支持拖放文件夹
      let filePath = file.name
      if (file.file?.webkitRelativePath) {
        const parts = file.file.webkitRelativePath.split('/')
        filePath = parts.slice(1).join('/') // 去掉第一层目录
      }

      advancedFormData.value.files.push({
        path: filePath,
        content: isText ? e.target.result : btoa(e.target.result),
        isBase64: !isText,
        size: file.file.size
      })
      onFinish()
    }
    reader.onerror = onError

    if (isTextFile(file.name)) {
      reader.readAsText(file.file)
    } else {
      reader.readAsBinaryString(file.file)
    }
  } catch (err) {
    onError()
  }
}

// 移除文件
function removeFile(index) {
  advancedFormData.value.files.splice(index, 1)
}

// 编辑文件
function editFile(index) {
  const file = advancedFormData.value.files[index]
  editingFile.value = file
  editingContent.value = file.content
  editingIndex.value = index
  showEditModal.value = true
}

// 保存编辑的文件
function saveEditedFile() {
  if (editingIndex.value >= 0) {
    advancedFormData.value.files[editingIndex.value].content = editingContent.value
  }
  showEditModal.value = false
  editingFile.value = null
  editingContent.value = ''
  editingIndex.value = -1
}

// 添加新文件
function addNewFile() {
  if (!newFilePath.value.trim()) {
    message.warning('请输入文件路径')
    return
  }

  // 检查是否已存在
  if (advancedFormData.value.files.some(f => f.path === newFilePath.value)) {
    message.warning('文件已存在')
    return
  }

  advancedFormData.value.files.push({
    path: newFilePath.value,
    content: newFileContent.value,
    isBase64: false,
    size: new Blob([newFileContent.value]).size
  })

  showAddFileModal.value = false
  newFilePath.value = ''
  newFileContent.value = ''
}

// 添加 SKILL.md 模板
function addSkillMdTemplate() {
  const template = isOpenCode.value
    ? `---
name: ${advancedFormData.value.directory || 'my-skill'}
description: "Skill description"
---

# Skill Instructions

Describe when this skill should be used and what it should do.
`
    : `---
name: "${advancedFormData.value.directory || '我的技能'}"
description: "技能描述"
---

# 技能指令

在这里编写你的技能内容...
`

  advancedFormData.value.files.unshift({
    path: 'SKILL.md',
    content: template,
    isBase64: false,
    size: new Blob([template]).size
  })
}

// 提交
async function handleSubmit() {
  if (createMode.value === 'simple') {
    await submitSimpleMode()
  } else {
    await submitAdvancedMode()
  }
}

async function submitSimpleMode() {
  try {
    await simpleFormRef.value?.validate()
  } catch (err) {
    return
  }

  if (isOpenCode.value) {
    const directory = simpleFormData.value.directory?.trim()
    if (!OPENCODE_SKILL_NAME_REGEX.test(directory || '')) {
      message.error('OpenCode skill 目录必须是小写字母/数字，可用单个 - 连接')
      return
    }
    if (!simpleFormData.value.description?.trim()) {
      message.error('OpenCode skill 需要填写 description')
      return
    }
  }

  submitting.value = true
  try {
    const result = await createCustomSkill({
      name: isOpenCode.value
        ? simpleFormData.value.directory
        : (simpleFormData.value.name || simpleFormData.value.directory),
      directory: simpleFormData.value.directory,
      description: simpleFormData.value.description,
      content: simpleFormData.value.content
    }, props.platform)

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

async function submitAdvancedMode() {
  try {
    await advancedFormRef.value?.validate()
  } catch (err) {
    return
  }

  if (!hasSkillMd.value) {
    message.error('必须包含 SKILL.md 文件')
    return
  }

  if (isOpenCode.value) {
    const directory = advancedFormData.value.directory?.trim()
    if (!OPENCODE_SKILL_NAME_REGEX.test(directory || '')) {
      message.error('OpenCode skill 目录必须是小写字母/数字，可用单个 - 连接')
      return
    }
  }

  submitting.value = true
  try {
    const result = await createSkillWithFiles({
      directory: advancedFormData.value.directory,
      files: advancedFormData.value.files.map(f => ({
        path: f.path,
        content: f.content,
        isBase64: f.isBase64
      }))
    }, props.platform)

    if (result.success) {
      message.success(`技能创建成功，包含 ${result.fileCount} 个文件`)
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
    createMode.value = 'simple'
    simpleFormData.value = {
      directory: '',
      name: '',
      description: '',
      content: ''
    }
    advancedFormData.value = {
      directory: '',
      files: []
    }
    editingFile.value = null
    editingContent.value = ''
    editingIndex.value = -1
    newFilePath.value = ''
    newFileContent.value = ''
  }
})
</script>

<style scoped>
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.file-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.file-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.file-icon {
  color: var(--n-text-color-3);
}

.file-path {
  font-family: monospace;
  font-size: 13px;
}

.file-size {
  color: var(--n-text-color-3);
  font-size: 12px;
}

.file-actions {
  display: flex;
  gap: 8px;
}

.skill-md {
  border-color: var(--n-primary-color);
}
</style>
