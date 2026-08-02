<template>
  <div class="skills-panel asset-panel" :class="{ 'in-drawer': inDrawer }">
    <!-- 独立模式头部 -->
    <div class="asset-panel-header" v-if="!inDrawer">
      <div class="asset-title-group">
        <n-button v-if="!hideBack" text @click="$emit('back')" class="back-btn">
          <template #icon><n-icon><ArrowBackOutline /></n-icon></template>
        </n-button>
        <div class="asset-heading">
          <div class="asset-title-row">
            <span class="asset-title">技能管理</span>
            <span class="asset-platform-pill">{{ currentPlatformLabel }}</span>
          </div>
          <div class="asset-subtitle">安装、创建和同步当前平台可用的技能</div>
        </div>
      </div>
      <div class="asset-action-row">
        <n-button text :focusable="false" @click="showCreateModal = true" class="action-btn">
          <template #icon><n-icon><AddOutline /></n-icon></template>
          创建
        </n-button>
        <n-button text :focusable="false" @click="showRepoManager = true" class="action-btn">
          <template #icon><n-icon><GitBranchOutline /></n-icon></template>
          仓库
        </n-button>
        <n-button text :focusable="false" @click="handleImport" :loading="importing" :disabled="currentPlatform !== 'claude'" class="action-btn">
          <template #icon><n-icon><CloudDownloadOutline /></n-icon></template>
          导入
        </n-button>
        <n-button text :focusable="false" @click="loadData(true)" :loading="loading" class="action-btn">
          <template #icon><n-icon><RefreshOutline /></n-icon></template>
          刷新
        </n-button>
      </div>
    </div>

    <!-- 抽屉模式头部 -->
    <div class="asset-drawer-toolbar" v-if="inDrawer">
      <div class="asset-action-row">
        <n-button text :focusable="false" @click="showCreateModal = true" class="action-btn">
          <template #icon><n-icon><AddOutline /></n-icon></template>
          创建
        </n-button>
        <n-button text :focusable="false" @click="showRepoManager = true" class="action-btn">
          <template #icon><n-icon><GitBranchOutline /></n-icon></template>
          仓库
        </n-button>
        <n-button text :focusable="false" @click="handleImport" :loading="importing" :disabled="currentPlatform !== 'claude'" class="action-btn">
          <template #icon><n-icon><CloudDownloadOutline /></n-icon></template>
          导入
        </n-button>
        <n-button text :focusable="false" @click="loadData(true)" :loading="loading" class="action-btn">
          <template #icon><n-icon><RefreshOutline /></n-icon></template>
          刷新
        </n-button>
      </div>
    </div>

    <!-- 统计栏 -->
    <div class="asset-summary">
      <span class="asset-summary-item">
        <span class="asset-summary-label">全部</span>
        <span class="asset-summary-value">{{ skills.length }}</span>
      </span>
      <span class="asset-summary-item">
        <span class="asset-summary-label">已安装</span>
        <span class="asset-summary-value">{{ installedCount }}</span>
      </span>
      <span class="asset-summary-item">
        <span class="asset-summary-label">可安装</span>
        <span class="asset-summary-value">{{ skills.length - installedCount }}</span>
      </span>
    </div>

    <!-- 搜索筛选 -->
    <div class="asset-filter-bar">
      <n-input v-model:value="searchQuery" placeholder="搜索技能名称或描述" clearable size="small" class="asset-search">
        <template #prefix><n-icon><SearchOutline /></n-icon></template>
      </n-input>
      <n-select v-model:value="filterStatus" :options="filterOptions" size="small" class="asset-filter" />
    </div>

    <!-- 内容区域 -->
    <div class="asset-panel-content">
      <n-spin :show="loading">
        <div v-if="filteredSkills.length === 0 && !loading" class="asset-empty">
          <n-empty :description="emptyText">
            <template #icon><n-icon size="48" color="var(--text-quaternary)"><ExtensionPuzzleOutline /></n-icon></template>
            <template #extra>
              <n-button size="small" @click="showRepoManager = true" v-if="skills.length === 0">配置仓库源</n-button>
            </template>
          </n-empty>
        </div>
        <div v-else class="asset-list">
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

    <!-- 底部提示 -->
    <div class="asset-footer">
      <n-icon size="14" class="asset-info-icon"><InformationCircleOutline /></n-icon>
      <span>安装/卸载后需重启 {{ currentPlatformLabel }} 生效</span>
    </div>

    <!-- 弹窗组件 -->
    <SkillRepoManager v-model:visible="showRepoManager" :platform="currentPlatform" @updated="loadData(true)" />
    <SkillCreateModal v-model:visible="showCreateModal" :platform="currentPlatform" @created="loadData" />
    <SkillDetailDrawer v-model:visible="showDetailDrawer" :skill="selectedSkill" :platform="currentPlatform" @updated="loadData" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { NButton, NIcon, NInput, NSelect, NSpin, NEmpty, useMessage } from 'naive-ui'
