<template>
  <div class="rules-panel" :class="{ 'in-drawer': props.inDrawer }">
    <!-- 头部 -->
    <div class="panel-header" v-if="!props.inDrawer">
      <div class="header-left">
        <n-button v-if="!props.hideBack" text @click="handleBack" class="back-btn">
          <template #icon>
            <n-icon><ArrowBackOutline /></n-icon>
          </template>
        </n-button>
        <span class="panel-title">Rules 规则</span>
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
        共 {{ rules.length }} 条规则
        <template v-if="rules.length > 0">
          · 用户级: {{ userCount }} · 项目级: {{ projectCount }}
        </template>
      </span>
    </div>

    <!-- 搜索和筛选 -->
    <div class="filter-bar">
      <n-input
        v-model:value="searchQuery"
        placeholder="搜索规则..."
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

    <!-- 规则列表 -->
    <div class="rules-content">
      <n-spin :show="loading">
        <div v-if="filteredRules.length === 0 && !loading" class="empty-state">
          <n-empty :description="emptyText">
            <template #icon>
              <n-icon size="48" color="var(--text-quaternary)">
                <BookOutline />
              </n-icon>
            </template>
            <template #extra>
              <n-button size="small" @click="showCreateModal = true">
                创建第一条规则
              </n-button>
            </template>
          </n-empty>
        </div>

        <div v-else class="rules-grid">
          <RuleCard
            v-for="rule in filteredRules"
            :key="rule.path"
            :rule="rule"
            :deleting="!!deletingKeys[rule.path]"
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
      <span>规则文件会自动加载到 Claude 上下文</span>
    </div>

    <!-- 创建/编辑弹窗 -->
    <RuleFormModal
      v-model:visible="showCreateModal"
      :rule="editingRule"
      :project-path="projectPath"
      @saved="handleSaved"
    />

    <!-- 详情抽屉 -->
    <n-drawer v-model:show="showDetailDrawer" :width="550">
      <n-drawer-content :title="selectedRule?.name || '规则详情'">
        <template v-if="selectedRule">
          <n-descriptions bordered :column="1">
            <n-descriptions-item label="作用域">
              {{ selectedRule.scope === 'user' ? '用户级' : '项目级' }}
            </n-descriptions-item>
            <n-descriptions-item label="文件路径">
              {{ selectedRule.path }}
            </n-descriptions-item>
            <n-descriptions-item label="子目录" v-if="selectedRule.directory">
              {{ selectedRule.directory }}
            </n-descriptions-item>
            <n-descriptions-item label="条件路径" v-if="selectedRule.paths">
              <n-tag type="warning" size="small">{{ selectedRule.paths }}</n-tag>
            </n-descriptions-item>
          </n-descriptions>

          <div class="detail-section">
            <h4>规则内容</h4>
            <n-code :code="selectedRule.body || '(无内容)'" language="markdown" word-wrap />
          </div>
        </template>
      </n-drawer-content>
    </n-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  NButton, NInput, NSelect, NIcon, NTag, NSpin, NEmpty,
  NDrawer, NDrawerContent, NDescriptions, NDescriptionsItem, NCode
} from 'naive-ui'
import {
  ArrowBackOutline,
  RefreshOutline,
  SearchOutline,
  InformationCircleOutline,
  AddOutline,
  BookOutline
} from '@vicons/ionicons5'
import { getRules, deleteRule } from '../api/rules'
import message from '../utils/message'
import RuleCard from './RuleCard.vue'
import RuleFormModal from './RuleFormModal.vue'

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

const rules = ref([])
const loading = ref(false)
const searchQuery = ref('')
const filterScope = ref('all')
const showCreateModal = ref(false)
const showDetailDrawer = ref(false)
const selectedRule = ref(null)
const editingRule = ref(null)
const deletingKeys = ref({})

const scopeOptions = [
  { label: '全部', value: 'all' },
  { label: '用户级', value: 'user' },
  { label: '项目级', value: 'project' }
]

const userCount = computed(() => rules.value.filter(r => r.scope === 'user').length)
const projectCount = computed(() => rules.value.filter(r => r.scope === 'project').length)

const filteredRules = computed(() => {
  let result = rules.value

  // 按作用域筛选
  if (filterScope.value !== 'all') {
    result = result.filter(rule => rule.scope === filterScope.value)
  }

  // 按搜索词筛选
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase()
    result = result.filter(rule =>
      rule.name?.toLowerCase().includes(query) ||
      rule.body?.toLowerCase().includes(query) ||
      rule.directory?.toLowerCase().includes(query) ||
      rule.paths?.toLowerCase().includes(query)
    )
  }

  return result
})

const emptyText = computed(() => {
  if (searchQuery.value) return '没有匹配的规则'
  if (filterScope.value === 'user') return '暂无用户级规则'
  if (filterScope.value === 'project') return '暂无项目级规则'
  return '暂无规则文件'
})

async function loadRules() {
  loading.value = true
  try {
    const result = await getRules(props.projectPath)
    if (result.success) {
      rules.value = result.rules || []
    }
  } catch (err) {
    message.error('加载规则列表失败: ' + err.message)
  } finally {
    loading.value = false
  }
}

function handleRefresh() {
  loadRules()
}

function handleEdit(rule) {
  editingRule.value = rule
  showCreateModal.value = true
}

async function handleDelete(rule) {
  deletingKeys.value[rule.path] = true
  try {
    const result = await deleteRule(rule.path, rule.scope, props.projectPath)
    if (result.success) {
      message.success('规则已删除')
      await loadRules()
      emit('updated')
    }
  } catch (err) {
    message.error('删除失败: ' + err.message)
  } finally {
    delete deletingKeys.value[rule.path]
  }
}

function handleCardClick(rule) {
  selectedRule.value = rule
  showDetailDrawer.value = true
}

function handleSaved() {
  editingRule.value = null
  loadRules()
  emit('updated')
}

function handleBack() {
  emit('back')
}

onMounted(() => {
  loadRules()
})
</script>

<style scoped>
.rules-panel {
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

.rules-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.rules-content :deep(.n-spin-container) {
  min-height: 300px;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
}

.rules-grid {
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
.rules-panel.in-drawer {
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

.rules-panel.in-drawer .filter-bar {
  padding: 10px 12px;
}

.rules-panel.in-drawer .stats-bar {
  padding: 10px 12px;
}

.rules-panel.in-drawer .rules-content {
  padding: 12px;
}

.rules-panel.in-drawer .panel-footer {
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
