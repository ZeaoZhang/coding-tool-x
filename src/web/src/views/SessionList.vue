<template>
  <div class="session-list-container">
      <!-- Fixed Header -->
      <div class="header">
      <div class="title-bar">
        <n-button size="small" @click="goBack" class="back-button">
          <template #icon>
            <n-icon size="18"><ArrowBackOutline /></n-icon>
          </template>
        </n-button>

        <div class="title-section">
          <div class="title-with-count">
            <n-h2>{{ projectDisplayName }}</n-h2>
            <n-text depth="3" class="session-count">({{ store.sessions.length }} 个对话)</n-text>
            <n-tag size="small" :bordered="false" type="info" class="total-size-tag">
              {{ formatSize(store.totalSize) }}
            </n-tag>
            <div class="header-actions">
              <template v-if="selectionMode">
                <n-checkbox
                  :checked="allSessionsSelected"
                  :indeterminate="partiallySelected"
                  :disabled="orderedSessions.length === 0 || batchDeleting"
                  @update:checked="handleToggleSelectAll"
                >
                  全选
                </n-checkbox>
                <n-text depth="3">已选 {{ selectedCount }} 个</n-text>
                <n-button
                  size="small"
                  type="error"
                  :disabled="selectedCount === 0"
                  :loading="batchDeleting"
                  @click="handleBatchDelete"
                >
                  <template #icon>
                    <n-icon><TrashOutline /></n-icon>
                  </template>
                  删除
                </n-button>
                <n-button size="small" :disabled="batchDeleting" @click="exitSelectionMode">
                  完成
                </n-button>
              </template>
              <n-button v-else size="small" type="error" secondary @click="enterSelectionMode">
                <template #icon>
                  <n-icon><TrashOutline /></n-icon>
                </template>
                管理
              </n-button>
            </div>
          </div>
          <n-text depth="3" class="project-path">{{ displayProjectPath }}</n-text>
          <div v-if="sessionStatusTags.length" class="status-tags" role="status" aria-live="polite">
            <n-tag
              v-for="tag in sessionStatusTags"
              :key="tag.key"
              size="small"
              :type="tag.type"
              :bordered="false"
            >
              {{ tag.text }}
            </n-tag>
            <n-button
              v-if="store.sessionsRefreshing || store.sessionsMeta?.error || store.error"
              text
              size="tiny"
              :loading="store.loading"
              @click="refreshDataWithScrollPreservation"
            >
              立即刷新
            </n-button>
          </div>
        </div>

        <!-- Search Bar -->
        <n-input
          v-model:value="searchQuery"
          placeholder="搜索会话..."
          clearable
          class="search-input"
          @keyup.enter="handleSearch"
          :disabled="searching"
        >
          <template #prefix>
            <n-icon><SearchOutline /></n-icon>
          </template>
          <template #suffix>
            <n-button text @click="handleSearch" :disabled="!searchQuery || searching" :loading="searching">
              搜索
            </n-button>
          </template>
        </n-input>
      </div>
    </div>

    <!-- Scrollable Content -->
    <div class="content" ref="contentEl">
      <!-- Loading -->
      <div v-if="store.loading && store.sessions.length === 0 && !store.sessionsPending" class="loading-container">
        <n-spin size="large">
          <template #description>
            加载会话列表...
          </template>
        </n-spin>
      </div>

      <div v-else-if="store.sessionsPending" class="loading-container compact">
        <n-spin size="small">
          <template #description>
            正在生成会话列表...
          </template>
        </n-spin>
      </div>

      <!-- Error -->
      <n-alert v-else-if="store.error && store.sessions.length === 0" type="error" title="加载失败" style="margin-bottom: 16px;">
        {{ store.error }}
      </n-alert>

      <!-- Sessions List with Draggable -->
    <draggable
      v-else-if="filteredSessions.length > 0"
      v-model="orderedSessions"
      item-key="sessionId"
      class="sessions-list"
      handle=".drag-handle"
      :disabled="selectionMode || batchDeleting"
      v-bind="dragOptions"
      ghost-class="ghost"
      chosen-class="chosen"
      animation="200"
      @end="handleDragEnd"
    >
      <template #item="{ element: session }">
        <div
          class="session-item"
          :class="{
            'session-item-selected': isSessionSelected(session.sessionId),
            'session-item-selection-mode': selectionMode
          }"
          @mouseenter="hoveredSession = session.sessionId"
          @mouseleave="hoveredSession = null"
          @click="handleSessionClick(session)"
        >
          <!-- Drag Handle -->
          <div v-if="!selectionMode" class="drag-handle">
            <n-icon size="16" color="#999">
              <ReorderThreeOutline />
            </n-icon>
          </div>

          <div v-else class="selection-checkbox" @click.stop>
            <n-checkbox
              :checked="isSessionSelected(session.sessionId)"
              @update:checked="toggleSessionSelection(session.sessionId, $event)"
            />
          </div>

          <!-- Left Content -->
          <div class="session-left">
            <div class="session-icon">
              <n-icon size="24" color="#18a058">
                <ChatbubbleEllipsesOutline />
              </n-icon>
            </div>

            <div class="session-info">
              <div class="session-header">
                <div class="session-title-row">
                  <span class="session-title">
                    {{ session.alias ? `${session.alias} (${session.sessionId.substring(0, 8)})` : session.sessionId }}
                  </span>
                  <n-tooltip v-if="session.forkedFrom" placement="top">
                    <template #trigger>
                      <n-tag size="small" type="warning" :bordered="false" style="margin-left: 8px; cursor: help;">
                        <template #icon>
                          <n-icon><GitBranchOutline /></n-icon>
                        </template>
                        Fork
                      </n-tag>
                    </template>
                    Fork 自: {{ session.forkedFrom }}
                  </n-tooltip>
                </div>
              </div>

              <div class="session-meta">
                <n-text depth="3">{{ formatTime(session.mtime) }}</n-text>
                <n-text depth="3">•</n-text>
                <n-tag size="small" :bordered="false">{{ formatSize(session.size) }}</n-tag>
              </div>

              <n-text depth="3" class="session-message" v-if="session.firstMessage">
                {{ truncateText(session.firstMessage, 80) }}
              </n-text>
              <n-text depth="3" class="session-message session-message-empty" v-else-if="!session.gitBranch && !session.summary">
                暂未读取到对话内容
              </n-text>
            </div>
          </div>

          <!-- Right Content (上下布局) -->
          <div class="session-right">
            <!-- 上部：分支标签区域 -->
            <div class="session-tags-area">
              <n-tag v-if="session.gitBranch" size="small" type="info" :bordered="false">
                <template #icon>
                  <n-icon><GitBranchOutline /></n-icon>
                </template>
                {{ session.gitBranch }}
              </n-tag>
            </div>

            <!-- 下部：操作按钮 -->
            <div v-if="!selectionMode" class="session-actions">
              <n-space>
                <n-button
                  v-show="hoveredSession === session.sessionId"
                  size="small"
                  type="error"
                  @click.stop="handleDelete(session.sessionId)"
                >
                  <template #icon>
                    <n-icon><TrashOutline /></n-icon>
                  </template>
                  删除
                </n-button>
                <n-button size="small" @click.stop="handleSetAlias(session)">
                  <template #icon>
                    <n-icon><CreateOutline /></n-icon>
                  </template>
                  别名
                </n-button>
                <n-button
                  size="small"
                  :type="isFavorite(currentChannel, effectiveProjectName, session.sessionId) ? 'warning' : 'default'"
                  @click.stop="handleToggleFavorite(session)"
                >
                  <template #icon>
                    <n-icon>
                      <Star v-if="isFavorite(currentChannel, effectiveProjectName, session.sessionId)" />
                      <StarOutline v-else />
                    </n-icon>
                  </template>
                  {{ isFavorite(currentChannel, effectiveProjectName, session.sessionId) ? '已收藏' : '收藏' }}
                </n-button>
                <n-button v-if="currentChannel !== 'opencode'" size="small" @click.stop="handleFork(session.sessionId)">
                  <template #icon>
                    <n-icon><GitBranchOutline /></n-icon>
                  </template>
                  Fork
                </n-button>
                <n-button size="small" type="primary" @click.stop="handleLaunchTerminal(session.sessionId)">
                  <template #icon>
                    <n-icon><TerminalOutline /></n-icon>
                  </template>
                  使用对话
                </n-button>
              </n-space>
            </div>
          </div>
        </div>
      </template>
    </draggable>

      <!-- Empty State -->
      <n-empty
        v-else
        description="没有找到会话"
        style="margin-top: 60px;"
      >
        <template #icon>
          <n-icon><DocumentTextOutline /></n-icon>
        </template>
      </n-empty>
    </div>

    <!-- Alias Dialog -->
    <n-modal v-model:show="showAliasDialog" preset="dialog" title="设置别名">
      <n-input
        v-model:value="editingAlias"
        placeholder="输入别名（留空删除）"
        @keyup.enter="confirmAlias"
      />
      <template #action>
        <n-space>
          <n-button @click="showAliasDialog = false">取消</n-button>
          <n-button type="primary" @click="confirmAlias">确定</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="showForkDialog" preset="dialog" title="Fork 对话">
      <n-space vertical :size="14">
        <n-text depth="3">
          可选择保留到第几条用户消息所在轮次；会包含这条消息后 AI 的完整输出。
        </n-text>
        <n-select
          v-model:value="selectedForkPoint"
          :options="forkPointOptions"
          :loading="forkOptionsLoading"
          clearable
          placeholder="选择保留到哪一轮（默认完整会话）"
        />
        <n-input
          v-model:value="forkAlias"
          placeholder="输入新会话别名（可选）"
          maxlength="120"
        />
      </n-space>
      <template #action>
        <n-space>
          <n-button :disabled="forking" @click="closeForkDialog">取消</n-button>
          <n-button type="primary" :loading="forking" @click="confirmFork">
            确认 Fork
          </n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- Search Results Dialog -->
    <n-modal v-model:show="showSearchResults" preset="card" title="搜索结果" style="width: 1200px;">
      <div v-if="searchResults" style="max-height: 70vh; overflow-y: auto;">
        <n-alert type="info" style="margin-bottom: 16px;">
          关键词 "{{ searchResults.keyword }}" 共找到 {{ searchResults.totalMatches }} 处匹配
        </n-alert>

        <div v-for="session in searchResults.sessions" :key="session.sessionId" class="search-result-item">
          <div class="search-result-header">
            <div class="search-result-title">
              <n-text strong>
                {{ session.alias ? `${session.alias} (${session.sessionId.substring(0, 8)})` : session.sessionId.substring(0, 8) }}
              </n-text>
              <n-tag size="small" :bordered="false">{{ session.matchCount }} 个匹配</n-tag>
            </div>
            <n-button size="small" type="primary" @click="handleLaunchTerminal(session.sessionId)">
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
            <n-text depth="3" class="search-match-text" v-html="highlightKeyword(match.context, searchResults.keyword)"></n-text>
          </div>
        </div>

        <n-empty v-if="searchResults.sessions.length === 0" description="没有找到匹配的内容" />
      </div>
    </n-modal>

    <!-- Chat History Drawer -->
    <ChatHistoryDrawer
      ref="chatHistoryRef"
      v-if="selectedSessionId"
      v-model:show="showChatHistory"
      :project-name="effectiveProjectName"
      :session-id="selectedSessionId"
      :session-alias="selectedSessionAlias"
      :channel="currentChannel"
      @error="handleChatHistoryError"
    />


  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  NButton, NIcon, NH2, NText, NInput, NSpin, NAlert, NEmpty,
  NTag, NSpace, NModal, NTooltip, NCheckbox, NSelect
} from 'naive-ui'
import {
  ArrowBackOutline, SearchOutline, DocumentTextOutline,
  ChatbubbleEllipsesOutline, GitBranchOutline, CreateOutline, TrashOutline,
  ReorderThreeOutline, TerminalOutline, StarOutline, Star,
} from '@vicons/ionicons5'
import draggable from 'vuedraggable'
import { useSessionsStore } from '../stores/sessions'
import { useFavorites } from '../composables/useFavorites'
import message, { dialog } from '../utils/message'
import { searchSessions as searchSessionsApi, copySessionLaunchCommand, getSessionOutline } from '../api/sessions'
import ChatHistoryDrawer from '../components/ChatHistoryDrawer.vue'

