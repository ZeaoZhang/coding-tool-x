<template>
  <div class="project-list-container">
    <!-- Codex 即将推出 -->
    <div v-if="currentChannel === 'codex'" class="coming-soon-container">
      <div class="coming-soon-content">
        <div class="coming-soon-icon">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2" fill="none"/>
            <path d="M8 8L16 16M16 8L8 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
        <h2 class="coming-soon-title">Codex 即将推出</h2>
        <p class="coming-soon-desc">我们正在为 Codex 开发专属功能，敬请期待</p>
        <div class="coming-soon-badge">🚧 开发中</div>
      </div>
    </div>

    <!-- Claude 项目列表 -->
    <template v-else>
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

    <!-- Global Search Shortcut Hint -->
    <div class="search-hint">
      <n-text depth="3" style="font-size: 12px;">
        <kbd>⌘</kbd> / <kbd>Ctrl</kbd> + <kbd>K</kbd> 全局搜索
      </n-text>
    </div>

    <!-- Global Search Modal -->
    <n-modal
      v-model:show="showGlobalSearch"
      preset="card"
      title="全局搜索"
      style="width: 800px; max-width: 90vw;"
      :style="{ marginTop: '80px' }"
    >
      <div style="margin-bottom: 16px;">
        <n-input
          ref="globalSearchInputRef"
          v-model:value="globalSearchQuery"
          placeholder="搜索所有项目的对话内容..."
          clearable
          @keyup.enter="handleGlobalSearch"
          :disabled="globalSearching"
        >
          <template #prefix>
            <n-icon><SearchOutline /></n-icon>
          </template>
          <template #suffix>
            <n-button text @click="handleGlobalSearch" :disabled="!globalSearchQuery || globalSearching" :loading="globalSearching">
              搜索
            </n-button>
          </template>
        </n-input>
      </div>

      <div v-if="globalSearchResults" style="max-height: 60vh; overflow-y: auto;">
        <n-alert type="info" style="margin-bottom: 16px;">
          关键词 "{{ globalSearchResults.keyword }}" 共找到 {{ globalSearchResults.totalMatches }} 处匹配
        </n-alert>

        <div v-for="session in globalSearchResults.sessions" :key="`${session.projectName}-${session.sessionId}`" class="search-result-item">
          <div class="search-result-header">
            <div class="search-result-title">
              <n-text strong style="font-size: 15px; font-weight: 700;">
                {{ session.projectDisplayName }}
              </n-text>
              <n-text depth="2" style="margin: 0 8px;">·</n-text>
              <n-text strong>
                {{ session.alias ? `${session.alias} (${session.sessionId.substring(0, 8)})` : session.sessionId.substring(0, 8) }}
              </n-text>
              <n-tag size="small" :bordered="false">{{ session.matchCount }} 个匹配</n-tag>
            </div>
            <n-button size="small" type="primary" @click="handleLaunchTerminalFromGlobal(session.projectName, session.sessionId)">
              <template #icon>
                <n-icon><TerminalOutline /></n-icon>
              </template>
              使用对话
            </n-button>
          </div>
          <div v-for="(match, idx) in session.matches" :key="idx" class="search-match">
            <n-tag size="tiny" :type="match.role === 'user' ? 'info' : 'success'" :bordered="false">
              {{ match.role === 'user' ? '用户' : '助手' }}
            </n-tag>
            <n-text depth="3" class="search-match-text" v-html="highlightKeyword(match.context, globalSearchResults.keyword)"></n-text>
          </div>
        </div>

        <n-empty v-if="globalSearchResults.sessions.length === 0" description="没有找到匹配的内容" />
      </div>
    </n-modal>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { NH2, NText, NSpin, NAlert, NEmpty, NIcon, NInput, NModal, NButton, NTag } from 'naive-ui'
