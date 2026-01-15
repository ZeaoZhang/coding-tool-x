<template>
  <div class="commands-panel" :class="{ 'in-drawer': props.inDrawer }">
    <!-- 头部 -->
    <div class="panel-header" v-if="!props.inDrawer">
      <div class="header-left">
        <n-button v-if="!props.hideBack" text @click="handleBack" class="back-btn">
          <template #icon>
            <n-icon><ArrowBackOutline /></n-icon>
          </template>
        </n-button>
        <span class="panel-title">Custom Commands</span>
      </div>
      <div class="header-right">
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
    <div class="drawer-header-bar" v-if="props.inDrawer">
      <div class="header-right">
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
    <div class="stats-bar">
      <span class="stats-text">
        共 {{ commands.length }} 个命令
        <template v-if="commands.length > 0">
          · 用户级: {{ userCount }} · 项目级: {{ projectCount }}
        </template>
      </span>
    </div>

    <!-- 搜索和筛选 -->
    <div class="filter-bar">
      <n-input
        v-model:value="searchQuery"
        placeholder="搜索命令..."
        clearable
        size="small"
        class="search-input"
      >
        <template #prefix>
          <n-icon><SearchOutline /></n-icon>
        </template>
      </n-input>
      <n-select
        v-model:value="filterScope"
        :options="scopeOptions"
        size="small"
        class="filter-select"
      />
    </div>

    <!-- 命令列表 -->
    <div class="commands-content">
      <n-spin :show="loading">
        <div v-if="filteredCommands.length === 0 && !loading" class="empty-state">
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

        <div v-else class="commands-grid">
          <CommandCard
            v-for="cmd in filteredCommands"
            :key="cmd.path"
            :command="cmd"
            :deleting="!!deletingKeys[cmd.path]"
            @edit="handleEdit"
            @delete="handleDelete"
            @click="handleCardClick"
          />
        </div>
      </n-spin>
    </div>

    <!-- 提示信息 -->
    <div class="panel-footer">
      <n-icon size="14" class="info-icon"><InformationCircleOutline /></n-icon>
      <span>使用 /命令名 在 Claude Code 中调用</span>
    </div>

    <!-- 创建/编辑弹窗 -->
    <CommandFormModal
      v-model:visible="showCreateModal"
      :command="editingCommand"
      :project-path="projectPath"
      @saved="handleSaved"
    />

    <!-- 详情抽屉 -->
    <n-drawer v-model:show="showDetailDrawer" :width="500">
      <n-drawer-content :title="selectedCommand?.name ? '/' + selectedCommand.name : '命令详情'">
        <template v-if="selectedCommand">
          <n-descriptions bordered :column="1">
            <n-descriptions-item label="作用域">
              {{ selectedCommand.scope === 'user' ? '用户级' : '项目级' }}
            </n-descriptions-item>
            <n-descriptions-item label="命名空间" v-if="selectedCommand.namespace">
              {{ selectedCommand.namespace }}
            </n-descriptions-item>
            <n-descriptions-item label="描述" v-if="selectedCommand.description">
              {{ selectedCommand.description }}
            </n-descriptions-item>
            <n-descriptions-item label="允许的工具" v-if="selectedCommand.allowedTools">
              {{ selectedCommand.allowedTools }}
            </n-descriptions-item>
            <n-descriptions-item label="参数提示" v-if="selectedCommand.argumentHint">
              {{ selectedCommand.argumentHint }}
            </n-descriptions-item>
          </n-descriptions>

          <div class="detail-section">
            <h4>命令内容</h4>
            <n-code :code="selectedCommand.body || '(无内容)'" language="markdown" word-wrap />
          </div>
        </template>
      </n-drawer-content>
    </n-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  NButton, NInput, NSelect, NIcon, NSpin, NEmpty,
  NDrawer, NDrawerContent, NDescriptions, NDescriptionsItem, NCode
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
import message from '../utils/message'
import CommandCard from './CommandCard.vue'
import CommandFormModal from './CommandFormModal.vue'

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
  }
})

const emit = defineEmits(['back', 'updated'])

const commands = ref([])
const loading = ref(false)
const searchQuery = ref('')
const filterScope = ref('all')
const showCreateModal = ref(false)
const showDetailDrawer = ref(false)
const selectedCommand = ref(null)
const editingCommand = ref(null)
const deletingKeys = ref({})

const scopeOptions = [
  { label: '全部', value: 'all' },
  { label: '用户级', value: 'user' },
  { label: '项目级', value: 'project' }
]

const userCount = computed(() => commands.value.filter(c => c.scope === 'user').length)
const projectCount = computed(() => commands.value.filter(c => c.scope === 'project').length)

const filteredCommands = computed(() => {
  let result = commands.value

  // 按作用域筛选
  if (filterScope.value !== 'all') {
    result = result.filter(cmd => cmd.scope === filterScope.value)
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
  return '暂无自定义命令'
})

async function loadCommands() {
  loading.value = true
  try {
    const result = await getCommands(props.projectPath)
    if (result.success) {
      commands.value = result.commands || []
    }
  } catch (err) {
    message.error('加载命令列表失败: ' + err.message)
  } finally {
    loading.value = false
  }
}

function handleRefresh() {
  loadCommands()
}

function handleEdit(cmd) {
  editingCommand.value = cmd
  showCreateModal.value = true
}

async function handleDelete(cmd) {
  deletingKeys.value[cmd.path] = true
  try {
    const result = await deleteCommand(cmd.name, cmd.scope, props.projectPath, cmd.namespace)
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
</script>

<style scoped>
.commands-panel {
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

.stats-bar {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-primary);
}

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

.search-input {
  flex: 1;
}

.filter-select {
  width: 100px;
}

.commands-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.commands-content :deep(.n-spin-container) {
  min-height: 300px;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
}

.commands-grid {
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
.commands-panel.in-drawer {
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

.commands-panel.in-drawer .filter-bar {
  padding: 10px 12px;
}

.commands-panel.in-drawer .stats-bar {
  padding: 10px 12px;
}

.commands-panel.in-drawer .commands-content {
  padding: 12px;
}

.commands-panel.in-drawer .panel-footer {
  padding: 8px 12px;
}

/* 详情部分 */
.detail-section {
  margin-top: 16px;
}

.detail-section h4 {
  margin: 0 0 8px 0;
  font-size: 13px;
  color: var(--text-secondary);
}
</style>
