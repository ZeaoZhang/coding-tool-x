<template>
  <div>
    <div v-if="state.loading" class="loading-container">
      <n-spin size="small" />
    </div>
    <div v-else>
      <div v-if="state.channels.length === 0" class="empty-state">
        <n-empty :description="config.emptyDescription">
          <template v-if="config.showEmptyAction" #extra>
            <n-button type="primary" size="small" @click="actions.openAddDialog">
              <template #icon>
                <n-icon><AddOutline /></n-icon>
              </template>
              {{ config.emptyActionText }}
            </n-button>
          </template>
        </n-empty>
      </div>
      <div v-else class="channels-list">
        <ChannelCard
          v-for="element in state.channels"
          :key="element.id"
          :channel="element"
          :collapsed="state.collapsed[element.id]"
          :header-tags="config.getHeaderTags(element, helpers)"
          :balance="helpers.getChannelBalance(element)"
          :info-rows="config.buildInfoRows(element, helpers)"
          :meta="buildMeta(element)"
          :show-apply-button="config.showApplyButton"
          :channel-type="config.type"
          :test-fn="config.testFn"
          :toggling="!!state.toggling[element.id]"
          @toggle-collapse="actions.toggleCollapse(element.id)"
          @apply="actions.handleApplyToSettings(element)"
          @edit="actions.handleEdit(element)"
          @delete="actions.handleDelete(element.id)"
          @toggle-enabled="value => actions.handleToggleEnabled(element, value)"
          @refresh-balance="actions.handleRefreshBalance(element)"
          @open-website="url => emit('open-website', url)"
        />
      </div>
    </div>

    <n-modal
      v-model:show="state.showDialog"
      preset="card"
      :title="state.editingChannel ? config.editTitle : config.addTitle"
      class="channel-dialog"
      :style="{ width: config.modalWidth + 'px', maxHeight: '80vh' }"
      :content-style="{ maxHeight: 'calc(80vh - 100px)', overflowY: 'auto' }"
    >
      <n-form label-placement="left" :label-width="config.formLabelWidth" class="channel-form">
        <template v-for="section in config.formSections" :key="section.title">
          <!-- 条件显示 section -->
          <div
            v-if="!section.showWhen || section.showWhen(state.formData)"
            class="form-section"
            :class="{
              collapsible: section.collapsible
            }"
          >
            <div class="section-title">
              {{ section.title }}
              <span v-if="section.description" class="section-desc">{{ section.description }}</span>
            </div>
            <div
              v-if="sectionHasModelConsumers(section)"
              class="model-catalog-control"
            >
              <n-button
                text
                type="primary"
                size="tiny"
                :loading="state.formData.modelsFetching"
                @click="handleModelCatalogAction"
              >
                {{ modelCatalogActionText }}
              </n-button>
              <span
                class="model-catalog-status"
                :class="{
                  'is-error': state.formData.modelsFetchError,
                  'is-loading': state.formData.modelsFetching
                }"
                role="status"
                aria-live="polite"
              >
                {{ modelCatalogStatusText }}
              </span>
            </div>
            <n-form-item
              v-for="field in section.fields"
              v-show="!field.showWhen || field.showWhen(state.formData)"
              :label="getFieldLabel(field)"
              :label-style="field.fullWidth ? { display: 'none' } : undefined"
              :required="field.required"
              :validation-status="getValidationStatus(field.key)"
              :feedback="getValidationMessage(field.key)"
            >
              <ChannelAuthSection
                v-if="field.type === 'channel-auth'"
                :platform="type"
                :channel-id="state.editingChannel?.id || ''"
                :form-data="state.formData"
                :auth-meta="state.authMeta"
                @update-auth="candidate => {
                  state.formData.authMode = 'oauth'
                  state.formData.authRef = candidate.authRef
                  state.formData.authSource = candidate.authSource
                  state.formData.authStatus = candidate.authStatus
                  state.formData.oauthProviderId = candidate.oauthProviderId || candidate.authRef?.providerId || ''
                }"
              />
              <!-- 预设选择器 -->
              <n-select
                v-else-if="field.type === 'preset'"
                :value="state.formData.presetId"
                :options="presetOptions"
                :placeholder="field.placeholder"
                @update:value="handlePresetChange"
              />
              <!-- 模型重定向编辑器 -->
              <ModelRedirectEditor
                v-else-if="field.type === 'model-redirect'"
                v-model="state.formData.modelRedirects"
                :available-models="state.formData.availableModels"
                :channel-type="config.type"
                @focusin="handleModelDropdownFocus"
              />
              <!-- 登录 provider 识别状态 -->
              <div
                v-else-if="field.type === 'auth-provider-status'"
                class="auth-provider-status"
              >
                <n-space
                  v-if="getFieldStatus(field).tags.length > 0"
                  size="small"
                  class="auth-provider-tags"
                >
                  <n-tag
                    v-for="tag in getFieldStatus(field).tags"
                    :key="tag.text"
                    size="small"
                    :type="tag.type || 'default'"
                    :bordered="false"
                  >
                    {{ tag.text }}
                  </n-tag>
                </n-space>
                <div
                  v-if="getFieldStatus(field).message"
                  class="auth-provider-message"
                  :class="{ warning: getFieldStatus(field).warning }"
                >
                  {{ getFieldStatus(field).message }}
                </div>
              </div>
              <!-- 多选模型选择器 -->
              <n-select
                v-else-if="field.type === 'model-multi-select'"
                v-model:value="state.formData.allowedModels"
                :options="state.formData.availableModels || []"
                :placeholder="field.placeholder"
                :loading="state.formData.modelsFetching"
                multiple
                filterable
                clearable
                tag
                @focus="handleModelDropdownFocus"
              />
              <!-- 测速模型选择器 (支持手动输入) -->
              <n-auto-complete
                v-else-if="field.type === 'select' && field.key === 'speedTestModel'"
                :value="state.formData.speedTestModel"
                :options="getSpeedTestModelOptions(state.formData.speedTestModel, field.options)"
                :placeholder="field.placeholder"
                :loading="state.formData.modelsFetching"
                :get-show="() => true"
                clearable
                @focus="handleModelDropdownFocus"
                @update:value="(val) => state.formData.speedTestModel = val"
              />
              <!-- 默认模型选择器 (支持手动输入) -->
              <n-auto-complete
                v-else-if="field.type === 'select' && field.key === 'model'"
                :value="state.formData.model"
                :options="getSpeedTestModelOptions(state.formData.model, field.options)"
                :placeholder="field.placeholder"
                :loading="state.formData.modelsFetching"
                :get-show="() => true"
                clearable
                @focus="handleModelDropdownFocus"
                @update:value="(val) => state.formData.model = val"
              />
              <!-- 自动完成输入框 -->
              <n-auto-complete
                v-else-if="field.type === 'autocomplete'"
                :value="getNestedValue(state.formData, field.key)"
                :options="getFilteredModelOptions(getNestedValue(state.formData, field.key))"
                :placeholder="field.placeholder"
                :loading="state.formData.modelsFetching"
                :get-show="() => true"
                @focus="handleModelDropdownFocus"
                @update:value="(val) => setNestedValue(state.formData, field.key, val)"
              />
              <!-- Radio Group -->
              <n-radio-group
                v-else-if="field.type === 'radio-group'"
                :value="getNestedValue(state.formData, field.key)"
                @update:value="(val) => setNestedValue(state.formData, field.key, val)"
              >
                <n-space>
                  <n-radio v-for="opt in field.options" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                  </n-radio>
                </n-space>
              </n-radio-group>
              <!-- OMP 完整模型定义编辑器 -->
              <div v-else-if="field.type === 'model-definitions'" class="model-definitions-editor">
                <div class="model-definitions-toolbar">
                  <n-button
                    size="tiny"
                    secondary
                    :loading="state.formData.modelMetadataFetching"
                    @click="handleModelMetadataSync"
                  >
                    自动获取 Metadata
                  </n-button>
                  <span class="model-catalog-status" role="status" aria-live="polite">
                    {{ state.formData.modelMetadataStatus || 'Metadata 读取 Models.dev 离线快照；模型列表按钮才探测渠道，普通保存不会启动网络或 OMP 命令。' }}
                  </span>
                </div>
                <n-input
                  :value="state.formData.modelDefinitionsJson"
                  type="textarea"
                  :autosize="{ minRows: 8, maxRows: 20 }"
                  :placeholder="field.placeholder"
                  @update:value="(val) => state.formData.modelDefinitionsJson = val"
                />
              </div>
              <!-- 其他字段 -->
              <component
                v-else
                :is="resolveFieldComponent(field)"
                :value="getNestedValue(state.formData, field.key)"
                v-bind="buildFieldProps(field)"
                @update:value="(val) => setNestedValue(state.formData, field.key, val)"
              />
            </n-form-item>
          </div>
        </template>
      </n-form>
      <template #footer>
        <div class="dialog-footer">
          <n-button @click="actions.closeDialog">取消</n-button>
          <n-button type="primary" @click="actions.handleSave">
            {{ state.editingChannel ? '保存修改' : '添加渠道' }}
          </n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import {
  NButton,
  NIcon,
  NEmpty,
  NSpin,
  NModal,
  NForm,
  NFormItem,
  NInput,
  NSwitch,
  NInputNumber,
  NSelect,
  NAutoComplete,
  NRadioGroup,
  NRadio,
  NSpace,
  NTag
} from 'naive-ui'
import { AddOutline } from '@vicons/ionicons5'
import ChannelCard from './ChannelCard.vue'
import ModelRedirectEditor from './ModelRedirectEditor.vue'
import ChannelAuthSection from './ChannelAuthSection.vue'
import channelPanelFactories from './channelPanelFactories'
import useChannelManager from '../../composables/useChannelManager'
import { useChannelScheduler } from '../../composables/useChannelScheduler'
import { createGenericChannelPanel } from './commonChannelSchema'
import { getPlatformChannels, createPlatformChannel, updatePlatformChannel, deletePlatformChannel } from '../../api/channels'
import { usePlatformStore } from '../../stores/platforms'