const props = defineProps({
  projectName: {
    type: String,
    required: true
  }
})

const router = useRouter()
const route = useRoute()
const store = useSessionsStore()
const { addFavorite, removeFavorite, isFavorite } = useFavorites()

// 当前渠道
const currentChannel = computed(() => route.meta.channel || 'claude')
const resolvedProjectName = ref(props.projectName)
const effectiveProjectName = computed(() => resolvedProjectName.value || props.projectName)

const searchQuery = ref('')
const FULL_FORK_POINT = '__full__'
const showAliasDialog = ref(false)
const editingSession = ref(null)
const editingAlias = ref('')
const hoveredSession = ref(null)
const orderedSessions = ref([])
const searchResults = ref(null)
const showSearchResults = ref(false)
const contentEl = ref(null)
const searching = ref(false)
const selectionMode = ref(false)
const selectedSessionIds = ref([])
const batchDeleting = ref(false)
const showForkDialog = ref(false)
const editingForkSession = ref(null)
const forkAlias = ref('')
const selectedForkPoint = ref(FULL_FORK_POINT)
const forkOptionsLoading = ref(false)
const forking = ref(false)
const forkPointOptions = ref([])

// Chat history drawer state
const showChatHistory = ref(false)
const selectedSessionId = ref('')
const selectedSessionAlias = ref('')
const chatHistoryRef = ref(null)

