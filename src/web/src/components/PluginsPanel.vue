<template>
  <div class="plugins-panel" :class="{ 'in-drawer': inDrawer }">
    <!-- 独立模式头部 -->
    <div class="panel-header" v-if="!inDrawer">
      <div class="header-left">
        <n-button v-if="!hideBack" text @click="$emit('back')" class="back-btn">
          <template #icon><n-icon><ArrowBackOutline /></n-icon></template>
        </n-button>
        <span class="panel-title">Plugins 插件管理</span>
      </div>
      <div class="header-right">
        <n-button text :focusable="false" @click="showRepoManager = true" class="action-btn">
          <template #icon><n-icon><GitBranchOutline /></n-icon></template>
          仓库
        </n-button>
        <n-button text :focusable="false" @click="handleSync" :loading="syncing" class="action-btn">
          <template #icon><n-icon><SyncOutline /></n-icon></template>
          同步
        </n-button>
        <n-button text :focusable="false" @click="loadData(true)" :loading="loading" class="action-btn">
          <template #icon><n-icon><RefreshOutline /></n-icon></template>
          刷新
        </n-button>
      </div>
    </div>

    <!-- 抽屉模式头部 -->
    <div class="drawer-header-bar" v-if="inDrawer">
      <div class="header-right">
        <n-button text :focusable="false" @click="showRepoManager = true" class="action-btn">
          <template #icon><n-icon><GitBranchOutline /></n-icon></template>
          仓库
        </n-button>
        <n-button text :focusable="false" @click="handleSync" :loading="syncing" class="action-btn">
          <template #icon><n-icon><SyncOutline /></n-icon></template>
          同步
        </n-button>
        <n-button text :focusable="false" @click="loadData(true)" :loading="loading" class="action-btn">
          <template #icon><n-icon><RefreshOutline /></n-icon></template>
          刷新
        </n-button>
      </div>
    </div>

    <!-- 统计栏 -->
    <div class="stats-bar">
      <span class="stats-text">
        共 {{ plugins.length }} 个插件
        <template v-if="plugins.length > 0">
          · 已安装: {{ installedCount }} · 未安装: {{ plugins.length - installedCount }}
        </template>
      </span>
    </div>

    <!-- 搜索筛选 -->
    <div class="filter-bar">
      <n-input
        v-model:value="searchQuery"
        placeholder="搜索插件..."
        clearable
        size="small"
        class="search-input"
      >
        <template #prefix><n-icon><SearchOutline /></n-icon></template>
      </n-input>
      <n-select v-model:value="filterStatus" :options="filterOptions" size="small" class="filter-select" />
    </div>

    <!-- 内容区域 -->
    <div class="panel-content">
      <n-spin :show="loading">
        <div v-if="filteredPlugins.length === 0 && !loading" class="empty-state">
          <n-empty :description="emptyText">
            <template #icon><n-icon size="48" color="var(--text-quaternary)"><ExtensionPuzzleOutline /></n-icon></template>
            <template #extra>
              <n-button size="small" @click="showRepoManager = true" v-if="plugins.length === 0">配置仓库源</n-button>
            </template>
          </n-empty>
        </div>
        <div v-else class="card-list">
          <PluginCard
            v-for="plugin in filteredPlugins"
            :key="plugin.key"
            :plugin="plugin"
            :installing="!!installingKeys[plugin.key]"
            :uninstalling="!!uninstallingKeys[plugin.key]"
            @install="handleInstall"
            @uninstall="handleUninstall"
            @click="handleCardClick"
          />
        </div>
      </n-spin>
    </div>

    <!-- 底部提示 -->
    <div class="panel-footer">
      <n-icon size="14" class="info-icon"><InformationCircleOutline /></n-icon>
      <span>安装/卸载后需重启 Claude Code 生效</span>
    </div>

    <!-- 弹窗组件 -->
    <PluginRepoManager v-model:visible="showRepoManager" @updated="loadData" />
    <PluginDetailDrawer
      v-model:visible="detailDrawerVisible"
      :plugin="selectedPlugin"
      @updated="loadData"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { NButton, NIcon, NInput, NSelect, NSpin, NEmpty, useMessage } from 'naive-ui'
import { ArrowBackOutline, GitBranchOutline, RefreshOutline, SearchOutline, ExtensionPuzzleOutline, InformationCircleOutline, SyncOutline } from '@vicons/ionicons5'
import { getPlugins, getMarketPlugins, installPlugin, uninstallPlugin, syncPluginRepos } from '../api/plugins'
import PluginCard from './PluginCard.vue'
import PluginRepoManager from './PluginRepoManager.vue'
import PluginDetailDrawer from './PluginDetailDrawer.vue'

const props = defineProps({
  inDrawer: { type: Boolean, default: false },
  hideBack: { type: Boolean, default: false },
  drawerVisible: { type: Boolean, default: false }
})

defineEmits(['back', 'updated'])