const props = defineProps({
  type: {
    type: String,
    required: true
  }
})

const emit = defineEmits(['open-website'])

const platformStore = usePlatformStore()
const platformManifest = platformStore.get(props.type) || { key: props.type, label: props.type, capabilities: { channels: true } }
const configFactory = channelPanelFactories[props.type]
  || (() => createGenericChannelPanel(platformManifest, {
    fetch: () => getPlatformChannels(props.type),
    create: payload => createPlatformChannel(props.type, payload),
    update: (channel, payload) => updatePlatformChannel(props.type, channel.id, payload),
    remove: channelId => deletePlatformChannel(props.type, channelId),
    toggle: (channel, enabled) => updatePlatformChannel(props.type, channel.id, { ...channel, enabled })
  }))
const config = configFactory()
const { state, validation, actions } = useChannelManager(config)
const { getChannelInflight } = useChannelScheduler(config.schedulerSource)
function getFieldLabel(field) {
  return typeof field.label === 'function' ? field.label(state.formData) : field.label
}

// 模型列表属于远端探测，按需加载，避免打开弹窗时阻塞渠道管理。
function stableSignatureValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableSignatureValue)
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableSignatureValue(value[key])
        return acc
      }, {})
  }
  return value === undefined || value === null ? '' : String(value)
}