const dragOptions = {
  // Keep sessions reorder-only inside the session list.
  group: { name: `${currentChannel.value}-sessions`, pull: false, put: false },
  forceFallback: true,
  fallbackOnBody: false,
  fallbackTolerance: 4,
  scroll: true
}

// Project display name (使用后端解析的名称)
const projectDisplayName = computed(() => {
  return store.currentProjectInfo?.displayName || props.projectName
})

// Full project path (使用后端解析的路径)
const displayProjectPath = computed(() => {
  return store.currentProjectInfo?.fullPath || effectiveProjectName.value
})

const selectedSessionSet = computed(() => new Set(selectedSessionIds.value))
const selectedCount = computed(() => selectedSessionIds.value.length)
const allSessionsSelected = computed(() => (
  orderedSessions.value.length > 0
  && orderedSessions.value.every(session => selectedSessionSet.value.has(session.sessionId))
))
const partiallySelected = computed(() => (
  selectedCount.value > 0 && !allSessionsSelected.value
))

async function ensureProjectNameResolved() {
  if (!store.projects.length) {
    await store.fetchProjects()
  }

  const exactMatch = store.projects.find(p => p.name === props.projectName)
  if (exactMatch) {
    resolvedProjectName.value = exactMatch.name
    return exactMatch.name
  }

  const displayMatch = store.projects.find(p =>
    p.displayName === props.projectName || p.fullPath === props.projectName
  )
  if (displayMatch) {
    resolvedProjectName.value = displayMatch.name
    if (displayMatch.name !== props.projectName) {
      await router.replace({
        name: `${currentChannel.value}-sessions`,
        params: { projectName: displayMatch.name }
      })
    }
    return displayMatch.name
  }

  resolvedProjectName.value = props.projectName
  return props.projectName
}

