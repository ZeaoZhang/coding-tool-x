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
    <div class="drawer-header-bar" v-if="inDrawer">
      <div class="header-right">
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
      <span>安装/卸载后需重启 {{ currentPlatformLabel }} 生效</span>
    </div>

    <!-- 弹窗组件 -->
    <PluginRepoManager v-model:visible="showRepoManager" :platform="currentPlatform" @updated="loadData" />
    <PluginDetailDrawer
      v-model:visible="detailDrawerVisible"
      :plugin="selectedPlugin"
      :platform="currentPlatform"
      @updated="loadData"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { NButton, NIcon, NInput, NSelect, NSpin, NEmpty, useMessage } from 'naive-ui'
import { ArrowBackOutline, GitBranchOutline, RefreshOutline, SearchOutline, ExtensionPuzzleOutline, InformationCircleOutline, CloudDownloadOutline } from '@vicons/ionicons5'
import { getPlugins, getMarketPlugins, installPlugin, uninstallPlugin, syncPluginRepos } from '../api/plugins'
import { importFromClaude } from '../api/config-registry'
import PluginCard from './PluginCard.vue'
import PluginRepoManager from './PluginRepoManager.vue'
import PluginDetailDrawer from './PluginDetailDrawer.vue'

const props = defineProps({
  inDrawer: { type: Boolean, default: false },
  hideBack: { type: Boolean, default: false },
  drawerVisible: { type: Boolean, default: false }
})

defineEmits(['back', 'updated'])

const route = useRoute()
const message = useMessage()
const loading = ref(false)
const plugins = ref([])
const searchQuery = ref('')
const filterStatus = ref('all')
const showRepoManager = ref(false)
const detailDrawerVisible = ref(false)
const selectedPlugin = ref(null)
const installingKeys = ref({})
const uninstallingKeys = ref({})
const importing = ref(false)
const loadRequestId = ref(0)

const currentPlatform = computed(() => {
  return route.meta.channel === 'opencode' ? 'opencode' : 'claude'
})

const currentPlatformLabel = computed(() => {
  return currentPlatform.value === 'opencode' ? 'OpenCode' : 'Claude Code'
})

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
  const requestId = ++loadRequestId.value
  const platform = currentPlatform.value
  loading.value = true
  try {
    if (force) {
      await syncPluginRepos(platform).catch(() => {})
    }

    const installedRes = await getPlugins(platform)
    const installedList = installedRes.success ? installedRes.plugins : []
    let marketList = []

    const mergePluginLists = (installed, market) => {
      const marketByName = {}
      for (const mp of market) {
        marketByName[mp.name] = mp
      }

      const installedPlugins = installed.map(p => {
        const marketInfo = marketByName[p.name] || {}
        return {
          ...marketInfo,
          ...p,
          installed: true,
          key: `installed-${p.name}`,
          description: p.description || marketInfo.description || '',
          repoProvider: p.repoProvider || marketInfo.repoProvider || '',
          repoHost: p.repoHost || marketInfo.repoHost || '',
          repoOwner: p.repoOwner || marketInfo.repoOwner || '',
          repoName: p.repoName || marketInfo.repoName || '',
          repoBranch: p.repoBranch || marketInfo.repoBranch || 'main',
          repoProjectPath: p.repoProjectPath || marketInfo.repoProjectPath || '',
          repoLocalPath: p.repoLocalPath || marketInfo.repoLocalPath || '',
          repoId: p.repoId || marketInfo.repoId || '',
          repoUrl: p.repoUrl || marketInfo.repoUrl || '',
          readmeUrl: p.readmeUrl || marketInfo.readmeUrl || '',
          directory: p.directory || marketInfo.directory || p.installPath || ''
        }
      })

      const installedNames = new Set(installed.map(p => p.name))
      const uninstalledPlugins = market
        .filter(p => !installedNames.has(p.name))
        .map(p => ({
          ...p,
          installed: false,
          key: `market-${p.repoId || p.repoProjectPath || p.repoLocalPath || p.repoOwner || 'repo'}-${p.directory || p.name}`
        }))

      return [...installedPlugins, ...uninstalledPlugins]
    }

    plugins.value = mergePluginLists(installedList, marketList)

    getMarketPlugins(platform, force)
      .catch(() => ({ success: true, plugins: [] }))
      .then((marketRes) => {
        if (requestId !== loadRequestId.value || platform !== currentPlatform.value) return
        marketList = marketRes.success ? marketRes.plugins : []
        plugins.value = mergePluginLists(installedList, marketList)
      })
  } catch (err) {
    message.error('加载插件失败: ' + err.message)
  } finally {
    if (requestId === loadRequestId.value) {
      loading.value = false
    }
  }
}

async function handleImport() {
  if (currentPlatform.value !== 'claude') return
  importing.value = true
  try {
    const res = await importFromClaude('plugins')
    if (res.success) {
      message.success(`成功导入 ${res.imported} 个插件`)
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

async function handleInstall(plugin) {
  if (!plugin.installSource && !plugin.repoOwner && !plugin.repoProjectPath && !plugin.repoLocalPath) {
    return message.error('缺少可安装来源')
  }
  installingKeys.value[plugin.key] = true
  try {
    const res = plugin.installSource
      ? await installPlugin('', null, currentPlatform.value, plugin.installSource)
      : await installPlugin(
        plugin.directory,
        {
          id: plugin.repoId,
          provider: plugin.repoProvider,
          host: plugin.repoHost,
          owner: plugin.repoOwner,
          name: plugin.repoName,
          branch: plugin.repoBranch || 'main',
          projectPath: plugin.repoProjectPath,
          localPath: plugin.repoLocalPath,
          repoUrl: plugin.repoUrl
        },
        currentPlatform.value
      )
    if (res.success) {
      message.success(`插件 "${plugin.name}" 安装成功`)
      const idx = plugins.value.findIndex(p => p.key === plugin.key)
      if (idx !== -1) {
        plugins.value[idx] = { ...plugins.value[idx], installed: true, key: `installed-${plugin.name}` }
      }
    } else { message.error(res.message || '安装失败') }
  } catch (err) { message.error('安装失败: ' + err.message) }
  finally { delete installingKeys.value[plugin.key] }
}

async function handleUninstall(plugin) {
  uninstallingKeys.value[plugin.key] = true
  try {
    const res = await uninstallPlugin(plugin.name, currentPlatform.value)
    if (res.success) {
      message.success(`插件 "${plugin.name}" 已卸载`)
      const idx = plugins.value.findIndex(p => p.key === plugin.key)
      if (idx !== -1) {
        plugins.value[idx] = { ...plugins.value[idx], installed: false, key: `market-${plugin.repoId || plugin.repoProjectPath || plugin.repoLocalPath || plugin.repoOwner || 'repo'}-${plugin.directory || plugin.name}` }
      }
    } else { message.error(res.message || res.error || '卸载失败') }
  } catch (err) { message.error('卸载失败: ' + err.message) }
  finally { delete uninstallingKeys.value[plugin.key] }
}

function handleCardClick(plugin) {
  selectedPlugin.value = plugin
  detailDrawerVisible.value = true
}

onMounted(() => {
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
