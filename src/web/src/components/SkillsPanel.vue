<template>
  <div class="skills-panel" :class="{ 'in-drawer': inDrawer }">
    <!-- 独立模式头部 -->
    <div class="panel-header" v-if="!inDrawer">
      <div class="header-left">
        <n-button v-if="!hideBack" text @click="$emit('back')" class="back-btn">
          <template #icon><n-icon><ArrowBackOutline /></n-icon></template>
        </n-button>
        <span class="panel-title">Skills 技能管理</span>
      </div>
      <div class="header-right">
        <n-button text @click="showCreateModal = true" class="action-btn">
          <template #icon><n-icon><AddOutline /></n-icon></template>
          创建
        </n-button>
        <n-button text @click="showRepoManager = true" class="action-btn">
          <template #icon><n-icon><GitBranchOutline /></n-icon></template>
          仓库
        </n-button>
        <n-button text @click="handleImport" :loading="importing" class="action-btn">
          <template #icon><n-icon><CloudDownloadOutline /></n-icon></template>
          导入
        </n-button>
        <n-button text @click="loadData(true)" :loading="loading" class="action-btn">
          <template #icon><n-icon><RefreshOutline /></n-icon></template>
          刷新
        </n-button>
      </div>
    </div>

    <!-- 抽屉模式头部 -->
    <div class="drawer-header-bar" v-if="inDrawer">
      <div class="header-right">
        <n-button text @click="showCreateModal = true" class="action-btn">
          <template #icon><n-icon><AddOutline /></n-icon></template>
          创建
        </n-button>
        <n-button text @click="showRepoManager = true" class="action-btn">
          <template #icon><n-icon><GitBranchOutline /></n-icon></template>
          仓库
        </n-button>
        <n-button text @click="handleImport" :loading="importing" class="action-btn">
          <template #icon><n-icon><CloudDownloadOutline /></n-icon></template>
          导入
        </n-button>
        <n-button text @click="loadData(true)" :loading="loading" class="action-btn">
          <template #icon><n-icon><RefreshOutline /></n-icon></template>
          刷新
        </n-button>
      </div>
    </div>

    <!-- 统计栏 -->
    <div class="stats-bar">
      <span class="stats-text">
        共 {{ skills.length }} 个技能
        <template v-if="skills.length > 0">
          · 已安装: {{ installedCount }} · 未安装: {{ skills.length - installedCount }}
          <template v-if="managedCount > 0"> · 托管: {{ managedCount }}</template>
        </template>
      </span>
    </div>

    <!-- 搜索筛选 -->
    <div class="filter-bar">
      <n-input v-model:value="searchQuery" placeholder="搜索技能..." clearable size="small" class="search-input">
        <template #prefix><n-icon><SearchOutline /></n-icon></template>
      </n-input>
      <n-select v-model:value="filterStatus" :options="filterOptions" size="small" class="filter-select" />
    </div>

    <!-- 内容区域 -->
    <div class="panel-content">
      <n-spin :show="loading">
        <div v-if="filteredSkills.length === 0 && !loading" class="empty-state">
          <n-empty :description="emptyText">
            <template #icon><n-icon size="48" color="var(--text-quaternary)"><ExtensionPuzzleOutline /></n-icon></template>
            <template #extra>
              <n-button size="small" @click="showRepoManager = true" v-if="skills.length === 0">配置仓库源</n-button>
            </template>
          </n-empty>
        </div>
        <div v-else class="card-list">
          <SkillCard
            v-for="skill in filteredSkills"
            :key="skill.key"
            :skill="skill"
            :installing="!!installingKeys[skill.key]"
            :uninstalling="!!uninstallingKeys[skill.key]"
            :registry-info="registryMap[skill.directory || skill.name]"
            :toggling="!!togglingKeys[skill.directory || skill.name]"
            @install="handleInstall"
            @uninstall="handleUninstall"
            @click="handleCardClick"
            @toggle-enabled="handleToggleEnabled"
            @toggle-platform="handleTogglePlatform"
          />
        </div>
      </n-spin>
    </div>

    <!-- 底部提示 -->
    <div class="panel-footer">
      <n-icon size="14" class="info-icon"><InformationCircleOutline /></n-icon>
      <span>安装/卸载后需重启 {{ currentPlatformLabel }} 生效</span>
    </div>

    <!-- 弹窗组件 -->
    <SkillRepoManager v-model:visible="showRepoManager" :platform="currentPlatform" @updated="loadData" />
    <SkillCreateModal v-model:visible="showCreateModal" :platform="currentPlatform" @created="loadData" />
    <SkillDetailModal v-model:visible="showDetailModal" :skill="selectedSkill" :platform="currentPlatform" @updated="loadData" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { NButton, NIcon, NInput, NSelect, NSpin, NEmpty, useMessage } from 'naive-ui'
