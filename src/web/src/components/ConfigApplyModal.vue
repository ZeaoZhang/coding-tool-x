<template>
  <n-modal
    :show="show"
    preset="card"
    :title="`应用模版: ${template?.name || ''}`"
    style="width: 650px"
    :mask-closable="false"
    @update:show="emit('update:show', $event)"
  >
    <n-form ref="formRef" :model="formData" :rules="formRules">
      <n-form-item label="选择已有项目">
        <n-select
          v-model:value="selectedProjectPath"
          :options="projectOptions"
          :loading="loadingProjects"
          placeholder="选择已有项目路径"
          filterable
          clearable
          @update:value="handleProjectSelect"
        />
      </n-form-item>

      <n-form-item label="目标项目路径" path="targetPath">
        <n-input
          v-model:value="formData.targetPath"
          placeholder="输入项目目录路径，如 /path/to/project"
        />
      </n-form-item>

      <!-- AI 配置文件选择（多选） -->
      <n-form-item label="生成配置文件" v-if="availableAiConfigs.length > 0">
        <n-checkbox-group v-model:value="formData.aiConfigTypes">
          <n-space>
            <n-checkbox
              v-for="ai in availableAiConfigs"
              :key="ai.key"
              :value="ai.key"
            >
              <n-space align="center" :size="4">
                <n-icon :size="16" :color="ai.color"><DocumentTextOutline /></n-icon>
                <span>{{ ai.name }}</span>
                <n-text depth="3" style="font-size: 12px">({{ ai.fileName || ai.name }})</n-text>
              </n-space>
            </n-checkbox>
          </n-space>
        </n-checkbox-group>
        <n-text depth="3" style="font-size: 12px; margin-top: 4px; display: block">
          可同时选择多个 CLI 配置文件
        </n-text>
      </n-form-item>
    </n-form>

    <!-- 预览按钮 -->
    <n-space style="margin-bottom: 16px">
      <n-button @click="handlePreview" :loading="loadingPreview" :disabled="!formData.targetPath || formData.aiConfigTypes.length === 0">
        预览应用效果
      </n-button>
    </n-space>

    <!-- 预览结果 -->
    <n-card v-if="previewData" size="small" title="应用预览">
      <n-space vertical>
        <div v-if="previewData.summary">
          <n-text depth="3">将应用：</n-text>
          <n-space style="margin-top: 8px" wrap>
            <n-tag
              v-for="aiCfg in previewData.summary.aiConfigs"
              :key="aiCfg.type"
              :type="getAiConfigTagType(aiCfg.type)"
              size="small"
            >
              {{ aiCfg.fileName || aiCfg.name }}
            </n-tag>
            <n-tag v-if="previewData.summary.skills" type="info" size="small">{{ previewData.summary.skills }} Skills</n-tag>
            <n-tag v-if="previewData.summary.agents" type="info" size="small">{{ previewData.summary.agents }} Agents</n-tag>
            <n-tag v-if="previewData.summary.commands" type="info" size="small">{{ previewData.summary.commands }} Commands</n-tag>
            <n-tag v-if="previewData.summary.plugins" type="warning" size="small">{{ previewData.summary.plugins }} Plugins</n-tag>
            <n-tag v-if="previewData.summary.mcpServers" type="warning" size="small">{{ previewData.summary.mcpServers }} MCP</n-tag>
            <n-tag v-if="previewData.summary.skipped" type="error" size="small">{{ previewData.summary.skipped }} Skipped</n-tag>
          </n-space>
        </div>

        <n-divider style="margin: 12px 0" />

        <div v-if="previewData.willCreate?.length">
          <n-text type="success">将创建：</n-text>
          <n-ul style="margin: 4px 0">
            <n-li v-for="file in previewData.willCreate" :key="file">
              <n-text code>{{ file }}</n-text>
            </n-li>
          </n-ul>
        </div>

        <div v-if="previewData.willOverwrite?.length">
          <n-text type="warning">将覆盖：</n-text>
          <n-ul style="margin: 4px 0">
            <n-li v-for="file in previewData.willOverwrite" :key="file">
              <n-text code>{{ file }}</n-text>
              <n-tag type="warning" size="tiny" style="margin-left: 8px">已存在</n-tag>
            </n-li>
          </n-ul>
        </div>

        <n-alert
          v-if="previewData.willOverwrite?.length"
          type="warning"
          style="margin-top: 8px"
        >
          以上文件将被覆盖，请确认后再应用
        </n-alert>

        <div v-if="previewData.skipped?.length">
          <n-text type="error">将跳过：</n-text>
          <n-ul style="margin: 4px 0">
            <n-li v-for="(item, index) in previewData.skipped" :key="`${item.type}-${item.item}-${index}`">
              <n-text>{{ item.type }}: </n-text>
              <n-text code>{{ item.item }}</n-text>
              <n-text depth="3"> - {{ item.reason }}</n-text>
            </n-li>
          </n-ul>
        </div>

        <n-alert
          v-if="previewData.skipped?.length"
          type="info"
          style="margin-top: 8px"
        >
          本次将进行部分应用，以上项会被跳过。
        </n-alert>
      </n-space>
    </n-card>

    <template #footer>
      <n-space justify="end">
        <n-button @click="emit('update:show', false)">取消</n-button>
        <n-button
          type="primary"
          :loading="applying"
          :disabled="!formData.targetPath || formData.aiConfigTypes.length === 0"
          @click="handleApply"
        >
          确认应用
        </n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import {
  NModal, NForm, NFormItem, NInput, NButton, NSpace, NCard,
  NTag, NText, NDivider, NUl, NLi, NAlert, NCheckboxGroup, NCheckbox, NIcon,
  NSelect, useMessage
} from 'naive-ui'
import { DocumentTextOutline } from '@vicons/ionicons5'
import { applyTemplate, previewTemplate } from '@/api/config-templates'
import { getAvailableProjects } from '@/api/workspaces'

