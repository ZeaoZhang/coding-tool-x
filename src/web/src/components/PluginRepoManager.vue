<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    title="插件仓库管理"
    :bordered="false"
    :closable="true"
    style="width: 480px; max-width: 90vw;"
    @close="handleClose"
  >
    <template #header-extra>
      <n-button type="primary" size="small" :loading="syncing" :focusable="false" @click="handleSync">
        <template #icon><n-icon><SyncOutline /></n-icon></template>
        同步
      </n-button>
    </template>
    <div class="repo-manager">
      <!-- 仓库列表 -->
      <div class="repo-list">
        <n-spin :show="loadingRepos">
          <div
            v-for="repo in repos"
            :key="repo.id || `${repo.owner}/${repo.name}/${repo.localPath || ''}`"
            class="repo-item"
          >
            <div class="repo-main">
              <n-switch
                :value="repo.enabled"
                size="small"
                @update:value="(val) => handleToggle(repo, val)"
              />
              <div class="repo-info">
                <div class="repo-name-row">
                  <div class="repo-name">{{ getRepoLabel(repo) }}</div>
                  <n-tag
                    v-if="supportsRepoAuth(repo)"
                    size="tiny"
                    :type="repo.hasToken ? 'success' : 'default'"
                    :bordered="false"
                  >
                    {{ repo.hasToken ? '已配 Token' : '未配 Token' }}
                  </n-tag>
                </div>
                <div class="repo-branch">{{ getRepoSubtitle(repo) }}</div>
                <div v-if="supportsRepoAuth(repo)" class="repo-auth-hint">
                  {{ getRepoAuthSummary(repo) }}
                </div>
              </div>
            </div>
            <div class="repo-actions">
              <n-button
                v-if="supportsRepoAuth(repo)"
                text
                type="primary"
                size="tiny"
                :focusable="false"
                @click="openAuthModal(repo)"
              >
                认证
              </n-button>
              <n-button
                text
                type="error"
                size="tiny"
                :focusable="false"
                @click="handleRemove(repo)"
              >
                删除
              </n-button>
            </div>
          </div>

          <div v-if="repos.length === 0" class="empty-hint">
            暂无仓库，请添加
          </div>
        </n-spin>
      </div>

      <!-- 添加仓库 -->
      <div class="add-repo">
        <div class="add-title">添加仓库</div>
        <div class="add-form">
          <n-input
            v-model:value="newRepo.input"
            placeholder="GitHub/GitLab 仓库地址，或本地路径"
            size="small"
            class="repo-input"
            @keyup.enter="handleAdd"
          />
          <n-input
            v-model:value="newRepo.branch"
            placeholder="分支"
            size="small"
            class="branch-input"
          />
          <n-button
            type="primary"
            size="small"
            :disabled="!canAdd"
            :loading="adding"
            :focusable="false"
            @click="handleAdd"
          >
            添加
          </n-button>
        </div>
        <div class="add-hint">
          支持 `owner/repo`、GitHub/GitLab URL 或 SSH、以及本地路径
        </div>
      </div>

      <!-- 提示信息 -->
      <div class="tips">
        <n-alert type="info" :bordered="false" size="small">
          支持 GitHub、GitLab 和本地仓库路径；远程仓库可按仓库单独配置 Token。
        </n-alert>
      </div>

      <!-- 推荐仓库 -->
      <div v-if="recommendedRepos.length > 0" class="recommended">
        <div class="recommended-title">推荐仓库</div>
        <div class="recommended-list">
          <div
            v-for="rec in recommendedRepos"
            :key="rec.url || `${rec.owner}/${rec.name}`"
            class="recommended-item"
            :class="{ added: isRepoAdded(rec) }"
            @click="!isRepoAdded(rec) && quickAdd(rec)"
          >
            <div class="rec-info">
              <span class="rec-name">{{ rec.owner }}/{{ rec.name }}</span>
              <span class="rec-desc">{{ rec.description }}</span>
            </div>
            <n-tag v-if="isRepoAdded(rec)" size="tiny" type="success" :bordered="false">
              已添加
            </n-tag>
            <n-icon v-else class="add-icon"><AddOutline /></n-icon>
          </div>
        </div>
      </div>
    </div>
  </n-modal>

  <n-modal
    v-model:show="authModalVisible"
    preset="card"
    :title="authModalTitle"
    :bordered="false"
    style="width: 460px; max-width: 92vw;"
    @close="handleAuthClose"
  >
    <div v-if="selectedAuthRepo" class="auth-manager">
      <n-alert type="info" :bordered="false" size="small">
        {{ getRepoAuthHelp(selectedAuthRepo) }}
      </n-alert>

      <div class="auth-meta">
        <div class="auth-meta-row">
          <span class="auth-label">仓库</span>
          <span class="auth-value">{{ getRepoLabel(selectedAuthRepo) }}</span>
        </div>
        <div class="auth-meta-row">
          <span class="auth-label">来源</span>
          <span class="auth-value">{{ selectedAuthRepo.provider === 'gitlab' ? 'GitLab' : 'GitHub' }}</span>
        </div>
        <div class="auth-meta-row">
          <span class="auth-label">当前状态</span>
          <span class="auth-value">
            {{ selectedAuthRepo.hasToken ? `已配置 ${selectedAuthRepo.tokenPreview || ''}` : '未配置仓库 Token' }}
          </span>
        </div>
      </div>

      <n-input
        v-model:value="authForm.token"
        type="password"
        show-password-on="click"
        clearable
        placeholder="输入此仓库专属 Token"
        @keyup.enter="handleSaveAuth"
      />

      <div class="auth-footnote">
        仓库 Token 会优先于全局环境变量、CLI 登录和系统 Git 凭据。
      </div>

      <div class="auth-actions">
        <n-button :focusable="false" @click="handleAuthClose">
          取消
        </n-button>
        <n-button
          v-if="selectedAuthRepo.hasToken"
          type="warning"
          secondary
          :focusable="false"
          :loading="clearingAuth"
          @click="handleClearAuth"
        >
          清除 Token
        </n-button>
        <n-button
          type="primary"
          :focusable="false"
          :disabled="!authForm.token.trim()"
          :loading="savingAuth"
          @click="handleSaveAuth"
        >
          保存 Token
        </n-button>
      </div>
    </div>
  </n-modal>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { NModal, NButton, NInput, NSwitch, NTag, NIcon, NAlert, NSpin } from 'naive-ui'