async function loadSessions(options = {}) {
  const projectName = await ensureProjectNameResolved()
  await store.fetchSessions(projectName, options)
}

// Sync with store
watch(() => store.sessionsWithAlias, (newSessions) => {
  orderedSessions.value = [...newSessions]
  const validIds = new Set(newSessions.map(session => session.sessionId))
  selectedSessionIds.value = selectedSessionIds.value.filter(sessionId => validIds.has(sessionId))
  if (selectionMode.value && newSessions.length === 0) {
    exitSelectionMode()
  }
}, { immediate: true })

const filteredSessions = computed(() => {
  if (!searchQuery.value) return orderedSessions.value

  const query = searchQuery.value.toLowerCase()
  return orderedSessions.value.filter(session => {
    return (
      session.sessionId.toLowerCase().includes(query) ||
      (session.alias && session.alias.toLowerCase().includes(query)) ||
      (session.firstMessage && session.firstMessage.toLowerCase().includes(query)) ||
      (session.gitBranch && session.gitBranch.toLowerCase().includes(query))
    )
  })
})

const sessionStatusTags = computed(() => {
  const tags = []
  if (store.sessionsRefreshing) {
    tags.push({
      key: 'refreshing',
      type: 'info',
      text: store.sessions.length > 0 ? '后台刷新中' : '首次生成中'
    })
  }
  if (store.sessionsUsingFallback && store.sessions.length > 0) {
    tags.push({
      key: 'fallback',
      type: 'warning',
      text: '正在显示缓存数据'
    })
  }
  if (store.error) {
    tags.push({
      key: 'error',
      type: 'error',
      text: `刷新失败：${store.error}`
    })
  }
  return tags
})

