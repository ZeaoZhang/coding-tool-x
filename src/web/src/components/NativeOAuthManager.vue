<template>
  <n-modal v-model:show="visible" preset="card" :title="`${toolLabel} 原生 OAuth`" style="width: 680px">
    <div class="oauth-manager">
      <n-alert type="info" :show-icon="false">
        登录仍由 {{ toolLabel }} CLI 完成；此处只同步、应用和关闭本地登录态。
      </n-alert>

      <n-alert v-if="warning" type="warning" :show-icon="false">{{ warning }}</n-alert>

      <div class="toolbar">
        <n-button type="primary" :loading="loading" @click="sync">
          同步本地 OAuth
        </n-button>
        <n-button :loading="loading" @click="loadSummary">刷新</n-button>
      </div>

      <n-empty v-if="!loading && credentials.length === 0" description="未同步到本地 OAuth 凭证" />
      <n-list v-else bordered>
        <n-list-item v-for="credential in credentials" :key="credential.id">
          <div class="credential-row">
            <div class="credential-main">
              <strong>{{ credential.name || credential.providerId || toolLabel }}</strong>
              <span class="credential-detail">
                Provider: {{ credential.providerId || '—' }} ·
                Account: {{ accountLabel(credential) }}
              </span>
              <span class="credential-detail">
                状态: {{ statusLabel(credential) }} ·
                {{ timeLabel(credential) }}
              </span>
            </div>
            <div class="credential-actions">
              <n-tag v-if="credential.isDefault" type="success" size="small">默认</n-tag>
              <n-button size="small" type="primary" :loading="busyId === credential.id" @click="apply(credential)">
                应用
              </n-button>
              <n-button size="small" :loading="busyId === credential.id" @click="disable(credential)">
                禁用本机
              </n-button>
            </div>
          </div>
        </n-list-item>
      </n-list>

      <div class="native-state">
        <span>Native 状态：{{ nativeStateLabel }}</span>
        <n-button size="small" secondary :loading="loading" @click="clearNative">
          清空全部本机 OAuth
        </n-button>
      </div>
    </div>
  </n-modal>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { NAlert, NButton, NEmpty, NList, NListItem, NModal, NTag } from 'naive-ui'
import message, { dialog } from '../utils/message'
import {
  getOAuthToolSummary,
  syncLocalOAuth,
  applyOAuthCredential,
  disableNativeOAuthCredential,
  clearNativeOAuth
} from '../api/oauthCredentials'

const props = defineProps({
  tool: { type: String, required: true },
  visible: { type: Boolean, default: false }
})
const emit = defineEmits(['update:visible', 'changed'])

const loading = ref(false)
const busyId = ref('')
const warning = ref('')
const summary = ref(null)
const visible = computed({
  get: () => props.visible,
  set: value => emit('update:visible', value)
})
const toolLabel = computed(() => props.tool === 'omp' ? 'OMP' : 'OpenCode')
const credentials = computed(() => summary.value?.summary?.credentials || [])
const nativeState = computed(() => summary.value?.summary?.nativeState || {})
const nativeStateLabel = computed(() => {
  if (nativeState.value.oauthPresent) return nativeState.value.mode || 'oauth'
  return '未检测到登录态'
})

function errorMessage(error, fallback) {
  return error?.response?.data?.error || error?.message || fallback
}

function accountLabel(credential) {
  return credential.accountEmail || credential.accountId || '本地账户'
}

function statusLabel(credential) {
  if (!credential.expiresAt) return '可用'
  return Number(credential.expiresAt) > Date.now() ? '可用' : '已过期'
}

function timeLabel(credential) {
  if (credential.lastUsedAt) return `最近使用：${new Date(credential.lastUsedAt).toLocaleString()}`
  if (credential.expiresAt) return `过期：${new Date(credential.expiresAt).toLocaleString()}`
  return '时间：—'
}

async function loadSummary() {
  loading.value = true
  warning.value = ''
  try {
    summary.value = await getOAuthToolSummary(props.tool)
  } catch (error) {
    warning.value = errorMessage(error, '读取本地 OAuth 状态失败')
  } finally {
    loading.value = false
  }
}

async function sync() {
  loading.value = true
  warning.value = ''
  try {
    const result = await syncLocalOAuth(props.tool)
    summary.value = { tool: props.tool, summary: result.summary }
    message.success('本地 OAuth 已同步')
    emit('changed', result)
  } catch (error) {
    warning.value = errorMessage(error, '同步本地 OAuth 失败')
  } finally {
    loading.value = false
  }
}

async function apply(credential) {
  busyId.value = credential.id
  warning.value = ''
  try {
    const result = await applyOAuthCredential(props.tool, credential.id)
    summary.value = { tool: props.tool, summary: result.toolSummary }
    message.success(result.message || 'OAuth 凭证已应用')
    emit('changed', result)
  } catch (error) {
    warning.value = errorMessage(error, '应用 OAuth 凭证失败')
  } finally {
    busyId.value = ''
  }
}

function confirmAction(content, action) {
  dialog.warning({
    title: '确认操作',
    content,
    positiveText: '确认',
    negativeText: '取消',
    onPositiveClick: action
  })
}

function disable(credential) {
  confirmAction(`禁用 ${credential.name || accountLabel(credential)} 的本机 OAuth 登录态？`, async () => {
    busyId.value = credential.id
    warning.value = ''
    try {
      const result = await disableNativeOAuthCredential(props.tool, credential.id)
      summary.value = { tool: props.tool, summary: result.toolSummary }
      message.success(result.message || '本机 OAuth 已禁用')
      emit('changed', result)
    } catch (error) {
      warning.value = errorMessage(error, '禁用本机 OAuth 失败')
    } finally {
      busyId.value = ''
    }
  })
}

function clearNative() {
  confirmAction(`清空全部 ${toolLabel.value} 本机 OAuth 登录态？`, async () => {
    loading.value = true
    warning.value = ''
    try {
      const result = await clearNativeOAuth(props.tool)
      await loadSummary()
      message.success('本机 OAuth 已清空')
      emit('changed', result)
    } catch (error) {
      warning.value = errorMessage(error, '清空本机 OAuth 失败')
    } finally {
      loading.value = false
    }
  })
}
watch(() => props.visible, value => {
  if (value) loadSummary()
}, { immediate: true })
</script>

<style scoped>
.oauth-manager { display: grid; gap: 14px; }
.toolbar, .native-state, .credential-row, .credential-actions { display: flex; align-items: center; gap: 10px; }
.toolbar { justify-content: flex-end; }
.native-state { justify-content: space-between; color: var(--text-color-3); }
.credential-row { width: 100%; justify-content: space-between; align-items: flex-start; }
.credential-main { display: grid; gap: 4px; min-width: 0; }
.credential-detail { color: var(--text-color-3); font-size: 12px; }
.credential-actions { flex-shrink: 0; }
</style>
