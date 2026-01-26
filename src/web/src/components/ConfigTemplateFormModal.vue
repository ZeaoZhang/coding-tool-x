<template>
  <n-modal
    :show="show"
    preset="card"
    :title="isEdit ? '编辑配置模版' : '创建配置模版'"
    style="width: 850px; max-height: 90vh"
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
            <n-input v-model:value="formData.description" type="textarea" :rows="2" placeholder="输入模版描述" />
          </n-form-item>
        </n-card>

        <!-- AI 配置文件 -->
        <n-card title="AI 配置文件" size="small" style="margin-bottom: 16px">
          <n-tabs type="line" animated>
            <n-tab-pane
              v-for="ai in AI_CONFIG_LIST"
              :key="ai.key"
              :name="ai.key"
            >
              <template #tab>
                <n-space align="center" :size="4">
                  <n-icon :size="16" :color="ai.color"><DocumentTextOutline /></n-icon>
                  <span>{{ ai.name }}</span>
                  <n-badge
                    v-if="formData.aiConfigs[ai.key]?.enabled"
                    dot
                    type="success"
                    :offset="[-2, 0]"
                  />
                </n-space>
              </template>
              <div class="ai-config-pane">
                <div class="ai-config-header">
                  <n-space align="center">
                    <n-switch v-model:value="formData.aiConfigs[ai.key].enabled" />
                    <n-text :depth="formData.aiConfigs[ai.key].enabled ? 1 : 3">
                      启用 {{ ai.fileName }}
                    </n-text>
                  </n-space>
                </div>
                <n-collapse-transition :show="formData.aiConfigs[ai.key].enabled">
                  <MarkdownEditor
                    v-model="formData.aiConfigs[ai.key].content"
                    :rows="10"
                    :min-height="220"
                    :placeholder="`输入 ${ai.fileName} 内容`"
                  />
                </n-collapse-transition>
              </div>
            </n-tab-pane>
          </n-tabs>
        </n-card>

        <!-- Skills -->
        <n-card title="Skills" size="small" style="margin-bottom: 16px">
          <template #header-extra>
            <n-tag size="small">已选 {{ formData.skills.length }}</n-tag>
          </template>
          <n-transfer
            v-model:value="selectedSkillDirectories"
            :options="skillOptions"
            source-title="可用 Skills"
            target-title="已选 Skills"
          />
        </n-card>

        <!-- Agents -->
        <n-card title="Agents" size="small" style="margin-bottom: 16px">
          <template #header-extra>
            <n-tag size="small">已选 {{ formData.agents.length }}</n-tag>
          </template>
          <n-transfer
            v-model:value="selectedAgentFileNames"
            :options="agentOptions"
            source-title="可用 Agents"
            target-title="已选 Agents"
          />
        </n-card>

        <!-- Commands -->
        <n-card title="Commands" size="small" style="margin-bottom: 16px">
          <template #header-extra>
            <n-tag size="small">已选 {{ formData.commands.length }}</n-tag>
          </template>
          <n-transfer
            v-model:value="selectedCommandNames"
            :options="commandOptions"
            source-title="可用 Commands"
            target-title="已选 Commands"
          />
        </n-card>

        <!-- Rules -->
        <n-card title="Rules" size="small" style="margin-bottom: 16px">
          <template #header-extra>
            <n-tag size="small">已选 {{ formData.rules.length }}</n-tag>
          </template>
          <n-transfer
            v-model:value="selectedRuleFileNames"
            :options="ruleOptions"
            source-title="可用 Rules"
            target-title="已选 Rules"
          />
        </n-card>

        <!-- MCP Servers -->
        <n-card title="MCP Servers" size="small">
          <template #header-extra>
            <n-tag size="small">已选 {{ formData.mcpServers.length }}</n-tag>
          </template>
          <n-transfer
            v-model:value="formData.mcpServers"
            :options="mcpOptions"
            source-title="可用 MCP Servers"
            target-title="已选 MCP Servers"
          />
        </n-card>
      </n-form>
    </n-scrollbar>

    <template #footer>
      <n-space justify="end">
        <n-button @click="emit('update:show', false)">取消</n-button>
        <n-button type="primary" :loading="saving" @click="handleSave">
          {{ isEdit ? '保存' : '创建' }}
        </n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import {
  NModal, NScrollbar, NForm, NFormItem, NInput, NCard, NSwitch,
  NCollapseTransition, NTransfer, NTag, NSpace, NButton, NTabs, NTabPane,
  NIcon, NText, NBadge,
  useMessage
} from 'naive-ui'
import { DocumentTextOutline } from '@vicons/ionicons5'
import { createTemplate, updateTemplate } from '@/api/config-templates'
import MarkdownEditor from './MarkdownEditor.vue'