function buildModelFetchSignature() {
  const form = state.formData || {}
  const apiKey = String(form.apiKey || '')
  return JSON.stringify(stableSignatureValue({
    channelId: state.editingChannel?.id || null,
    presetId: form.presetId || '',
    providerKey: form.providerKey || '',
    providerApi: form.providerApi || '',
    wireApi: form.wireApi || '',
    targetApi: form.targetApi || '',
    gatewaySourceType: form.gatewaySourceType || '',
    authMode: form.authMode || '',
    oauthProviderId: form.oauthProviderId || '',
    baseUrl: form.baseUrl || '',
    apiKeyMarker: apiKey ? `${apiKey.length}:${apiKey.slice(-4)}` : ''
  }))
}

function resetModelFetchState({ clearOptions = false } = {}) {
  state.formData.modelsFetching = false
  state.formData._modelsLoadedOnce = false
  state.formData._modelsFetchSignature = null
  state.formData.modelsFetchError = null
  state.formData.modelsFetchErrorHint = null
  state.formData.modelsFetchMeta = null
  if (clearOptions) {
    state.formData.availableModels = []
  }
}

async function handleModelDropdownFocus() {
  if (!config.fetchModelsForChannel || state.formData.modelsFetching) return
  const signature = buildModelFetchSignature()
  const existingOptions = state.formData.availableModels || []
  if (
    existingOptions.length > 0
    && state.formData._modelsLoadedOnce
    && state.formData._modelsFetchSignature === signature
  ) {
    return
  }
  await handleFetchModels({ signature })
}

const modelCatalogActionText = computed(() => {
  if (state.formData.modelsFetching) return '正在加载模型'
  if (state.formData.modelsFetchError) return '重试加载模型'
  if ((state.formData.availableModels || []).length > 0) return '刷新可选模型'
  return '加载可选模型'
})

