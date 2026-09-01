<template>
  <div class="plugins-panel asset-panel" :class="{ 'in-drawer': inDrawer }">
    <!-- 独立模式头部 -->
    <div class="asset-panel-header" v-if="!inDrawer">
      <div class="asset-title-group">
        <n-button v-if="!hideBack" text @click="$emit('back')" class="back-btn">
          <template #icon><n-icon><ArrowBackOutline /></n-icon></template>
        </n-button>
        <div class="asset-heading">
          <div class="asset-title-row">
            <span class="asset-title">插件管理</span>
            <span class="asset-platform-pill">{{ currentPlatformLabel }}</span>
          </div>
          <div class="asset-subtitle">管理平台插件、仓库源和市场安装状态</div>
        </div>
      </div>
      <div class="asset-action-row" v-if="managedPluginPlatforms.includes(currentPlatform)">
        <n-button v-if="capabilities.repositories" text :focusable="false" @click="showRepoManager = true" class="action-btn">
          <template #icon><n-icon><GitBranchOutline /></n-icon></template>
          仓库
        </n-button>
        <n-button v-if="capabilities.import" text :focusable="false" @click="handleImport" :loading="importing" class="action-btn">
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
      <div class="asset-action-row" v-if="managedPluginPlatforms.includes(currentPlatform)">
        <n-button v-if="capabilities.repositories" text :focusable="false" @click="showRepoManager = true" class="action-btn">
          <template #icon><n-icon><GitBranchOutline /></n-icon></template>
          仓库
        </n-button>
        <n-button v-if="capabilities.import" text :focusable="false" @click="handleImport" :loading="importing" class="action-btn">
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
        <span class="asset-summary-value">{{ plugins.length }}</span>
      </span>
      <span class="asset-summary-item">
        <span class="asset-summary-label">已安装</span>
        <span class="asset-summary-value">{{ installedCount }}</span>
      </span>
      <span class="asset-summary-item">
        <span class="asset-summary-label">可安装</span>
        <span class="asset-summary-value">{{ plugins.length - installedCount }}</span>
      </span>
    </div>

    <!-- 搜索筛选 -->
    <div class="asset-filter-bar">
      <n-input
        v-model:value="searchQuery"
        placeholder="搜索插件名称或描述"
        clearable
        size="small"
        class="asset-search"
      >
        <template #prefix><n-icon><SearchOutline /></n-icon></template>
      </n-input>
      <n-select v-model:value="filterStatus" :options="filterOptions" size="small" class="asset-filter" />
    </div>

    <!-- 内容区域 -->
    <div class="asset-panel-content">
      <n-spin :show="loading">
        <div v-if="filteredPlugins.length === 0 && !loading" class="asset-empty">
          <n-empty :description="emptyText">
            <template #icon><n-icon size="48" color="var(--text-quaternary)"><ExtensionPuzzleOutline /></n-icon></template>
            <template #extra>
              <n-button size="small" @click="showRepoManager = true" v-if="managedPluginPlatforms.includes(currentPlatform) && plugins.length === 0 && capabilities.repositories">配置仓库源</n-button>
            </template>
          </n-empty>
        </div>
        <div v-else class="asset-list">
          <PluginCard
            v-for="plugin in filteredPlugins"
            :key="plugin.key"
            :plugin="plugin"
            :readonly="plugin.readonly || (!capabilities.install && !capabilities.uninstall)"
            :can-install="capabilities.install"
            :can-uninstall="capabilities.uninstall"
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
    <div v-if="managedPluginPlatforms.includes(currentPlatform) && (capabilities.install || capabilities.uninstall)" class="asset-footer">
      <n-icon size="14" class="asset-info-icon"><InformationCircleOutline /></n-icon>
      <span>安装/卸载后需重启 {{ currentPlatformLabel }} 生效</span>
    </div>

    <!-- 弹窗组件 -->
    <PluginRepoManager
      v-if="capabilities.repositories"
      v-model:visible="showRepoManager"
      :platform="currentPlatform"
      :project-path="props.projectPath"
      :capabilities="capabilities"
      @updated="loadData"
    />
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
import { getPlugins, getMarketPlugins, getPluginCapabilities, installPlugin, uninstallPlugin, syncPluginRepos } from '../api/plugins'
import { importFromClaude } from '../api/config-registry'
import PluginCard from './PluginCard.vue'
import PluginRepoManager from './PluginRepoManager.vue'
import PluginDetailDrawer from './PluginDetailDrawer.vue'
import { getPlatformConfig } from '../config/platforms'
import { usePlatformStore } from '../stores/platforms'
import { useEnabledCliPlatforms } from '../composables/useEnabledCliPlatforms'
import { getRoutePlatform } from '../config/platformCatalog'