const props = defineProps({
  show: Boolean,
  template: Object,
  availableConfigs: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['update:show', 'success'])
const message = useMessage()

const formRef = ref(null)
const saving = ref(false)

// AI 配置类型列表
const AI_CONFIG_LIST = [
  { key: 'claude', name: 'Claude', fileName: 'CLAUDE.md', color: '#cc785c' },
  { key: 'codex', name: 'Codex', fileName: 'AGENTS.md', color: '#10a37f' },
  { key: 'gemini', name: 'Gemini', fileName: 'GEMINI.md', color: '#4285f4' }
]

const isEdit = computed(() => !!props.template?.id && !props.template?.isBuiltin)

// 表单数据
const formData = ref(getDefaultFormData())

function getDefaultFormData() {
  return {
    name: '',
    description: '',
    aiConfigs: {
      claude: { enabled: false, content: '' },
      codex: { enabled: false, content: '' },
      gemini: { enabled: false, content: '' }
    },
    // 兼容旧字段
    claudeMd: { enabled: false, content: '' },
    skills: [],
    agents: [],
    commands: [],
    rules: [],
    mcpServers: []
  }
}

// 表单规则
const formRules = {
  name: { required: true, message: '请输入模版名称', trigger: 'blur' }
}

// Transfer 选项
const skillOptions = computed(() => {
  const skills = props.availableConfigs?.skills || []
  return skills.map(s => ({
    value: s.directory,
    label: s.name ? `${s.name} (${s.directory})` : s.directory,
    disabled: false
  }))
})

const agentOptions = computed(() => {
  const agents = props.availableConfigs?.agents || []
  return agents.map(a => ({
    value: a.fileName,
    label: a.name || a.fileName,
    disabled: false
  }))
})

const commandOptions = computed(() => {
  const commands = props.availableConfigs?.commands || []
  return commands.map(c => ({
    value: c.namespace ? `${c.namespace}/${c.name}` : c.name,
    label: c.namespace ? `${c.namespace}/${c.name}` : c.name,
    disabled: false
  }))
})

const ruleOptions = computed(() => {
  const rules = props.availableConfigs?.rules || []
  return rules.map(r => ({
    value: r.directory ? `${r.directory}/${r.fileName}` : r.fileName,
    label: r.directory ? `${r.directory}/${r.fileName}` : r.fileName,
    disabled: false
  }))
})

const mcpOptions = computed(() => {
  const servers = props.availableConfigs?.mcpServers || []
  const presets = props.availableConfigs?.mcpPresets || []
  const combined = [
    ...servers.map(s => ({ value: s.id, label: s.name || s.id })),
    ...presets.map(p => ({ value: p.id, label: `${p.name} (预设)` }))
  ]
  // 去重
  const seen = new Set()
  return combined.filter(item => {
    if (seen.has(item.value)) return false
    seen.add(item.value)
    return true
  })
})

const selectedSkillDirectories = computed({
  get: () => formData.value.skills.map(s => s.directory),
  set: (directories) => {
    const skills = props.availableConfigs?.skills || []
    formData.value.skills = directories.map(dir => {
      const found = skills.find(s => s.directory === dir)
      return found ? { ...found } : { directory: dir, name: dir }
    })
  }
})

// 选中的 agent fileNames
const selectedAgentFileNames = computed({
  get: () => formData.value.agents.map(a => a.fileName),
  set: (fileNames) => {
    const agents = props.availableConfigs?.agents || []
    formData.value.agents = fileNames.map(fn => {
      const found = agents.find(a => a.fileName === fn)
      return found ? { ...found } : { fileName: fn }
    })
  }
})

// 选中的 command names
const selectedCommandNames = computed({
  get: () => formData.value.commands.map(c => c.namespace ? `${c.namespace}/${c.name}` : c.name),
  set: (names) => {
    const commands = props.availableConfigs?.commands || []
    formData.value.commands = names.map(n => {
      const found = commands.find(c => (c.namespace ? `${c.namespace}/${c.name}` : c.name) === n)
      return found ? { ...found } : { name: n }
    })
  }
})

// 选中的 rule fileNames
const selectedRuleFileNames = computed({
  get: () => formData.value.rules.map(r => r.directory ? `${r.directory}/${r.fileName}` : r.fileName),
  set: (names) => {
    const rules = props.availableConfigs?.rules || []
    formData.value.rules = names.map(n => {
      const found = rules.find(r => (r.directory ? `${r.directory}/${r.fileName}` : r.fileName) === n)
      return found ? { ...found } : { fileName: n }
    })
  }
})

// 监听 show 和 template 变化
watch(() => props.show, (newVal) => {
  if (newVal) {
    if (props.template) {
      // 处理 AI 配置
      let aiConfigs = {
        claude: { enabled: false, content: '' },
        codex: { enabled: false, content: '' },
        gemini: { enabled: false, content: '' }
      }

      // 优先使用新的 aiConfigs
      if (props.template.aiConfigs) {
        for (const key of ['claude', 'codex', 'gemini']) {
          if (props.template.aiConfigs[key]) {
            aiConfigs[key] = { ...props.template.aiConfigs[key] }
          }
        }
      } else if (props.template.claudeMd) {
        // 兼容旧的 claudeMd 字段
        aiConfigs.claude = { ...props.template.claudeMd }
      }

      formData.value = {
        name: props.template.name || '',
        description: props.template.description || '',
        aiConfigs,
        claudeMd: props.template.claudeMd ? { ...props.template.claudeMd } : { enabled: false, content: '' },
        skills: props.template.skills ? [...props.template.skills] : [],
        agents: props.template.agents ? [...props.template.agents] : [],
        commands: props.template.commands ? [...props.template.commands] : [],
        rules: props.template.rules ? [...props.template.rules] : [],
        mcpServers: props.template.mcpServers ? [...props.template.mcpServers] : []
      }
    } else {
      formData.value = getDefaultFormData()
    }
  }
})

// 保存
async function handleSave() {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }

  saving.value = true
  try {
    const data = { ...formData.value }
    let res
    if (isEdit.value) {
      res = await updateTemplate(props.template.id, data)
    } else {
      res = await createTemplate(data)
    }
    if (res.success) {
      message.success(isEdit.value ? '保存成功' : '创建成功')
      emit('success')
    } else {
      message.error(res.message || '操作失败')
    }
  } catch (error) {
    message.error('操作失败: ' + error.message)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.ai-config-pane {
  padding: 12px 0;
}
.ai-config-header {
  margin-bottom: 12px;
}
</style>