const modelCatalogStatusText = computed(() => {
  if (state.formData.modelsFetching) {
    return '正在读取模型列表，仍可继续填写表单。'
  }
  if (state.formData.modelsFetchError) {
    const hint = state.formData.modelsFetchErrorHint
    const retryText = state.formData.modelsFetchMeta?.stale && state.formData.modelsFetchMeta?.retryAfter
      ? `当前使用缓存目录，${new Date(state.formData.modelsFetchMeta.retryAfter).toLocaleString()} 后可自动重试，也可手动刷新。`
      : ''
    const message = hint
      ? `模型列表未能更新：${state.formData.modelsFetchError}。${hint}`
      : `模型列表未能更新：${state.formData.modelsFetchError}。可重试或手动填写模型名称。`
    return `${message}${retryText ? ` ${retryText}` : ''}`
  }
  const meta = state.formData.modelsFetchMeta
  if (meta?.stale && meta?.retryAfter) {
    return `正在使用缓存的模型目录；${new Date(meta.retryAfter).toLocaleString()} 后可自动重试，也可手动刷新。`
  }
  if (meta?.stale) {
    return '正在使用已过期的模型目录；可点击“刷新可选模型”更新。'
  }
  if (meta?.cached) {
    return '已从本地缓存加载可选模型。'
  }
  const count = (state.formData.availableModels || []).length
  if (count > 0) return `已加载 ${count} 个可选模型。`
  return '可手动填写模型名称，或加载该渠道的可选模型。'
})

function isModelConsumer(field) {
  if (['model-redirect', 'model-multi-select', 'autocomplete'].includes(field.type)) {
    return true
  }
  return field.type === 'select' && ['model', 'speedTestModel'].includes(field.key)
}

function sectionHasModelConsumers(section) {
  return section.fields?.some(field => (
    (!field.showWhen || field.showWhen(state.formData)) && isModelConsumer(field)
  )) && Boolean(config.fetchModelsForChannel)
}

async function handleModelCatalogAction() {
  if (!config.fetchModelsForChannel || state.formData.modelsFetching) return
  const signature = buildModelFetchSignature()
  const shouldRefresh = state.formData._modelsLoadedOnce
    && state.formData._modelsFetchSignature === signature
  await handleFetchModels({ forceRefresh: shouldRefresh, signature })
}

async function handleModelMetadataSync() {
  if (typeof config.fetchModelMetadataForChannel !== 'function' || state.formData.modelMetadataFetching) return
  state.formData.modelMetadataFetching = true
  state.formData.modelMetadataStatus = '正在读取 OMP metadata…'
  try {
    await config.fetchModelMetadataForChannel(state.formData)
  } catch (error) {
    state.formData.modelMetadataStatus = error?.response?.data?.error || error?.message || '读取 OMP metadata 失败'
  } finally {
    state.formData.modelMetadataFetching = false
  }
}

// 预设选项
const presetOptions = computed(() => {
  if (!config.presets) return []

  const groups = {}
  config.presets.forEach(preset => {
    const category = preset.category || 'custom'
    if (!groups[category]) {
      groups[category] = {
        type: 'group',
        label: config.presetCategories?.[category] || category,
        key: category,
        children: []
      }
    }
    groups[category].children.push({
      label: preset.name,
      value: preset.id
    })
  })

  return Object.values(groups)
})

// 预设变化处理
function handlePresetChange(presetId) {
  if (config.onPresetChange) {
    const newForm = config.onPresetChange(presetId, state.formData)
    Object.assign(state.formData, newForm)
  } else {
    state.formData.presetId = presetId
  }
  resetModelFetchState({ clearOptions: true })
}

// 获取模型列表
async function handleFetchModels({ forceRefresh = false, signature = buildModelFetchSignature() } = {}) {
  if (config.fetchModelsForChannel) {
    state.formData.modelsFetching = true
    state.formData.modelsFetchError = null
    state.formData.modelsFetchErrorHint = null
    state.formData.modelsFetchMeta = null
    try {
      await config.fetchModelsForChannel(state.editingChannel?.id || null, state.formData, { forceRefresh })
    } catch (error) {
      if (buildModelFetchSignature() === signature) {
        state.formData.modelsFetchError = error?.message || '获取模型列表失败'
        state.formData.modelsFetchErrorHint = '可重试，或先手动填写模型名称'
      }
    } finally {
      if (buildModelFetchSignature() === signature) {
        state.formData.modelsFetching = false
      }
    }
    if (buildModelFetchSignature() !== signature) {
      resetModelFetchState({ clearOptions: true })
      return
    }
    state.formData._modelsLoadedOnce = true
    state.formData._modelsFetchSignature = signature
  }
}

// 获取嵌套值 (支持 'modelConfig.model' 这种路径)
function getNestedValue(obj, path) {
  if (!path.includes('.')) return obj[path]
  const keys = path.split('.')
  let value = obj
  for (const key of keys) {
    value = value?.[key]
  }
  return value
}

