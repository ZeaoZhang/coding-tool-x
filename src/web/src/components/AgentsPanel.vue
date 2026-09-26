<template>
  <div class="agents-panel asset-panel" :class="{ 'in-drawer': props.inDrawer }">
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
            <span class="asset-title">代理管理</span>
            <span class="asset-platform-pill">{{ currentPlatformLabel }}</span>
          </div>
          <div class="asset-subtitle">维护自定义代理、工具权限和平台启用状态</div>
        </div>
      </div>
      <div class="asset-action-row" v-if="supportsCurrentPlatform">
        <n-button text @click="openCreateModal" class="action-btn">
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
      <div class="asset-action-row" v-if="supportsCurrentPlatform">
        <n-button text @click="openCreateModal" class="action-btn">
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

    <div v-if="currentPlatform === 'omp'" class="omp-model-roles">
      <div class="omp-model-roles-toolbar">
        <div class="omp-model-roles-copy">
          <strong>OMP 模型角色</strong>
          <span>候选模型只取当前启用渠道。原生 OAuth 渠道读取允许模型列表（未设置时读取已声明模型），并使用 OAuth provider ID 作为前缀；OAuth Auth Gateway 使用该托管渠道的模型配置。思考强度会写入选择器后缀，例如 :high。</span>
          <span v-if="ompUnavailableRoles.length" class="omp-model-roles-stale">
            以下角色当前指向未启用渠道模型：{{ ompUnavailableRoles.join('、') }}。请切换到已启用渠道中的模型，或清空对应角色。
          </span>
          <div v-if="ompModelRolesLoadError" class="omp-model-roles-error">
            <span>{{ ompModelRolesLoadError }}</span>
            <n-button text size="tiny" :disabled="loadingOmpModelRoles" @click="loadOmpModelRoles">重试</n-button>
          </div>
        </div>
        <n-button
          type="primary"
          size="small"
          :loading="savingOmpModelRoles"
          :disabled="loadingOmpModelRoles || !!ompModelRolesLoadError || savingOmpModelRoles || !ompModelRolesDirty"
          @click="saveOmpModelRoles"
        >
          保存角色配置
        </n-button>
      </div>
      <div class="omp-model-roles-header">
        <span>角色</span>
        <span>模型</span>
        <span>思考强度</span>
      </div>
      <div
        v-for="role in ompModelRoleDefinitions"
        :key="role.key"
        class="omp-model-role-row"
      >
        <strong>{{ role.key }}</strong>
        <n-select
          v-model:value="role.model"
          :options="ompModelOptions"
          placeholder="请选择已启用渠道模型"
          filterable
          clearable
          size="small"
          :disabled="loadingOmpModelRoles || !!ompModelRolesLoadError || savingOmpModelRoles"
        />
        <n-select
          v-model:value="role.thinkingLevel"
          :options="ompThinkingOptions"
          placeholder="跟随默认"
          clearable
          size="small"
          :disabled="loadingOmpModelRoles || !!ompModelRolesLoadError || savingOmpModelRoles || !ompModelOptionValues.has(role.model)"
        />
      </div>
    </div>

    <!-- 统计栏 -->
    <div class="asset-summary">
      <span class="asset-summary-item">
        <span class="asset-summary-label">全部</span>
        <span class="asset-summary-value">{{ agents.length }}</span>
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
        placeholder="搜索代理、描述或文件名"
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

    <!-- 代理列表 -->
    <div class="asset-panel-content">
      <n-spin :show="loading">
        <div v-if="filteredAgents.length === 0 && !loading" class="asset-empty">
          <n-empty :description="emptyText">
            <template #icon>
              <n-icon size="48" color="var(--text-quaternary)">
                <PersonOutline />
              </n-icon>
            </template>
            <template #extra>
              <n-button size="small" @click="openCreateModal" v-if="supportsCurrentPlatform">
                创建第一个代理
              </n-button>
            </template>
          </n-empty>
        </div>

        <div v-else class="asset-list">
          <AgentCard
            v-for="agent in filteredAgents"
            :key="getAgentUiKey(agent)"
            :agent="agent"
            :deleting="!!deletingKeys[getAgentUiKey(agent)]"
            :registry-info="registryMap[getRegistryKeyForAgent(agent)]"
            :toggling="!!togglingKeys[getRegistryKeyForAgent(agent)]"
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
      <span>{{ agentUsageHint }}</span>
    </div>

    <!-- 创建/编辑弹窗 -->
    <AgentFormModal
      :visible="showCreateModal"
      @update:visible="handleModalVisibleChange"
      :agent="editingAgent"
      :project-path="projectPath"
      :platform="currentPlatform"
      @saved="handleSaved"
    />

    <AgentDetailDrawer
      v-model:visible="showDetailDrawer"
      :agent="selectedAgent"
      :platform="currentPlatform"
      :loading="detailLoading"
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
  PersonOutline
} from '@vicons/ionicons5'
import { getAgents, getAgent, deleteAgent } from '../api/agents'
import { client } from '../api/client'
import { listItems, toggleEnabled, togglePlatform, syncAll } from '../api/config-registry'
import message from '../utils/message'
import AgentCard from './AgentCard.vue'
import AgentDetailDrawer from './AgentDetailDrawer.vue'
import AgentFormModal from './AgentFormModal.vue'
import { getPlatformConfig } from '../config/platforms'
import { usePlatformStore } from '../stores/platforms'
import { useEnabledCliPlatforms } from '../composables/useEnabledCliPlatforms'
import { getRoutePlatform } from '../config/platformCatalog'

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
const platformStore = usePlatformStore()
const route = useRoute()
const agents = ref([])
const loading = ref(false)
const searchQuery = ref('')
const filterScope = ref('all')
const showCreateModal = ref(false)
const showDetailDrawer = ref(false)
const selectedAgent = ref(null)
const detailLoading = ref(false)
const editingAgent = ref(null)
const deletingKeys = ref({})
const registryMap = ref({})
const togglingKeys = ref({})
const ompModelRoleDefinitions = ref([])
const originalOmpModelRoles = ref('')
const ompModelOptions = ref([])
const ompUnavailableRoles = ref([])
const ompModelOptionValues = computed(() => new Set(ompModelOptions.value.map(option => option.value)))
const loadingOmpModelRoles = ref(false)
const savingOmpModelRoles = ref(false)
const ompModelRolesLoadError = ref('')
const ompModelRolesDirty = computed(() => JSON.stringify(ompModelRolesPayload()) !== originalOmpModelRoles.value)
let detailRequestId = 0
const { byCapability } = useEnabledCliPlatforms()
const managedAgentPlatforms = computed(() => byCapability('agents').map(platform => platform.key))
const supportsCurrentPlatform = computed(() => managedAgentPlatforms.value.includes(currentPlatform.value))

