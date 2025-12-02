<template>
  <div class="skills-panel" :class="{ 'in-drawer': props.inDrawer }">
    <!-- 头部 -->
    <div class="panel-header" v-if="!props.inDrawer">
      <div class="header-left">
        <n-button v-if="!props.hideBack" text @click="handleBack" class="back-btn">
          <template #icon>
            <n-icon><ArrowBackOutline /></n-icon>
          </template>
        </n-button>
        <span class="panel-title">Skills 技能管理</span>
        <n-tag type="info" size="small" :bordered="false">
          {{ installedCount }}/{{ skills.length }}
        </n-tag>
      </div>
      <div class="header-right">
        <n-button text @click="showCreateModal = true" class="action-btn">
          <template #icon>
            <n-icon><AddOutline /></n-icon>
          </template>
          创建
        </n-button>
        <n-button text @click="showRepoManager = true" class="action-btn">
          <template #icon>
            <n-icon><GitBranchOutline /></n-icon>
          </template>
          仓库
        </n-button>
        <n-button text @click="handleRefresh" :loading="loading" class="action-btn">
          <template #icon>
            <n-icon><RefreshOutline /></n-icon>
          </template>
          刷新
        </n-button>
      </div>
    </div>

    <!-- Drawer 模式下的简化头部 -->
    <div class="drawer-header-bar" v-if="props.inDrawer">
      <div class="header-left">
        <n-tag type="info" size="small" :bordered="false">
          {{ installedCount }}/{{ skills.length }}
        </n-tag>
      </div>
      <div class="header-right">
        <n-button text @click="showCreateModal = true" class="action-btn">
          <template #icon>
            <n-icon><AddOutline /></n-icon>
          </template>
          创建
        </n-button>
        <n-button text @click="showRepoManager = true" class="action-btn">
          <template #icon>
            <n-icon><GitBranchOutline /></n-icon>
          </template>
          仓库
        </n-button>
        <n-button text @click="handleRefresh" :loading="loading" class="action-btn">
          <template #icon>
            <n-icon><RefreshOutline /></n-icon>
          </template>
          刷新
        </n-button>
      </div>
    </div>

    <!-- 搜索和筛选 -->
    <div class="filter-bar">
      <n-input
        v-model:value="searchQuery"
        placeholder="搜索技能..."
        clearable
        size="small"
        class="search-input"
      >
        <template #prefix>
          <n-icon><SearchOutline /></n-icon>
        </template>
      </n-input>
      <n-select
        v-model:value="filterStatus"
        :options="filterOptions"
        size="small"
        class="filter-select"
      />
    </div>

    <!-- 技能列表 -->
    <div class="skills-content">
      <n-spin :show="loading">
        <div v-if="filteredSkills.length === 0 && !loading" class="empty-state">
          <n-empty :description="emptyText">
            <template #icon>
              <n-icon size="48" color="var(--text-quaternary)">
                <ExtensionPuzzleOutline />
              </n-icon>
            </template>
            <template #extra>
              <n-button size="small" @click="showRepoManager = true" v-if="skills.length === 0">
                配置仓库源
              </n-button>
            </template>
          </n-empty>
        </div>

        <div v-else class="skills-grid">
          <SkillCard
            v-for="skill in filteredSkills"
            :key="skill.key"
            :skill="skill"
            :installing="!!installingKeys[skill.key]"
            :uninstalling="!!uninstallingKeys[skill.key]"
            @install="handleInstall"
            @uninstall="handleUninstall"
            @click="handleCardClick"
          />
        </div>
      </n-spin>
    </div>

    <!-- 提示信息 -->
    <div class="panel-footer">
      <n-icon size="14" class="info-icon"><InformationCircleOutline /></n-icon>
      <span>安装/卸载后需重启 Claude Code 生效</span>
    </div>

    <!-- 仓库管理弹窗 -->
    <SkillRepoManager
      v-model:visible="showRepoManager"
      @updated="loadSkills"
    />

    <!-- 创建技能弹窗 -->
    <SkillCreateModal
      v-model:visible="showCreateModal"
      @created="loadSkills"
    />

    <!-- 技能详情弹窗 -->
    <SkillDetailModal
      v-model:visible="showDetailModal"
      :skill="selectedSkill"
      @updated="loadSkills"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { NButton, NInput, NSelect, NIcon, NTag, NSpin, NEmpty } from 'naive-ui'
import {
  ArrowBackOutline,
  GitBranchOutline,
  RefreshOutline,
  SearchOutline,
  InformationCircleOutline,
  AddOutline,
  ExtensionPuzzleOutline
} from '@vicons/ionicons5'
import { getSkills, installSkill, uninstallSkill } from '../api/skills'
import message from '../utils/message'
import SkillCard from './SkillCard.vue'
import SkillRepoManager from './SkillRepoManager.vue'
import SkillCreateModal from './SkillCreateModal.vue'
import SkillDetailModal from './SkillDetailModal.vue'

