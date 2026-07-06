<template>
  <div class="templates-panel" :class="{ 'in-drawer': inDrawer }">
    <!-- 独立模式头部 -->
    <div class="panel-header" v-if="!inDrawer">
      <div class="header-left">
        <n-button v-if="!hideBack" text @click="$emit('back')" class="back-btn">
          <template #icon><n-icon><ArrowBackOutline /></n-icon></template>
        </n-button>
        <span class="panel-title">配置模版管理</span>
      </div>
      <div class="header-right">
        <n-button text @click="handleCreate" class="action-btn">
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
        <n-button text @click="handleCreate" class="action-btn">
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
        共 {{ templates.length }} 个模版
      </span>
    </div>

    <!-- 搜索筛选 -->
    <div class="filter-bar">
      <n-input v-model:value="searchQuery" placeholder="搜索模版..." clearable size="small" class="search-input">
        <template #prefix><n-icon><SearchOutline /></n-icon></template>
      </n-input>
      <n-select v-model:value="filterCliType" :options="cliTypeFilterOptions" size="small" class="filter-select" />
    </div>

    <!-- 内容区域 -->
    <div class="panel-content">
      <n-spin :show="loading">
        <div v-if="filteredTemplates.length === 0 && !loading" class="empty-state">
          <n-empty description="暂无配置模版">
            <template #icon><n-icon size="48" color="var(--text-quaternary)"><DocumentOutline /></n-icon></template>
            <template #extra>
              <n-button size="small" @click="handleCreate">创建第一个模版</n-button>
            </template>
          </n-empty>
        </div>
        <div v-else class="card-list">
          <ConfigTemplateCard
            v-for="tpl in filteredTemplates"
            :key="tpl.id"
            :template="tpl"
            :deleting="deletingId === tpl.id"
            @click="handlePreview"
            @preview="handlePreview"
            @edit="handleEdit"
            @delete="handleDelete"
            @apply="handleApply"
          />
        </div>
      </n-spin>
    </div>

    <!-- 底部提示 -->
    <div class="panel-footer">
      <n-icon size="14" class="info-icon"><InformationCircleOutline /></n-icon>
      <span>配置模版可快速应用到工作区</span>
    </div>

    <!-- 弹窗组件 -->
    <ConfigTemplateFormModal v-model:show="showFormModal" :template="editingTemplate" :available-configs="availableConfigs" @success="handleFormSuccess" />
    <ConfigApplyModal v-model:show="showApplyModal" :template="applyingTemplate" @success="handleApplySuccess" />
    <ConfigPreviewModal v-model:show="showPreviewModal" :template="previewTemplate" @apply="handleApply" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { NButton, NIcon, NInput, NSelect, NSpin, NEmpty, useMessage, useDialog } from 'naive-ui'
import { ArrowBackOutline, AddOutline, RefreshOutline, SearchOutline, DocumentOutline, InformationCircleOutline } from '@vicons/ionicons5'
import { getAllTemplates, getAvailableConfigs, deleteTemplate } from '../api/config-templates'
import ConfigTemplateCard from './ConfigTemplateCard.vue'
import ConfigTemplateFormModal from './ConfigTemplateFormModal.vue'
import ConfigApplyModal from './ConfigApplyModal.vue'
import ConfigPreviewModal from './ConfigPreviewModal.vue'

const props = defineProps({
  inDrawer: { type: Boolean, default: false },
  hideBack: { type: Boolean, default: false },
  drawerVisible: { type: Boolean, default: false }
})

defineEmits(['back', 'updated'])

const message = useMessage()
const dialog = useDialog()

const loading = ref(false)
const templates = ref([])
const availableConfigs = ref({})
const searchQuery = ref('')
const filterCliType = ref('')

const cliTypeFilterOptions = [
  { label: '全部 CLI', value: '' },
  { label: 'Claude Code', value: 'claude' },
  { label: 'Codex', value: 'codex' },
  { label: 'Gemini', value: 'gemini' },
  { label: 'OpenCode', value: 'opencode' },
  { label: 'Pi Agent', value: 'pi' }
]

const deletingId = ref(null)

const showFormModal = ref(false)
const showApplyModal = ref(false)
const showPreviewModal = ref(false)
const editingTemplate = ref(null)
const applyingTemplate = ref(null)
const previewTemplate = ref(null)

const filteredTemplates = computed(() => {
  let result = templates.value
  if (filterCliType.value) result = result.filter(t => t.cliType === filterCliType.value)
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(t => t.name?.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q))
  }
  return result
})

async function loadData() {
  loading.value = true
  try {
    const [tplRes, cfgRes] = await Promise.all([getAllTemplates(), getAvailableConfigs()])
    if (tplRes.success) templates.value = tplRes.data || []
    if (cfgRes.success) availableConfigs.value = cfgRes.data || {}
  } catch (err) {
    message.error('加载数据失败: ' + err.message)
  } finally {
    loading.value = false
  }
}

function handleCreate() {
  editingTemplate.value = null
  showFormModal.value = true
}

function handleEdit(tpl) {
  editingTemplate.value = { ...tpl }
  showFormModal.value = true
}

function handlePreview(tpl) {
  previewTemplate.value = tpl
  showPreviewModal.value = true
}

function handleApply(tpl) {
  applyingTemplate.value = tpl
  showPreviewModal.value = false
  showApplyModal.value = true
}

function handleDelete(tpl) {
  dialog.warning({
    title: '确认删除',
    content: `确定要删除模版 "${tpl.name}" 吗？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      deletingId.value = tpl.id
      try {
        const res = await deleteTemplate(tpl.id)
        if (res.success) { message.success('删除成功'); loadData() }
        else message.error(res.message || '删除失败')
      } catch (err) { message.error('删除失败: ' + err.message) }
      finally { deletingId.value = null }
    }
  })
}

function handleFormSuccess() {
  showFormModal.value = false
  loadData()
}

function handleApplySuccess() {
  showApplyModal.value = false
  loadData()
}

onMounted(() => loadData())

watch(() => props.drawerVisible, (val) => { if (val) loadData() })
</script>

<style scoped>
.templates-panel {
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
.templates-panel.in-drawer .stats-bar { padding: 10px 12px; }
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
.templates-panel.in-drawer .filter-bar { padding: 10px 12px; }
.search-input { flex: 1; }
.filter-select { width: 100px; }
.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
.templates-panel.in-drawer .panel-content { padding: 12px; }
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
.templates-panel.in-drawer .panel-footer { padding: 8px 12px; }
.info-icon { color: var(--text-quaternary); }
</style>