const OMP_MODEL_ROLE_KEYS = [
  'default', 'smol', 'slow', 'plan', 'commit', 'vision', 'designer', 'task', 'advisor', 'tiny'
]
const OMP_THINKING_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const ompThinkingOptions = OMP_THINKING_LEVELS.map(level => ({ label: level, value: level }))

function ompModelRolesPayload() {
  return Object.fromEntries(ompModelRoleDefinitions.value.map(role => [role.key, {
    model: role.model || '',
    thinkingLevel: role.thinkingLevel || ''
  }]))
}

function applyOmpModelRoleSettings(data = {}) {
  const roles = data.roles && typeof data.roles === 'object' ? data.roles : {}
  ompModelRoleDefinitions.value = OMP_MODEL_ROLE_KEYS.map(key => ({
    key,
    model: typeof roles[key]?.model === 'string' ? roles[key].model : '',
    thinkingLevel: typeof roles[key]?.thinkingLevel === 'string' ? roles[key].thinkingLevel : ''
  }))
  originalOmpModelRoles.value = JSON.stringify(ompModelRolesPayload())
  ompModelOptions.value = (Array.isArray(data.modelOptions) ? data.modelOptions : [])
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => ({ label: value, value }))
  ompUnavailableRoles.value = data.unavailableRoles && typeof data.unavailableRoles === 'object'
    ? Object.keys(data.unavailableRoles).filter(key => data.unavailableRoles[key] === true)
    : []
}

function getOmpModelRolesErrorMessage(error, fallback) {
  return error?.data?.error
    || error?.response?.data?.error
    || error?.message
    || fallback
}

const currentPlatform = computed(() => {
  const requested = String(props.platform || getRoutePlatform(route) || '').trim().toLowerCase()
  return requested
})

const agentUsageHint = computed(() =>
  currentPlatform.value === 'opencode'
    ? '使用 @agent 或 Task 在 OpenCode 中调用'
    : currentPlatform.value === 'omp'
    ? 'OMP Agent 由 task 工具按名称调用；模型可在 Agent 配置中单独指定'
    : currentPlatform.value === 'gemini'
    ? '使用 @agent 调用 Gemini 自定义代理'
    : '使用 Task tool 调用自定义代理'
)

const currentPlatformLabel = computed(() => {
  const platform = platformStore.get(currentPlatform.value) || getPlatformConfig(currentPlatform.value)
  return platform.label || platform.title || 'Claude Code'
})

