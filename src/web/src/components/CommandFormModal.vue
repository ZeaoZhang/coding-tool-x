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
          <n-icon :size="22"><TerminalOutline /></n-icon>
        </span>
        <div class="config-edit-title-stack">
          <span class="config-edit-kicker">{{ currentPlatformLabel }}</span>
          <span class="config-edit-title">{{ isEdit ? commandTitle : '创建新命令' }}</span>
        </div>
      </div>
      <div class="config-edit-badges">
        <n-tag size="small" :bordered="false" type="info">{{ scopeBadgeText }}</n-tag>
        <n-tag v-if="formData.namespace" size="small" :bordered="false" type="warning">{{ formData.namespace }}</n-tag>
        <n-tag size="small" :bordered="false" type="success">{{ commandFormatLabel }}</n-tag>
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
      <div class="command-workbench">
        <div class="command-sidebar">
          <section class="config-edit-section">
            <div class="section-heading">
              <n-icon :size="16"><OptionsOutline /></n-icon>
              <span>命令入口</span>
            </div>

            <div class="field-grid">
              <n-form-item label="命令名" path="name">
                <n-input
                  v-model:value="formData.name"
                  :disabled="isEdit"
                  placeholder="review"
                >
                  <template #prefix>/</template>
                </n-input>
              </n-form-item>

              <n-form-item label="命名空间" path="namespace">
                <n-input
                  v-model:value="formData.namespace"
                  :disabled="isEdit"
                  placeholder="frontend"
                />
              </n-form-item>
            </div>

            <n-form-item label="作用域" path="scope">
              <n-radio-group v-model:value="formData.scope" :disabled="isEdit" class="scope-picker">
                <n-radio value="user">
                  <span class="scope-option">
                    <span class="scope-title">用户级</span>
                    <span class="scope-path">{{ userScopePath }}</span>
                  </span>
                </n-radio>
                <n-radio value="project">
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
                placeholder="一句话说明这个 slash command 的用途"
              />
            </n-form-item>
          </section>

          <section class="config-edit-section">
            <div class="section-heading">
              <n-icon :size="16"><SettingsOutline /></n-icon>
              <span>Frontmatter</span>
            </div>

            <template v-if="supportsCommandMetadata">
              <n-form-item label="允许的工具" path="allowedTools">
                <n-input
                  v-model:value="formData.allowedTools"
                  placeholder="Bash, Edit, Read"
                />
              </n-form-item>

              <n-form-item label="参数提示" path="argumentHint">
                <n-input
                  v-model:value="formData.argumentHint"
                  placeholder="add [id] | remove [id]"
                />
              </n-form-item>
            </template>

            <div v-else class="platform-note">
              <n-icon :size="16"><InformationCircleOutline /></n-icon>
              <span>{{ currentPlatformLabel }} commands 会按平台原生格式保存，当前平台不写入 Claude/Codex 风格的工具和参数 frontmatter。</span>
            </div>
          </section>

          <section class="config-edit-section token-section">
            <div class="section-heading">
              <n-icon :size="16"><CodeSlashOutline /></n-icon>
              <span>可用变量</span>
            </div>

            <div class="command-token-box">
              <div class="token-row">
                <code>$ARGUMENTS</code>
                <span>完整参数</span>
              </div>
              <div class="token-row">
                <code>$1</code>
                <span>第一个参数</span>
              </div>
              <div class="token-row" v-if="supportsCommandMetadata">
                <code>!</code>
                <span>执行 shell 行</span>
              </div>
              <div class="token-row" v-if="supportsCommandMetadata">
                <code>@</code>
                <span>引用文件</span>
              </div>
            </div>
          </section>
        </div>

        <section class="config-edit-section content-section">
          <div class="section-heading">
            <n-icon :size="16"><DocumentTextOutline /></n-icon>
            <span>命令内容</span>
          </div>
          <n-form-item path="body" :show-label="false" class="editor-form-item">
            <MarkdownEditor
              v-model="formData.body"
              :rows="12"
              :min-height="280"
              placeholder="写下命令提示词。可以使用 $ARGUMENTS、$1、$2 等变量。"
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
import { NModal, NForm, NFormItem, NInput, NRadioGroup, NRadio, NButton, NIcon, NTag } from 'naive-ui'
import {
  CodeSlashOutline,
  DocumentTextOutline,
  InformationCircleOutline,
  OptionsOutline,
  SaveOutline,
  SettingsOutline,
  TerminalOutline
} from '@vicons/ionicons5'
import { createCommand, updateCommand } from '../api/commands'
import message from '../utils/message'
import MarkdownEditor from './MarkdownEditor.vue'
import { getPlatformConfig } from '../config/platforms'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  command: {
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

const isEdit = computed(() => !!props.command)
const modalTitle = computed(() => isEdit.value ? '编辑命令' : '创建命令')
const currentPlatformLabel = computed(() => {
  const platform = getPlatformConfig(props.platform)
  return platform.label || platform.title || 'Claude Code'
})
const userScopePath = computed(() =>
  props.platform === 'opencode'
    ? '~/.config/opencode/commands/'
    : props.platform === 'gemini'
    ? '~/.gemini/commands/'
    : props.platform === 'pi'
    ? '~/.pi/agent/prompts/'
    : props.platform === 'codex'
    ? '~/.codex/commands/'
    : '~/.claude/commands/'
)
const projectScopePath = computed(() =>
  props.platform === 'opencode'
    ? '.opencode/commands/'
    : props.platform === 'gemini'
    ? '.gemini/commands/'
    : props.platform === 'pi'
    ? '.pi/prompts/'
    : props.platform === 'codex'
    ? '.codex/commands/'
    : '.claude/commands/'
)
const supportsCommandMetadata = computed(() => props.platform !== 'opencode' && props.platform !== 'gemini' && props.platform !== 'pi')
const scopeBadgeText = computed(() => formData.value.scope === 'project' ? '项目级' : '用户级')
const commandTitle = computed(() => formData.value.name ? `/${formData.value.name}` : '编辑命令')
const commandFormatLabel = computed(() => props.platform === 'gemini' ? 'TOML' : 'Markdown')

const formRef = ref(null)
const saving = ref(false)
const modalContentStyle = {
  maxHeight: 'calc(92vh - 134px)',
  overflowY: 'auto',
  paddingBottom: '18px'
}

const formData = ref({
  name: '',
  scope: 'user',
  namespace: '',
  description: '',
  allowedTools: '',
  argumentHint: '',
  body: ''
})

const rules = {
  name: {
    required: true,
    message: '请输入命令名',
    trigger: 'blur'
  },
  scope: {
    required: true,
    message: '请选择作用域',
    trigger: 'change'
  }
}

// 监听 command 变化，填充表单
watch(() => props.command, (cmd) => {
  if (cmd) {
    formData.value = {
      name: cmd.name || '',
      scope: cmd.scope || 'user',
      namespace: cmd.namespace || '',
      description: cmd.description || '',
      allowedTools: cmd.allowedTools || '',
      argumentHint: cmd.argumentHint || '',
      body: cmd.body || ''
    }
  } else {
    resetForm()
  }
}, { immediate: true })

function resetForm() {
  formData.value = {
    name: '',
    scope: 'user',
    namespace: '',
    description: '',
    allowedTools: '',
    argumentHint: '',
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
      await updateCommand(formData.value.name, formData.value.scope, data, props.platform)
      message.success('命令更新成功')
    } else {
      await createCommand(data, props.platform)
      message.success('命令创建成功')
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
  font-family: var(--font-mono);
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

.command-workbench {
  display: grid;
  grid-template-columns: minmax(320px, 0.88fr) minmax(420px, 1.12fr);
  gap: 14px;
  align-items: stretch;
}

.command-sidebar {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 14px;
}

.config-edit-section {
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  background: var(--bg-primary);
}

.content-section {
  display: flex;
  flex-direction: column;
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

.platform-note {
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

.command-token-box {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}

.token-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-tertiary);
  font-size: 12px;
}

.token-row code {
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 12px;
}

.editor-form-item {
  flex: 1;
  margin-bottom: 0;
}

.editor-form-item :deep(.markdown-editor),
.editor-form-item :deep(.editor-container),
.editor-form-item :deep(.n-input),
.editor-form-item :deep(.n-input-wrapper),
.editor-form-item :deep(textarea) {
  min-height: 100%;
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

  .command-workbench,
  .field-grid,
  .scope-picker,
  .command-token-box {
    grid-template-columns: 1fr;
  }
}
</style>