function goBack() {
  const channel = route.meta.channel || 'claude'
  router.push({ name: `${channel}-projects` })
}

async function handleSearch() {
  if (!searchQuery.value) return

  searching.value = true
  try {
    // 增加上下文长度到 35 (15 + 20)
    const data = await searchSessionsApi(effectiveProjectName.value, searchQuery.value, 35, currentChannel.value)
    searchResults.value = data
    showSearchResults.value = true
  } catch (err) {
    message.error('搜索失败: ' + err.message)
  } finally {
    searching.value = false
  }
}

async function handleDragEnd() {
  const order = orderedSessions.value.map(s => s.sessionId)
  await store.saveSessionOrder(order)
}

function enterSelectionMode() {
  selectionMode.value = true
  hoveredSession.value = null
}

function exitSelectionMode() {
  selectionMode.value = false
  selectedSessionIds.value = []
  hoveredSession.value = null
}

function isSessionSelected(sessionId) {
  return selectedSessionSet.value.has(sessionId)
}

function toggleSessionSelection(sessionId, checked = !isSessionSelected(sessionId)) {
  const nextSelected = new Set(selectedSessionIds.value)
  if (checked) {
    nextSelected.add(sessionId)
  } else {
    nextSelected.delete(sessionId)
  }
  selectedSessionIds.value = Array.from(nextSelected)
}

function handleToggleSelectAll(checked) {
  if (checked) {
    selectedSessionIds.value = orderedSessions.value.map(session => session.sessionId)
    return
  }
  selectedSessionIds.value = []
}

function handleSessionClick(session) {
  if (selectionMode.value) {
    toggleSessionSelection(session.sessionId)
    return
  }
  handleViewChatHistory(session)
}

function handleSetAlias(session) {
  editingSession.value = session
  editingAlias.value = session.alias || ''
  showAliasDialog.value = true
}

async function confirmAlias() {
  if (!editingSession.value) return

  try {
    const sessionId = editingSession.value.sessionId
    if (editingAlias.value) {
      await store.setAlias(sessionId, editingAlias.value)
      message.success('别名设置成功')
    } else {
      await store.deleteAlias(sessionId)
      message.success('别名已删除')
    }
    showAliasDialog.value = false
    editingSession.value = null
    editingAlias.value = ''
  } catch (err) {
    message.error('操作失败: ' + err.message)
  }
}

function closeForkDialog() {
  showForkDialog.value = false
  editingForkSession.value = null
  forkAlias.value = ''
  selectedForkPoint.value = FULL_FORK_POINT
  forkPointOptions.value = []
  forkOptionsLoading.value = false
  forking.value = false
}

async function handleFork(sessionId) {
  if (currentChannel.value === 'opencode') {
    message.warning('OpenCode 当前不支持该 Fork 操作')
    return
  }

  try {
    const session = orderedSessions.value.find(item => item.sessionId === sessionId)
    editingForkSession.value = session || { sessionId }
    forkAlias.value = ''
    selectedForkPoint.value = FULL_FORK_POINT
    forkPointOptions.value = [
      {
        label: '完整会话末尾（保留全部消息）',
        value: FULL_FORK_POINT
      }
    ]
    showForkDialog.value = true
    forkOptionsLoading.value = true

    const outline = await getSessionOutline(effectiveProjectName.value, sessionId, currentChannel.value)
    const items = Array.isArray(outline?.items) ? outline.items : []
    forkPointOptions.value = [
      {
        label: '完整会话末尾（保留全部消息）',
        value: FULL_FORK_POINT
      },
      ...items.map(item => ({
        label: `保留到第 ${item.userMessageNumber} 条用户消息这一轮 · ${item.preview}`,
        value: item.userMessageNumber
      }))
    ]
  } catch (err) {
    message.error('加载 Fork 位置失败: ' + err.message)
    closeForkDialog()
  } finally {
    forkOptionsLoading.value = false
  }
}

