<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    title="技能扫描设置"
    :bordered="false"
    :closable="!saving"
    :mask-closable="!saving"
    :close-on-esc="!saving"
    style="width: 420px; max-width: 92vw;"
  >
    <n-spin :show="loading">
      <n-alert v-if="loadError" type="error" :show-icon="true">
        {{ loadError }}
        <template #action>
          <n-button size="small" :disabled="loading || saving" @click="loadSettings">重试</n-button>
        </template>
      </n-alert>

      <div v-else class="scan-settings">
        <div class="section-title">扫描来源</div>
        <div v-for="item in settingItems" :key="item.key" class="setting-row">
          <div class="setting-copy">
            <div :id="`${item.key}-label`" class="setting-label">{{ item.label }}</div>
            <div class="setting-description">{{ item.description }}</div>
          </div>
          <n-switch
            v-model:value="form[item.key]"
            :disabled="loading || saving"
            :aria-labelledby="`${item.key}-label`"
          />
        </div>
      </div>
    </n-spin>

    <template #footer>
      <div class="modal-actions">
        <n-button :disabled="saving" @click="visible = false">取消</n-button>
        <n-button
          type="primary"
          :loading="saving"
          :disabled="loading || saving || !!loadError"
          @click="handleSave"
        >
          保存
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { NAlert, NButton, NModal, NSpin, NSwitch, useMessage } from 'naive-ui'
import { getOmpSkillSettings, updateOmpSkillSettings } from '../api/skills'
import {
  OMP_SKILL_SETTINGS_KEYS,
  submitOmpSkillSettings,
  validateOmpSkillSettingsResponse,
  validateOmpSkillSettingsSaveResult
} from '../utils/omp-skill-settings'

const props = defineProps({
  visible: Boolean,
  operationToken: { type: Number, default: 0 }
})

const emit = defineEmits(['update:visible', 'saved'])
const message = useMessage()
const loading = ref(false)
const saving = ref(false)
const loadError = ref('')
const SETTINGS_KEYS = OMP_SKILL_SETTINGS_KEYS
const form = reactive(Object.fromEntries(SETTINGS_KEYS.map(key => [key, true])))
let loadRequestId = 0
let saveRequestId = 0

const settingItems = [
  {
    key: 'enableCodexUser',
    label: 'Codex 用户',
    description: '扫描 Codex 用户技能目录'
  },
  {
    key: 'enableClaudeUser',
    label: 'Claude 用户与插件',
    description: '扫描 Claude 用户目录和插件技能'
  },
  {
    key: 'enablePiUser',
    label: 'OMP 用户与插件',
    description: '扫描 OMP 用户目录和插件技能'
  },
  {
    key: 'enablePiProject',
    label: '当前项目 .omp/skills',
    description: '扫描当前项目的 OMP 技能目录'
  }
]

const visible = computed({
  get: () => props.visible,
  set: value => {
    if (!saving.value) emit('update:visible', value)
  }
})

function errorMessage(error) {
  try {
    if (error instanceof Error) return error.message
    if (typeof error === 'string') return error
    if (error === null || error === undefined) return '未知错误'
    if (typeof error === 'object' && typeof error.message === 'string') return error.message
  } catch {
    // Fall through to safe serialization for unusual thrown values such as proxies.
  }

  try {
    const serialized = JSON.stringify(error)
    if (typeof serialized === 'string') return serialized
  } catch {
    // Fall through to string coercion.
  }

  try {
    return String(error)
  } catch {
    return '未知错误'
  }
}

async function loadSettings() {
  const requestId = ++loadRequestId
  loading.value = true
  loadError.value = ''

  try {
    const result = await getOmpSkillSettings()
    const settings = validateOmpSkillSettingsResponse(result)
    if (requestId !== loadRequestId || !props.visible) return

    Object.assign(form, settings)
  } catch (error) {
    if (requestId !== loadRequestId || !props.visible) return

    loadError.value = `加载技能扫描设置失败: ${errorMessage(error)}`
    message.error(loadError.value)
  } finally {
    if (requestId === loadRequestId) loading.value = false
  }
}

async function handleSave() {
  if (loading.value || saving.value || loadError.value) return

  const requestId = ++saveRequestId
  const operationToken = props.operationToken
  const submittedSettings = Object.fromEntries(SETTINGS_KEYS.map(key => [key, form[key]]))
  let accepted = false
  saving.value = true
  try {
    const savedSettings = await submitOmpSkillSettings(submittedSettings, updateOmpSkillSettings)
    if (requestId !== saveRequestId || operationToken !== props.operationToken || !props.visible) return

    emit('saved', savedSettings, operationToken)
  } catch (error) {
    if (requestId !== saveRequestId || operationToken !== props.operationToken || !props.visible) return
    message.error(`保存技能扫描设置失败: ${errorMessage(error)}`)
  } finally {
    if (requestId === saveRequestId && operationToken === props.operationToken && props.visible) saving.value = false
  }
}

watch(
  () => props.visible,
  value => {
    if (value) {
      loadSettings()
    } else {
      loadRequestId += 1
      saveRequestId += 1
      saving.value = false
      loading.value = false
      loadError.value = ''
    }
  },
  { immediate: true }
)
</script>

<style scoped>
.scan-settings {
  display: flex;
  flex-direction: column;
}

.section-title {
  margin-bottom: 8px;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-light);
}

.setting-row:last-child {
  border-bottom: 0;
}

.setting-copy {
  min-width: 0;
}

.setting-label {
  color: var(--text-primary);
  font-weight: 500;
}

.setting-description {
  margin-top: 3px;
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 1.45;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