const props = defineProps({
  inDrawer: { type: Boolean, default: false },
  hideBack: { type: Boolean, default: false },
  drawerVisible: { type: Boolean, default: false },
  platform: { type: String, default: '' },
  projectPath: { type: String, default: '' }
})

defineEmits(['back', 'updated'])

const route = useRoute()
const platformStore = usePlatformStore()
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
const capabilities = ref({
  supportsPlugins: true,
  repositories: true,
  market: true,
  install: true,
  uninstall: true,
  import: true,
  syncRepos: true
})
const { byCapability } = useEnabledCliPlatforms()
const managedPluginPlatforms = computed(() => byCapability('plugins').map(platform => platform.key))
const supportsCurrentPlatform = computed(() => managedPluginPlatforms.value.includes(currentPlatform.value))

function setUnsupportedCapabilities() {
  capabilities.value = {
    supportsPlugins: false,
    repositories: false,
    market: false,
    install: false,
    uninstall: false,
    import: false,
    syncRepos: false,
    disabledReason: `${currentPlatformLabel.value} 暂未提供插件管理能力`
  }
}

const currentPlatform = computed(() => {
  const requested = String(
    props.platform ||
    (Array.isArray(route.query.platform) ? route.query.platform[0] : route.query.platform) ||
    getRoutePlatform(route) ||
    ''
  ).trim().toLowerCase()
  return requested
})

const currentPlatformLabel = computed(() => {
  const platform = platformStore.get(currentPlatform.value) || getPlatformConfig(currentPlatform.value)
  return platform.label || platform.title || 'Claude Code'
})

const filterOptions = [
  { label: '全部', value: 'all' },
  { label: '已安装', value: 'installed' },
  { label: '未安装', value: 'uninstalled' }
]

const installedCount = computed(() => plugins.value.filter(p => p.installed).length)

function requestContext(plugin = null) {
  return {
    ...(props.projectPath ? { cwd: props.projectPath } : {}),
    ...(plugin?.scope
      ? { scope: plugin.scope }
      : { scope: props.projectPath ? 'project' : 'user' })
  }
}

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
  if (capabilities.value.supportsPlugins === false) return capabilities.value.disabledReason || `${currentPlatformLabel.value} 暂未提供插件管理能力`
  return '暂无可用插件，请配置仓库源'
})

async function loadCapabilities(platform, requestId) {
  try {
    const res = await getPluginCapabilities(platform)
    if (requestId !== loadRequestId.value || platform !== currentPlatform.value) return false
    if (res.success && res.capabilities) {
      capabilities.value = {
        supportsPlugins: true,
        repositories: false,
        market: false,
        install: false,
        uninstall: false,
        import: false,
        syncRepos: false,
        ...res.capabilities
      }
      return true
    }
  } catch {
    if (requestId !== loadRequestId.value || platform !== currentPlatform.value) return false
    // 旧服务端降级：保留 Claude/OpenCode 可用，Codex 不再前端硬编码只读
  }
  if (requestId !== loadRequestId.value || platform !== currentPlatform.value) return false
  capabilities.value = {
    supportsPlugins: managedPluginPlatforms.value.includes(platform),
    repositories: managedPluginPlatforms.value.includes(platform),
    market: managedPluginPlatforms.value.includes(platform),
    install: managedPluginPlatforms.value.includes(platform),
    uninstall: managedPluginPlatforms.value.includes(platform),
    import: platform === 'claude',
    syncRepos: platform === 'claude'
  }
  return true
}

