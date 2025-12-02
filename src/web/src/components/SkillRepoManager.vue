<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    title="仓库管理"
    :bordered="false"
    :closable="true"
    style="width: 480px; max-width: 90vw;"
    @close="handleClose"
  >
    <div class="repo-manager">
      <!-- 仓库列表 -->
      <div class="repo-list">
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
            @click="handleRemove(repo)"
          >
            删除
          </n-button>
        </div>

        <div v-if="repos.length === 0" class="empty-hint">
          暂无仓库，请添加
        </div>
      </div>

      <!-- 添加仓库 -->
      <div class="add-repo">
        <div class="add-title">添加仓库</div>
        <div class="add-form">
          <n-input
            v-model:value="newRepo.input"
            placeholder="owner/repo"
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
            @click="handleAdd"
          >
            添加
          </n-button>
        </div>
        <div class="add-hint">
          格式: owner/repo，例如 anthropics/skills
        </div>
      </div>

      <!-- 提示信息 -->
      <div class="tips">
        <n-alert type="info" :bordered="false" size="small">
          添加仓库后，系统会从 GitHub 获取技能列表。如果网络较慢，请耐心等待或使用代理。
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
import { NModal, NButton, NInput, NSwitch, NTag, NIcon, NAlert } from 'naive-ui'
import { AddOutline } from '@vicons/ionicons5'
import { getSkillRepos, addSkillRepo, removeSkillRepo, toggleSkillRepo } from '../api/skills'
import message from '../utils/message'

const props = defineProps({
  visible: Boolean
})

const emit = defineEmits(['update:visible', 'updated'])

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

const repos = ref([])
const adding = ref(false)
const newRepo = ref({
  input: '',
  branch: 'main'
})

const recommendedRepos = [
  { owner: 'anthropics', name: 'skills', description: '官方技能库', branch: 'main' },
  { owner: 'ComposioHQ', name: 'awesome-claude-skills', description: '社区精选', branch: 'master' },
  { owner: 'cexll', name: 'myclaude', description: '多智能体工作流', branch: 'master' }
]

const canAdd = computed(() => {
  const input = newRepo.value.input.trim()
  if (!input) return false
  const parts = input.split('/')
  return parts.length === 2 && parts[0] && parts[1]
})

async function loadRepos() {
  try {
    const result = await getSkillRepos()
    if (result.success) {
      repos.value = result.repos || []
    }
  } catch (err) {
    console.error('Load repos error:', err)
  }
}

async function handleAdd() {
  if (!canAdd.value) return

  const input = newRepo.value.input.trim()
  const [owner, name] = input.split('/')

  adding.value = true
  try {
    const result = await addSkillRepo({
      owner,
      name,
      branch: newRepo.value.branch || 'main',
      enabled: true
    })

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
    const result = await removeSkillRepo(repo.owner, repo.name)
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
    const result = await toggleSkillRepo(repo.owner, repo.name, enabled)
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
    const result = await addSkillRepo({
      owner: rec.owner,
      name: rec.name,
      branch: rec.branch,
      enabled: true
    })

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
