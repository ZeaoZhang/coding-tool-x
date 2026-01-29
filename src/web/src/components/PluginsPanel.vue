<template>
  <div class="plugins-panel">
    <!-- Header -->
    <div class="panel-header">
      <div class="header-left">
        <n-button v-if="!hideBack" quaternary size="small" @click="$emit('back')">
          <template #icon><n-icon><ArrowBackOutline /></n-icon></template>
        </n-button>
        <h3 class="panel-title">Plugins</h3>
      </div>
      <div class="header-actions">
        <n-button size="small" quaternary @click="loadPlugins" :loading="loading">
          <template #icon><n-icon><RefreshOutline /></n-icon></template>
        </n-button>
        <n-button size="small" type="primary" @click="showInstallModal = true">
          <template #icon><n-icon><AddOutline /></n-icon></template>
          安装插件
        </n-button>
      </div>
    </div>

    <!-- Stats -->
    <div class="stats-bar">
      <div class="stat-item">
        <span class="stat-value">{{ plugins.length }}</span>
        <span class="stat-label">总计</span>
      </div>
      <div class="stat-item">
        <span class="stat-value enabled">{{ enabledCount }}</span>
        <span class="stat-label">已启用</span>
      </div>
      <div class="stat-item">
        <span class="stat-value disabled">{{ disabledCount }}</span>
        <span class="stat-label">已禁用</span>
      </div>
    </div>

    <!-- Search -->
    <div class="search-bar">
      <n-input
        v-model:value="searchQuery"
        placeholder="搜索插件..."
        clearable
        size="small"
      >
        <template #prefix>
          <n-icon><SearchOutline /></n-icon>
        </template>
      </n-input>
    </div>

    <!-- Content -->
    <div class="panel-content">
      <n-spin :show="loading">
        <div v-if="filteredPlugins.length > 0" class="plugins-grid">
          <PluginCard
            v-for="plugin in filteredPlugins"
            :key="plugin.name"
            :plugin="plugin"
            @toggle="handleToggle(plugin, $event)"
            @config="handleConfig(plugin)"
            @uninstall="handleUninstall(plugin)"
          />
        </div>
        <n-empty v-else description="暂无插件" class="empty-state">
          <template #icon>
            <n-icon :size="48"><ExtensionPuzzleOutline /></n-icon>
          </template>
          <template #extra>
            <n-button size="small" @click="showInstallModal = true">
              安装第一个插件
            </n-button>
          </template>
        </n-empty>
      </n-spin>
    </div>

    <!-- Install Modal -->
    <n-modal
      v-model:show="showInstallModal"
      preset="dialog"
      title="安装插件"
      positive-text="安装"
      negative-text="取消"
      :loading="installing"
      @positive-click="handleInstall"
    >
      <n-form ref="formRef" :model="installForm" :rules="installRules">
        <n-form-item label="Git 仓库地址" path="gitUrl">
          <n-input
            v-model:value="installForm.gitUrl"
            placeholder="https://github.com/user/plugin.git"
          />
        </n-form-item>
      </n-form>
      <div class="install-hint">
        支持 GitHub、GitLab 等 Git 仓库地址
      </div>
    </n-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { NButton, NIcon, NInput, NSpin, NEmpty, NModal, NForm, NFormItem } from 'naive-ui'
import { RefreshOutline, AddOutline, SearchOutline, ExtensionPuzzleOutline, ArrowBackOutline } from '@vicons/ionicons5'
import PluginCard from './PluginCard.vue'
import { getPlugins, installPlugin, uninstallPlugin, togglePlugin } from '../api/plugins'
import message from '../utils/message'

defineProps({
  hideBack: Boolean,
  inDrawer: Boolean
})

defineEmits(['back', 'updated'])

const loading = ref(false)
const installing = ref(false)
const plugins = ref([])
const searchQuery = ref('')
const showInstallModal = ref(false)
const formRef = ref(null)

const installForm = ref({
  gitUrl: ''
})

const installRules = {
  gitUrl: {
    required: true,
    message: '请输入 Git 仓库地址',
    trigger: 'blur'
  }
}

const enabledCount = computed(() => plugins.value.filter(p => p.enabled).length)
const disabledCount = computed(() => plugins.value.filter(p => !p.enabled).length)

const filteredPlugins = computed(() => {
  if (!searchQuery.value) return plugins.value
  const query = searchQuery.value.toLowerCase()
  return plugins.value.filter(p =>
    p.name.toLowerCase().includes(query) ||
    (p.description && p.description.toLowerCase().includes(query))
  )
})

async function loadPlugins() {
  loading.value = true
  try {
    const result = await getPlugins()
    if (result.success) {
      plugins.value = result.plugins || []
    } else {
      message.error(result.message || '加载插件列表失败')
    }
  } catch (err) {
    message.error('加载插件列表失败: ' + err.message)
  } finally {
    loading.value = false
  }
}

async function handleInstall() {
  try {
    await formRef.value?.validate()
  } catch {
    return false
  }

  installing.value = true
  try {
    const result = await installPlugin(installForm.value.gitUrl)
    if (result.success) {
      message.success('插件安装成功')
      showInstallModal.value = false
      installForm.value.gitUrl = ''
      loadPlugins()
    } else {
      message.error(result.message || '安装失败')
    }
  } catch (err) {
    message.error('安装失败: ' + err.message)
  } finally {
    installing.value = false
  }
  return false
}

async function handleToggle(plugin, enabled) {
  try {
    const result = await togglePlugin(plugin.name, enabled)
    if (result.success) {
      plugin.enabled = enabled
      message.success(enabled ? '插件已启用' : '插件已禁用')
    } else {
      message.error(result.message || '操作失败')
    }
  } catch (err) {
    message.error('操作失败: ' + err.message)
  }
}

function handleConfig(plugin) {
  message.info('配置功能开发中')
}

async function handleUninstall(plugin) {
  if (!confirm(`确定要卸载插件 "${plugin.name}" 吗？`)) return

  try {
    const result = await uninstallPlugin(plugin.name)
    if (result.success) {
      message.success('插件已卸载')
      loadPlugins()
    } else {
      message.error(result.message || '卸载失败')
    }
  } catch (err) {
    message.error('卸载失败: ' + err.message)
  }
}

onMounted(() => {
  loadPlugins()
})
</script>

<style scoped>
.plugins-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 0 16px 0;
  border-bottom: 1px solid var(--border-primary);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.header-actions {
  display: flex;
  gap: 8px;
}

.stats-bar {
  display: flex;
  gap: 24px;
  padding: 16px 0;
  border-bottom: 1px solid var(--border-primary);
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-value {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.stat-value.enabled {
  color: var(--primary-color);
}

.stat-value.disabled {
  color: var(--text-tertiary);
}

.stat-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.search-bar {
  padding: 16px 0;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
}

.plugins-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.empty-state {
  padding: 48px 0;
}

.install-hint {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-tertiary);
}
</style>
