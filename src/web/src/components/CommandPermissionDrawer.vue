<template>
  <n-drawer
    v-model:show="visible"
    :width="drawerWidth"
    placement="right"
    :mask-closable="true"
  >
    <n-drawer-content closable :native-scrollbar="false">
      <template #header>
        <div class="drawer-header">
          <n-icon :size="20" color="#18a058">
            <ShieldCheckmarkOutline />
          </n-icon>
          <span>命令执行权限</span>
        </div>
      </template>

      <div class="permission-container">
        <!-- 项目选择 -->
        <div class="section">
          <div class="section-header">
            <n-text strong>选择项目</n-text>
          </div>
          <n-select
            v-model:value="selectedProject"
            :options="projectOptions"
            placeholder="选择要配置的项目"
            filterable
            clearable
            @update:value="handleProjectChange"
          />
        </div>

        <!-- CLI 工具说明 -->
        <n-collapse>
          <n-collapse-item title="各 CLI 工具权限配置说明" name="cli-info">
            <div class="cli-info-cards">
              <div class="cli-info-card claude-card">
                <div class="cli-card-header">
                  <n-text strong>Claude Code</n-text>
                </div>
                <n-text depth="3" style="font-size: 12px;">
                  配置文件: .claude/settings.json<br>
                  格式: permissions.allow / permissions.deny<br>
                  全权限: --dangerously-skip-permissions
                </n-text>
              </div>
              <div class="cli-info-card codex-card">
                <div class="cli-card-header">
                  <n-text strong>Codex CLI</n-text>
                </div>
                <n-text depth="3" style="font-size: 12px;">
                  沙箱模式: --sandbox read-only/workspace-write<br>
                  审批模式: --approval-mode suggest/auto-edit<br>
                  全权限: --dangerously-bypass-approvals-and-sandbox
                </n-text>
              </div>
              <div class="cli-info-card gemini-card">
                <div class="cli-card-header">
                  <n-text strong>Gemini CLI</n-text>
                </div>
                <n-text depth="3" style="font-size: 12px;">
                  允许工具: --allowedTools "ShellTool(*)"<br>
                  沙箱: --sandbox / -s<br>
                  全权限: --yolo
                </n-text>
              </div>
            </div>
          </n-collapse-item>
        </n-collapse>

        <!-- All-Allow 模式提示 -->
        <n-alert
          v-if="allAllowEnabled"
          type="warning"
          :bordered="false"
          style="margin-bottom: 16px;"
        >
          <template #icon>
            <n-icon><WarningOutline /></n-icon>
          </template>
          <div>
            <n-text strong>All-Allow 模式已启用</n-text>
            <n-text depth="3" style="display: block; font-size: 12px; margin-top: 4px;">
              当前所有命令都将自动执行，无需确认。此模式通过启动命令参数设置。
            </n-text>
          </div>
        </n-alert>

        <!-- 权限设置 -->
        <div v-if="selectedProject" class="section">
          <div class="section-header">
            <n-text strong>权限设置 (Claude Code 格式)</n-text>
            <n-text depth="3" style="font-size: 12px;">
              配置将保存到项目的 .claude/settings.json，Claude Code 直接使用此配置
            </n-text>
          </div>

          <!-- 允许自动执行的命令 -->
          <div class="permission-card allow-card">
            <div class="card-header">
              <n-icon :size="18" color="#18a058">
                <CheckmarkCircleOutline />
              </n-icon>
              <n-text strong>允许自动执行 (allow)</n-text>
            </div>
            <n-text depth="3" style="font-size: 12px; margin-bottom: 12px; display: block;">
              这些工具/命令将被 AI 自动执行，无需用户确认
            </n-text>
            <n-dynamic-tags
              v-model:value="permissions.allow"
              :render-tag="renderAllowTag"
            >
              <template #input="{ submit, deactivate }">
                <n-input
                  ref="allowInputRef"
                  v-model:value="allowInputValue"
                  size="small"
                  style="width: 240px;"
                  placeholder="如: Bash(npm run:*)"
                  @keyup.enter="() => { submit(allowInputValue); allowInputValue = '' }"
                  @blur="deactivate"
                />
              </template>
              <template #trigger="{ activate, disabled }">
                <n-button
                  size="small"
                  type="primary"
                  dashed
                  :disabled="disabled"
                  @click="activate()"
                >
                  <template #icon>
                    <n-icon><AddOutline /></n-icon>
                  </template>
                  添加规则
                </n-button>
              </template>
            </n-dynamic-tags>
            <n-text depth="3" style="font-size: 11px; margin-top: 8px; display: block;">
              格式: Tool(pattern) - 如 Bash(npm run:*), Read(./src/**), Edit(*.ts)
            </n-text>
          </div>

          <!-- 需要确认的命令 -->
          <div class="permission-card deny-card">
            <div class="card-header">
              <n-icon :size="18" color="#f0a020">
                <HandLeftOutline />
              </n-icon>
              <n-text strong>需要用户确认 (deny)</n-text>
            </div>
            <n-text depth="3" style="font-size: 12px; margin-bottom: 12px; display: block;">
              这些工具/命令执行前将提示用户确认
            </n-text>
            <n-dynamic-tags
              v-model:value="permissions.deny"
              :render-tag="renderDenyTag"
            >
              <template #input="{ submit, deactivate }">
                <n-input
                  ref="denyInputRef"
                  v-model:value="denyInputValue"
                  size="small"
                  style="width: 240px;"
                  placeholder="如: Bash(rm:*)"
                  @keyup.enter="() => { submit(denyInputValue); denyInputValue = '' }"
                  @blur="deactivate"
                />
              </template>
              <template #trigger="{ activate, disabled }">
                <n-button
                  size="small"
                  type="warning"
                  dashed
                  :disabled="disabled"
                  @click="activate()"
                >
                  <template #icon>
                    <n-icon><AddOutline /></n-icon>
                  </template>
                  添加规则
                </n-button>
              </template>
            </n-dynamic-tags>
            <n-text depth="3" style="font-size: 11px; margin-top: 8px; display: block;">
              建议: Bash(rm:*), Bash(sudo:*), Bash(git push --force:*), Read(.env)
            </n-text>
          </div>
        </div>

        <!-- 无项目选择提示 -->
        <div v-if="!selectedProject" class="empty-hint">
          <n-icon :size="32" color="var(--text-quaternary)">
            <ShieldCheckmarkOutline />
          </n-icon>
          <n-text depth="3" style="font-size: 13px;">
            请先选择一个项目来配置权限
          </n-text>
        </div>

        <!-- 权限模版（始终显示） -->
        <div class="template-section">
          <div class="template-header">
            <n-text depth="2" style="font-size: 13px;">
              权限模版
            </n-text>
            <n-button size="tiny" text @click="handleCreateTemplate">
              <template #icon><n-icon><AddOutline /></n-icon></template>
              新建
            </n-button>
          </div>
          <div class="template-list">
            <div
              v-for="tpl in templates"
              :key="tpl.id"
              class="template-item"
            >
              <div class="template-info" @click="applyTemplate(tpl)">
                <n-text strong style="font-size: 13px;">{{ tpl.name }}</n-text>
                <n-text depth="3" style="font-size: 11px;">{{ tpl.description }}</n-text>
              </div>
              <n-space :size="4">
                <n-button
                  size="tiny"
                  text
                  @click="handlePreviewTemplate(tpl)"
                >
                  预览
                </n-button>
                <n-button
                  size="tiny"
                  text
                  :disabled="!selectedProject"
                  @click="applyTemplate(tpl)"
                >
                  应用
                </n-button>
                <n-button
                  size="tiny"
                  text
                  @click="handleEditTemplate(tpl)"
                >
                  编辑
                </n-button>
                <n-popconfirm
                  @positive-click="handleDeleteTemplate(tpl)"
                >
                  <template #trigger>
                    <n-button size="tiny" text type="error">
                      删除
                    </n-button>
                  </template>
                  确定删除模版 "{{ tpl.name }}" 吗？
                </n-popconfirm>
              </n-space>
            </div>
            <n-empty v-if="templates.length === 0" description="暂无模版" size="small" />
          </div>
        </div>
      </div>

      <template #footer>
        <n-space justify="end">
          <n-button @click="visible = false">取消</n-button>
          <n-button
            type="primary"
            :loading="saving"
            :disabled="!selectedProject || !hasChanges"
            @click="handleSave"
          >
            <template #icon>
              <n-icon><SaveOutline /></n-icon>
            </template>
            保存设置
          </n-button>
        </n-space>
      </template>
    </n-drawer-content>
  </n-drawer>

  <!-- 模版表单弹窗 -->
  <PermissionTemplateFormModal
    v-model:show="showTemplateForm"
    :template="editingTemplate"
    @success="handleTemplateFormSuccess"
  />

  <!-- 模版预览弹窗 -->
  <n-modal v-model:show="showPreview" preset="card" style="width: 480px; max-width: 90vw;">
    <template #header>
      <div style="display: flex; align-items: center; gap: 8px;">
        <n-icon :size="18" color="#18a058"><EyeOutline /></n-icon>
        <span>模版预览</span>
      </div>
    </template>
    <div v-if="previewTemplate" class="preview-content">
      <div class="preview-header">
        <n-text strong style="font-size: 15px;">{{ previewTemplate.name }}</n-text>
      </div>
      <n-text depth="3" style="font-size: 12px;">{{ previewTemplate.description }}</n-text>

      <n-divider style="margin: 12px 0;" />

      <!-- Allow 规则 -->
      <div class="preview-section">
        <div class="preview-section-header">
          <n-icon :size="16" color="#18a058"><CheckmarkCircleOutline /></n-icon>
          <n-text strong>允许自动执行 (allow)</n-text>
        </div>
        <div class="preview-rules">
          <n-tag
            v-for="rule in previewTemplate.permissions?.allow || []"
            :key="rule"
            type="success"
            size="small"
            style="margin: 2px;"
          >
            {{ rule }}
          </n-tag>
          <n-text v-if="!previewTemplate.permissions?.allow?.length" depth="3" style="font-size: 12px;">
            无规则
          </n-text>
        </div>
      </div>

      <!-- Deny 规则 -->
      <div class="preview-section" style="margin-top: 12px;">
        <div class="preview-section-header">
          <n-icon :size="16" color="#f0a020"><HandLeftOutline /></n-icon>
          <n-text strong>需要用户确认 (deny)</n-text>
        </div>
        <div class="preview-rules">
          <n-tag
            v-for="rule in previewTemplate.permissions?.deny || []"
            :key="rule"
            type="warning"
            size="small"
            style="margin: 2px;"
          >
            {{ rule }}
          </n-tag>
          <n-text v-if="!previewTemplate.permissions?.deny?.length" depth="3" style="font-size: 12px;">
            无规则
          </n-text>
        </div>
      </div>
    </div>
  </n-modal>
</template>

<script setup>
import { ref, computed, watch, h } from 'vue'
import {
  NDrawer, NDrawerContent, NSelect, NButton, NIcon, NText, NSpace,
  NAlert, NDynamicTags, NInput, NEmpty, NTag, NCollapse, NCollapseItem,
  NPopconfirm, NModal, NCard, NDivider
} from 'naive-ui'
import {
  ShieldCheckmarkOutline, CheckmarkCircleOutline, HandLeftOutline,
  WarningOutline, AddOutline, SaveOutline, EyeOutline
} from '@vicons/ionicons5'
import { useResponsiveDrawer } from '../composables/useResponsiveDrawer'
import { getPermissions, savePermissions, getAllAllowStatus, getPermissionTemplates, deletePermissionTemplate } from '../api/permissions'
import { getProjects } from '../api/projects'
import message from '../utils/message'
import PermissionTemplateFormModal from './PermissionTemplateFormModal.vue'

const props = defineProps({
  visible: { type: Boolean, default: false }
})

const emit = defineEmits(['update:visible'])

const { drawerWidth } = useResponsiveDrawer(580, 520)

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

// 状态
const loading = ref(false)
const saving = ref(false)
const projects = ref([])
const selectedProject = ref(null)
const allAllowEnabled = ref(false)
const permissions = ref({
  allow: [],
  deny: []
})
const originalPermissions = ref({
  allow: [],
  deny: []
})

// 模版数据
const templates = ref([])
const showTemplateForm = ref(false)
const editingTemplate = ref(null)
const showPreview = ref(false)
const previewTemplate = ref(null)

// 输入值
const allowInputValue = ref('')
const denyInputValue = ref('')

// 计算属性
const projectOptions = computed(() => {
  return projects.value.map(p => {
    const projectPath = p.fullPath || p.path || ''
    const displayName = p.displayName || p.name || ''
    const fallbackName = projectPath ? projectPath.split(/[\\/]/).pop() : ''
    return {
      label: displayName || fallbackName || projectPath || p.name,
      value: projectPath
    }
  }).filter(option => option.value)
})

const hasChanges = computed(() => {
  return JSON.stringify(permissions.value) !== JSON.stringify(originalPermissions.value)
})

// 渲染标签
function renderAllowTag(tag, index) {
  return h(NTag, {
    type: 'success',
    closable: true,
    onClose: () => {
      permissions.value.allow.splice(index, 1)
    }
  }, { default: () => tag })
}

function renderDenyTag(tag, index) {
  return h(NTag, {
    type: 'warning',
    closable: true,
    onClose: () => {
      permissions.value.deny.splice(index, 1)
    }
  }, { default: () => tag })
}

// 加载项目列表
async function loadProjects() {
  try {
    const result = await getProjects()
    projects.value = result.projects || []
  } catch (err) {
    console.error('Failed to load projects:', err)
  }
}

// 加载 All-Allow 状态
async function loadAllAllowStatus() {
  try {
    const result = await getAllAllowStatus()
    allAllowEnabled.value = result.enabled || false
  } catch (err) {
    console.error('Failed to load all-allow status:', err)
  }
}

// 加载模版
async function loadTemplates() {
  try {
    const result = await getPermissionTemplates()
    if (result.success) {
      templates.value = result.data || []
    }
  } catch (err) {
    console.error('Failed to load templates:', err)
  }
}

// 加载项目权限
async function loadPermissions(projectPath) {
  if (!projectPath) return

  loading.value = true
  try {
    const result = await getPermissions(projectPath)
    if (result.success) {
      permissions.value = {
        allow: result.settings?.allow || [],
        deny: result.settings?.deny || []
      }
      originalPermissions.value = JSON.parse(JSON.stringify(permissions.value))
    }
  } catch (err) {
    console.error('Failed to load permissions:', err)
    permissions.value = { allow: [], deny: [] }
    originalPermissions.value = { allow: [], deny: [] }
  } finally {
    loading.value = false
  }
}

// 项目切换
function handleProjectChange(value) {
  if (value) {
    loadPermissions(value)
  } else {
    permissions.value = { allow: [], deny: [] }
    originalPermissions.value = { allow: [], deny: [] }
  }
}

// 应用模版
function applyTemplate(template) {
  // 检查是否选择了项目
  if (!selectedProject.value) {
    message.warning('请选择一个项目')
    return
  }
  
  if (template && template.permissions) {
    permissions.value = {
      allow: [...(template.permissions.allow || [])],
      deny: [...(template.permissions.deny || [])]
    }
    message.success(`已应用模板：${template.name}`)
  }
}

// 保存设置
async function handleSave() {
  if (!selectedProject.value) return

  saving.value = true
  try {
    const result = await savePermissions(selectedProject.value, permissions.value)
    if (result.success) {
      originalPermissions.value = JSON.parse(JSON.stringify(permissions.value))
      message.success(`权限设置已保存到 ${result.savedTo}`)
    } else {
      message.error('保存失败: ' + (result.message || '未知错误'))
    }
  } catch (err) {
    console.error('Failed to save permissions:', err)
    message.error('保存失败: ' + err.message)
  } finally {
    saving.value = false
  }
}

// 创建模版
function handleCreateTemplate() {
  editingTemplate.value = null
  showTemplateForm.value = true
}

// 编辑模版
function handleEditTemplate(tpl) {
  editingTemplate.value = { ...tpl }
  showTemplateForm.value = true
}

// 预览模版
function handlePreviewTemplate(tpl) {
  previewTemplate.value = tpl
  showPreview.value = true
}

// 删除模版
async function handleDeleteTemplate(tpl) {
  try {
    const res = await deletePermissionTemplate(tpl.id)
    if (res.success) {
      message.success('模版已删除')
      loadTemplates()
    } else {
      message.error(res.message || '删除失败')
    }
  } catch (err) {
    message.error('删除失败: ' + err.message)
  }
}

// 模版表单成功回调
function handleTemplateFormSuccess() {
  showTemplateForm.value = false
  loadTemplates()
}

// 监听抽屉打开
watch(visible, (val) => {
  if (val) {
    loadProjects()
    loadAllAllowStatus()
    loadTemplates()
  }
})
</script>

<style scoped>
.drawer-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.permission-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 4px;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cli-info-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cli-info-card {
  padding: 10px 12px;
  border-radius: 6px;
  border-left: 3px solid;
}

.claude-card {
  background: rgba(204, 120, 92, 0.1);
  border-left-color: #cc785c;
}

.codex-card {
  background: rgba(16, 163, 127, 0.1);
  border-left-color: #10a37f;
}

.gemini-card {
  background: rgba(66, 133, 244, 0.1);
  border-left-color: #4285f4;
}

.cli-card-header {
  margin-bottom: 4px;
}

.permission-card {
  padding: 16px;
  border-radius: 10px;
  border: 1px solid var(--border-primary);
  background: var(--bg-secondary);
}

[data-theme="dark"] .permission-card {
  background: rgba(30, 41, 59, 0.4);
  border-color: rgba(148, 163, 184, 0.15);
}

.allow-card {
  border-left: 3px solid #18a058;
}

.deny-card {
  border-left: 3px solid #f0a020;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.template-section {
  padding: 12px;
  border-radius: 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
}

[data-theme="dark"] .template-section {
  background: rgba(30, 41, 59, 0.4);
  border-color: rgba(148, 163, 184, 0.15);
}

.template-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.template-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.template-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  transition: all 0.2s;
}

.template-item:hover {
  border-color: var(--primary-color);
}

.template-item.is-builtin {
  border-left: 3px solid #18a058;
}

.template-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  cursor: pointer;
  flex: 1;
  min-width: 0;
}

[data-theme="dark"] .template-item {
  background: rgba(30, 41, 59, 0.6);
  border-color: rgba(148, 163, 184, 0.1);
}

.empty-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 16px;
  background: var(--bg-secondary);
  border-radius: 8px;
  border: 1px dashed var(--border-primary);
}

[data-theme="dark"] .empty-hint {
  background: rgba(30, 41, 59, 0.3);
}

.preview-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.preview-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preview-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.preview-section-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.preview-rules {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px;
  background: var(--bg-secondary);
  border-radius: 6px;
  min-height: 32px;
}
</style>
