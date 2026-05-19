<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    :title="modalTitle"
    style="width: min(940px, 96vw); max-height: 92vh;"
    :content-style="modalContentStyle"
    :mask-closable="false"
    class="config-edit-modal"
  >
    <div class="config-edit-header">
      <div class="config-edit-identity">
        <span class="config-edit-icon">
          <n-icon :size="22"><PersonOutline /></n-icon>
        </span>
        <div class="config-edit-title-stack">
          <span class="config-edit-kicker">{{ currentPlatformLabel }}</span>
          <span class="config-edit-title">{{ isEdit ? formData.fileName || '编辑代理' : '创建新代理' }}</span>
        </div>
      </div>
      <div class="config-edit-badges">
        <n-tag size="small" :bordered="false" type="info">{{ scopeBadgeText }}</n-tag>
        <n-tag v-if="isCodexPlatform" size="small" :bordered="false" type="success">Codex 用户级</n-tag>
        <n-tag v-if="isCodexPlatform && formData.configMode !== 'none'" size="small" :bordered="false" type="warning">
          {{ configModeLabel }}
        </n-tag>
      </div>
    </div>

    <n-form
      ref="formRef"
      :model="formData"
      :rules="rules"
      label-placement="top"
      require-mark-placement="right-hanging"
      class="config-edit-form"
    >
      <div class="config-edit-grid" :class="{ 'is-codex': isCodexPlatform }">
        <section class="config-edit-section">
          <div class="section-heading">
            <n-icon :size="16"><OptionsOutline /></n-icon>
            <span>基础信息</span>
          </div>

          <div class="field-grid">
            <n-form-item label="文件名" path="fileName">
              <n-input
                v-model:value="formData.fileName"
                :disabled="isEdit"
                placeholder="code-reviewer"
              />
            </n-form-item>

            <n-form-item v-if="isClaudePlatform" label="显示名称" path="name">
              <n-input
                v-model:value="formData.name"
                placeholder="代理的显示名称"
              />
            </n-form-item>
          </div>

          <n-form-item label="作用域" path="scope">
            <n-radio-group
              v-model:value="formData.scope"
              :disabled="isEdit"
              class="scope-picker"
              :class="{ 'single-option': isCodexPlatform }"
            >
              <n-radio value="user">
                <span class="scope-option">
                  <span class="scope-title">用户级</span>
                  <span class="scope-path">{{ userScopePath }}</span>
                </span>
              </n-radio>
              <n-radio v-if="!isCodexPlatform" value="project">
                <span class="scope-option">
                  <span class="scope-title">项目级</span>
                  <span class="scope-path">{{ projectScopePath }}</span>
                </span>
              </n-radio>
            </n-radio-group>
          </n-form-item>

          <n-form-item label="描述" path="description">
            <n-input
              v-model:value="formData.description"
              type="textarea"
              :autosize="{ minRows: 3, maxRows: 5 }"
              placeholder="一句话说明这个代理什么时候该被调用"
            />
          </n-form-item>

          <div v-if="isCodexPlatform" class="platform-note">
            <n-icon :size="16"><InformationCircleOutline /></n-icon>
            <span>Codex agents 写入用户级配置。描述会进入 <code>~/.codex/config.toml</code>，TOML 配置可托管到 <code>~/.codex/agents/</code>。</span>
          </div>
        </section>

        <section class="config-edit-section">
          <div class="section-heading">
            <n-icon :size="16"><SettingsOutline /></n-icon>
            <span>{{ isCodexPlatform ? '运行配置' : '模型与权限' }}</span>
          </div>

          <template v-if="isCodexPlatform">
            <n-form-item label="配置模式" path="configMode">
              <n-select
                v-model:value="formData.configMode"
                :options="configModeOptions"
                placeholder="选择配置模式"
              />
            </n-form-item>

            <n-form-item v-if="formData.configMode === 'custom'" label="配置文件路径" path="configFile">
              <n-input
                v-model:value="formData.configFile"
                placeholder="~/.omx/agents/my-agent.toml"
              />
            </n-form-item>

            <div v-if="formData.configMode === 'none'" class="empty-config-box">
              <n-icon :size="18"><DocumentTextOutline /></n-icon>
              <span>仅保存代理描述，不额外写入模型或工具配置。</span>
            </div>

            <n-form-item v-else label="Agent Config (TOML)" path="configContent" class="editor-form-item">
              <n-input
                v-model:value="formData.configContent"
                type="textarea"
                :autosize="{ minRows: 14, maxRows: 22 }"
                class="toml-editor"
                placeholder='model = "gpt-5.4"'
              />
            </n-form-item>
          </template>

          <template v-else>
            <n-form-item label="可用工具" path="tools">
              <n-input
                v-model:value="formData.tools"
                placeholder="Read, Edit, Bash"
              />
            </n-form-item>

            <n-form-item label="模型" path="model">
              <n-input
                v-if="isTextModelPlatform"
                v-model:value="formData.model"
                placeholder="gpt-5, claude-sonnet-4, openrouter/model"
              />
              <n-select
                v-else
                v-model:value="formData.model"
                :options="modelOptions"
                placeholder="选择模型"
                clearable
              />
            </n-form-item>

            <div class="field-grid">
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
                  placeholder="自动加载的技能，逗号分隔"
                />
              </n-form-item>
            </div>
          </template>
        </section>

        <section v-if="!isCodexPlatform" class="config-edit-section content-section">
          <div class="section-heading">
            <n-icon :size="16"><DocumentTextOutline /></n-icon>
            <span>系统提示词</span>
          </div>
          <n-form-item path="systemPrompt" :show-label="false" class="editor-form-item">
            <MarkdownEditor
              v-model="formData.systemPrompt"
              :rows="10"
              :min-height="240"
              placeholder="定义代理的行为、边界和输出要求"
              :default-editing="!isEdit"
            />
          </n-form-item>
        </section>
      </div>
    </n-form>

    <template #footer>
      <div class="modal-footer">
        <n-button @click="handleCancel">取消</n-button>
        <n-button type="primary" :loading="saving" @click="handleSubmit">
          <template #icon>
            <n-icon><SaveOutline /></n-icon>
          </template>
          {{ isEdit ? '保存' : '创建' }}
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { NModal, NForm, NFormItem, NInput, NRadioGroup, NRadio, NSelect, NButton, NIcon, NTag } from 'naive-ui'
import {
  DocumentTextOutline,
  InformationCircleOutline,
  OptionsOutline,
  PersonOutline,
  SaveOutline,
  SettingsOutline
} from '@vicons/ionicons5'
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
const isCodexPlatform = computed(() => props.platform === 'codex')
const isClaudePlatform = computed(() => props.platform === 'claude')
const isTextModelPlatform = computed(() => props.platform === 'codex' || props.platform === 'opencode')
const modalTitle = computed(() => isEdit.value ? '编辑代理' : '创建代理')
const currentPlatformLabel = computed(() => {
  const labels = {
    claude: 'Claude Code',
    codex: 'Codex CLI',
    gemini: 'Gemini CLI',
    opencode: 'OpenCode'
  }
  return labels[props.platform] || 'Claude Code'
})
const userScopePath = computed(() =>
  props.platform === 'codex'
    ? '~/.codex/config.toml'
    : props.platform === 'opencode'
    ? '~/.config/opencode/agents/'
    : props.platform === 'gemini'
    ? '~/.gemini/agents/'
    : '~/.claude/agents/'
)
const projectScopePath = computed(() =>
  props.platform === 'opencode'
    ? '.opencode/agents/'
    : props.platform === 'gemini'
    ? '.gemini/agents/'
    : '.claude/agents/'
)
const scopeBadgeText = computed(() => formData.value.scope === 'project' ? '项目级' : '用户级')
const configModeLabel = computed(() =>
  configModeOptions.find(option => option.value === formData.value.configMode)?.label || '配置'
)

