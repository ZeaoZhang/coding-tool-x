<template>
  <div class="commands-panel asset-panel" :class="{ 'in-drawer': props.inDrawer }">
    <!-- 头部 -->
    <div class="asset-panel-header" v-if="!props.inDrawer">
      <div class="asset-title-group">
        <n-button v-if="!props.hideBack" text @click="handleBack" class="back-btn">
          <template #icon>
            <n-icon><ArrowBackOutline /></n-icon>
          </template>
        </n-button>
        <div class="asset-heading">
          <div class="asset-title-row">
            <span class="asset-title">命令管理</span>
            <span class="asset-platform-pill">{{ currentPlatformLabel }}</span>
          </div>
          <div class="asset-subtitle">维护 slash commands、作用域和跨平台启用状态</div>
        </div>
      </div>
      <div class="asset-action-row">
        <n-button text @click="showCreateModal = true" class="action-btn">
          <template #icon>
            <n-icon><AddOutline /></n-icon>
          </template>
          创建
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
    <div class="asset-drawer-toolbar" v-if="props.inDrawer">
      <div class="asset-action-row">
        <n-button text @click="showCreateModal = true" class="action-btn">
          <template #icon>
            <n-icon><AddOutline /></n-icon>
          </template>
          创建
        </n-button>
        <n-button text @click="handleRefresh" :loading="loading" class="action-btn">
          <template #icon>
            <n-icon><RefreshOutline /></n-icon>
          </template>
          刷新
        </n-button>
      </div>
    </div>

    <!-- 统计栏 -->
    <div class="asset-summary">
      <span class="asset-summary-item">
        <span class="asset-summary-label">全部</span>
        <span class="asset-summary-value">{{ commands.length }}</span>
      </span>
      <span class="asset-summary-item">
        <span class="asset-summary-label">用户级</span>
        <span class="asset-summary-value">{{ userCount }}</span>
      </span>
      <span class="asset-summary-item">
        <span class="asset-summary-label">项目级</span>
        <span class="asset-summary-value">{{ projectCount }}</span>
      </span>
      <span class="asset-summary-item">
        <span class="asset-summary-label">托管</span>
        <span class="asset-summary-value">{{ managedCount }}</span>
      </span>
    </div>

    <!-- 搜索和筛选 -->
    <div class="asset-filter-bar">
      <n-input
        v-model:value="searchQuery"
        placeholder="搜索命令、描述或命名空间"
        clearable
        size="small"
        class="asset-search"
      >
        <template #prefix>
          <n-icon><SearchOutline /></n-icon>
        </template>
      </n-input>
      <n-select
        v-model:value="filterScope"
        :options="scopeOptions"
        size="small"
        class="asset-filter"
      />
    </div>

    <!-- 命令列表 -->
    <div class="asset-panel-content">
      <n-spin :show="loading">
        <div v-if="filteredCommands.length === 0 && !loading" class="asset-empty">
          <n-empty :description="emptyText">
            <template #icon>
              <n-icon size="48" color="var(--text-quaternary)">
                <TerminalOutline />
              </n-icon>
            </template>
            <template #extra>
              <n-button size="small" @click="showCreateModal = true">
                创建第一个命令
              </n-button>
            </template>
          </n-empty>
        </div>

        <div v-else class="asset-list">
          <CommandCard
            v-for="cmd in filteredCommands"
            :key="cmd.path"
            :command="cmd"
            :deleting="!!deletingKeys[cmd.path]"
            :registry-info="registryMap[cmd.name]"
            :toggling="!!togglingKeys[cmd.name]"
            @edit="handleEdit"
            @delete="handleDelete"
            @click="handleCardClick"
            @toggle-enabled="handleToggleEnabled"
            @toggle-platform="handleTogglePlatform"
          />
        </div>
      </n-spin>
    </div>

    <!-- 提示信息 -->
    <div class="asset-footer">
      <n-icon size="14" class="asset-info-icon"><InformationCircleOutline /></n-icon>
      <span>{{ commandUsageHint }}</span>
    </div>

    <!-- 创建/编辑弹窗 -->
    <CommandFormModal
      v-model:visible="showCreateModal"
      :command="editingCommand"
      :project-path="projectPath"
      :platform="currentPlatform"
      @saved="handleSaved"
    />

    <CommandDetailDrawer
      v-model:visible="showDetailDrawer"
      :command="selectedCommand"
      :platform="currentPlatform"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  NButton, NInput, NSelect, NIcon, NSpin, NEmpty
} from 'naive-ui'
import {
  ArrowBackOutline,
  RefreshOutline,
  SearchOutline,
  InformationCircleOutline,
  AddOutline,
  TerminalOutline
} from '@vicons/ionicons5'
import { getCommands, deleteCommand } from '../api/commands'
import { listItems, toggleEnabled, togglePlatform, syncAll } from '../api/config-registry'
import message from '../utils/message'
import CommandCard from './CommandCard.vue'
import CommandDetailDrawer from './CommandDetailDrawer.vue'
import CommandFormModal from './CommandFormModal.vue'
import { BUILT_IN_CLI_PLATFORMS, getPlatformConfig } from '../config/platforms'

