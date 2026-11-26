<template>
  <div class="omp-model-roles omp-fallback-chains">
    <div class="omp-model-roles-toolbar">
      <div class="omp-model-roles-copy">
        <strong>模型回退链</strong>
        <span>
          当前模型不可用时，按顺序改用链上的渠道模型<template v-if="isOmp">（写入 OMP config.yml 的 retry.fallbackChains，由 OMP 依次尝试）</template><template v-else>（切换到该渠道并改写请求里的 model）</template>。候选来自已启用渠道。
        </span>
        <span v-if="unavailableList.length" class="omp-model-roles-stale">
          以下回退目标当前不可用：{{ unavailableList.join('；') }}。
        </span>
        <div v-if="loadError" class="omp-model-roles-error">
          <span>{{ loadError }}</span>
          <n-button text size="tiny" :disabled="loading" @click="load">重试</n-button>
        </div>
      </div>
      <n-button
        type="primary"
        size="small"
        :loading="saving"
        :disabled="loading || !!loadError || saving || !dirty"
        @click="save"
      >
        保存回退链
      </n-button>
    </div>

    <ChannelFallbackChainEditor
      v-model:chains="chains"
      :model-options="modelOptions"
      :disabled="loading || !!loadError || saving"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { NButton } from 'naive-ui'
import { client } from '../../api/client'
import message from '../../utils/message'
import ChannelFallbackChainEditor from './ChannelFallbackChainEditor.vue'

const props = defineProps({
  platform: {
    type: String,
    default: ''
  }
})

const isOmp = computed(() => String(props.platform || '').toLowerCase() === 'omp')
const chains = ref([])
const modelOptions = ref([])
const loading = ref(false)
const saving = ref(false)
const loadError = ref('')
const original = ref('')

const dirty = computed(() => JSON.stringify(chains.value) !== original.value)

const availableTargets = computed(() => new Set(modelOptions.value
  .map(option => `${option.channelId}\u0000${option.model}`)))

// 目标渠道被停用/模型下架后，界面直接提示（不再依赖各平台后端各算一套）
const unavailableList = computed(() => chains.value.flatMap(rule => (rule.targets || [])
  .map(target => ({
    label: `${rule.from} → ${channelName(target.channelId)} · ${target.model}`,
    ok: availableTargets.value.has(`${target.channelId}\u0000${target.model}`)
  }))
  .filter(item => !item.ok)
  .map(item => item.label)))

function channelName(channelId) {
  const option = modelOptions.value.find(item => item.channelId === channelId)
  return option ? option.channelName : String(channelId || '')
}

function resolveErrorMessage(error) {
  return error?.data?.error
    || error?.response?.data?.error
    || error?.message
    || '未知错误'
}

function apply(data = {}) {
  chains.value = (Array.isArray(data.chains) ? data.chains : []).map(rule => ({
    from: typeof rule.from === 'string' ? rule.from : '',
    targets: (Array.isArray(rule.targets) ? rule.targets : []).map(target => ({
      channelId: String(target?.channelId || ''),
      model: String(target?.model || '')
    }))
  }))
  original.value = JSON.stringify(chains.value)
  modelOptions.value = (Array.isArray(data.modelOptions) ? data.modelOptions : [])
    .filter(option => option && option.channelId && option.model)
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const { data } = await client.get('/settings/model-fallback-chains', { params: { platform: props.platform } })
    apply(data)
  } catch (error) {
    loadError.value = `加载模型回退链失败：${resolveErrorMessage(error)}`
  } finally {
    loading.value = false
  }
}

async function save() {
  if (loading.value || saving.value || loadError.value) return
  saving.value = true
  try {
    const { data } = await client.put('/settings/model-fallback-chains', {
      platform: props.platform,
      chains: chains.value
        .map(rule => ({
          from: String(rule.from || '').trim(),
          targets: (rule.targets || [])
            .map(target => ({ channelId: String(target.channelId || '').trim(), model: String(target.model || '').trim() }))
            .filter(target => target.channelId && target.model)
        }))
        .filter(rule => rule.from && rule.targets.length > 0)
    })
    apply(data)
    message.success('模型回退链已保存')
  } catch (error) {
    message.error(`保存模型回退链失败：${resolveErrorMessage(error)}`)
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
/* 卡片从 AgentsPanel 抽成独立组件后不再继承其 scoped 样式，这里自带一份并复用同一套 class。 */
.omp-model-roles {
  margin: 0 14px 12px;
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  background: var(--bg-secondary);
}

.omp-model-roles-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 12px 0;
}

.omp-model-roles-copy {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  font-size: 12px;
}

.omp-model-roles-copy strong {
  color: var(--text-primary);
  font-size: 13px;
}

.omp-model-roles-copy span {
  color: var(--text-secondary);
  line-height: 1.5;
}

.omp-model-roles-copy .omp-model-roles-stale {
  color: var(--n-warning-color, #f0a020);
}

.omp-model-roles-error {
  color: var(--n-error-color, #d03050);
  display: flex;
  align-items: center;
  gap: 8px;
}

.omp-model-roles-error span {
  color: inherit;
}

.omp-model-roles-toolbar > .n-button {
  flex-shrink: 0;
}

.omp-fallback-chains :deep(.channel-fallback-editor) {
  padding: 0 12px 12px;
}
</style>