import { ArrowBackOutline, AddOutline, GitBranchOutline, RefreshOutline, SearchOutline, ExtensionPuzzleOutline, InformationCircleOutline, CloudDownloadOutline } from '@vicons/ionicons5'
import { getSkills, installSkill, uninstallSkill } from '../api/skills'
import { listItems, importFromClaude, toggleEnabled, togglePlatform } from '../api/config-registry'
import SkillCard from './SkillCard.vue'
import SkillRepoManager from './SkillRepoManager.vue'
import SkillCreateModal from './SkillCreateModal.vue'
import SkillDetailModal from './SkillDetailModal.vue'

const props = defineProps({
  inDrawer: { type: Boolean, default: false },
  hideBack: { type: Boolean, default: false },
  drawerVisible: { type: Boolean, default: false }
})

defineEmits(['back', 'updated'])

const route = useRoute()
const message = useMessage()
const loading = ref(false)
const skills = ref([])
const searchQuery = ref('')
const filterStatus = ref('all')
const showRepoManager = ref(false)
const showCreateModal = ref(false)
const showDetailModal = ref(false)
const selectedSkill = ref(null)
const installingKeys = ref({})
const uninstallingKeys = ref({})
const togglingKeys = ref({})
const registryMap = ref({})
const importing = ref(false)

const currentPlatform = computed(() => {
  const channel = route.meta.channel
  if (channel === 'codex' || channel === 'opencode') return channel
  return 'claude'
})

const currentPlatformLabel = computed(() => {
  const map = {
    claude: 'Claude Code',
    codex: 'Codex CLI',
    opencode: 'OpenCode'
  }
  return map[currentPlatform.value] || 'Claude Code'
})

const filterOptions = [
  { label: '全部', value: 'all' },
  { label: '已安装', value: 'installed' },
  { label: '未安装', value: 'uninstalled' },
  { label: '自定义', value: 'custom' }
]

const installedCount = computed(() => skills.value.filter(s => s.installed).length)
const managedCount = computed(() => Object.keys(registryMap.value).length)

const filteredSkills = computed(() => {
  let result = skills.value
  if (filterStatus.value === 'installed') result = result.filter(s => s.installed)
  else if (filterStatus.value === 'uninstalled') result = result.filter(s => !s.installed)
  else if (filterStatus.value === 'custom') result = result.filter(s => !s.repoOwner)
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(s => s.name?.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q))
  }
  return [...result].sort((a, b) => (a.installed === b.installed ? 0 : a.installed ? -1 : 1))
})

const emptyText = computed(() => {
  if (searchQuery.value) return '没有匹配的技能'
  if (filterStatus.value === 'installed') return '暂无已安装的技能'
  if (filterStatus.value === 'uninstalled') return '所有技能都已安装'
  if (filterStatus.value === 'custom') return '暂无自定义技能'
  return '暂无可用技能，请配置仓库源'
})

