<template>
  <n-drawer
    v-model:show="visible"
    :width="drawerWidth"
    placement="right"
    :mask-closable="true"
  >
    <n-drawer-content closable :native-scrollbar="false">
      <template #header>
        <div class="drawer-header">
          <n-icon :size="20" color="#2080f0">
            <KeyOutline />
          </n-icon>
          <span>OAuth 凭证管理</span>
        </div>
      </template>

      <div class="oauth-container">
        <n-alert type="info" :show-icon="false">
          这里只管理 OAuth token 的导入、同步和切换，不直接发起 OAuth 登录。过期后由用户自行刷新。
        </n-alert>

        <div class="toolbar">
          <n-space>
            <n-button secondary @click="loadSummaries" :loading="loading">
              刷新
            </n-button>
            <n-button
              type="primary"
              secondary
              :loading="busyKey === `sync-${currentTool}`"
              @click="handleSyncLocal(currentTool)"
            >
              同步本地现有配置
            </n-button>
            <n-button type="primary" @click="openImportModal(currentTool)">
              手动导入
            </n-button>
          </n-space>
        </div>

        <n-spin :show="loading">
          <n-tabs v-model:value="currentTool" type="line" animated>
            <n-tab-pane
              v-for="tool in toolOrder"
              :key="tool"
              :name="tool"
              :tab="toolLabels[tool]"
            >
              <div class="tool-panel">
                <div class="section-header">
                  <div>
                    <div class="section-title">已管理凭证</div>
                    <div class="section-desc">每个工具只能设置一个默认 token</div>
                  </div>
                </div>

                <n-empty
                  v-if="!getSummary(tool)?.credentials?.length"
                  description="暂无 OAuth 凭证"
                  size="small"
                />

                <div v-else class="credential-list">
                  <n-card
                    v-for="credential in getSortedCredentials(tool)"
                    :key="credential.id"
                    size="small"
                    class="credential-card"
                    :class="credential.isDefault ? 'credential-card--active' : 'credential-card--inactive'"
                  >
                    <div class="credential-top">
                      <div class="credential-main">
                        <div class="credential-name">{{ credential.name }}</div>
                        <div class="credential-tags">
                          <n-tag v-if="credential.isDefault" size="small" type="success">默认</n-tag>
                          <n-tag v-if="credential.providerId" size="small">{{ credential.providerId }}</n-tag>
                        </div>
                      </div>

                      <div class="credential-actions">
                        <n-button
                          size="small"
                          type="primary"
                          :loading="busyKey === `apply-${tool}-${credential.id}`"
                          :disabled="isCredentialApplied(tool, credential)"
                          @click="handleApply(tool, credential.id)"
                        >
                          应用到本地
                        </n-button>
                        <n-button
                          size="small"
                          quaternary
                          :loading="busyKey === `delete-${tool}-${credential.id}`"
                          @click="handleDelete(tool, credential.id)"
                        >
                          删除
                        </n-button>
                      </div>
                    </div>

                    <div class="credential-meta">
                      <div class="meta-item">
                        <span class="meta-label">Token</span>
                        <span class="meta-value">{{ credential.tokenPreview || '-' }}</span>
                      </div>
                      <div class="meta-item">
                        <span class="meta-label">Email</span>
                        <span class="meta-value">{{ credential.accountEmail || '-' }}</span>
                      </div>
                      <div class="meta-item">
                        <span class="meta-label">Account ID</span>
                        <span class="meta-value">{{ credential.accountId || '-' }}</span>
                      </div>
                      <div class="meta-item">
                        <span class="meta-label">Refresh_time</span>
                        <span class="meta-value">{{ formatTime(credential.expiresAt) }}</span>
                      </div>
                    </div>

                  </n-card>
                </div>
              </div>
            </n-tab-pane>
          </n-tabs>
        </n-spin>
      </div>
    </n-drawer-content>
  </n-drawer>

  <n-modal
    v-model:show="showImportModal"
    preset="card"
    title="手动导入 OAuth 凭证"
    style="width: 720px; max-width: 92vw;"
  >
    <div class="import-modal">
      <div class="import-tool">{{ toolLabels[importTool] }}</div>
      <n-input
        v-model:value="importName"
        placeholder="可选：凭证名称，留空则自动生成"
      />
      <n-upload
        accept=".json"
        :show-file-list="false"
        :custom-request="handleFileUpload"
      >
        <n-upload-dragger style="padding: 12px 0;">
          <div style="display:flex;align-items:center;justify-content:center;gap:8px;">
            <n-icon size="18"><DocumentOutline /></n-icon>
            <span style="font-size:13px;">上传 JSON 文件（如 auth.json），或直接在下方粘贴</span>
          </div>
        </n-upload-dragger>
      </n-upload>
      <n-input
        v-model:value="importRaw"
        type="textarea"
        :rows="10"
        placeholder="粘贴 token JSON、auth.json 片段或该工具原生 OAuth 结构"
      />
      <div class="import-hint">
        Claude 支持 `claudeAiOauth`/token JSON，Codex 支持 `auth.json`，Gemini 支持 `access_token` 或 `token` 结构，OpenCode 支持 `providerId + oauth` 或 `auth.json` 片段。
      </div>
    </div>
    <template #footer>
      <n-space justify="end">
        <n-button @click="closeImportModal">取消</n-button>
        <n-button type="primary" :loading="busyKey === `import-${importTool}`" @click="handleImport">
          导入
        </n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NDrawer,
  NDrawerContent,
  NEmpty,
  NIcon,
  NInput,
  NModal,
  NSpace,
  NSpin,
  NTabPane,
  NTabs,
  NTag,
  NUpload,
  NUploadDragger
} from 'naive-ui'
import { KeyOutline, DocumentOutline } from '@vicons/ionicons5'
import { useResponsiveDrawer } from '../composables/useResponsiveDrawer'
import message from '../utils/message'
import {
  applyOAuthCredential,
  deleteOAuthCredential,
  getOAuthCredentialSummaries,
  importOAuthCredential,
  setDefaultOAuthCredential,
  syncLocalOAuthCredential
} from '../api/oauth-credentials'