import { AddOutline, SyncOutline } from '@vicons/ionicons5'
import { getPluginRepos, addPluginRepo, removePluginRepo, togglePluginRepo, syncPluginRepos, updatePluginRepoAuth } from '../api/plugins'
import message from '../utils/message'
import { parseRepoInput, normalizeDirectory } from '../utils/skill-repo-input'

const props = defineProps({
  visible: Boolean,
  platform: {
    type: String,
    default: 'claude'
  }
})

const emit = defineEmits(['update:visible', 'updated'])

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

const repos = ref([])
const loadingRepos = ref(false)
const adding = ref(false)
const syncing = ref(false)
const authModalVisible = ref(false)
const selectedAuthRepo = ref(null)
const savingAuth = ref(false)
const clearingAuth = ref(false)
const authForm = ref({
  token: ''
})
const newRepo = ref({
  input: '',
  branch: 'main'
})

const authModalTitle = computed(() => {
  if (!selectedAuthRepo.value) return '仓库认证'
  return `${selectedAuthRepo.value.provider === 'gitlab' ? 'GitLab' : 'GitHub'} 仓库认证`
})

const recommendedRepos = computed(() => {
  if (props.platform === 'opencode') {
    return [
      { owner: 'Tommertom', name: 'opencode-plugin-marketplace', url: 'https://github.com/Tommertom/opencode-plugin-marketplace', description: 'OpenCode 插件市场', branch: 'main' },
      { owner: 'avifenesh', name: 'awesome-slash', url: 'https://github.com/avifenesh/awesome-slash', description: 'Awesome Slash 命令集', branch: 'main' },
      { owner: 'NeoLabHQ', name: 'context-engineering-kit', url: 'https://github.com/NeoLabHQ/context-engineering-kit', description: '上下文工程工具包', branch: 'master' },
      { owner: 'awesome-opencode', name: 'awesome-opencode', url: 'https://github.com/awesome-opencode/awesome-opencode', description: 'OpenCode 生态聚合', branch: 'main' },
      { owner: 'sst', name: 'opencode', url: 'https://github.com/sst/opencode', description: 'OpenCode 官方仓库', branch: 'dev' }
    ]
  }
  if (props.platform === 'codex') {
    return []
  }
  return [
    { owner: 'anthropics', name: 'claude-plugins-official', url: 'https://github.com/anthropics/claude-plugins-official', description: '官方插件库', branch: 'main' }
  ]
})

