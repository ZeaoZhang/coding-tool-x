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

          <!-- 保存位置选择 -->
          <div class="save-location-options">
            <n-radio-group v-model:value="saveToLocal" size="small">
              <n-radio-button :value="false">
                settings.json (团队共享)
              </n-radio-button>
              <n-radio-button :value="true">
                settings.local.json (个人)
              </n-radio-button>
            </n-radio-group>
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

          <!-- 预设模版 -->
          <div class="template-section">
            <n-text depth="2" style="font-size: 13px; margin-bottom: 8px; display: block;">
              快速应用预设
            </n-text>
            <n-space>
              <n-button size="small" @click="applyTemplate('safe')">
                <template #icon>
                  <n-icon><ShieldOutline /></n-icon>
                </template>
                安全模式
              </n-button>
              <n-button size="small" @click="applyTemplate('balanced')">
                <template #icon>
                  <n-icon><ScaleOutline /></n-icon>
                </template>
                平衡模式
              </n-button>
              <n-button size="small" @click="applyTemplate('permissive')">
                <template #icon>
                  <n-icon><FlashOutline /></n-icon>
                </template>
                宽松模式
              </n-button>
            </n-space>
          </div>
        </div>

        <!-- 无项目选择提示 -->
        <n-empty
          v-else
          description="请选择一个项目来配置权限"
          style="margin-top: 40px;"
        />
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
</template>

<script setup>
import { ref, computed, watch, h } from 'vue'
import {
  NDrawer, NDrawerContent, NSelect, NButton, NIcon, NText, NSpace,
  NAlert, NDynamicTags, NInput, NEmpty, NTag, NCollapse, NCollapseItem,
  NRadioGroup, NRadioButton
} from 'naive-ui'
import {
  ShieldCheckmarkOutline, CheckmarkCircleOutline, HandLeftOutline,
  WarningOutline, AddOutline, SaveOutline, ShieldOutline, ScaleOutline, FlashOutline
} from '@vicons/ionicons5'
import { useResponsiveDrawer } from '../composables/useResponsiveDrawer'
import { getPermissions, savePermissions, getAllAllowStatus, getPermissionTemplates } from '../api/permissions'
import { getProjects } from '../api/projects'
import message from '../utils/message'

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
const saveToLocal = ref(false)
const permissions = ref({
  allow: [],
  deny: []
})
const originalPermissions = ref({
  allow: [],
  deny: []
})

// 模版数据
const templates = ref({})

// 输入值
const allowInputValue = ref('')
const denyInputValue = ref('')

// 计算属性
const projectOptions = computed(() => {
  return projects.value.map(p => ({
    label: p.name,
    value: p.path
  }))
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
      templates.value = result.templates
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
function applyTemplate(templateName) {
  const template = templates.value[templateName]
  if (template) {
    permissions.value = {
      allow: [...template.allow],
      deny: [...template.deny]
    }
  }
}

// 保存设置
async function handleSave() {
  if (!selectedProject.value) return

  saving.value = true
  try {
    const result = await savePermissions(selectedProject.value, permissions.value, saveToLocal.value)
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

.save-location-options {
  margin-bottom: 8px;
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
  padding: 16px;
  border-radius: 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
}

[data-theme="dark"] .template-section {
  background: rgba(30, 41, 59, 0.4);
  border-color: rgba(148, 163, 184, 0.15);
}
</style>