async function loadData(force = false) {
  const requestId = ++loadRequestId.value
  const platform = currentPlatform.value
  if (!supportsCurrentPlatform.value) {
    plugins.value = []
    setUnsupportedCapabilities()
    loading.value = false
    return
  }
  loading.value = true
  try {
    if (!await loadCapabilities(platform, requestId)) return
    if (requestId !== loadRequestId.value || platform !== currentPlatform.value) return

    if (capabilities.value.supportsPlugins === false) {
      plugins.value = []
      return
    }

    if (force && capabilities.value.syncRepos) {
      await syncPluginRepos(platform, requestContext()).catch(() => {})
      if (requestId !== loadRequestId.value || platform !== currentPlatform.value) return
    }

    const installedRes = await getPlugins(platform, {
      ...(props.projectPath ? { cwd: props.projectPath } : {})
    })
    if (requestId !== loadRequestId.value || platform !== currentPlatform.value) return

    const installedList = installedRes.success ? installedRes.plugins : []
    let marketList = []

    const mergePluginLists = (installed, market) => {
      const marketById = {}
      for (const mp of market) {
        marketById[mp.pluginId || mp.id || mp.name] = mp
      }

      const installedPlugins = installed.map(p => {
        const identity = p.pluginId || p.id || p.name
        const marketInfo = marketById[identity] || {}
        return {
          ...marketInfo,
          ...p,
          installed: true,
          key: p.key || `installed-${identity}-${p.scope || 'user'}`,
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
          marketplace: p.marketplace || marketInfo.marketplace || '',
          installSource: p.installSource || marketInfo.installSource || '',
          readmeUrl: p.readmeUrl || marketInfo.readmeUrl || '',
          containsSkills: Boolean(p.containsSkills || marketInfo.containsSkills),
          skillPaths: Array.isArray(p.skillPaths) ? p.skillPaths : (Array.isArray(marketInfo.skillPaths) ? marketInfo.skillPaths : []),
          pluginKind: p.pluginKind || marketInfo.pluginKind || ((p.containsSkills || marketInfo.containsSkills) ? 'skill-bundle' : 'plugin'),
          strict: Object.prototype.hasOwnProperty.call(p, 'strict') ? p.strict : marketInfo.strict,
          directory: p.directory || marketInfo.directory || p.installPath || ''
        }
      })

      const installedIds = new Set(installed.map(p => p.pluginId || p.id || p.name))
      const uninstalledPlugins = market
        .filter(p => !installedIds.has(p.pluginId || p.id || p.name))
        .map(p => ({
          ...p,
          installed: false,
          key: p.key || `market-${p.pluginId || p.id || p.name}`
        }))

      return [...installedPlugins, ...uninstalledPlugins]
    }

    plugins.value = mergePluginLists(installedList, marketList)

    if (capabilities.value.market) {
      getMarketPlugins(platform, force, {
        ...(props.projectPath ? { cwd: props.projectPath } : {})
      })
        .catch(() => ({ success: true, plugins: [] }))
        .then((marketRes) => {
          if (requestId !== loadRequestId.value || platform !== currentPlatform.value) return
          marketList = marketRes.success ? marketRes.plugins : []
          plugins.value = mergePluginLists(installedList, marketList)
        })
    }
  } catch (err) {
    if (requestId === loadRequestId.value && platform === currentPlatform.value) {
      message.error('加载插件失败: ' + err.message)
    }
  } finally {
    if (requestId === loadRequestId.value) {
      loading.value = false
    }
  }
}

async function handleImport() {
  if (!supportsCurrentPlatform.value || currentPlatform.value !== 'claude') return
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
  if (!supportsCurrentPlatform.value || !capabilities.value.install || plugin.readonly) return
  if (!plugin.installSource && !plugin.repoOwner && !plugin.repoProjectPath && !plugin.repoLocalPath) {
    return message.error('缺少可安装来源')
  }
  installingKeys.value[plugin.key] = true
  try {
    const res = plugin.installSource
      ? await installPlugin(
        '',
        null,
        currentPlatform.value,
        plugin.pluginId || plugin.installSource,
        requestContext(plugin),
        plugin
      )
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
          repoUrl: plugin.repoUrl,
          marketplace: plugin.marketplace
        },
        currentPlatform.value,
        '',
        requestContext(plugin),
        plugin
      )
    if (res.success) {
      message.success(`插件 "${plugin.name}" 安装成功`)
      const idx = plugins.value.findIndex(p => p.key === plugin.key)
      if (idx !== -1) {
        plugins.value[idx] = {
          ...plugins.value[idx],
          installed: true,
          key: `installed-${plugin.pluginId || plugin.id || plugin.name}-${plugin.scope || requestContext(plugin).scope}`
        }
      }
    } else { message.error(res.message || '安装失败') }
  } catch (err) { message.error('安装失败: ' + err.message) }
  finally { delete installingKeys.value[plugin.key] }
}

async function handleUninstall(plugin) {
  if (!supportsCurrentPlatform.value || !capabilities.value.uninstall || plugin.readonly) return
  uninstallingKeys.value[plugin.key] = true
  try {
    const res = await uninstallPlugin(
      plugin.pluginId || plugin.id || plugin.name,
      currentPlatform.value,
      requestContext(plugin)
    )
    if (res.success) {
      message.success(`插件 "${plugin.name}" 已卸载`)
      const idx = plugins.value.findIndex(p => p.key === plugin.key)
      if (idx !== -1) {
        plugins.value[idx] = {
          ...plugins.value[idx],
          installed: false,
          key: `market-${plugin.pluginId || plugin.id || plugin.name}`
        }
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
.back-btn { padding: 4px; }
.action-btn { padding: 4px 8px; }
</style>