const canAdd = computed(() => {
  return !!parseRepoInput(newRepo.value.input.trim())
})

function buildRepoIdentity(repo) {
  const provider = repo.provider || (repo.localPath ? 'local' : (repo.projectPath ? 'gitlab' : 'github'))
  const branch = repo.branch || 'main'
  const directory = normalizeDirectory(repo.directory)
  if (provider === 'local') {
    return `local:${repo.localPath || ''}::${directory}`
  }
  if (provider === 'gitlab') {
    return `gitlab:${repo.host || 'https://gitlab.com'}::${repo.projectPath || ''}::${branch}::${directory}`
  }
  return `github:${repo.host || 'https://github.com'}::${repo.owner || ''}/${repo.name || ''}::${branch}::${directory}`
}

function getRepoLabel(repo) {
  if (repo.provider === 'local') return repo.localPath || repo.name || '本地仓库'
  if (repo.provider === 'gitlab') return repo.projectPath || [repo.owner, repo.name].filter(Boolean).join('/')
  return [repo.owner, repo.name].filter(Boolean).join('/')
}

function getRepoSubtitle(repo) {
  const parts = []
  if (repo.provider === 'local') {
    parts.push('本地仓库')
  } else if (repo.provider === 'gitlab') {
    parts.push('GitLab')
    if (repo.host) parts.push(repo.host.replace(/^https?:\/\//, ''))
  } else {
    parts.push('GitHub')
  }
  if (repo.branch) parts.push(repo.branch)
  if (repo.directory) parts.push(`目录: ${repo.directory}`)
  return parts.join(' · ')
}

function supportsRepoAuth(repo) {
  return repo?.provider === 'github' || repo?.provider === 'gitlab'
}

function getRepoAuthSummary(repo) {
  if (!supportsRepoAuth(repo)) return ''
  if (repo.hasToken) {
    return `仓库 Token: ${repo.tokenPreview || '已配置'}`
  }
  if (repo.provider === 'gitlab') {
    return '未配置仓库 Token，将回退到全局 Token、glab 或 git credential'
  }
  return '未配置仓库 Token，可选配置后优先用于 GitHub API 访问'
}

function getRepoAuthHelp(repo) {
  if (repo?.provider === 'gitlab') {
    return '私有 GitLab 仓库建议配置仓库级 Private Token；保存后会优先使用当前仓库 Token，再回退到全局环境变量、glab 和 git credential。'
  }
  return 'GitHub 仓库可选配置 Personal Access Token；保存后会优先使用当前仓库 Token，再回退到全局环境变量、gh 和 git credential。'
}

function handleAuthClose() {
  authModalVisible.value = false
  selectedAuthRepo.value = null
  authForm.value.token = ''
  savingAuth.value = false
  clearingAuth.value = false
}

function openAuthModal(repo) {
  if (!supportsRepoAuth(repo)) return
  selectedAuthRepo.value = repo
  authForm.value.token = ''
  authModalVisible.value = true
}

async function loadRepos() {
  loadingRepos.value = true
  try {
    const result = await getPluginRepos(props.platform)
    if (result.success) {
      repos.value = result.repos || []
    }
  } catch (err) {
    message.error('加载仓库失败: ' + err.message)
  } finally {
    loadingRepos.value = false
  }
}

async function handleSync() {
  syncing.value = true
  try {
    const result = await syncPluginRepos(props.platform)
    if (result.success) {
      message.success('仓库同步成功')
      emit('updated')
    }
  } catch (err) {
    message.error('同步失败: ' + err.message)
  } finally {
    syncing.value = false
  }
}

async function handleAdd() {
  if (!canAdd.value) return

  const parsedRepo = parseRepoInput(newRepo.value.input.trim())

  adding.value = true
  try {
    const result = await addPluginRepo({
      ...parsedRepo,
      branch: newRepo.value.branch || 'main',
      enabled: true
    }, props.platform)

    if (result.success) {
      repos.value = result.repos
      newRepo.value.input = ''
      newRepo.value.branch = 'main'
      message.success('仓库添加成功')
      emit('updated')
    }
  } catch (err) {
    message.error('添加失败: ' + err.message)
  } finally {
    adding.value = false
  }
}

async function handleRemove(repo) {
  try {
    const result = await removePluginRepo(repo, props.platform)
    if (result.success) {
      repos.value = result.repos
      message.success('仓库已删除')
      emit('updated')
    }
  } catch (err) {
    message.error('删除失败: ' + err.message)
  }
}

async function handleToggle(repo, enabled) {
  try {
    const result = await togglePluginRepo(repo, enabled, props.platform)
    if (result.success) {
      repos.value = result.repos
      emit('updated')
    }
  } catch (err) {
    message.error('操作失败: ' + err.message)
  }
}

async function handleSaveAuth() {
  const repo = selectedAuthRepo.value
  const token = authForm.value.token.trim()
  if (!repo || !token) return

  savingAuth.value = true
  try {
    const result = await updatePluginRepoAuth(repo, { token }, props.platform)
    if (result.success) {
      repos.value = result.repos || []
      message.success('仓库 Token 已保存')
      emit('updated')
      handleAuthClose()
    }
  } catch (err) {
    message.error('保存 Token 失败: ' + err.message)
  } finally {
    savingAuth.value = false
  }
}

async function handleClearAuth() {
  const repo = selectedAuthRepo.value
  if (!repo) return

  clearingAuth.value = true
  try {
    const result = await updatePluginRepoAuth(repo, { clearToken: true }, props.platform)
    if (result.success) {
      repos.value = result.repos || []
      message.success('仓库 Token 已清除')
      emit('updated')
      handleAuthClose()
    }
  } catch (err) {
    message.error('清除 Token 失败: ' + err.message)
  } finally {
    clearingAuth.value = false
  }
}

function isRepoAdded(rec) {
  const identity = buildRepoIdentity(rec)
  return repos.value.some(r => buildRepoIdentity(r) === identity)
}

async function quickAdd(rec) {
  adding.value = true
  try {
    const result = await addPluginRepo({
      owner: rec.owner,
      name: rec.name,
      url: rec.url,
      branch: rec.branch,
      enabled: true
    }, props.platform)

    if (result.success) {
      repos.value = result.repos
      message.success('仓库添加成功')
      emit('updated')
    }
  } catch (err) {
    message.error('添加失败: ' + err.message)
  } finally {
    adding.value = false
  }
}

function handleClose() {
  handleAuthClose()
  emit('update:visible', false)
}

watch(() => props.visible, (val) => {
  if (val) loadRepos()
})

watch(() => props.platform, () => {
  if (props.visible) loadRepos()
})

onMounted(() => {
  if (props.visible) loadRepos()
})
</script>

<style scoped>
.repo-manager {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.repo-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.repo-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--bg-tertiary);
  border-radius: 6px;
}

.repo-main {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.repo-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.repo-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.repo-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.repo-branch {
  font-size: 11px;
  color: var(--text-tertiary);
}

.repo-auth-hint {
  font-size: 11px;
  color: var(--text-tertiary);
}

.repo-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding-left: 12px;
}

.empty-hint {
  text-align: center;
  padding: 20px;
  color: var(--text-tertiary);
  font-size: 13px;
}

.add-repo {
  padding-top: 8px;
  border-top: 1px solid var(--border-primary);
}

.add-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 10px;
}

