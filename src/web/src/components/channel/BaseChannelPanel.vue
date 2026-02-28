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
      <draggable
        v-else
        v-model="state.channels"
        item-key="id"
        class="channels-list"
        ghost-class="ghost"
        chosen-class="chosen"
        drag-class="drag"
        animation="200"
        @end="actions.handleDragEnd"
      >
        <template #item="{ element }">
          <ChannelCard
            :key="element.id"
            :channel="element"
            :collapsed="state.collapsed[element.id]"
            :header-tags="config.getHeaderTags(element, helpers)"
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
            @open-website="url => emit('open-website', url)"
          />
        </template>
      </draggable>
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
            <n-form-item
              v-for="field in section.fields"
              v-show="!field.showWhen || field.showWhen(state.formData)"
              :key="field.key"
              :label="field.label"
              :label-style="field.fullWidth ? { display: 'none' } : undefined"
              :required="field.required"
              :validation-status="getValidationStatus(field.key)"
              :feedback="getValidationMessage(field.key)"
            >
              <!-- 预设选择器 -->
              <n-select
                v-if="field.type === 'preset'"
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
              />
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
                @update:value="(val) => state.formData.speedTestModel = val"
              >
                <template v-if="state.formData.modelsFetchError" #empty>
                  <div style="padding: 8px; color: #d03050; font-size: 12px;">
                    <div style="font-weight: 500; margin-bottom: 4px;">
                      {{ state.formData.modelsFetchError }}
                    </div>
                    <div v-if="state.formData.modelsFetchErrorHint" style="color: #666; font-size: 11px; line-height: 1.4;">
                      {{ state.formData.modelsFetchErrorHint }}
                    </div>
                  </div>
                </template>
              </n-auto-complete>
              <!-- 默认模型选择器 (支持手动输入) -->
              <n-auto-complete
                v-else-if="field.type === 'select' && field.key === 'model'"
                :value="state.formData.model"
                :options="getSpeedTestModelOptions(state.formData.model, field.options)"
                :placeholder="field.placeholder"
                :loading="state.formData.modelsFetching"
                :get-show="() => true"
                clearable
                @update:value="(val) => state.formData.model = val"
              >
                <template v-if="state.formData.modelsFetchError" #empty>
                  <div style="padding: 8px; color: #d03050; font-size: 12px;">
                    <div style="font-weight: 500; margin-bottom: 4px;">
                      {{ state.formData.modelsFetchError }}
                    </div>
                    <div v-if="state.formData.modelsFetchErrorHint" style="color: #666; font-size: 11px; line-height: 1.4;">
                      {{ state.formData.modelsFetchErrorHint }}
                    </div>
                  </div>
                </template>
              </n-auto-complete>
              <!-- 自动完成输入框 -->
              <n-auto-complete
                v-else-if="field.type === 'autocomplete'"
                :value="getNestedValue(state.formData, field.key)"
                :options="getFilteredModelOptions(getNestedValue(state.formData, field.key))"
                :placeholder="field.placeholder"
                :get-show="() => true"
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
import { computed, watch } from 'vue'
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
  NSpace
} from 'naive-ui'
import { AddOutline } from '@vicons/ionicons5'
import draggable from 'vuedraggable'
import ChannelCard from './ChannelCard.vue'
import ModelRedirectEditor from './ModelRedirectEditor.vue'
import channelPanelFactories from './channelPanelFactories'
import useChannelManager from '../../composables/useChannelManager'
import { useChannelScheduler } from '../../composables/useChannelScheduler'

const props = defineProps({
  type: {
    type: String,
    required: true
  }
})

const emit = defineEmits(['open-website'])

const configFactory = channelPanelFactories[props.type] || channelPanelFactories.claude
const config = configFactory()
const { state, validation, actions } = useChannelManager(config)
const { getChannelInflight } = useChannelScheduler(config.schedulerSource)

// 监听对话框打开，自动获取模型列表
watch(() => state.showDialog, async (newVal) => {
  if (newVal && config.fetchModelsForChannel) {
    await handleFetchModels()
  }
})

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
async function handlePresetChange(presetId) {
  if (config.onPresetChange) {
    const newForm = config.onPresetChange(presetId, state.formData)
    Object.assign(state.formData, newForm)
  } else {
    state.formData.presetId = presetId
  }
  // 预设切换后重新获取模型列表（入口类型切换时需要更新可用模型）
  await handleFetchModels()
}

// 获取模型列表
async function handleFetchModels() {
  if (config.fetchModelsForChannel) {
    await config.fetchModelsForChannel(state.editingChannel?.id || null, state.formData)
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

const helpers = {
  getChannelInflight,
  formatFreeze: (remaining) => `冻结 ${remaining || 0}s`,
  maskApiKey: (key) => {
    if (!key) return '(未设置)'
    if (key.length <= 12) return '******'
    return `${key.slice(0, 8)}******${key.slice(-4)}`
  },
  handleResetHealth: (channel) => actions.handleResetHealth(channel),
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
  refresh: actions.loadChannels
})
</script>

<style src="./channel-panel-common.css"></style>