const scopeOptions = [
  { label: '全部', value: 'all' },
  { label: '用户级', value: 'user' },
  { label: '项目级', value: 'project' },
  { label: '已托管', value: 'managed' }
]

const userCount = computed(() => agents.value.filter(a => a.scope === 'user').length)
const projectCount = computed(() => agents.value.filter(a => a.scope === 'project').length)
const managedCount = computed(() => Object.keys(registryMap.value).length)

function getAgentUiKey(agent) {
  if (!agent) {
    return ''
  }

  const scope = typeof agent.scope === 'string' && agent.scope.trim() ? agent.scope.trim() : 'unknown'
  const relativePath = typeof agent.path === 'string' && agent.path.trim() ? agent.path.trim() : ''
  const fileName = typeof agent.fileName === 'string' && agent.fileName.trim() ? agent.fileName.trim() : ''
  return `${scope}:${relativePath || fileName}`
}

function getRegistryKeyForAgent(agent) {
  if (!agent) {
    return ''
  }

  const candidates = []
  if (typeof agent.path === 'string' && agent.path.trim()) {
    candidates.push(agent.path.trim())
  }
  if (typeof agent.fileName === 'string' && agent.fileName.trim()) {
    const fileName = agent.fileName.trim()
    candidates.push(`${fileName}.md`, fileName)
  }
  if (typeof agent.name === 'string' && agent.name.trim()) {
    candidates.push(agent.name.trim())
  }

  for (const candidate of candidates) {
    if (registryMap.value[candidate]) {
      return candidate
    }
  }

  return candidates[0] || ''
}

const filteredAgents = computed(() => {
  let result = agents.value

  // 按作用域筛选
  if (filterScope.value === 'user') {
    result = result.filter(agent => agent.scope === 'user')
  } else if (filterScope.value === 'project') {
    result = result.filter(agent => agent.scope === 'project')
  } else if (filterScope.value === 'managed') {
    result = result.filter(agent => registryMap.value[getRegistryKeyForAgent(agent)])
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
  if (filterScope.value === 'managed') return '暂无托管的代理'
  if (!supportsCurrentPlatform.value) return `${currentPlatformLabel.value} 暂未提供 Agents 能力`
  return '暂无自定义代理'
})

async function loadAgents() {
  if (!supportsCurrentPlatform.value) {
    agents.value = []
    registryMap.value = {}
    loading.value = false
    return
  }
  loading.value = true
  try {
    const [agentRes, registryRes] = await Promise.all([
      getAgents(props.projectPath, currentPlatform.value),
      listItems('agents', { platform: currentPlatform.value, projectPath: props.projectPath })
    ])
    if (agentRes.success) {
      agents.value = agentRes.agents || []
    }
    if (registryRes.success) {
      registryMap.value = {}
      for (const [name, item] of Object.entries(registryRes.items || {})) {
        registryMap.value[name] = item
      }
    }
  } catch (err) {
    message.error('加载代理列表失败: ' + err.message)
  } finally {
    loading.value = false
  }
}

async function handleToggleEnabled(agent, enabled) {
  const registryKey = getRegistryKeyForAgent(agent)
  if (!registryKey) {
    message.error('未找到代理对应的托管配置键')
    return
  }

  togglingKeys.value[registryKey] = true
  try {
    const res = await toggleEnabled('agents', registryKey, enabled)
    if (res.success) {
      message.success(enabled ? '已启用' : '已禁用')
      await loadAgents()
    }
  } catch (err) {
    message.error('切换失败: ' + err.message)
  } finally {
    delete togglingKeys.value[registryKey]
  }
}

async function handleTogglePlatform(agent, platform, enabled) {
  const registryKey = getRegistryKeyForAgent(agent)
  if (!registryKey) {
    message.error('未找到代理对应的托管配置键')
    return
  }

  togglingKeys.value[registryKey] = true
  try {
    const res = await togglePlatform('agents', registryKey, platform, enabled)
    if (res.success) {
      message.success(`${platform} ${enabled ? '已启用' : '已禁用'}`)
      await loadAgents()
    }
  } catch (err) {
    message.error('切换失败: ' + err.message)
  } finally {
    delete togglingKeys.value[registryKey]
  }
}

async function handleRefresh() {
  loading.value = true
  try {
    const syncResult = await syncAll('agents')
    if (!syncResult?.success) {
      message.warning(syncResult?.message || '同步失败，已继续刷新列表')
    }
  } catch (err) {
    message.warning('同步失败，已继续刷新列表: ' + err.message)
  }
  await loadAgents()
}

async function loadOmpModelRoles() {
  if (currentPlatform.value !== 'omp') return
  loadingOmpModelRoles.value = true
  ompModelRolesLoadError.value = ''
  try {
    const { data } = await client.get('/settings/omp-model-roles')
    applyOmpModelRoleSettings(data)
  } catch (error) {
    ompModelRolesLoadError.value = `加载 OMP 角色配置失败：${getOmpModelRolesErrorMessage(error, '未知错误')}`
  } finally {
    loadingOmpModelRoles.value = false
  }
}

async function saveOmpModelRoles() {
  if (loadingOmpModelRoles.value || savingOmpModelRoles.value || ompModelRolesLoadError.value) return
  savingOmpModelRoles.value = true
  try {
    const { data } = await client.put('/settings/omp-model-roles', {
      roles: ompModelRolesPayload()
    })
    applyOmpModelRoleSettings(data)
    message.success('OMP 模型角色配置已保存')
  } catch (error) {
    message.error(`保存 OMP 角色配置失败：${getOmpModelRolesErrorMessage(error, '未知错误')}`)
  } finally {
    savingOmpModelRoles.value = false
  }
}

function openCreateModal() {
  editingAgent.value = null
  showCreateModal.value = true
}

function handleModalVisibleChange(visible) {
  showCreateModal.value = visible
  if (!visible) {
    editingAgent.value = null
  }
}

function handleEdit(agent) {
  loadAgentDetail(agent, true)
}

async function handleDelete(agent) {
  const key = getAgentUiKey(agent)
  deletingKeys.value[key] = true
  try {
    const result = await deleteAgent(agent.fileName, agent.scope, props.projectPath, currentPlatform.value)
    if (result.success) {
      message.success('代理已删除')
      await loadAgents()
      emit('updated')
    }
  } catch (err) {
    message.error('删除失败: ' + err.message)
  } finally {
    delete deletingKeys.value[key]
  }
}

async function loadAgentDetail(agent, forEdit = false) {
  if (!agent) return

  const requestId = ++detailRequestId
  detailLoading.value = true
  if (!forEdit) {
    selectedAgent.value = null
    showDetailDrawer.value = true
  }

  try {
    const detailRes = await getAgent(agent.fileName, agent.scope, props.projectPath, currentPlatform.value)
    if (requestId !== detailRequestId) return

    const nextAgent = detailRes?.agent || agent
    if (forEdit) {
      editingAgent.value = nextAgent
      showCreateModal.value = true
    } else {
      selectedAgent.value = nextAgent
    }
  } catch (err) {
    if (requestId !== detailRequestId) return
    message.error('加载代理详情失败: ' + err.message)
    if (forEdit) {
      editingAgent.value = agent
      showCreateModal.value = true
    } else {
      selectedAgent.value = agent
    }
  } finally {
    if (requestId === detailRequestId) {
      detailLoading.value = false
    }
  }
}

function handleCardClick(agent) {
  loadAgentDetail(agent, false)
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
  loadOmpModelRoles()
})

