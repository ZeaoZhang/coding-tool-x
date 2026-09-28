<template>
  <div class="preset-panel">
    <div class="toolbar">
      <n-select v-model:value="profile" :options="profileOptions" placeholder="选择 DSH Profile" size="small" @update:value="loadPresets" />
      <n-button size="small" :disabled="!profile" @click="startCreate">新建预设</n-button>
      <n-button size="small" :loading="loading" @click="loadPresets">刷新</n-button>
    </div>

    <n-alert v-if="error" type="error" :show-icon="false">{{ error }}</n-alert>
    <n-spin :show="loading">
      <div v-if="!loading && presets.length === 0" class="empty">该 Profile 尚无 Agent 预设</div>
      <div v-else class="preset-list">
        <button
          v-for="preset in presets"
          :key="preset.id"
          class="preset-item"
          :class="{ selected: selectedId === preset.id }"
          @click="selectPreset(preset)"
        >
          <strong>{{ preset.name || preset.id }}</strong>
          <span>{{ preset.description || preset.id }}</span>
          <small>{{ preset.builtIn ? '内置预设' : '自定义预设' }}</small>
        </button>
      </div>
    </n-spin>

    <div v-if="editing" class="editor">
      <div class="editor-title">{{ creating ? '新建 Agent 预设' : (draft.name || draft.id) }}</div>
      <div class="field-grid">
        <label>预设 ID<n-input v-model:value="draft.id" :disabled="!creating" placeholder="例如 review" /></label>
        <label>显示名称<n-input v-model:value="draft.name" placeholder="可选" /></label>
        <label>排序<n-input-number v-model:value="draft.order" :min="0" /></label>
        <label class="wide">描述<n-input v-model:value="draft.description" placeholder="可选" /></label>
        <label class="wide">插件声明（JSON 格式的 YAML）
          <n-input v-model:value="pluginsText" type="textarea" :autosize="{ minRows: 8, maxRows: 18 }" spellcheck="false" />
        </label>
      </div>
      <div class="editor-actions">
        <n-button type="primary" :loading="saving" @click="save">保存预设</n-button>
        <n-button v-if="!creating && !draft.builtIn" type="error" secondary :loading="deleting" @click="remove">删除</n-button>
        <n-button @click="editing = false">取消</n-button>
      </div>
      <div v-if="draft.builtIn" class="hint">保存后会在当前 Profile 覆盖内置预设。</div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { NAlert, NButton, NInput, NInputNumber, NSelect, NSpin, useMessage } from 'naive-ui'
import { deleteDshAgentPreset, getDshAgentPresets, getDshProfiles, saveDshAgentPreset } from '../api/dsh-agent-presets'

const message = useMessage()
const profiles = ref([])
const profile = ref('')
const presets = ref([])
const revision = ref(null)
const selectedId = ref('')
const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const error = ref('')
const editing = ref(false)
const creating = ref(false)
const pluginsText = ref('[]')
const draft = ref(emptyDraft())
const profileOptions = computed(() => profiles.value.map(item => ({ label: item.name, value: item.name })))

function emptyDraft() {
  return { id: '', name: '', description: '', order: 0, plugins: [], builtIn: false }
}

onMounted(async () => {
  try {
    profiles.value = await getDshProfiles()
    profile.value = profiles.value[0]?.name || ''
    if (profile.value) await loadPresets()
  } catch (cause) {
    error.value = cause.message || '读取 DSH Profile 失败'
  }
})

async function loadPresets() {
  if (!profile.value) return
  loading.value = true
  error.value = ''
  try {
    const result = await getDshAgentPresets(profile.value)
    presets.value = result.presets || []
    revision.value = result.revision ?? null
    if (selectedId.value) {
      const selected = presets.value.find(item => item.id === selectedId.value)
      if (selected) selectPreset(selected)
      else { editing.value = false; selectedId.value = '' }
    }
  } catch (cause) {
    error.value = cause.message || '读取 Agent 预设失败'
  } finally {
    loading.value = false
  }
}

function selectPreset(preset) {
  selectedId.value = preset.id
  draft.value = { ...preset, plugins: Array.isArray(preset.plugins) ? preset.plugins : [] }
  pluginsText.value = JSON.stringify(draft.value.plugins, null, 2)
  creating.value = false
  editing.value = true
}

function startCreate() {
  selectedId.value = ''
  draft.value = emptyDraft()
  pluginsText.value = '[]'
  creating.value = true
  editing.value = true
}

async function save() {
  let plugins
  try { plugins = JSON.parse(pluginsText.value || '[]') } catch (_) {
    message.error('插件声明必须是有效的 JSON 数组')
    return
  }
  if (!Array.isArray(plugins)) {
    message.error('插件声明必须是数组')
    return
  }
  saving.value = true
  try {
    await saveDshAgentPreset(profile.value, {
      id: draft.value.id,
      name: draft.value.name,
      description: draft.value.description,
      order: draft.value.order,
      plugins
    }, revision.value)
    message.success('Agent 预设已保存')
    selectedId.value = draft.value.id
    await loadPresets()
  } catch (cause) {
    message.error(cause.message || '保存失败，请刷新后重试')
  } finally {
    saving.value = false
  }
}

async function remove() {
  deleting.value = true
  try {
    await deleteDshAgentPreset(profile.value, draft.value.id, revision.value)
    message.success('自定义 Agent 预设已删除')
    selectedId.value = ''
    editing.value = false
    await loadPresets()
  } catch (cause) {
    message.error(cause.message || '删除失败，请刷新后重试')
  } finally {
    deleting.value = false
  }
}
</script>

<style scoped>
.preset-panel { display: flex; flex-direction: column; gap: 12px; padding: 12px 16px 20px; overflow: auto; }
.toolbar { display: grid; grid-template-columns: minmax(180px, 1fr) auto auto; gap: 8px; align-items: center; }
.preset-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px; }
.preset-item { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-secondary); color: var(--text-primary); text-align: left; cursor: pointer; }
.preset-item.selected { border-color: var(--primary-color); }
.preset-item span, .preset-item small { color: var(--text-secondary); }
.preset-item span { overflow: hidden; max-width: 100%; text-overflow: ellipsis; white-space: nowrap; }
.editor { display: flex; flex-direction: column; gap: 12px; padding: 14px; border: 1px solid var(--border-color); border-radius: 8px; }
.editor-title { font-weight: 600; }
.field-grid { display: grid; grid-template-columns: 1fr 1fr 100px; gap: 10px; }
.field-grid label { display: flex; flex-direction: column; gap: 5px; color: var(--text-secondary); font-size: 12px; }
.field-grid .wide { grid-column: 1 / -1; }
.editor-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.hint, .empty { color: var(--text-secondary); font-size: 12px; }
.empty { padding: 20px 4px; text-align: center; }
@media (max-width: 560px) { .toolbar { grid-template-columns: 1fr 1fr; } .toolbar :deep(.n-base-selection) { grid-column: 1 / -1; } .field-grid { grid-template-columns: 1fr; } }
</style>