import { ArrowBackOutline, AddOutline, GitBranchOutline, RefreshOutline, SearchOutline, ExtensionPuzzleOutline, InformationCircleOutline, CloudDownloadOutline } from '@vicons/ionicons5'
import { getSkills, installSkill, uninstallSkill, installLocalSkill } from '../api/skills'
import { importFromClaude } from '../api/config-registry'
import SkillCard from './SkillCard.vue'
import SkillRepoManager from './SkillRepoManager.vue'
import SkillCreateModal from './SkillCreateModal.vue'
import SkillDetailDrawer from './SkillDetailDrawer.vue'
import { BUILT_IN_CLI_PLATFORMS, getPlatformConfig } from '../config/platforms'

const props = defineProps({
  inDrawer: { type: Boolean, default: false },
  hideBack: { type: Boolean, default: false },
  drawerVisible: { type: Boolean, default: false },
  platform: { type: String, default: '' },
  projectPath: { type: String, default: '' }
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
const showDetailDrawer = ref(false)
const selectedSkill = ref(null)
const installingKeys = ref({})
const uninstallingKeys = ref({})
const importing = ref(false)
const loadRequestId = ref(0)
const managedSkillPlatforms = BUILT_IN_CLI_PLATFORMS
  .filter(platform => platform.supportsSkills !== false)
  .map(platform => platform.key)

const currentPlatform = computed(() => {
  if (props.platform && managedSkillPlatforms.includes(props.platform)) {
    return props.platform
  }
  const channel = route.meta.channel
  if (managedSkillPlatforms.includes(channel)) return channel
  return 'claude'
})

const currentPlatformLabel = computed(() => {
  const platform = getPlatformConfig(currentPlatform.value)
  return platform.label || platform.title || 'Claude Code'
})

const filterOptions = [
  { label: '全部', value: 'all' },
  { label: '已安装', value: 'installed' },
  { label: '未安装', value: 'uninstalled' }
]

const installedCount = computed(() => skills.value.filter(s => s.installed).length)

const filteredSkills = computed(() => {
  let result = skills.value
  if (filterStatus.value === 'installed') result = result.filter(s => s.installed)
  else if (filterStatus.value === 'uninstalled') result = result.filter(s => !s.installed)
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
  return '暂无可用技能，请配置仓库源'
})

async function loadData(force = false) {
  const requestId = ++loadRequestId.value
  const platform = currentPlatform.value
  loading.value = true
  try {
    const skillsRes = await getSkills(force, platform, {
      ...(props.projectPath ? { cwd: props.projectPath } : {})
    })
    if (requestId !== loadRequestId.value || platform !== currentPlatform.value) return
    if (skillsRes.success) skills.value = skillsRes.skills || []
  } catch (err) {
    message.error('加载技能失败: ' + err.message)
  } finally {
    if (requestId === loadRequestId.value) {
      loading.value = false
    }
  }
}

async function handleImport() {
  if (currentPlatform.value !== 'claude') {
    return
  }
  importing.value = true
  try {
    const res = await importFromClaude('skills')
    if (res.success) {
      message.success(`成功导入 ${res.imported} 个技能`)
      await loadData()
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
  if (skill.protected) return
  installingKeys.value[skill.key] = true
  try {
    let res
    if (skill.isLocal) {
      res = await installLocalSkill(skill.directory, currentPlatform.value)
    } else {
      if (!skill.repoOwner && !skill.repoProjectPath && !skill.repoLocalPath) { message.error('缺少仓库信息'); return }
      res = await installSkill(
        skill.directory,
        {
          id: skill.repoId,
          provider: skill.repoProvider,
          host: skill.repoHost,
          owner: skill.repoOwner,
          name: skill.repoName,
          branch: skill.repoBranch || 'main',
          directory: skill.repoDirectory || '',
          projectPath: skill.repoProjectPath,
          localPath: skill.repoLocalPath,
          repoUrl: skill.repoUrl
        },
        skill.fullDirectory || null,
        currentPlatform.value
      )
    }
    if (res.success) {
      message.success(`技能 "${skill.name}" 安装成功`)
      const s = skills.value.find(x => x.key === skill.key)
      if (s) s.installed = true
    }
  } catch (err) { message.error('安装失败: ' + err.message) }
  finally { delete installingKeys.value[skill.key] }
}

async function handleUninstall(skill) {
  if (skill.protected || skill.readonly) return
  uninstallingKeys.value[skill.key] = true
  try {
    const res = await uninstallSkill(skill.directory, currentPlatform.value, {
      ...(props.projectPath ? { cwd: props.projectPath } : {}),
      ...(skill.sourceScope ? { scope: skill.sourceScope } : {})
    })
    if (res.success) {
      message.success(`技能 "${skill.name}" 已卸载`)
      const s = skills.value.find(x => x.key === skill.key)
      if (s) s.installed = false
    }
  } catch (err) { message.error('卸载失败: ' + err.message) }
  finally { delete uninstallingKeys.value[skill.key] }
}


function handleCardClick(skill) {
  selectedSkill.value = skill
  showDetailDrawer.value = true
}

onMounted(() => {
  // 抽屉模式下仅在打开时加载，避免应用启动时触发网络依赖
  if (!props.inDrawer || props.drawerVisible) {
    loadData()
  }
})

watch(() => props.drawerVisible, (val) => {
  if (val) loadData()
})

watch(() => currentPlatform.value, () => {
  loadData()
})
</script>

<style scoped>
.back-btn { padding: 4px; }
.action-btn { padding: 4px 8px; }
</style>