async function confirmFork() {
  if (!editingForkSession.value) return

  try {
    forking.value = true
    await store.forkSession(editingForkSession.value.sessionId, {
      afterUserMessageNumber: selectedForkPoint.value === FULL_FORK_POINT ? null : selectedForkPoint.value,
      alias: forkAlias.value?.trim() || undefined
    })
    message.success('Fork 成功!')
    closeForkDialog()
  } catch (err) {
    message.error('Fork 失败: ' + err.message)
  } finally {
    forking.value = false
  }
}

// View chat history
function handleViewChatHistory(session) {
  selectedSessionId.value = session.sessionId
  selectedSessionAlias.value = session.alias || ''
  showChatHistory.value = true
  nextTick(() => {
    chatHistoryRef.value?.open()
  })
}

// Handle chat history error
function handleChatHistoryError(errorMsg) {
  message.error(errorMsg)
}

function syncDeletedSessionState(sessionIds) {
  const deletedIds = new Set((sessionIds || []).filter(Boolean))
  if (deletedIds.size === 0) return

  selectedSessionIds.value = selectedSessionIds.value.filter(sessionId => !deletedIds.has(sessionId))

  if (selectedSessionId.value && deletedIds.has(selectedSessionId.value)) {
    showChatHistory.value = false
    selectedSessionId.value = ''
    selectedSessionAlias.value = ''
  }
}

async function handleLaunchTerminal(sessionId) {
  try {
    const { copyResult } = await copySessionLaunchCommand(effectiveProjectName.value, sessionId, currentChannel.value)
    if (copyResult?.method === 'manual') {
      message.warning('自动复制失败，已弹出手动复制框')
      return
    }
    message.success('启动命令已复制到剪贴板')
  } catch (err) {
    message.error('复制失败: ' + err.message)
  }
}

function handleDelete(sessionId) {
  dialog.warning({
    title: '删除会话',
    content: '确定要删除这个会话吗？此操作不可恢复！',
    positiveText: '确定删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await store.deleteSession(sessionId)
        syncDeletedSessionState([sessionId])
        message.success('会话已删除')
      } catch (err) {
        message.error('删除失败: ' + err.message)
      }
    }
  })
}

function handleBatchDelete() {
  if (selectedCount.value === 0) {
    message.warning('请先选择要删除的会话')
    return
  }

  const deletingIds = [...selectedSessionIds.value]
  dialog.warning({
    title: '批量删除会话',
    content: `确定要删除选中的 ${deletingIds.length} 个会话吗？此操作不可恢复！`,
    positiveText: '确定删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      batchDeleting.value = true
      try {
        const result = await store.deleteSessions(deletingIds)
        syncDeletedSessionState(result.deletedSessionIds)

        if (result.failed.length === 0) {
          message.success(`已删除 ${result.deletedSessionIds.length} 个会话`)
          exitSelectionMode()
          return
        }

        selectedSessionIds.value = result.failed.map(item => item.sessionId)
        if (result.deletedSessionIds.length > 0) {
          message.warning(`已删除 ${result.deletedSessionIds.length} 个会话，${result.failed.length} 个删除失败`)
        } else {
          message.error(`删除失败: ${result.failed[0].error.message}`)
        }
      } finally {
        batchDeleting.value = false
      }
    }
  })
}

// 切换收藏状态
async function handleToggleFavorite(session) {
  const channel = currentChannel.value
  const favorited = isFavorite(channel, effectiveProjectName.value, session.sessionId)

  try {
    if (favorited) {
      await removeFavorite(channel, effectiveProjectName.value, session.sessionId)
      message.success('已取消收藏')
    } else {
      const sessionData = {
        sessionId: session.sessionId,
        projectName: effectiveProjectName.value,
        projectDisplayName: projectDisplayName.value,
        projectFullPath: displayProjectPath.value,
        alias: session.alias || '',
        firstMessage: session.firstMessage || '',
        mtime: session.mtime,
        size: session.size,
        gitBranch: session.gitBranch || '',
        forkedFrom: session.forkedFrom || ''
      }
      await addFavorite(channel, sessionData)
      message.success('已添加到收藏')
    }
  } catch (err) {
    message.error('操作失败: ' + err.message)
  }
}

function formatTime(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN')
}

function formatSize(bytes) {
  if (!bytes) return '0 B'
  const k = 1024
  if (bytes < k) return bytes + ' B'
  if (bytes < k * k) return (bytes / k).toFixed(1) + ' KB'
  return (bytes / k / k).toFixed(1) + ' MB'
}

