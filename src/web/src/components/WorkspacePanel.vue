<template>
  <div class="workspace-panel" :class="{ 'in-drawer': inDrawer }">
    <!-- 独立模式头部 -->
    <div class="panel-header" v-if="!inDrawer">
      <div class="header-left">
        <n-button v-if="!hideBack" text @click="$emit('back')" class="back-btn">
          <template #icon><n-icon><ArrowBackOutline /></n-icon></template>
        </n-button>
        <span class="panel-title">工作区管理</span>
      </div>
      <div class="header-right">
        <n-button text @click="showCreateModal = true" class="action-btn">
          <template #icon><n-icon><AddOutline /></n-icon></template>
          创建
        </n-button>
        <n-button text @click="loadData" :loading="loading" class="action-btn">
          <template #icon><n-icon><RefreshOutline /></n-icon></template>
          刷新
        </n-button>
      </div>
    </div>

    <!-- 抽屉模式头部 -->
    <div class="drawer-header-bar" v-if="inDrawer">
      <div class="header-right">
        <n-button text @click="showCreateModal = true" class="action-btn">
          <template #icon><n-icon><AddOutline /></n-icon></template>
          创建
        </n-button>
        <n-button text @click="loadData" :loading="loading" class="action-btn">
          <template #icon><n-icon><RefreshOutline /></n-icon></template>
          刷新
        </n-button>
      </div>
    </div>

    <!-- 统计栏 -->
    <div class="stats-bar">
      <span class="stats-text">
        共 {{ workspaces.length }} 个工作区
      </span>
    </div>

    <!-- 搜索筛选 -->
    <div class="filter-bar">
      <n-input v-model:value="searchQuery" placeholder="搜索工作区..." clearable size="small" class="search-input">
        <template #prefix><n-icon><SearchOutline /></n-icon></template>
      </n-input>
    </div>

    <!-- 内容区域 -->
    <div class="panel-content">
      <n-spin :show="loading">
        <div v-if="filteredWorkspaces.length === 0 && !loading" class="empty-state">
          <n-empty description="暂无工作区">
            <template #icon><n-icon size="48" color="var(--text-quaternary)"><FolderOpenOutline /></n-icon></template>
            <template #extra>
              <n-button size="small" @click="showCreateModal = true">创建第一个工作区</n-button>
            </template>
          </n-empty>
        </div>
        <div v-else class="card-list">
          <WorkspaceCard
            v-for="ws in filteredWorkspaces"
            :key="ws.id"
            :workspace="ws"
            @click="handleView"
            @view="handleView"
            @delete="handleDelete"
          />
        </div>
      </n-spin>
    </div>

    <!-- 底部提示 -->
    <div class="panel-footer">
      <n-icon size="14" class="info-icon"><InformationCircleOutline /></n-icon>
      <span>工作区用于管理多个项目的统一开发环境</span>
    </div>

    <!-- 创建工作区弹窗 -->
    <WorkspaceFormModal v-model:show="showCreateModal" @success="handleCreateSuccess" />

    <!-- 工作区详情弹窗 -->
    <WorkspaceDetailModal v-model:show="showDetailModal" :workspace="currentWorkspace" @deleted="loadData" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { NButton, NIcon, NInput, NSpin, NEmpty, useMessage, useDialog } from 'naive-ui'
import { ArrowBackOutline, AddOutline, RefreshOutline, SearchOutline, FolderOpenOutline, InformationCircleOutline } from '@vicons/ionicons5'
import { getWorkspaces, deleteWorkspace } from '../api/workspaces'
import WorkspaceCard from './WorkspaceCard.vue'
import WorkspaceFormModal from './WorkspaceFormModal.vue'
import WorkspaceDetailModal from './WorkspaceDetailModal.vue'

const props = defineProps({
  inDrawer: { type: Boolean, default: false },
  hideBack: { type: Boolean, default: false },
  drawerVisible: { type: Boolean, default: false }
})

const emit = defineEmits(['back', 'updated'])

const message = useMessage()
const dialog = useDialog()

const loading = ref(false)
const workspaces = ref([])
const searchQuery = ref('')
const showCreateModal = ref(false)
const showDetailModal = ref(false)
const currentWorkspace = ref(null)

const filteredWorkspaces = computed(() => {
  if (!searchQuery.value.trim()) return workspaces.value
  const q = searchQuery.value.toLowerCase()
  return workspaces.value.filter(ws =>
    ws.name?.toLowerCase().includes(q) ||
    ws.description?.toLowerCase().includes(q) ||
    ws.path?.toLowerCase().includes(q)
  )
})

async function loadData() {
  loading.value = true
  try {
    const res = await getWorkspaces()
    if (res.success) {
      workspaces.value = res.data || []
    }
  } catch (err) {
    message.error('加载工作区失败: ' + err.message)
  } finally {
    loading.value = false
  }
}

function handleView(ws) {
  currentWorkspace.value = ws
  showDetailModal.value = true
}

function handleDelete(ws) {
  dialog.warning({
    title: '确认删除',
    content: `确定要删除工作区"${ws.name}"吗？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const res = await deleteWorkspace(ws.id, false)
        if (res.success) {
          message.success('删除成功')
          loadData()
          emit('updated')
        } else {
          message.error(res.message || '删除失败')
        }
      } catch (err) {
        message.error('删除失败: ' + err.message)
      }
    }
  })
}

function handleCreateSuccess() {
  showCreateModal.value = false
  loadData()
  emit('updated')
}

onMounted(() => loadData())

watch(() => props.drawerVisible, (val) => {
  if (val) loadData()
})
</script>

<style scoped>
.workspace-panel {
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

.drawer-header-bar {
  padding: 8px 12px;
}

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
.workspace-panel.in-drawer .stats-bar { padding: 10px 12px; }
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

.workspace-panel.in-drawer .filter-bar {
  padding: 10px 12px;
}

.search-input { flex: 1; }

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.workspace-panel.in-drawer .panel-content {
  padding: 12px;
}

.panel-content :deep(.n-spin-container) {
  min-height: 200px;
}

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

.workspace-panel.in-drawer .panel-footer {
  padding: 8px 12px;
}

.info-icon { color: var(--text-quaternary); }
</style>
