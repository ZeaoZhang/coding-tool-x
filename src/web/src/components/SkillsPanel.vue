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
      <div class="asset-subtitle">缓存并控制当前平台可用的技能</div>
        </div>
      </div>
      <div class="asset-action-row" v-if="supportsCurrentPlatform">
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
        <n-button v-if="showOmpSettings" text aria-label="OMP 技能设置" @click="openOmpSettings" class="action-btn">
          <template #icon><n-icon><SettingsOutline /></n-icon></template>
          设置
        </n-button>
        <n-button text :focusable="false" @click="handleRefresh" :loading="refreshing || loading" class="action-btn">
          <template #icon><n-icon><RefreshOutline /></n-icon></template>
          刷新远端
        </n-button>
      </div>
    </div>

    <!-- 抽屉模式头部 -->
    <div class="asset-drawer-toolbar" v-if="inDrawer">
      <div class="asset-action-row" v-if="supportsCurrentPlatform">
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
        <n-button v-if="showOmpSettings" text aria-label="OMP 技能设置" @click="openOmpSettings" class="action-btn">
          <template #icon><n-icon><SettingsOutline /></n-icon></template>
          设置
        </n-button>
        <n-button text :focusable="false" @click="handleRefresh" :loading="refreshing || loading" class="action-btn">
          <template #icon><n-icon><RefreshOutline /></n-icon></template>
          刷新远端
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
        <span class="asset-summary-label">已启用</span>
        <span class="asset-summary-value">{{ enabledCount }}</span>
      </span>
      <span class="asset-summary-item">
        <span class="asset-summary-label">待审批</span>
        <span class="asset-summary-value">{{ pendingCount }}</span>
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
              <n-button size="small" @click="showRepoManager = true" v-if="supportsCurrentPlatform && skills.length === 0">配置仓库源</n-button>
            </template>
          </n-empty>
        </div>
        <div v-else class="asset-list">
          <SkillCard
            v-for="skill in filteredSkills"
            :key="skill.controlKey || skill.key"
            :skill="skill"
            :toggling="!!togglingKeys[skill.controlKey || skill.key]"
            :panel-scope="props.scope"
            @toggle="handleToggle"
            @approve="handleApprove"
          />
        </div>
      </n-spin>
    </div>

    <!-- 底部提示 -->
    <div class="asset-footer">
      <n-icon size="14" class="asset-info-icon"><InformationCircleOutline /></n-icon>
      <span>开关变更后需重启 {{ currentPlatformLabel }} 生效；远端刷新只在手动点击后执行</span>
    </div>
    <div v-if="refreshStatusText" class="asset-refresh-status">
      刷新任务：{{ refreshStatusText }}
      <span v-if="refreshTask?.fetchedSkills !== undefined"> · 已处理 {{ refreshTask.fetchedSkills }} 个 Skill</span>
      <span v-if="refreshTask?.failedRepos?.length"> · 失败仓库 {{ refreshTask.failedRepos.length }}</span>
    </div>

    <!-- 弹窗组件 -->
    <SkillRepoManager v-model:visible="showRepoManager" :platform="currentPlatform" @updated="loadData" />
    <SkillCreateModal
      v-model:visible="showCreateModal"
      :platform="currentPlatform"
      :scope="props.scope"
      :project-path="props.projectPath"
      @created="loadData"
    />
    <SkillDetailDrawer
      v-model:visible="showDetailDrawer"
      :skill="selectedSkill"
      :platform="currentPlatform"
      :scope="props.scope"
      :project-path="props.projectPath"
      @updated="loadData"
    />
    <OmpSkillSettingsModal v-model:visible="showOmpSettingsModal" :operation-token="ompSettingsEpoch" @saved="handleOmpSettingsSaved" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { NButton, NIcon, NInput, NSelect, NSpin, NEmpty, useMessage } from 'naive-ui'