// 高亮关键字
function highlightKeyword(text, keyword) {
  if (!keyword || !text) return text
  const regex = new RegExp(`(${keyword})`, 'gi')
  return text.replace(regex, '<mark style="background-color: #ffd700; padding: 2px 4px; border-radius: 2px; font-weight: 600;">$1</mark>')
}

// 截断文本
function truncateText(text, maxLength = 80) {
  if (!text) return ''
  if (text.length > maxLength) {
    return text.substring(0, maxLength) + '...'
  }
  return text
}

// 保存和恢复滚动位置
async function refreshDataWithScrollPreservation() {
  // Save scroll position
  const scrollTop = contentEl.value?.scrollTop || 0

  // Fetch data
  const projectName = await ensureProjectNameResolved()
  await store.retrySessions(projectName)

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

// 监听 channel 变化
watch([currentChannel, () => props.projectName], ([newChannel]) => {
  exitSelectionMode()
  store.setChannel(newChannel)
  loadSessions()
}, { immediate: true })

onMounted(() => {
  // 【暂时移除】添加事件监听 - 每次切换回来就刷新，体验不好
  // document.addEventListener('visibilitychange', handleVisibilityChange)
  // window.addEventListener('focus', handleWindowFocus)
})

onUnmounted(() => {
  // 【暂时移除】清理事件监听
  // document.removeEventListener('visibilitychange', handleVisibilityChange)
  // window.removeEventListener('focus', handleWindowFocus)
})
</script>

<style scoped>
.session-list-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.header {
  flex-shrink: 0;
  padding: 24px 24px 16px 24px;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-primary);
}

.content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px 24px 24px 24px;
}

.sessions-list {
  position: relative;
  overflow: hidden;
}

.back-button {
  flex-shrink: 0;
  margin-right: 12px;
}

.title-bar {
  display: flex;
  align-items: center;
  gap: 16px;
}

.title-section {
  flex: 1;
  min-width: 0;
}

.title-with-count {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
  flex-wrap: wrap;
}

.title-section h2 {
  margin: 0;
  font-size: 20px;
}

.session-count {
  font-size: 14px;
  color: #666;
}

.total-size-tag {
  margin-left: 8px;
}

.project-path {
  font-size: 13px;
  display: block;
  color: #666;
  margin-bottom: 2px;
}

.status-tags {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 6px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: 4px;
}

.search-input {
  width: 320px;
  flex-shrink: 0;
}

.loading-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 400px;
}

.loading-container.compact {
  min-height: 180px;
}

/* Session Item */
.session-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  margin-bottom: 8px;
  transition: all 0.2s;
  cursor: pointer;
}

.session-item:hover {
  border-color: #18a058;
  box-shadow: 0 2px 8px rgba(24, 160, 88, 0.1);
}

.session-item-selection-mode {
  cursor: default;
}

.session-item-selected {
  border-color: #18a058;
  box-shadow: 0 0 0 2px rgba(24, 160, 88, 0.12);
  background: rgba(24, 160, 88, 0.04);
}

.drag-handle {
  cursor: move;
  width: 24px;
  height: 24px;
  padding: 4px;
  opacity: 0.4;
  transition: all 0.2s;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.session-item:hover .drag-handle {
  opacity: 1;
  background-color: rgba(24, 160, 88, 0.1);
  border-radius: 4px;
}

.selection-checkbox {
  width: 24px;
  min-width: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Left Content - 左侧内容区 */
.session-left {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}

.session-icon {
  flex-shrink: 0;
}

.session-info {
  flex: 1;
  min-width: 0;
}

.session-header {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
}

.session-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.session-title {
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 1;
  min-width: 0;
}

.session-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 13px;
}

.session-message {
  display: block;
  max-width: 600px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.session-message-empty {
  font-style: italic;
  opacity: 0.5;
}

/* Right Content - 右侧内容区（上下布局） */
.session-right {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: flex-end;
  min-width: 280px;
  flex-shrink: 0;
  gap: 12px;
}

.session-tags-area {
  min-height: 24px;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
}

.session-actions {
  display: flex;
  align-items: center;
  margin-top: auto;
}

/* Draggable states */
.ghost {
  opacity: 0.4;
}

.chosen {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}

/* Search Results */
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
