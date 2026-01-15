<template>
  <div class="agents-panel" :class="{ 'in-drawer': props.inDrawer }">
    <!-- 头部 -->
    <div class="panel-header" v-if="!props.inDrawer">
      <div class="header-left">
        <n-button v-if="!props.hideBack" text @click="handleBack" class="back-btn">
          <template #icon>
            <n-icon><ArrowBackOutline /></n-icon>
          </template>
        </n-button>
        <span class="panel-title">Custom Agents</span>
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
        共 {{ agents.length }} 个代理
        <template v-if="agents.length > 0">
          · 用户级: {{ userCount }} · 项目级: {{ projectCount }}
        </template>
      </span>
    </div>

    <!-- 搜索和筛选 -->
    <div class="filter-bar">
      <n-input
        v-model:value="searchQuery"
        placeholder="搜索代理..."
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

    <!-- 代理列表 -->
    <div class="agents-content">
      <n-spin :show="loading">
        <div v-if="filteredAgents.length === 0 && !loading" class="empty-state">
          <n-empty :description="emptyText">
            <template #icon>
              <n-icon size="48" color="var(--text-quaternary)">
                <PersonOutline />
              </n-icon>
            </template>
            <template #extra>
              <n-button size="small" @click="showCreateModal = true">
                创建第一个代理
              </n-button>
            </template>
          </n-empty>
        </div>

        <div v-else class="agents-grid">
          <AgentCard
            v-for="agent in filteredAgents"
            :key="agent.path"
            :agent="agent"
            :deleting="!!deletingKeys[agent.path]"
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
      <span>使用 Task tool 调用自定义代理</span>
    </div>

    <!-- 创建/编辑弹窗 -->
    <AgentFormModal
      v-model:visible="showCreateModal"
      :agent="editingAgent"
      :project-path="projectPath"
      @saved="handleSaved"
    />

    <!-- 详情抽屉 -->
    <n-drawer v-model:show="showDetailDrawer" :width="550">
      <n-drawer-content :title="selectedAgent?.name || '代理详情'">
        <template v-if="selectedAgent">
          <n-descriptions bordered :column="1">
            <n-descriptions-item label="作用域">
              {{ selectedAgent.scope === 'user' ? '用户级' : '项目级' }}
            </n-descriptions-item>
            <n-descriptions-item label="文件名">
              {{ selectedAgent.fileName }}.md
            </n-descriptions-item>
            <n-descriptions-item label="描述" v-if="selectedAgent.description">
              {{ selectedAgent.description }}
            </n-descriptions-item>
            <n-descriptions-item label="可用工具" v-if="selectedAgent.tools">
              {{ selectedAgent.tools }}
            </n-descriptions-item>
            <n-descriptions-item label="模型" v-if="selectedAgent.model">
              {{ selectedAgent.model }}
            </n-descriptions-item>
            <n-descriptions-item label="权限模式" v-if="selectedAgent.permissionMode">
              {{ selectedAgent.permissionMode }}
            </n-descriptions-item>
            <n-descriptions-item label="技能" v-if="selectedAgent.skills">
              {{ selectedAgent.skills }}
            </n-descriptions-item>
          </n-descriptions>

          <div class="detail-section">
            <h4>系统提示词</h4>
            <n-code :code="selectedAgent.systemPrompt || '(无内容)'" language="markdown" word-wrap />
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
  PersonOutline
} from '@vicons/ionicons5'
import { getAgents, deleteAgent } from '../api/agents'
import message from '../utils/message'
import AgentCard from './AgentCard.vue'
import AgentFormModal from './AgentFormModal.vue'

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

const agents = ref([])
const loading = ref(false)
const searchQuery = ref('')
const filterScope = ref('all')
const showCreateModal = ref(false)
const showDetailDrawer = ref(false)
const selectedAgent = ref(null)
const editingAgent = ref(null)
const deletingKeys = ref({})

const scopeOptions = [
  { label: '全部', value: 'all' },
  { label: '用户级', value: 'user' },
  { label: '项目级', value: 'project' }
]

const userCount = computed(() => agents.value.filter(a => a.scope === 'user').length)
const projectCount = computed(() => agents.value.filter(a => a.scope === 'project').length)

const filteredAgents = computed(() => {
  let result = agents.value

  // 按作用域筛选
  if (filterScope.value !== 'all') {
    result = result.filter(agent => agent.scope === filterScope.value)
  }

  // 按搜索词筛选
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase()
    result = result.filter(agent =>
      agent.name?.toLowerCase().includes(query) ||
      agent.description?.toLowerCase().includes(query) ||
      agent.fileName?.toLowerCase().includes(query)
    )
  }

  return result
})

const emptyText = computed(() => {
  if (searchQuery.value) return '没有匹配的代理'
  if (filterScope.value === 'user') return '暂无用户级代理'
  if (filterScope.value === 'project') return '暂无项目级代理'
  return '暂无自定义代理'
})

async function loadAgents() {
  loading.value = true
  try {
    const result = await getAgents(props.projectPath)
    if (result.success) {
      agents.value = result.agents || []
    }
  } catch (err) {
    message.error('加载代理列表失败: ' + err.message)
  } finally {
    loading.value = false
  }
}

function handleRefresh() {
  loadAgents()
}

function handleEdit(agent) {
  editingAgent.value = agent
  showCreateModal.value = true
}

async function handleDelete(agent) {
  deletingKeys.value[agent.path] = true
  try {
    const result = await deleteAgent(agent.fileName, agent.scope, props.projectPath)
    if (result.success) {
      message.success('代理已删除')
      await loadAgents()
      emit('updated')
    }
  } catch (err) {
    message.error('删除失败: ' + err.message)
  } finally {
    delete deletingKeys.value[agent.path]
  }
}

function handleCardClick(agent) {
  selectedAgent.value = agent
  showDetailDrawer.value = true
}

function handleSaved() {
  editingAgent.value = null
  loadAgents()
  emit('updated')
}

function handleBack() {
  emit('back')
}

onMounted(() => {
  loadAgents()
})
</script>

<style scoped>
.agents-panel {
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

.agents-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.agents-content :deep(.n-spin-container) {
  min-height: 300px;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
}

.agents-grid {
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
.agents-panel.in-drawer {
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

.agents-panel.in-drawer .filter-bar {
  padding: 10px 12px;
}

.agents-panel.in-drawer .stats-bar {
  padding: 10px 12px;
}

.agents-panel.in-drawer .agents-content {
  padding: 12px;
}

.agents-panel.in-drawer .panel-footer {
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
