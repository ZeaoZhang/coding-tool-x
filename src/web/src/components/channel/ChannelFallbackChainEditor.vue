<template>
  <div class="channel-fallback-editor">
    <div v-if="!chains.length" class="fb-empty">还没有配置回退链。未配置时，模型不可用只会返回上游错误。</div>

    <div v-for="(rule, index) in chains" :key="index" class="fb-row">
      <div class="fb-from">
        <n-auto-complete
          :value="rule.from"
          :options="fromOptions(rule.from)"
          placeholder="当前模型"
          :get-show="() => true"
          :disabled="disabled"
          clearable
          @update:value="(val) => setFrom(index, val)"
        />
      </div>

      <div class="fb-arrow">
        <n-icon size="16" color="#999"><ArrowForwardOutline /></n-icon>
      </div>

      <div class="fb-targets">
        <n-tag
          v-for="(target, targetIndex) in rule.targets"
          :key="`${target.channelId}-${target.model}`"
          size="small"
          :bordered="false"
          type="info"
          :closable="!disabled"
          @close="removeTarget(index, targetIndex)"
        >
          {{ targetIndex + 1 }}. {{ channelLabel(target.channelId) }} · {{ target.model }}
        </n-tag>

        <template v-if="pending[index]">
          <n-select
            class="fb-pick"
            size="small"
            :value="pending[index].channelId || null"
            :options="channelSelectOptions"
            placeholder="选择渠道"
            filterable
            :disabled="disabled"
            @update:value="(val) => setPendingChannel(index, val)"
          />
          <n-select
            v-if="pending[index].channelId"
            class="fb-pick"
            size="small"
            :value="null"
            :options="modelSelectOptions(index)"
            placeholder="选择该渠道的模型"
            filterable
            :disabled="disabled"
            @update:value="(val) => addTarget(index, val)"
          />
          <n-button quaternary size="tiny" :disabled="disabled" @click="cancelPending(index)">取消</n-button>
        </template>
        <n-button v-else dashed size="tiny" :disabled="disabled || !channelSelectOptions.length" @click="startPending(index)">
          ＋ 添加回退模型
        </n-button>
      </div>

      <n-button quaternary circle size="small" :disabled="disabled" @click="removeRule(index)">
        <template #icon><n-icon><CloseOutline /></n-icon></template>
      </n-button>
    </div>

    <n-button dashed size="small" block :disabled="disabled" @click="addRule">
      <template #icon><n-icon><AddOutline /></n-icon></template>
      添加回退链
    </n-button>
  </div>
</template>

<script setup>
import { computed, reactive, watch } from 'vue'
import { NAutoComplete, NButton, NIcon, NSelect, NTag } from 'naive-ui'
import { AddOutline, ArrowForwardOutline, CloseOutline } from '@vicons/ionicons5'

const props = defineProps({
  chains: {
    type: Array,
    default: () => []
  },
  modelOptions: {
    type: Array,
    default: () => []
  },
  disabled: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:chains'])

const rows = reactive([])
const pending = reactive({})

function cloneRules(value) {
  return (Array.isArray(value) ? value : []).map(rule => ({
    from: String(rule?.from || ''),
    targets: (Array.isArray(rule?.targets) ? rule.targets : [])
      .map(target => ({ channelId: String(target?.channelId || ''), model: String(target?.model || '') }))
      .filter(target => target.channelId && target.model)
  }))
}

watch(() => props.chains, (value) => {
  rows.splice(0, rows.length, ...cloneRules(value))
}, { immediate: true, deep: true })

const channelsById = computed(() => {
  const map = new Map()
  for (const option of props.modelOptions) {
    if (!map.has(option.channelId)) map.set(option.channelId, { id: option.channelId, name: option.channelName, models: [] })
    map.get(option.channelId).models.push(option.model)
  }
  return map
})

const channelSelectOptions = computed(() => [...channelsById.value.values()]
  .map(channel => ({ label: channel.name, value: channel.id })))

const allModels = computed(() => [...new Set(props.modelOptions.map(option => option.model))].sort())

function commit() {
  emit('update:chains', rows
    .map(rule => ({
      from: String(rule.from || '').trim(),
      targets: rule.targets.filter(target => target.channelId && target.model)
    }))
    .filter(rule => rule.from && rule.targets.length > 0))
}

function fromOptions(inputValue) {
  const keyword = String(inputValue || '').toLowerCase()
  return allModels.value
    .filter(model => !keyword || model.toLowerCase().includes(keyword))
    .map(model => ({ label: model, value: model }))
}

function channelLabel(channelId) {
  const channel = channelsById.value.get(channelId)
  return channel ? channel.name : `已停用渠道(${channelId.slice(0, 6)})`
}

function modelSelectOptions(index) {
  const channel = channelsById.value.get(pending[index]?.channelId)
  const used = new Set((rows[index]?.targets || []).map(target => target.model))
  return (channel?.models || [])
    .filter(model => !used.has(model))
    .map(model => ({ label: model, value: model }))
}

function addRule() {
  rows.push({ from: '', targets: [] })
}

function removeRule(index) {
  rows.splice(index, 1)
  delete pending[index]
  commit()
}

function setFrom(index, value) {
  if (!rows[index]) return
  rows[index].from = value || ''
  commit()
}

function startPending(index) {
  pending[index] = { channelId: '' }
}

function cancelPending(index) {
  delete pending[index]
}

function setPendingChannel(index, channelId) {
  if (!pending[index]) pending[index] = { channelId: '' }
  pending[index].channelId = channelId || ''
}

function addTarget(index, model) {
  const channelId = pending[index]?.channelId
  if (!rows[index] || !channelId || !model) return
  rows[index].targets.push({ channelId, model })
  delete pending[index]
  commit()
}

function removeTarget(index, targetIndex) {
  rows[index]?.targets.splice(targetIndex, 1)
  commit()
}
</script>

<style scoped>
.channel-fallback-editor {
  width: 100%;
}

.fb-empty {
  margin-bottom: 10px;
  font-size: 12px;
  color: #999;
}

.fb-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 10px;
}

.fb-from {
  flex: 0 0 190px;
  min-width: 0;
}

.fb-arrow {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 28px;
}

.fb-targets {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.fb-pick {
  flex: 0 0 165px;
}
</style>