import { FolderOpenOutline, SearchOutline, TerminalOutline } from '@vicons/ionicons5'
import draggable from 'vuedraggable'
import { useSessionsStore } from '../stores/sessions'
import ProjectCard from '../components/ProjectCard.vue'
import message, { dialog } from '../utils/message'
import api from '../api'

const router = useRouter()
const route = useRoute()
const store = useSessionsStore()

// 当前渠道
const currentChannel = computed(() => route.meta.channel || 'claude')

// Search query
const searchQuery = ref('')

// Local ordered projects for draggable
const orderedProjects = ref([])

// Content element ref for scroll preservation
const contentEl = ref(null)

// Global search
const showGlobalSearch = ref(false)
const globalSearchQuery = ref('')
const globalSearchResults = ref(null)
const globalSearching = ref(false)
const globalSearchInputRef = ref(null)

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
  const channel = route.meta.channel || 'claude'
  router.push({ name: `${channel}-sessions`, params: { projectName } })
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

// 【暂时移除】页面可见性变化时刷新数据
// 原因：每次切换回来就刷新，体验不好
// function handleVisibilityChange() {
//   if (document.visibilityState === 'visible') {
//     refreshDataWithScrollPreservation()
//   }
// }

// 【暂时移除】窗口获得焦点时刷新数据
// 原因：每次切换回来就刷新，体验不好
// function handleWindowFocus() {
//   refreshDataWithScrollPreservation()
// }

// 全局搜索相关函数
async function handleGlobalSearch() {
  if (!globalSearchQuery.value) return

  globalSearching.value = true
  try {
    const data = await api.searchSessionsGlobally(globalSearchQuery.value, 35)
    globalSearchResults.value = data
  } catch (err) {
    message.error('搜索失败: ' + err.message)
  } finally {
    globalSearching.value = false
  }
}

async function handleLaunchTerminalFromGlobal(projectName, sessionId) {
  try {
    await api.launchTerminal(projectName, sessionId)
    message.success('已启动终端')
    showGlobalSearch.value = false
  } catch (err) {
    message.error('启动失败: ' + err.message)
  }
}

// 高亮关键字
function highlightKeyword(text, keyword) {
  if (!keyword || !text) return text
  const regex = new RegExp(`(${keyword})`, 'gi')
  return text.replace(regex, '<mark style="background-color: #ffd700; padding: 2px 4px; border-radius: 2px; font-weight: 600;">$1</mark>')
}

// 快捷键监听
function handleKeyDown(e) {
  // Command/Ctrl + K
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault()
    showGlobalSearch.value = true
    // 等待弹窗打开后聚焦输入框
    nextTick(() => {
      globalSearchInputRef.value?.focus()
    })
  }
}

// 监听弹窗关闭，清空搜索结果
watch(showGlobalSearch, (newVal) => {
  if (!newVal) {
    globalSearchQuery.value = ''
    globalSearchResults.value = null
  }
})

onMounted(async () => {
  try {
    await store.fetchProjects()
  } catch (err) {
    console.error('❌ Failed to fetch projects:', err)
  }

  // 【暂时移除】添加事件监听 - 每次切换回来就刷新，体验不好
  // document.addEventListener('visibilitychange', handleVisibilityChange)
  // window.addEventListener('focus', handleWindowFocus)
  document.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  // 【暂时移除】清理事件监听
  // document.removeEventListener('visibilitychange', handleVisibilityChange)
  // window.removeEventListener('focus', handleWindowFocus)
  document.removeEventListener('keydown', handleKeyDown)
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

/* Codex 即将推出样式 */
.coming-soon-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  background: var(--bg-primary);
}

.coming-soon-content {
  text-align: center;
  max-width: 480px;
}

.coming-soon-icon {
  width: 120px;
  height: 120px;
  margin: 0 auto 32px;
  color: #3b82f6;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.05);
    opacity: 0.8;
  }
}

.coming-soon-icon svg {
  width: 100%;
  height: 100%;
  filter: drop-shadow(0 4px 16px rgba(59, 130, 246, 0.3));
}