const props = defineProps({
  visible: { type: Boolean, default: false }
})

const emit = defineEmits(['update:visible'])

const { drawerWidth } = useResponsiveDrawer(760, 520)

const visible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value)
})

const toolOrder = ['claude', 'codex', 'gemini', 'opencode']
const toolLabels = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  opencode: 'OpenCode'
}

const currentTool = ref('claude')
const loading = ref(false)
const busyKey = ref('')
const summaries = ref({})

const showImportModal = ref(false)
const importTool = ref('claude')
const importName = ref('')
const importRaw = ref('')

watch(() => props.visible, (value) => {
  if (value) {
    loadSummaries()
  }
})

function getSummary(tool) {
  return summaries.value?.[tool] || null
}

function getSortedCredentials(tool) {
  const credentials = getSummary(tool)?.credentials || []
  return [...credentials].sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0))
}

function isCredentialApplied(tool, credential) {
  const nativeState = getSummary(tool)?.nativeState
  const nativeCredential = nativeState?.nativeCredential
  if (!nativeState?.oauthPresent || nativeState?.mode !== 'oauth' || !nativeCredential) {
    return false
  }

  const sameToken = nativeCredential.tokenPreview && credential.tokenPreview
    ? nativeCredential.tokenPreview === credential.tokenPreview
    : false

  const sameProvider = !nativeCredential.providerId || !credential.providerId
    ? true
    : nativeCredential.providerId === credential.providerId

  const sameAccountId = !nativeCredential.accountId || !credential.accountId
    ? true
    : nativeCredential.accountId === credential.accountId

  const sameAccountEmail = !nativeCredential.accountEmail || !credential.accountEmail
    ? true
    : nativeCredential.accountEmail === credential.accountEmail

  return sameToken && sameProvider && sameAccountId && sameAccountEmail
}

function modeLabel(mode) {
  if (mode === 'oauth') return 'OAuth 控制'
  if (mode === 'proxy') return '动态切换'
  if (mode === 'channel') return '渠道控制'
  return '未接管'
}

function modeTagType(mode) {
  if (mode === 'oauth') return 'success'
  if (mode === 'proxy') return 'warning'
  if (mode === 'channel') return 'info'
  return 'default'
}

function sourceLabel(source) {
  if (source === 'synced-local') return '同步本地'
  if (source === 'manual') return '手动导入'
  return source || '-'
}

function nativeStorageLabel(storage) {
  const value = String(storage || '').trim()
  if (!value) return '未检测'
  if (value === 'keychain') return 'Keychain'
  if (value === 'file') return '凭证文件'
  if (value === 'auth-file') return 'auth.json'
  if (value === 'settings-env') return 'settings.env'
  if (value === 'encrypted-file') return '加密文件'
  if (value === 'legacy-file') return '旧文件'
  if (value === 'plaintext-file') return '明文文件'
  if (value === 'auth-file+keychain') return 'auth.json + keyring'
  if (value === 'encrypted-file+keychain') return '加密文件 + keyring'
  return value
}

function isExpired(expiresAt) {
  if (!expiresAt) return false
  const value = Number(expiresAt)
  if (Number.isFinite(value) && value > 0) {
    return value < Date.now()
  }
  const parsed = Date.parse(expiresAt)
  return Number.isFinite(parsed) && parsed < Date.now()
}

function formatTime(value) {
  if (!value) return '-'
  const numeric = Number(value)
  const timestamp = Number.isFinite(numeric) && numeric > 0
    ? numeric
    : Date.parse(value)

  if (!Number.isFinite(timestamp)) return String(value)
  return new Date(timestamp).toLocaleString()
}

