<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    title="技能仓库管理"
    :bordered="false"
    :closable="true"
    style="width: 480px; max-width: 90vw;"
    @close="handleClose"
  >
    <div class="repo-manager">
      <!-- 仓库列表 -->
      <div class="repo-list">
        <n-spin :show="loadingRepos">
          <div
            v-for="repo in repos"
            :key="repo.id || `${repo.owner}/${repo.name}/${repo.directory || ''}`"
            class="repo-item"
          >
            <div class="repo-main">
              <n-switch
                :value="repo.enabled"
                size="small"
                @update:value="(val) => handleToggle(repo, val)"
              />
              <div class="repo-info">
                <div class="repo-name">{{ getRepoLabel(repo) }}</div>
                <div class="repo-branch">{{ getRepoSubtitle(repo) }}</div>
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
            placeholder="GitHub/GitLab 仓库地址，或本地路径"
            size="small"
            class="repo-input"
            @keyup.enter="handleAdd"
          />
          <n-input
            v-model:value="newRepo.branch"
            placeholder="分支（本地可忽略）"
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
          支持 GitHub、GitLab 和本地仓库路径；私有 GitLab 仓库请先配置 Token。
        </n-alert>
      </div>

      <!-- 推荐仓库 -->
      <div class="recommended">
        <div class="recommended-title">推荐仓库</div>
        <div class="recommended-list">
          <div
            v-for="rec in recommendedRepos"
            :key="rec.id || `${rec.owner}/${rec.name}/${rec.directory || ''}`"
            class="recommended-item"
            :class="{ added: isRepoAdded(rec) }"
            @click="!isRepoAdded(rec) && quickAdd(rec)"
          >
            <div class="rec-info">
              <span class="rec-name">{{ getRepoLabel(rec) }}</span>
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
import { AddOutline } from '@vicons/ionicons5'
import { getSkillRepos, addSkillRepo, removeSkillRepo, toggleSkillRepo } from '../api/skills'
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
const newRepo = ref({
  input: '',
  branch: 'main'
})

const recommendedRepos = computed(() => {
  if (props.platform === 'codex') {
    return [
      { provider: 'github', owner: 'openai', name: 'skills', description: 'Codex 官方技能库', branch: 'main', directory: 'skills/.curated' }
    ]
  }
  if (props.platform === 'opencode') {
    return [
      { provider: 'github', owner: 'Shakudo-io', name: 'opencode-skills', description: 'OpenCode 官方技能库（46个技能）', branch: 'main', directory: '' }
    ]
  }
  if (props.platform === 'gemini') {
    return [
      { provider: 'github', owner: 'google-gemini', name: 'gemini-cli', description: 'Gemini 官方技能库', branch: 'main', directory: '.gemini/skills' }
    ]
  }
  return [
    { provider: 'github', owner: 'anthropics', name: 'skills', description: '官方技能库', branch: 'main' },
    { provider: 'github', owner: 'ComposioHQ', name: 'awesome-claude-skills', description: '社区精选', branch: 'master' },
    { provider: 'github', owner: 'cexll', name: 'myclaude', description: '多智能体工作流', branch: 'master' }
  ]
})

function isLikelyLocalPath(input) {
  return /^(\/|~\/|\.\/|\.\.\/|[a-zA-Z]:[\\/]|file:\/\/)/.test(input)
}

function normalizeDirectory(directory = '') {
  return String(directory || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
}

function buildRepoIdentity(repo) {
  const provider = repo.provider || (repo.localPath ? 'local' : (repo.projectPath ? 'gitlab' : 'github'))
  const directory = normalizeDirectory(repo.directory)
  const branch = repo.branch || 'main'
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
    if (repo.host) {
      parts.push(repo.host.replace(/^https?:\/\//, ''))
    }
  } else {
    parts.push('GitHub')
  }
  if (repo.branch) parts.push(repo.branch)
  if (repo.directory) parts.push(`目录: ${repo.directory}`)
  return parts.join(' · ')
}

function parseRepoInput(input) {
  const value = input.trim()
  if (!value) return null

  if (isLikelyLocalPath(value)) {
    return {
      provider: 'local',
      localPath: value
    }
  }

  const sshMatch = value.match(/^git@([^:]+):(.+?)(?:\.git)?$/i)
  if (sshMatch) {
    const host = `https://${sshMatch[1]}`
    const projectPath = sshMatch[2].replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '')
    const provider = sshMatch[1].includes('github') ? 'github' : 'gitlab'
    if (provider === 'gitlab') {
      return { provider, host, projectPath }
    }
    const parts = projectPath.split('/')
    if (parts.length >= 2) {
      return { provider, host, owner: parts[0], name: parts[1] }
    }
  }

  try {
    const parsed = new URL(value)
    const host = `${parsed.protocol}//${parsed.host}`
    const projectPath = parsed.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '')
    if (parsed.hostname.includes('github')) {
      const parts = projectPath.split('/')
      if (parts.length >= 2) {
        return { provider: 'github', host, owner: parts[0], name: parts[1] }
      }
    }
    return { provider: 'gitlab', host, projectPath }
  } catch {
    // noop
  }

  const parts = value.split('/').filter(Boolean)
  if (parts.length === 2) {
    return { provider: 'github', owner: parts[0], name: parts[1] }
  }

  return null
}

const parsedRepoInput = computed(() => parseRepoInput(newRepo.value.input))
const canAdd = computed(() => !!parsedRepoInput.value)

async function loadRepos() {
  loadingRepos.value = true
  try {
    const result = await getSkillRepos(props.platform)
    if (result.success) {
      repos.value = result.repos || []
    }
  } catch (err) {
    message.error('加载仓库失败: ' + err.message)
  } finally {
    loadingRepos.value = false
  }
}

async function handleAdd() {
  if (!canAdd.value) return

  const parsedRepo = parsedRepoInput.value

  adding.value = true
  try {
    const result = await addSkillRepo({
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
    const result = await removeSkillRepo(repo, props.platform)
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
    const result = await toggleSkillRepo(repo, enabled, props.platform)
    if (result.success) {
      repos.value = result.repos
      emit('updated')
    }
  } catch (err) {
    message.error('操作失败: ' + err.message)
  }
}

function isRepoAdded(rec) {
  const identity = buildRepoIdentity(rec)
  return repos.value.some(r => buildRepoIdentity(r) === identity)
}

async function quickAdd(rec) {
  adding.value = true
  try {
    const result = await addSkillRepo({
      ...rec,
      branch: rec.branch || 'main',
      directory: rec.directory || '',
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