const message = useMessage()
const loading = ref(false)
const syncing = ref(false)
const plugins = ref([])
const searchQuery = ref('')
const filterStatus = ref('all')
const showRepoManager = ref(false)
const detailDrawerVisible = ref(false)
const selectedPlugin = ref(null)
const installingKeys = ref({})
const uninstallingKeys = ref({})

const filterOptions = [
  { label: '全部', value: 'all' },
  { label: '已安装', value: 'installed' },
  { label: '未安装', value: 'uninstalled' }
]

const installedCount = computed(() => plugins.value.filter(p => p.installed).length)

const filteredPlugins = computed(() => {
  let result = plugins.value
  if (filterStatus.value === 'installed') result = result.filter(p => p.installed)
  else if (filterStatus.value === 'uninstalled') result = result.filter(p => !p.installed)
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(p => p.name?.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q))
  }
  return [...result].sort((a, b) => (a.installed === b.installed ? 0 : a.installed ? -1 : 1))
})

const emptyText = computed(() => {
  if (searchQuery.value) return '没有匹配的插件'
  if (filterStatus.value === 'installed') return '暂无已安装的插件'
  if (filterStatus.value === 'uninstalled') return '所有插件都已安装'
  return '暂无可用插件，请配置仓库源'
})

async function loadData(force = false) {
  loading.value = true
  try {
    // 并行获取已安装插件和市场插件
    const [installedRes, marketRes] = await Promise.all([
      getPlugins(force),
      getMarketPlugins().catch(() => ({ success: true, plugins: [] }))
    ])

    const installedList = installedRes.success ? installedRes.plugins : []
    const marketList = marketRes.success ? marketRes.plugins : []

    // 创建市场插件的名称映射，用于合并详细信息
    const marketByName = {}
    for (const mp of marketList) {
      marketByName[mp.name] = mp
    }

    // 已安装插件：合并市场插件的详细信息
    const installedPlugins = installedList.map(p => {
      const marketInfo = marketByName[p.name] || {}
      return {
        ...marketInfo,  // 先用市场插件信息作为基础
        ...p,           // 已安装插件信息覆盖
        installed: true,
        key: `installed-${p.name}`,
        // 确保这些字段优先使用市场插件的值（如果已安装插件没有）
        description: p.description || marketInfo.description || '',
        repoOwner: p.repoOwner || marketInfo.repoOwner || '',
        repoName: p.repoName || marketInfo.repoName || '',
        repoBranch: p.repoBranch || marketInfo.repoBranch || 'main',
        directory: p.directory || marketInfo.directory || p.installPath || ''
      }
    })

    // 未安装的市场插件
    const installedNames = new Set(installedList.map(p => p.name))
    const uninstalledPlugins = marketList
      .filter(p => !installedNames.has(p.name))
      .map(p => ({
        ...p,
        installed: false,
        key: `market-${p.repoOwner}-${p.pluginPath}`
      }))

    plugins.value = [...installedPlugins, ...uninstalledPlugins]
  } catch (err) {
    message.error('加载插件失败: ' + err.message)
  } finally {
    loading.value = false
  }
}

async function handleSync() {
  syncing.value = true
  try {
    const res = await syncPluginRepos()
    if (res.success) {
      message.success('仓库同步成功')
      await loadData(true)
    }
  } catch (err) {
    message.error('同步失败: ' + err.message)
  } finally {
    syncing.value = false
  }
}

async function handleInstall(plugin) {
  if (!plugin.repoOwner) return message.error('缺少仓库信息')
  installingKeys.value[plugin.key] = true
  try {
    const res = await installPlugin(plugin.directory, { owner: plugin.repoOwner, name: plugin.repoName, branch: plugin.repoBranch || 'main' })
    if (res.success) { message.success(`插件 "${plugin.name}" 安装成功`); await loadData(true) }
  } catch (err) { message.error('安装失败: ' + err.message) }
  finally { delete installingKeys.value[plugin.key] }
}

async function handleUninstall(plugin) {
  uninstallingKeys.value[plugin.key] = true
  try {
    const res = await uninstallPlugin(plugin.directory)
    if (res.success) { message.success(`插件 "${plugin.name}" 已卸载`); await loadData(true) }
  } catch (err) { message.error('卸载失败: ' + err.message) }
  finally { delete uninstallingKeys.value[plugin.key] }
}

function handleCardClick(plugin) {
  selectedPlugin.value = plugin
  detailDrawerVisible.value = true
}

onMounted(() => loadData())

watch(() => props.drawerVisible, (val) => {
  if (val) loadData()
})
</script>

<style scoped>
.plugins-panel {
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
.plugins-panel.in-drawer .stats-bar { padding: 10px 12px; }
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
.plugins-panel.in-drawer .filter-bar { padding: 10px 12px; }
.search-input { flex: 1; }
.filter-select { width: 100px; }
.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
.plugins-panel.in-drawer .panel-content { padding: 12px; }
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
.plugins-panel.in-drawer .panel-footer { padding: 8px 12px; }
.info-icon { color: var(--text-quaternary); }
</style>