[data-theme="dark"] .coming-soon-icon svg {
  filter: drop-shadow(0 4px 20px rgba(59, 130, 246, 0.4));
}

.coming-soon-title {
  font-size: 32px;
  font-weight: 700;
  margin: 0 0 16px 0;
  background: linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.coming-soon-desc {
  font-size: 16px;
  color: var(--text-tertiary);
  margin: 0 0 32px 0;
  line-height: 1.6;
}

.coming-soon-badge {
  display: inline-block;
  padding: 10px 24px;
  background: rgba(59, 130, 246, 0.1);
  border: 2px solid rgba(59, 130, 246, 0.3);
  border-radius: 24px;
  color: #3b82f6;
  font-size: 14px;
  font-weight: 600;
}

[data-theme="dark"] .coming-soon-badge {
  background: rgba(59, 130, 246, 0.15);
  border-color: rgba(59, 130, 246, 0.4);
  color: #60a5fa;
}

.header {
  flex-shrink: 0;
  padding: 24px 24px 20px 24px;
  background: var(--gradient-bg);
  border-bottom: 1px solid var(--border-primary);
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
  position: relative;
}

.header::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(24, 160, 88, 0.1), transparent);
}

.header-text {
  flex: 1;
}

.header-text :deep(.n-h2) {
  font-size: 26px;
  font-weight: 700;
  background: linear-gradient(135deg, #1f2937 0%, #374151 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  letter-spacing: -0.5px;
}

[data-theme="dark"] .header-text :deep(.n-h2) {
  background: linear-gradient(135deg, #f9fafb 0%, #d1d5db 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.search-input {
  width: 320px;
  flex-shrink: 0;
}

.search-input :deep(.n-input) {
  border-radius: 10px;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  transition: all 0.2s ease;
}

.search-input :deep(.n-input:hover) {
  border-color: var(--border-secondary);
  box-shadow: var(--shadow-sm);
}

.search-input :deep(.n-input:focus-within) {
  border-color: #18a058;
  box-shadow: 0 0 0 3px rgba(24, 160, 88, 0.1);
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px 24px 24px;
  background: var(--gradient-bg);
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

/* 全局搜索快捷键提示 */
.search-hint {
  position: fixed;
  bottom: 24px;
  left: 24px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  z-index: 10;
  backdrop-filter: blur(10px);
  opacity: 0.8;
  transition: all 0.2s ease;
}

[data-theme="dark"] .search-hint {
  background: rgba(30, 41, 59, 0.95);
  border: 1px solid rgba(71, 85, 105, 0.6);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

.search-hint:hover {
  opacity: 1;
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
}

[data-theme="dark"] .search-hint:hover {
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
}

.search-hint kbd {
  display: inline-block;
  padding: 4px 8px;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 12px;
  line-height: 1.4;
  font-weight: 600;
  color: var(--text-secondary);
  background: var(--bg-primary);
  border: 1px solid var(--border-secondary);
  border-radius: 4px;
  box-shadow: 0 2px 0 var(--border-primary), 0 1px 3px rgba(0, 0, 0, 0.1);
}

[data-theme="dark"] .search-hint kbd {
  background: rgba(51, 65, 85, 0.6);
  border: 1px solid rgba(71, 85, 105, 0.8);
  box-shadow: 0 2px 0 rgba(30, 41, 59, 0.8), 0 1px 4px rgba(0, 0, 0, 0.4);
  color: #e2e8f0;
}

/* 搜索结果样式 */
.search-result-item {
  margin-bottom: 16px;
  padding: 12px;
  border: 1px solid var(--border-primary);
  border-radius: 6px;
  background: var(--bg-elevated);
}

.search-result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.search-result-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-match {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 6px;
  padding: 6px;
  background: var(--bg-secondary);
  border-radius: 4px;
}

.search-match-text {
  flex: 1;
  line-height: 1.6;
}
</style>
