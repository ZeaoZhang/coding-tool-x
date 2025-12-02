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
            :class="{ collapsible: section.collapsible }"
          >
            <div class="section-title">
              {{ section.title }}
              <span v-if="section.description" class="section-desc">{{ section.description }}</span>
            </div>
            <n-form-item
              v-for="field in section.fields"
              :key="field.key"
              :label="field.label"
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
  NSelect
} from 'naive-ui'
import { AddOutline } from '@vicons/ionicons5'
import draggable from 'vuedraggable'
import ChannelCard from './ChannelCard.vue'
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

// 预设选项（仅 Claude 有）
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