watch(currentPlatform, () => {
  detailRequestId += 1
  detailLoading.value = false
  selectedAgent.value = null
  loadAgents()
  loadOmpModelRoles()
})
</script>

<style scoped>
.back-btn {
  padding: 4px;
}

.action-btn {
  padding: 4px 8px;
}

.omp-model-roles {
  margin: 0 14px 12px;
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  background: var(--bg-secondary);
}

.omp-model-roles-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px;
}

.omp-model-roles-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  font-size: 12px;
}

.omp-model-roles-copy strong {
  color: var(--text-primary);
  font-size: 13px;
}

.omp-model-roles-copy span {
  color: var(--text-secondary);
  line-height: 1.5;
}

.omp-model-roles-copy .omp-model-roles-stale {
  color: var(--n-warning-color, #f0a020);
}

.omp-model-roles-error {
  color: var(--n-error-color, #d03050);
  display: flex;
  align-items: center;
  gap: 8px;
}

.omp-model-roles-error span {
  color: inherit;
}

.omp-model-roles-header,
.omp-model-role-row {
  display: grid;
  grid-template-columns: 88px minmax(180px, 1.4fr) minmax(130px, 0.8fr);
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
}

.omp-model-roles-header {
  color: var(--text-secondary);
  font-size: 11px;
  border-top: 1px solid var(--border-primary);
  border-bottom: 1px solid var(--border-primary);
}

.omp-model-role-row + .omp-model-role-row {
  border-top: 1px solid var(--border-primary);
}

.omp-model-role-row strong {
  color: var(--text-primary);
  font-size: 12px;
}

@media (max-width: 600px) {
  .omp-model-roles-toolbar {
    align-items: flex-start;
  }

  .omp-model-roles-header {
    display: none;
  }

  .omp-model-role-row {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  .omp-model-role-row strong {
    grid-column: 1 / -1;
  }
}
</style>