async function loadData(force = false) {
  loading.value = true
  try {
    const [skillsRes, registryRes] = await Promise.all([
      getSkills(force, currentPlatform.value),
      listItems('skills')
    ])
    if (skillsRes.success) skills.value = skillsRes.skills || []
    if (registryRes.success) {
      registryMap.value = {}
      for (const [name, item] of Object.entries(registryRes.items || {})) {
        registryMap.value[name] = item
      }
    }
  } catch (err) {
    message.error('加载技能失败: ' + err.message)
  } finally {
    loading.value = false
  }
}

async function handleImport() {
  importing.value = true
  try {
    const res = await importFromClaude('skills')
    if (res.success) {
      message.success(`成功导入 ${res.imported} 个技能`)
      await loadData(true)
    } else {
      message.error(res.message || '导入失败')
    }
  } catch (err) {
    message.error('导入失败: ' + err.message)
  } finally {
    importing.value = false
  }
}

async function handleInstall(skill) {
  if (!skill.repoOwner) return message.error('缺少仓库信息')
  installingKeys.value[skill.key] = true
  try {
    const res = await installSkill(
      skill.directory,
      { owner: skill.repoOwner, name: skill.repoName, branch: skill.repoBranch || 'main' },
      skill.fullDirectory || null,
      currentPlatform.value
    )
    if (res.success) { message.success(`技能 "${skill.name}" 安装成功`); await loadData(true) }
  } catch (err) { message.error('安装失败: ' + err.message) }
  finally { delete installingKeys.value[skill.key] }
}

async function handleUninstall(skill) {
  uninstallingKeys.value[skill.key] = true
  try {
    const res = await uninstallSkill(skill.directory, currentPlatform.value)
    if (res.success) { message.success(`技能 "${skill.name}" 已卸载`); await loadData(true) }
  } catch (err) { message.error('卸载失败: ' + err.message) }
  finally { delete uninstallingKeys.value[skill.key] }
}

async function handleToggleEnabled(skill, enabled) {
  const key = skill.directory || skill.name
  togglingKeys.value[key] = true
  try {
    const res = await toggleEnabled('skills', key, enabled)
    if (res.success) {
      message.success(enabled ? '已启用' : '已禁用')
      await loadData(true)
    }
  } catch (err) {
    message.error('切换失败: ' + err.message)
  } finally {
    delete togglingKeys.value[key]
  }
}

async function handleTogglePlatform(skill, platform, enabled) {
  const key = skill.directory || skill.name
  togglingKeys.value[key] = true
  try {
    const res = await togglePlatform('skills', key, platform, enabled)
    if (res.success) {
      message.success(`${platform} ${enabled ? '已启用' : '已禁用'}`)
      await loadData(true)
    }
  } catch (err) {
    message.error('切换失败: ' + err.message)
  } finally {
    delete togglingKeys.value[key]
  }
}

function handleCardClick(skill) {
  selectedSkill.value = skill
  showDetailModal.value = true
}

onMounted(() => loadData())

watch(() => props.drawerVisible, (val) => {
  if (val) loadData()
})

watch(() => currentPlatform.value, () => {
  loadData(true)
})
</script>

<style scoped>
.skills-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--bg-primary);
}
.panel-header, .drawer-header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-primary);
  background: var(--bg-secondary);
}
.drawer-header-bar { padding: 8px 12px; }
.header-left, .header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.back-btn { padding: 4px; }
.panel-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}
.action-btn {
  font-size: 12px;
  padding: 4px 8px;
}
.stats-bar {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-primary);
}
.skills-panel.in-drawer .stats-bar { padding: 10px 12px; }
.stats-text {
  font-size: 12px;
  color: var(--text-tertiary);
}
.filter-bar {
  display: flex;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-primary);
}
.skills-panel.in-drawer .filter-bar { padding: 10px 12px; }
.search-input { flex: 1; }
.filter-select { width: 100px; }
.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
.skills-panel.in-drawer .panel-content { padding: 12px; }
.panel-content :deep(.n-spin-container) { min-height: 200px; }
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
}
.card-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
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
.skills-panel.in-drawer .panel-footer { padding: 8px 12px; }
.info-icon { color: var(--text-quaternary); }
</style>