const props = defineProps({
  hideBack: {
    type: Boolean,
    default: false
  },
  inDrawer: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['back', 'updated'])

const skills = ref([])
const loading = ref(false)
const searchQuery = ref('')
const filterStatus = ref('all')
const showRepoManager = ref(false)
const showCreateModal = ref(false)
const showDetailModal = ref(false)
const selectedSkill = ref(null)
const installingKeys = ref({})  // 正在安装的技能 key -> true
const uninstallingKeys = ref({})  // 正在卸载的技能 key -> true

const filterOptions = [
  { label: '全部', value: 'all' },
  { label: '已安装', value: 'installed' },
  { label: '未安装', value: 'uninstalled' }
]

const installedCount = computed(() => skills.value.filter(s => s.installed).length)

const filteredSkills = computed(() => {
  let result = skills.value

  // 按状态筛选
  if (filterStatus.value === 'installed') {
    result = result.filter(s => s.installed)
  } else if (filterStatus.value === 'uninstalled') {
    result = result.filter(s => !s.installed)
  }

  // 按搜索词筛选
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase()
    result = result.filter(s =>
      s.name?.toLowerCase().includes(query) ||
      s.description?.toLowerCase().includes(query) ||
      s.directory?.toLowerCase().includes(query)
    )
  }

  // 已安装的排在前面
  result = [...result].sort((a, b) => {
    if (a.installed && !b.installed) return -1
    if (!a.installed && b.installed) return 1
    return 0
  })

  return result
})

const emptyText = computed(() => {
  if (searchQuery.value) return '没有匹配的技能'
  if (filterStatus.value === 'installed') return '暂无已安装的技能'
  if (filterStatus.value === 'uninstalled') return '所有技能都已安装'
  return '暂无可用技能，请配置仓库源'
})

async function loadSkills(forceRefresh = false) {
  loading.value = true
  try {
    const result = await getSkills(forceRefresh)
    if (result.success) {
      skills.value = result.skills || []
    }
  } catch (err) {
    message.error('加载技能列表失败: ' + err.message)
  } finally {
    loading.value = false
  }
}

// 强制刷新（用于刷新按钮）
function handleRefresh() {
  loadSkills(true)
}

async function handleInstall(skill) {
  if (!skill.repoOwner || !skill.repoName) {
    message.error('缺少仓库信息，无法安装')
    return
  }

  installingKeys.value[skill.key] = true
  try {
    const result = await installSkill(skill.directory, {
      owner: skill.repoOwner,
      name: skill.repoName,
      branch: skill.repoBranch || 'main'
    })

    if (result.success) {
      message.success(`技能 "${skill.name}" 安装成功`)
      // 重新加载列表以确保与后端同步
      await loadSkills(true)
      // 通知父组件更新
      emit('updated')
    }
  } catch (err) {
    message.error('安装失败: ' + err.message)
  } finally {
    delete installingKeys.value[skill.key]
  }
}

async function handleUninstall(skill) {
  uninstallingKeys.value[skill.key] = true
  try {
    const result = await uninstallSkill(skill.directory)

    if (result.success) {
      message.success(`技能 "${skill.name}" 已卸载`)
      // 重新加载列表以确保与后端同步
      await loadSkills(true)
      // 通知父组件更新
      emit('updated')
    }
  } catch (err) {
    message.error('卸载失败: ' + err.message)
  } finally {
    delete uninstallingKeys.value[skill.key]
  }
}

function handleCardClick(skill) {
  selectedSkill.value = skill
  showDetailModal.value = true
}

function handleBack() {
  emit('back')
}

onMounted(() => {
  loadSkills()
})
</script>

<style scoped>
.skills-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-primary);
  background: var(--bg-secondary);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.back-btn {
  padding: 4px;
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.action-btn {
  font-size: 12px;
  padding: 4px 8px;
}

.filter-bar {
  display: flex;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-primary);
}

.search-input {
  flex: 1;
}

.filter-select {
  width: 100px;
}

.skills-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

/* loading 时居中显示 */
.skills-content :deep(.n-spin-container) {
  min-height: 300px;
}

.skills-content :deep(.n-spin-container.n-spin-container--spinning) {
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
}

.skills-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.panel-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  font-size: 11px;
  color: var(--text-tertiary);
  border-top: 1px solid var(--border-primary);
  background: var(--bg-secondary);
}

.info-icon {
  color: var(--text-quaternary);
}

/* Drawer 模式样式 */
.skills-panel.in-drawer {
  height: 100%;
}

.drawer-header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-primary);
  background: var(--bg-secondary);
}

.skills-panel.in-drawer .filter-bar {
  padding: 10px 12px;
}

.skills-panel.in-drawer .skills-content {
  padding: 12px;
}

.skills-panel.in-drawer .panel-footer {
  padding: 8px 12px;
}
</style>
