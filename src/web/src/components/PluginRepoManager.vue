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
            :key="`${repo.owner}/${repo.name}`"
            class="repo-item"
          >
            <div class="repo-main">
              <n-switch
                :value="repo.enabled"
                size="small"
                @update:value="(val) => handleToggle(repo, val)"
              />
              <div class="repo-info">
                <div class="repo-name">{{ repo.owner }}/{{ repo.name }}</div>
                <div class="repo-branch">{{ repo.branch }}</div>
              </div>
            </div>
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
            placeholder="owner/repo 或 GitHub URL"
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
          格式: owner/repo 或完整 GitHub URL
        </div>
      </div>

      <!-- 提示信息 -->
      <div class="tips">
        <n-alert type="info" :bordered="false" size="small">
          添加仓库后，系统会从 GitHub 获取插件列表。如果网络较慢，请耐心等待或使用代理。
        </n-alert>
      </div>

      <!-- 推荐仓库 -->
      <div class="recommended">
        <div class="recommended-title">推荐仓库</div>
        <div class="recommended-list">
          <div
            v-for="rec in recommendedRepos"
            :key="`${rec.owner}/${rec.name}`"
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
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { NModal, NButton, NInput, NSwitch, NTag, NIcon, NAlert, NSpin } from 'naive-ui'
import { AddOutline, SyncOutline } from '@vicons/ionicons5'
import { getPluginRepos, addPluginRepo, removePluginRepo, togglePluginRepo, syncPluginRepos } from '../api/plugins'
import message from '../utils/message'

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
const newRepo = ref({
  input: '',
  branch: 'main'
})

const recommendedRepos = computed(() => {
  if (props.platform === 'opencode') {
    return [
      { owner: 'awesome-opencode', name: 'awesome-opencode', url: 'https://github.com/awesome-opencode/awesome-opencode', description: 'OpenCode 生态聚合', branch: 'main' },
      { owner: 'sst', name: 'opencode', url: 'https://github.com/sst/opencode', description: 'OpenCode 官方仓库', branch: 'dev' }
    ]
  }
  return [
    { owner: 'anthropics', name: 'claude-plugins-official', url: 'https://github.com/anthropics/claude-plugins-official', description: '官方插件库', branch: 'main' }
  ]
})

const canAdd = computed(() => {
  const input = newRepo.value.input.trim()
  if (!input) return false

  // Support both URL format and owner/repo format
  if (input.includes('github.com')) {
    return input.match(/github\.com\/([^\/]+)\/([^\/\.]+)/)
  }

  const parts = input.split('/')
  return parts.length === 2 && parts[0] && parts[1]
})

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

  const input = newRepo.value.input.trim()
  let owner, name, url

  // Parse URL format
  if (input.includes('github.com')) {
    const match = input.match(/github\.com\/([^\/]+)\/([^\/\.]+)/)
    if (match) {
      owner = match[1]
      name = match[2]
      url = input
    }
  } else {
    // Parse owner/repo format
    const parts = input.split('/')
    owner = parts[0]
    name = parts[1]
    url = `https://github.com/${owner}/${name}`
  }

  adding.value = true
  try {
    const result = await addPluginRepo({
      owner,
      name,
      url,
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
    const result = await removePluginRepo(repo.owner, repo.name, props.platform)
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
    const result = await togglePluginRepo(repo.owner, repo.name, enabled, props.platform)
    if (result.success) {
      repos.value = result.repos
      emit('updated')
    }
  } catch (err) {
    message.error('操作失败: ' + err.message)
  }
}

function isRepoAdded(rec) {
  return repos.value.some(r => r.owner === rec.owner && r.name === rec.name)
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
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--bg-tertiary);
  border-radius: 6px;
}

.repo-main {
  display: flex;
  align-items: center;
  gap: 10px;
}

.repo-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
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
</style>