const formRef = ref(null)
const saving = ref(false)
const modalContentStyle = {
  maxHeight: 'calc(92vh - 134px)',
  overflowY: 'auto',
  paddingBottom: '18px'
}

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

const configModeOptions = [
  { label: '仅描述', value: 'none' },
  { label: '托管 TOML', value: 'managed' },
  { label: '自定义路径', value: 'custom' }
]

const formData = ref({
  fileName: '',
  scope: 'user',
  name: '',
  description: '',
  configMode: 'none',
  configFile: '',
  configContent: '',
  tools: '',
  model: '',
  permissionMode: '',
  skills: '',
  systemPrompt: ''
})

const rules = computed(() => {
  const baseRules = {
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
    description: {
      required: true,
      message: '请输入代理描述',
      trigger: 'blur'
    }
  }

  if (isClaudePlatform.value) {
    baseRules.name = {
      required: true,
      message: '请输入代理名称',
      trigger: 'blur'
    }
  }

  if (isCodexPlatform.value) {
    baseRules.configMode = {
      required: true,
      message: '请选择配置模式',
      trigger: 'change'
    }
    baseRules.configFile = {
      required: formData.value.configMode === 'custom',
      message: '请输入自定义配置文件路径',
      trigger: 'blur'
    }
  }

  return baseRules
})