import { ArrowBackOutline, AddOutline, GitBranchOutline, RefreshOutline, SearchOutline, ExtensionPuzzleOutline, InformationCircleOutline, CloudDownloadOutline, SettingsOutline } from '@vicons/ionicons5'
import { getSkills, refreshSkills, getSkillRefreshTask, toggleSkill, setSkillTrust } from '../api/skills'
import { setProjectSkillEnabled } from '../api/project-config'
import { importFromClaude } from '../api/config-registry'
import SkillCard from './SkillCard.vue'
import SkillRepoManager from './SkillRepoManager.vue'
import SkillCreateModal from './SkillCreateModal.vue'
import SkillDetailDrawer from './SkillDetailDrawer.vue'
import OmpSkillSettingsModal from './OmpSkillSettingsModal.vue'
import { getPlatformConfig } from '../config/platforms'
import { usePlatformStore } from '../stores/platforms'
import { useEnabledCliPlatforms } from '../composables/useEnabledCliPlatforms'
import { completeOmpSkillSettingsSave, supportsOmpSkillSettings, validateOmpSkillListResponse } from '../utils/omp-skill-settings'
import { getRoutePlatform } from '../config/platformCatalog'

const props = defineProps({
  inDrawer: { type: Boolean, default: false },
  hideBack: { type: Boolean, default: false },
  drawerVisible: { type: Boolean, default: false },
  platform: { type: String, default: '' },
  projectPath: { type: String, default: '' },
  scope: { type: String, default: 'user' }
})

defineEmits(['back', 'updated'])

const route = useRoute()
const platformStore = usePlatformStore()
const message = useMessage()
const loading = ref(false)
const skills = ref([])
const searchQuery = ref('')
const filterStatus = ref('all')
const showRepoManager = ref(false)
const showCreateModal = ref(false)
const showDetailDrawer = ref(false)
const showOmpSettingsModal = ref(false)
const ompSettingsEpoch = ref(0)
const selectedSkill = ref(null)
const togglingKeys = ref({})
const refreshing = ref(false)
const refreshTask = ref(null)
const importing = ref(false)
const loadRequestId = ref(0)
const refreshContextEpoch = ref(0)
const { byCapability } = useEnabledCliPlatforms()
const managedSkillPlatforms = computed(() => byCapability('skills').map(platform => platform.key))
const supportsCurrentPlatform = computed(() => managedSkillPlatforms.value.includes(currentPlatform.value))

const currentPlatform = computed(() => {
  return String(props.platform || getRoutePlatform(route) || 'claude').trim().toLowerCase()
})

const scopeOptions = computed(() => ({
  ...(props.projectPath ? { cwd: props.projectPath } : {}),
  ...(props.scope && props.scope !== 'user' ? { scope: props.scope } : {})
}))
const showOmpSettings = computed(() => supportsOmpSkillSettings(currentPlatform.value))

const currentPlatformLabel = computed(() => {
  const platform = platformStore.get(currentPlatform.value) || getPlatformConfig(currentPlatform.value)
  return platform.label || platform.title || 'Claude Code'
})

const filterOptions = [
  { label: '全部', value: 'all' },
  { label: '已启用', value: 'enabled' },
  { label: '已关闭', value: 'disabled' },
  { label: '待审批 / 需复审', value: 'pending' }
]

const enabledCount = computed(() => skills.value.filter(s => s.enabled).length)
const refreshStatusText = computed(() => {
  const status = refreshTask.value?.status || refreshTask.value?.state
  return ({
    never_fetched: '从未刷新',
    queued: '排队中',
    running: '刷新中',
    succeeded: '已完成',
    partial: '部分成功',
    failed: '失败',
    interrupted: '已中断',
    idle: '已完成'
  })[status] || ''
})
const pendingCount = computed(() => skills.value.filter(s => ['pending', 'needs_review'].includes(s.trust)).length)