async function loadSummaries() {
  loading.value = true
  try {
    const result = await getOAuthCredentialSummaries()
    summaries.value = result.tools || {}
  } catch (error) {
    console.error('加载 OAuth 凭证失败:', error)
    message.error('加载 OAuth 凭证失败: ' + (error.message || '未知错误'))
  } finally {
    loading.value = false
  }
}

async function withBusy(key, action) {
  busyKey.value = key
  try {
    await action()
  } catch (error) {
    const msg = error?.response?.data?.error || error?.message || '操作失败'
    message.error(msg)
  } finally {
    busyKey.value = ''
  }
}

function handleFileUpload({ file, onFinish, onError }) {
  const reader = new FileReader()
  reader.onload = (e) => {
    importRaw.value = e.target.result
    onFinish()
  }
  reader.onerror = onError
  reader.readAsText(file.file)
}

function openImportModal(tool) {
  importTool.value = tool
  importName.value = ''
  importRaw.value = ''
  showImportModal.value = true
}

function closeImportModal() {
  showImportModal.value = false
  importName.value = ''
  importRaw.value = ''
}

async function handleImport() {
  if (!importRaw.value.trim()) {
    message.warning('请先粘贴 OAuth 内容')
    return
  }

  await withBusy(`import-${importTool.value}`, async () => {
    const result = await importOAuthCredential(importTool.value, {
      name: importName.value,
      raw: importRaw.value
    })
    summaries.value[importTool.value] = result.summary
    message.success('OAuth 凭证导入成功')
    closeImportModal()
  })
}

async function handleSyncLocal(tool) {
  await withBusy(`sync-${tool}`, async () => {
    const result = await syncLocalOAuthCredential(tool)
    summaries.value[tool] = result.summary || result.tools?.[tool]
    const syncedCount = Array.isArray(result.credentials) ? result.credentials.length : 0
    if (syncedCount > 1) {
      message.success(`${toolLabels[tool]} 本地 OAuth 已同步 ${syncedCount} 条凭证`)
      return
    }
    message.success(`${toolLabels[tool]} 本地 OAuth 已同步`)
  })
}

async function handleSetDefault(tool, credentialId) {
  await withBusy(`default-${tool}-${credentialId}`, async () => {
    const result = await setDefaultOAuthCredential(tool, credentialId)
    summaries.value[tool] = result.summary
    message.success(`${toolLabels[tool]} 默认凭证已更新`)
  })
}

async function handleApply(tool, credentialId) {
  await withBusy(`apply-${tool}-${credentialId}`, async () => {
    const result = await applyOAuthCredential(tool, credentialId)
    summaries.value[tool] = result.toolSummary
    message.success(result.message || `${toolLabels[tool]} 已切换到 OAuth 控制`)
    window.dispatchEvent(new CustomEvent('channel-management-refresh', { detail: { channel: tool } }))
  })
}

async function handleDelete(tool, credentialId) {
  const confirmed = window.confirm('删除后不会自动清理本地原生配置，确认删除该凭证吗？')
  if (!confirmed) {
    return
  }

  await withBusy(`delete-${tool}-${credentialId}`, async () => {
    const result = await deleteOAuthCredential(tool, credentialId)
    summaries.value[tool] = result.summary
    message.success('OAuth 凭证已删除')
  })
}


</script>

<style scoped>
.drawer-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
}

.oauth-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.toolbar {
  display: flex;
  justify-content: flex-end;
}

.tool-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.state-card {
  border-radius: 12px;
}

.state-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.state-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.state-storage {
  font-size: 12px;
  color: var(--text-color-3);
}

.state-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.state-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.state-label,
.meta-label {
  font-size: 12px;
  color: var(--text-color-3);
}

.state-value,
.meta-value {
  font-size: 13px;
  color: var(--text-color-1);
  word-break: break-all;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
}

.section-desc {
  font-size: 12px;
  color: var(--text-color-3);
}

.credential-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.credential-card {
  border-radius: 12px;
  transition: opacity 0.2s;
}

.credential-card--active {
  opacity: 1;
}

.credential-card--inactive {
  opacity: 0.5;
}

.credential-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.credential-main {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.credential-name {
  font-size: 14px;
  font-weight: 600;
}

.credential-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.credential-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.credential-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 14px;
}

.meta-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.import-modal {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.import-tool {
  font-size: 13px;
  font-weight: 600;
  color: var(--primary-color);
}

.import-hint {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-color-3);
}

@media (max-width: 768px) {
  .toolbar {
    justify-content: stretch;
  }

  .toolbar :deep(.n-space) {
    width: 100%;
  }

  .toolbar :deep(.n-button) {
    flex: 1;
  }

  .state-grid,
  .credential-meta {
    grid-template-columns: 1fr;
  }

  .credential-top {
    flex-direction: column;
  }

  .credential-actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