// 设置嵌套值
function setNestedValue(obj, path, value) {
  if (!path.includes('.')) {
    obj[path] = value
    return
  }
  const keys = path.split('.')
  let target = obj
  for (let i = 0; i < keys.length - 1; i++) {
    if (!target[keys[i]]) target[keys[i]] = {}
    target = target[keys[i]]
  }
  target[keys[keys.length - 1]] = value
}

// 根据输入值过滤模型选项
function getFilteredModelOptions(inputValue) {
  const options = state.formData.availableModels || []
  if (!inputValue || !options.length) {
    return options
  }
  const searchTerm = inputValue.toLowerCase()
  return options.filter(opt => {
    const label = (opt.label || opt.value || '').toLowerCase()
    return label.includes(searchTerm)
  })
}

// 获取测速模型选项（合并动态可用模型与字段配置模型）
function getSpeedTestModelOptions(inputValue, fieldOptions) {
  const merged = []
  const seen = new Set()
  const appendOptions = (options) => {
    for (const opt of options || []) {
      const value = String(opt?.value || '').trim()
      if (!value) continue
      const key = value.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      merged.push({
        label: opt?.label || value,
        value
      })
    }
  }

  // 合并动态模型 + 字段配置模型，避免仅展示单个默认模型
  appendOptions(state.formData.availableModels || [])
  appendOptions(fieldOptions || [])
  const options = merged

  if (!inputValue || !options.length) {
    return options
  }
  const searchTerm = inputValue.toLowerCase()
  return options.filter(opt => {
    const label = (opt.label || opt.value || '').toLowerCase()
    return label.includes(searchTerm)
  })
}

// 获取验证状态（支持嵌套路径）
function getValidationStatus(key) {
  const flatKey = key.replace(/\./g, '_')
  return validation[flatKey]?.status || validation[key]?.status
}

function getValidationMessage(key) {
  const flatKey = key.replace(/\./g, '_')
  return validation[flatKey]?.message || validation[key]?.message
}

function getFieldStatus(field) {
  if (typeof field.getStatus !== 'function') {
    return { tags: [], message: '' }
  }
  const status = field.getStatus(state.formData) || {}
  return {
    tags: Array.isArray(status.tags) ? status.tags : [],
    message: status.message || '',
    warning: status.warning === true
  }
}

const helpers = {
  getChannelInflight,
  getChannelBalance: (channel) => state.balances[channel.id] || null,
  formatFreeze: (remaining) => `冻结 ${remaining || 0}s`,
  maskApiKey: (key) => {
    if (key === undefined) return '已隐藏'
    if (!key) return '(未设置)'
    if (key.length <= 12) return '******'
    return `${key.slice(0, 8)}******${key.slice(-4)}`
  },
  handleResetHealth: (channel) => actions.handleResetHealth(channel),
  handleRefreshBalance: (channel) => actions.handleRefreshBalance(channel),
  handleOpenWebsite: (url) => emit('open-website', url)
}

function buildMeta(channel) {
  const inflight = getChannelInflight(channel.id)
  const concurrencyText = channel.maxConcurrency
    ? `${inflight}/${channel.maxConcurrency}`
    : inflight > 0 ? inflight : '不限'
  return {
    weight: channel.weight || 1,
    concurrencyText,
    concurrencyActive: inflight > 0
  }
}

function resolveFieldComponent(field) {
  switch (field.type) {
    case 'password':
    case 'text':
    case 'textarea':
      return NInput
    case 'number':
      return NInputNumber
    case 'switch':
      return NSwitch
    case 'radio-group':
      return NRadioGroup
    default:
      return NInput
  }
}

function buildFieldProps(field) {
  const base = { placeholder: field.placeholder }
  if (field.type === 'password') {
    base.type = 'password'
    base['show-password-on'] = 'click'
  }
  if (field.type === 'textarea') {
    base.type = 'textarea'
    base.autosize = field.autosize || { minRows: 5, maxRows: 16 }
  }
  if (field.type === 'number') {
    base.min = field.min ?? 1
    base.max = field.max ?? 100
    base.step = field.step ?? 1
    base.clearable = field.clearable
    base.style = 'width: 100%;'
  }
  if (field.disabledOnEdit && state.editingChannel) {
    base.disabled = true
  }
  return base
}

defineExpose({
  openAddDialog: actions.openAddDialog,
  syncCurrentChannels: actions.handleSyncCurrentChannels,
  refresh: actions.loadChannels
})
</script>

<style src="./channel-panel-common.css"></style>
<style scoped>
.model-definitions-editor {
  width: 100%;
}

.model-definitions-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
</style>