// 监听 agent 变化，填充表单
watch(() => props.agent, (agent) => {
  if (agent) {
    const inferredConfigMode = agent.configMode ||
      (agent.configFile ? (String(agent.configFile).includes('/.codex/agents/') ? 'managed' : 'custom') : 'none')
    formData.value = {
      fileName: agent.fileName || '',
      scope: agent.scope || 'user',
      name: agent.name || '',
      description: agent.description || '',
      configMode: inferredConfigMode,
      configFile: agent.configFile || '',
      configContent: agent.fullContent || '',
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

watch(() => props.platform, (platform) => {
  if (platform === 'codex') {
    formData.value.scope = 'user'
    if (!formData.value.configMode) {
      formData.value.configMode = 'none'
    }
  }
}, { immediate: true })

function resetForm() {
  formData.value = {
    fileName: '',
    scope: 'user',
    name: '',
    description: '',
    configMode: 'none',
    configFile: '',
    configContent: '',
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

    if (isCodexPlatform.value) {
      if (formData.value.configMode === 'custom') {
        data.configFile = formData.value.configFile
      } else {
        delete data.configFile
      }

      if (formData.value.configMode === 'managed' || formData.value.configMode === 'custom') {
        data.configContent = formData.value.configContent || ''
      } else {
        delete data.configContent
      }
    } else {
      delete data.configMode
      delete data.configFile
      delete data.configContent
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
.config-edit-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  margin: -4px 0 18px;
  padding: 16px;
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  background: var(--bg-secondary);
}

.config-edit-identity {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 12px;
}

.config-edit-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 42px;
  height: 42px;
  border: 1px solid oklch(62% 0.15 151 / 0.28);
  border-radius: 8px;
  background: oklch(62% 0.15 151 / 0.10);
  color: var(--primary-color);
}

.config-edit-title-stack {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 3px;
}

.config-edit-kicker {
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 1.3;
}

.config-edit-title {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 18px;
  font-weight: 650;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.config-edit-badges {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 6px;
}

.config-edit-form {
  min-width: 0;
}

.config-edit-grid {
  display: grid;
  grid-template-columns: minmax(280px, 0.9fr) minmax(340px, 1.1fr);
  gap: 14px;
}

.config-edit-grid.is-codex {
  align-items: start;
}

.config-edit-section {
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  background: var(--bg-primary);
}

.content-section {
  grid-column: 1 / -1;
}

.section-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 650;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.scope-picker {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  width: 100%;
}

.scope-picker.single-option {
  grid-template-columns: 1fr;
}

.scope-picker :deep(.n-radio) {
  align-items: flex-start;
  min-width: 0;
  margin: 0;
  padding: 10px;
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  background: var(--bg-secondary);
}

.scope-option {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}

.scope-title {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
}

.scope-path {
  overflow-wrap: anywhere;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.4;
}

.platform-note,
.empty-config-box {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 11px 12px;
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.platform-note code {
  font-family: var(--font-mono);
  font-size: 11px;
}

.empty-config-box {
  align-items: center;
  margin-top: 4px;
}

.editor-form-item {
  margin-bottom: 0;
}

.toml-editor :deep(textarea) {
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.65;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 2px;
}

@media (max-width: 760px) {
  .config-edit-header {
    flex-direction: column;
  }

  .config-edit-grid,
  .field-grid,
  .scope-picker {
    grid-template-columns: 1fr;
  }
}
</style>