const props = defineProps({
  show: Boolean,
  template: Object
})

const emit = defineEmits(['update:show', 'success'])
const message = useMessage()

const formRef = ref(null)
const loadingPreview = ref(false)
const applying = ref(false)
const previewData = ref(null)
const loadingProjects = ref(false)
const existingProjects = ref([])
const selectedProjectPath = ref(null)

// AI 配置类型信息
const AI_CONFIG_INFO = {
  claude: { key: 'claude', name: 'Claude', fileName: 'CLAUDE.md', color: '#cc785c' },
  codex: { key: 'codex', name: 'Codex', fileName: 'AGENTS.md', color: '#10a37f' },
  gemini: { key: 'gemini', name: 'Gemini', fileName: 'GEMINI.md', color: '#4285f4' },
  opencode: { key: 'opencode', name: 'OpenCode', fileName: '.opencode/AGENTS.md', color: '#ff6b35' },
  omp: { key: 'omp', name: 'OMP command templates', fileName: '.omp/commands', color: '#0f9f9a' }
}

// 获取可用的 AI 配置列表（优先展示当前 CLI 对应配置）
const availableAiConfigs = computed(() => {
  const aiConfigs = props.template?.aiConfigs || {}
  const cliType = props.template?.cliType

  if (cliType === 'omp' && AI_CONFIG_INFO.omp) {
    return [AI_CONFIG_INFO.omp]
  }

  const allEnabled = Object.entries(aiConfigs)
    .filter(([, cfg]) => cfg?.enabled && cfg?.content)
    .map(([key]) => AI_CONFIG_INFO[key])
    .filter(Boolean)

  if (cliType && cliType !== 'all') {
    const preferred = aiConfigs[cliType]
    if (preferred?.enabled && preferred?.content && AI_CONFIG_INFO[cliType]) {
      return [AI_CONFIG_INFO[cliType]]
    }
  }

  return allEnabled
})

// 获取默认选中的 AI 配置类型（全部选中）
function getDefaultAiConfigTypes() {
  return availableAiConfigs.value.map(ai => ai.key)
}

const formData = ref({
  targetPath: '',
  aiConfigTypes: []  // 改为数组支持多选
})

const formRules = {
  targetPath: { required: true, message: '请输入目标路径', trigger: 'blur' }
}

const projectOptions = computed(() => {
  const seen = new Set()
  const options = []
  for (const project of existingProjects.value) {
    const projectPath = project.fullPath || project.path || project.name
    if (!projectPath || seen.has(projectPath)) continue
    seen.add(projectPath)
    options.push({
      label: `${project.displayName || project.name} (${project.channel})`,
      value: projectPath
    })
  }
  return options
})

// 获取 AI 配置标签类型
function getAiConfigTagType(type) {
  const typeMap = {
    claude: 'warning',
    codex: 'success',
    gemini: 'info',
    opencode: 'error',
    omp: 'success'
  }
  return typeMap[type] || 'default'
}

// 重置状态
watch(() => props.show, (newVal) => {
  if (newVal) {
    formData.value.targetPath = ''
    formData.value.aiConfigTypes = getDefaultAiConfigTypes()
    previewData.value = null
    selectedProjectPath.value = null
    loadProjects()
  }
})

// 监听模版变化，重置 AI 配置类型
watch(() => props.template, () => {
  formData.value.aiConfigTypes = getDefaultAiConfigTypes()
})

async function loadProjects() {
  loadingProjects.value = true
  try {
    const res = await getAvailableProjects()
    if (res.success) {
      existingProjects.value = Array.isArray(res.data) ? res.data : []
    } else {
      existingProjects.value = []
    }
  } catch (error) {
    existingProjects.value = []
  } finally {
    loadingProjects.value = false
  }
}

function handleProjectSelect(value) {
  if (value) {
    formData.value.targetPath = value
  }
}

// 预览
async function handlePreview() {
  if (!formData.value.targetPath || !props.template || formData.value.aiConfigTypes.length === 0) return

  loadingPreview.value = true
  try {
    const res = await previewTemplate(
      props.template.id,
      formData.value.targetPath,
      formData.value.aiConfigTypes  // 传递数组
    )
    if (res.success) {
      previewData.value = res.data
    } else {
      message.error(res.message || '预览失败')
    }
  } catch (error) {
    message.error('预览失败: ' + error.message)
  } finally {
    loadingPreview.value = false
  }
}

// 应用
async function handleApply() {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }

  if (!props.template || formData.value.aiConfigTypes.length === 0) return

  applying.value = true
  try {
    const res = await applyTemplate(
      props.template.id,
      formData.value.targetPath,
      formData.value.aiConfigTypes  // 传递数组
    )
    if (res.success) {
      const skipped = res.data?.results?.skipped || []
      if (skipped.length > 0) {
        message.warning(`模版已部分应用，${skipped.length} 项已跳过`)
      } else {
        message.success('模版应用成功')
      }
      emit('success', res.data || null)
    } else {
      message.error(res.message || '应用失败')
    }
  } catch (error) {
    message.error('应用失败: ' + error.message)
  } finally {
    applying.value = false
  }
}
</script>