.add-form {
  display: flex;
  gap: 8px;
}

.repo-input {
  flex: 1;
}

.branch-input {
  width: 80px;
}

.add-hint {
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.tips {
  padding-top: 8px;
}

.recommended {
  padding-top: 12px;
  border-top: 1px solid var(--border-primary);
}

.recommended-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.recommended-title::before {
  content: '';
  width: 3px;
  height: 14px;
  background: #18a058;
  border-radius: 2px;
}

.recommended-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.recommended-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  background: var(--bg-tertiary);
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s;
}

.recommended-item:not(.added):hover {
  background: var(--bg-secondary);
  box-shadow: 0 2px 8px rgba(24, 160, 88, 0.1);
}

.recommended-item.added {
  cursor: default;
  opacity: 0.6;
  background: var(--bg-secondary);
}

.rec-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.rec-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
}

.rec-desc {
  font-size: 11px;
  color: var(--text-tertiary);
}

.add-icon {
  color: #18a058;
}

.auth-manager {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.auth-meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  background: var(--bg-tertiary);
  border-radius: 8px;
}

.auth-meta-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.auth-label {
  font-size: 12px;
  color: var(--text-tertiary);
}

.auth-value {
  font-size: 12px;
  color: var(--text-primary);
  text-align: right;
  word-break: break-all;
}

.auth-footnote {
  font-size: 11px;
  color: var(--text-tertiary);
}

.auth-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