const filteredSkills = computed(() => {
  let result = skills.value
  if (filterStatus.value === 'enabled') result = result.filter(s => s.enabled)
  else if (filterStatus.value === 'disabled') result = result.filter(s => !s.enabled)
  else if (filterStatus.value === 'pending') result = result.filter(s => ['pending', 'needs_review'].includes(s.trust))
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(s => s.name?.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q))
  }
  return [...result].sort((a, b) => (a.enabled === b.enabled ? 0 : a.enabled ? -1 : 1))
})

const emptyText = computed(() => {
  if (searchQuery.value) return '没有匹配的技能'
  if (filterStatus.value === 'enabled') return '暂无已启用的技能'
  if (filterStatus.value === 'disabled') return '暂无已关闭的技能'
  if (filterStatus.value === 'pending') return '暂无待审批的技能'
  if (!supportsCurrentPlatform.value) return `${currentPlatformLabel.value} 暂未提供 Skills 能力`
  return '暂无可用技能，请配置仓库源'
})

async function loadData({ notifyError = true } = {}) {
  const requestId = ++loadRequestId.value
  const platform = currentPlatform.value
  if (!supportsCurrentPlatform.value) {
    skills.value = []
    loading.value = false
    return false
  }
  loading.value = true
  try {
    const skillsRes = await getSkills(platform, scopeOptions.value)
    const loadedSkills = validateOmpSkillListResponse(skillsRes)
    if (requestId !== loadRequestId.value || platform !== currentPlatform.value) return false

    skills.value = loadedSkills
    refreshTask.value = skillsRes.refresh || null
    return true
  } catch (err) {
    if (requestId !== loadRequestId.value || platform !== currentPlatform.value) return false
    if (notifyError) message.error('加载技能失败: ' + (err?.message || String(err)))
    return false
  } finally {
    if (requestId === loadRequestId.value && platform === currentPlatform.value) {
      loading.value = false
    }
  }
}