const props = defineProps({
  hideBack: {
    type: Boolean,
    default: false
  },
  inDrawer: {
    type: Boolean,
    default: false
  },
  projectPath: {
    type: String,
    default: null
  },
  platform: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['back', 'updated'])
const route = useRoute()

const commands = ref([])
const loading = ref(false)
const searchQuery = ref('')
const filterScope = ref('all')
const showCreateModal = ref(false)
const showDetailDrawer = ref(false)
const selectedCommand = ref(null)
const editingCommand = ref(null)
const deletingKeys = ref({})
const registryMap = ref({})
const togglingKeys = ref({})
const managedCommandPlatforms = BUILT_IN_CLI_PLATFORMS
  .filter(platform => platform.supportsCommands !== false)
  .map(platform => platform.key)

const currentPlatform = computed(() => {
  if (managedCommandPlatforms.includes(props.platform)) {
    return props.platform
  }
  const channel = route.meta.channel
  if (managedCommandPlatforms.includes(channel)) return channel
  return 'claude'
})

const commandUsageHint = computed(() =>
  currentPlatform.value === 'opencode'
    ? '使用 /命令名 在 OpenCode 中调用'
    : currentPlatform.value === 'pi'
    ? '使用 OMP slash command 调用'
    : currentPlatform.value === 'gemini'
    ? '使用 /命令名 在 Gemini CLI 中调用'
    : currentPlatform.value === 'codex'
    ? '使用 /命令名 在 Codex CLI 中调用'
    : '使用 /命令名 在 Claude Code 中调用'
)

const currentPlatformLabel = computed(() => {
  const platform = getPlatformConfig(currentPlatform.value)
  return platform.label || platform.title || 'Claude Code'
})

const scopeOptions = [
  { label: '全部', value: 'all' },
  { label: '用户级', value: 'user' },
  { label: '项目级', value: 'project' },
  { label: '已托管', value: 'managed' }
]

const userCount = computed(() => commands.value.filter(c => c.scope === 'user').length)
const projectCount = computed(() => commands.value.filter(c => c.scope === 'project').length)
const managedCount = computed(() => Object.keys(registryMap.value).length)

const filteredCommands = computed(() => {
  let result = commands.value

  // 按作用域筛选
  if (filterScope.value === 'user') {
    result = result.filter(cmd => cmd.scope === 'user')
  } else if (filterScope.value === 'project') {
    result = result.filter(cmd => cmd.scope === 'project')
  } else if (filterScope.value === 'managed') {
    result = result.filter(cmd => registryMap.value[cmd.name])
  }

  // 按搜索词筛选
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase()
    result = result.filter(cmd =>
      cmd.name?.toLowerCase().includes(query) ||
      cmd.description?.toLowerCase().includes(query) ||
      cmd.namespace?.toLowerCase().includes(query)
    )
  }

  return result
})

const emptyText = computed(() => {
  if (searchQuery.value) return '没有匹配的命令'
  if (filterScope.value === 'user') return '暂无用户级命令'
  if (filterScope.value === 'project') return '暂无项目级命令'
  if (filterScope.value === 'managed') return '暂无托管的命令'
  return '暂无自定义命令'
})

async function loadCommands() {
  loading.value = true
  try {
    const [cmdRes, registryRes] = await Promise.all([
      getCommands(props.projectPath, currentPlatform.value),
      listItems('commands')
    ])
    if (cmdRes.success) {
      commands.value = cmdRes.commands || []
    }
    if (registryRes.success) {
      registryMap.value = {}
      for (const [name, item] of Object.entries(registryRes.items || {})) {
        registryMap.value[name] = item
      }
    }
  } catch (err) {
    message.error('加载命令列表失败: ' + err.message)
  } finally {
    loading.value = false
  }
}

async function handleToggleEnabled(cmd, enabled) {
  togglingKeys.value[cmd.name] = true
  try {
    const res = await toggleEnabled('commands', cmd.name, enabled)
    if (res.success) {
      message.success(enabled ? '已启用' : '已禁用')
      await loadCommands()
    }
  } catch (err) {
    message.error('切换失败: ' + err.message)
  } finally {
    delete togglingKeys.value[cmd.name]
  }
}

async function handleTogglePlatform(cmd, platform, enabled) {
  togglingKeys.value[cmd.name] = true
  try {
    const res = await togglePlatform('commands', cmd.name, platform, enabled)
    if (res.success) {
      message.success(`${platform} ${enabled ? '已启用' : '已禁用'}`)
      await loadCommands()
    }
  } catch (err) {
    message.error('切换失败: ' + err.message)
  } finally {
    delete togglingKeys.value[cmd.name]
  }
}

async function handleRefresh() {
  loading.value = true
  try {
    const syncResult = await syncAll('commands')
    if (!syncResult?.success) {
      message.warning(syncResult?.message || '同步失败，已继续刷新列表')
    }
  } catch (err) {
    message.warning('同步失败，已继续刷新列表: ' + err.message)
  }
  await loadCommands()
}

function handleEdit(cmd) {
  editingCommand.value = cmd
  showCreateModal.value = true
}

async function handleDelete(cmd) {
  deletingKeys.value[cmd.path] = true
  try {
    const result = await deleteCommand(cmd.name, cmd.scope, props.projectPath, cmd.namespace, currentPlatform.value)
    if (result.success) {
      message.success('命令已删除')
      await loadCommands()
      emit('updated')
    }
  } catch (err) {
    message.error('删除失败: ' + err.message)
  } finally {
    delete deletingKeys.value[cmd.path]
  }
}

function handleCardClick(cmd) {
  selectedCommand.value = cmd
  showDetailDrawer.value = true
}

function handleSaved() {
  editingCommand.value = null
  loadCommands()
  emit('updated')
}

function handleBack() {
  emit('back')
}

onMounted(() => {
  loadCommands()
})

watch(currentPlatform, () => {
  loadCommands()
})
</script>

<style scoped>
.back-btn {
  padding: 4px;
}

.action-btn {
  padding: 4px 8px;
}
</style>
