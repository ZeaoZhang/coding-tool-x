<template>
  <div class="project-list-container">
    <!-- Fixed Header -->
    <div class="header">
      <div class="header-text">
        <n-h2 style="margin: 0;">我的项目</n-h2>
        <n-text depth="3">选择一个项目查看会话，拖拽可调整顺序</n-text>
      </div>
      <n-input
        v-model:value="searchQuery"
        placeholder="搜索项目..."
        clearable
        class="search-input"
      >
        <template #prefix>
          <n-icon><SearchOutline /></n-icon>
        </template>
      </n-input>
    </div>

    <!-- Scrollable Content -->
    <div class="content" ref="contentEl">
      <!-- Loading -->
      <div v-if="store.loading" class="loading-container">
        <n-spin size="large">
          <template #description>
            加载项目列表...
          </template>
        </n-spin>
      </div>

      <!-- Error -->
      <n-alert v-else-if="store.error" type="error" title="加载失败" style="margin-top: 20px;">
        {{ store.error }}
      </n-alert>

      <!-- Projects Grid with Draggable (only when not searching) -->
      <draggable
      v-else-if="!searchQuery"
      v-model="orderedProjects"
      item-key="name"
      class="projects-grid"
      ghost-class="ghost"
      chosen-class="chosen"
      drag-class="drag"
      animation="200"
      @end="handleDragEnd"
    >
      <template #item="{ element }">
        <ProjectCard
          :project="element"
          @click="handleProjectClick(element.name)"
          @delete="handleDeleteProject"
        />
      </template>
    </draggable>

      <!-- Projects Grid (static when searching) -->
      <div v-else class="projects-grid">
        <ProjectCard
          v-for="project in filteredProjects"
          :key="project.name"
          :project="project"
          @click="handleProjectClick(project.name)"
          @delete="handleDeleteProject"
        />
      </div>

      <!-- Empty State -->
      <n-empty
        v-if="!store.loading && !store.error && store.projects.length === 0"
        description="没有找到项目"
        style="margin-top: 60px;"
      >
        <template #icon>
          <n-icon><FolderOpenOutline /></n-icon>
        </template>
      </n-empty>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { NH2, NText, NSpin, NAlert, NEmpty, NIcon, NInput } from 'naive-ui'
import { FolderOpenOutline, SearchOutline } from '@vicons/ionicons5'
import draggable from 'vuedraggable'
import { useSessionsStore } from '../stores/sessions'
import ProjectCard from '../components/ProjectCard.vue'
import message, { dialog } from '../utils/message'

const router = useRouter()
const store = useSessionsStore()

// Search query
const searchQuery = ref('')

// Local ordered projects for draggable
const orderedProjects = ref([])

// Content element ref for scroll preservation
const contentEl = ref(null)

// Filtered projects based on search (only used when searching)
const filteredProjects = computed(() => {
  const query = searchQuery.value.toLowerCase()
  return orderedProjects.value.filter(project => {
    // 搜索显示名称和完整路径
    const displayName = (project.displayName || '').toLowerCase()
    const fullPath = (project.fullPath || '').toLowerCase()
    return displayName.includes(query) || fullPath.includes(query)
  })
})

// Sync with store
watch(() => store.projects, (newProjects) => {
  orderedProjects.value = [...newProjects]
}, { immediate: true })

function handleProjectClick(projectName) {
  router.push({ name: 'sessions', params: { projectName } })
}

async function handleDragEnd() {
  // Save the new order
  const order = orderedProjects.value.map(p => p.name)
  await store.saveProjectOrder(order)
}

function handleDeleteProject(project) {
  // 使用解析后的完整路径
  const projectPath = project.fullPath || project.name
  const sessionCount = project.sessionCount || 0

  dialog.warning({
    title: '删除项目',
    content: `确定要删除项目 "${projectPath}" 吗？\n\n当前项目包含 ${sessionCount} 个会话，删除后所有会话数据将无法恢复！`,
    positiveText: '确定删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await store.deleteProject(project.name)
        message.success('项目已删除')
      } catch (err) {
        message.error('删除失败: ' + err.message)
      }
    }
  })
}

// 保存和恢复滚动位置
async function refreshDataWithScrollPreservation() {
  // Save scroll position
  const scrollTop = contentEl.value?.scrollTop || 0

  // Fetch data
  await store.fetchProjects()

  // Restore scroll position after DOM update
  await nextTick()
  if (contentEl.value) {
    contentEl.value.scrollTop = scrollTop
  }
}

// 页面可见性变化时刷新数据
function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    refreshDataWithScrollPreservation()
  }
}

// 窗口获得焦点时刷新数据
function handleWindowFocus() {
  refreshDataWithScrollPreservation()
}

onMounted(async () => {
  await store.fetchProjects()

  // 添加事件监听
  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('focus', handleWindowFocus)
})

onUnmounted(() => {
  // 清理事件监听
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  window.removeEventListener('focus', handleWindowFocus)
})
</script>

<style scoped>
.project-list-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.header {
  flex-shrink: 0;
  padding: 24px 24px 16px 24px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
}

.header-text {
  flex: 1;
}

.search-input {
  width: 320px;
  flex-shrink: 0;
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px 24px 24px;
}

.loading-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 400px;
}

.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}

/* 拖动时的半透明虚影 */
.ghost {
  opacity: 0.4;
}

/* 被选中开始拖动的元素 */
.chosen {
  transform: scale(1.05);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2) !important;
  cursor: move !important;
}

/* 正在拖动中的元素 */
.drag {
  opacity: 0.8;
  transform: rotate(2deg);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25) !important;
}
</style>