async function handleImport() {
  if (!supportsCurrentPlatform.value || currentPlatform.value !== 'claude') {
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

async function handleToggle(skill, enabled) {
  if (!supportsCurrentPlatform.value) return
  if (
    !skill.controlKey
    || skill.protected
    || skill.readonly
    || skill.managed === false
    || (props.scope === 'project' && skill.sourceScope !== 'project')
  ) return
  if (enabled && skill.trust !== 'approved') {
    message.warning(skill.trust === 'blocked' ? '该技能已被阻止' : '该技能需要先审批')
    return
  }
  if (skill.projection?.state === 'unsupported') {
    message.error('当前平台不支持安全投影，无法切换该项目技能')
    return
  }
  if (enabled && !skill.cached) {
    message.warning('该技能尚无完整缓存，请先手动刷新远端')
    return
  }

  const key = skill.controlKey
  togglingKeys.value[key] = true
  try {
    const result = props.scope === 'project'
      ? await setProjectSkillEnabled(props.projectPath, currentPlatform.value, key, enabled)
      : await toggleSkill(key, enabled, currentPlatform.value, scopeOptions.value)
    if (result.status === 'needs_approval') {
      message.warning('该技能需要先审批')
      return
    }
    if (result.status === 'blocked') {
      message.error('该技能已被阻止')
      return
    }
    if (result.status === 'unsupported') {
      message.error('当前平台不支持安全投影')
      return
    }
    if (result.status === 'conflict') {
      message.warning('目标 Skill 目录已被其他来源占用')
      return
    }
    if (result.status === 'projection_failed') {
      message.error(result.lastError || 'Skill 投影失败')
      return
    }
    const currentSkill = skills.value.find(item => item.controlKey === key)
    if (currentSkill) {
      currentSkill.enabled = result.enabled
      currentSkill.installed = result.enabled
      currentSkill.projection = result.projection || currentSkill.projection
    }
    message.success(enabled ? `技能 "${skill.name}" 已启用` : `技能 "${skill.name}" 已关闭`)
  } catch (err) {
    message.error('切换失败: ' + (err.response?.data?.message || err.message))
  } finally {
    delete togglingKeys.value[key]
  }
}

async function handleApprove(skill) {
  if (!supportsCurrentPlatform.value) return
  if (!skill.controlKey || !['pending', 'needs_review'].includes(skill.trust)) return
  if (props.scope === 'project' && skill.sourceScope !== 'project') return
  const key = skill.controlKey
  togglingKeys.value[key] = true
  try {
    const result = await setSkillTrust(key, 'approved', currentPlatform.value, scopeOptions.value)
    const currentSkill = skills.value.find(item => item.controlKey === key)
    if (currentSkill) currentSkill.trust = result.trust
    message.success(`技能 "${skill.name}" 已批准，当前仍保持关闭`)
  } catch (err) {
    message.error('审批失败: ' + (err.response?.data?.message || err.message))
  } finally {
    delete togglingKeys.value[key]
  }
}

async function handleRefresh() {
  if (!supportsCurrentPlatform.value || refreshing.value) return
  const epoch = refreshContextEpoch.value
  const contextKey = JSON.stringify({
    platform: currentPlatform.value,
    scope: props.scope || 'user',
    projectPath: props.projectPath || ''
  })
  const isCurrent = () => (
    epoch === refreshContextEpoch.value
    && contextKey === JSON.stringify({
      platform: currentPlatform.value,
      scope: props.scope || 'user',
      projectPath: props.projectPath || ''
    })
  )

  refreshing.value = true
  try {
    const platform = currentPlatform.value
    const result = await refreshSkills(platform, scopeOptions.value)
    if (!isCurrent()) return
    refreshTask.value = result.task || null
    let task = result.task
    while (task && ['queued', 'running'].includes(task.status)) {
      await new Promise(resolve => setTimeout(resolve, 250))
      const taskResult = await getSkillRefreshTask(task.id, {
        ...scopeOptions.value,
        platform: currentPlatform.value
      })
      if (!isCurrent()) return
      task = taskResult.task
      refreshTask.value = task
    }
    if (!isCurrent()) return
    if (task?.status === 'failed') {
      message.error(task.error || '远端刷新失败')
    } else if (task?.status === 'partial') {
      message.warning('远端刷新部分成功')
    } else {
      message.success('远端 Skill 刷新完成')
    }
    await loadData()
  } catch (err) {
    if (isCurrent()) message.error('刷新失败: ' + (err.response?.data?.message || err.message))
  } finally {
    if (isCurrent()) refreshing.value = false
  }
}

function openOmpSettings() {
  if (!showOmpSettings.value) return

  ompSettingsEpoch.value += 1
  showOmpSettingsModal.value = true
}

async function handleOmpSettingsSaved(_settings, operationToken) {
  if (
    currentPlatform.value !== 'omp' ||
    !showOmpSettingsModal.value ||
    operationToken !== ompSettingsEpoch.value
  ) return

  const platform = currentPlatform.value
  showOmpSettingsModal.value = false
  const refreshed = await completeOmpSkillSettingsSave(() => {}, loadData)
  if (platform !== currentPlatform.value || operationToken !== ompSettingsEpoch.value) return
  if (refreshed) {
    message.success('技能扫描设置已保存')
  } else {
    message.error('设置已保存，但技能列表刷新失败')
  }
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

watch([() => currentPlatform.value, () => props.scope, () => props.projectPath], ([platform]) => {
  refreshContextEpoch.value += 1
  refreshing.value = false
  refreshTask.value = null
  ompSettingsEpoch.value += 1
  if (!supportsOmpSkillSettings(platform)) showOmpSettingsModal.value = false
  loadData()
})
</script>

<style scoped>
.back-btn { padding: 4px; }
.action-btn { padding: 4px 8px; }
</style>
