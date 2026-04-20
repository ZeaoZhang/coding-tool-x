<template>
  <n-drawer
    v-model:show="visible"
    :width="drawerWidth"
    placement="right"
    :auto-focus="false"
    :trap-focus="false"
    :block-scroll="false"
  >
    <div class="drawer-wrapper">
      <div ref="headerRef" class="drawer-header">
        <div class="header-row">
          <n-icon :size="18" :component="ChatbubblesIcon" />
          <span class="session-name">{{ sessionAlias || sessionId.substring(0, 8) }} ({{ totalMessages }})</span>
          <n-tag v-if="metadata.gitBranch" size="small" type="info">
            <template #icon>
              <n-icon :component="GitBranchIcon" />
            </template>
            {{ metadata.gitBranch }}
          </n-tag>
          <span class="spacer"></span>
          <n-icon
            :size="20"
            :component="CloseIcon"
            class="close-btn"
            @click="visible = false"
          />
        </div>
        <div v-if="metadata.summary" class="session-summary">{{ metadata.summary }}</div>
      </div>

      <div class="drawer-body">
        <div v-if="loading && messages.length === 0" class="loading-container">
          <n-spin size="medium">
            <template #description>加载聊天记录...</template>
          </n-spin>
        </div>

        <div v-else-if="!loading && messages.length === 0" class="empty-container">
          <n-empty description="暂无聊天记录" />
        </div>

        <div v-else class="history-layout">
          <div class="mobile-toc-toggle">
            <n-button tertiary size="small" @click="mobileTocCollapsed = !mobileTocCollapsed">
              {{ mobileTocCollapsed ? '展开用户目录' : '收起用户目录' }}
            </n-button>
          </div>

          <aside class="toc-rail" :class="{ 'mobile-collapsed': mobileTocCollapsed }">
            <div class="toc-header">
              用户目录
              <span v-if="outlineLoading" class="toc-header-hint">加载中...</span>
            </div>
            <div v-if="outlineLoading && tocItems.length === 0" class="toc-empty">目录加载中...</div>
            <div v-else-if="tocItems.length === 0" class="toc-empty">暂无用户消息</div>
            <div v-else class="toc-list">
              <button
                v-for="item in tocItems"
                :key="item.userMessageNumber"
                type="button"
                class="toc-item"
                :class="{ active: activeTocUserNumber === item.userMessageNumber }"
                @click="jumpToTocItem(item)"
              >
                <span class="toc-order">#{{ item.userMessageNumber }}</span>
                <span class="toc-preview">{{ item.preview }}</span>
                <span class="toc-time">{{ formatTocTime(item.timestamp) }}</span>
              </button>
            </div>
          </aside>

          <div class="messages-pane">
            <div class="messages-container" ref="messagesContainer" @scroll="handleScroll">
              <div v-if="hasMore" class="load-more-top">
                <n-button
                  :loading="loading"
                  @click="loadMore"
                  size="small"
                  secondary
                >
                  <template #icon>
                    <n-icon :component="ChevronUpIcon" />
                  </template>
                  加载更早的消息
                </n-button>
              </div>

              <div class="messages-list">
                <ChatMessage
                  v-for="(message, index) in messages"
                  :key="messageAnchorIds[index] || index"
                  :message="message"
                  :message-anchor-id="messageAnchorIds[index]"
                />
              </div>
            </div>

            <div v-if="showScrollButton" class="scroll-btn" @click="scrollToBottom">
              <n-icon :size="18" :component="ArrowDownIcon" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </n-drawer>
</template>

<script setup>
import { ref, computed, nextTick, watch, onBeforeUnmount } from 'vue'
import { NDrawer, NIcon, NTag, NSpin, NEmpty, NButton } from 'naive-ui'
import { useResponsiveDrawer } from '../composables/useResponsiveDrawer'
import { Chatbubbles as ChatbubblesIcon, GitBranch as GitBranchIcon, ChevronUp as ChevronUpIcon, ArrowDown as ArrowDownIcon, Close as CloseIcon } from '@vicons/ionicons5'
import ChatMessage from './ChatMessage.vue'
import { getSessionMessages, getSessionOutline, getSessionStatus } from '../api/sessions'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  projectName: {
    type: String,
    required: true
  },
  sessionId: {
    type: String,
    required: true
  },
  sessionAlias: {
    type: String,
    default: ''
  },
  channel: {
    type: String,
    default: 'claude'
  }
})

const emit = defineEmits(['update:show', 'error'])

const { drawerWidth } = useResponsiveDrawer(900, 800)
const TOC_SAFETY_GAP = 12
const PAGE_SIZE = 20

const visible = computed({
  get: () => props.show,
  set: (val) => emit('update:show', val)
})

const loading = ref(false)
const outlineLoading = ref(false)
const messages = ref([])
const outlineItems = ref([])
const metadata = ref({})
const currentPage = ref(1)
const totalMessages = ref(0)
const hasMore = ref(false)
const messagesContainer = ref(null)
const headerRef = ref(null)
const showScrollButton = ref(false)
const activeTocUserNumber = ref(null)
const mobileTocCollapsed = ref(false)
const pendingJumpTarget = ref(null)

let scrollSyncRaf = 0
let statusPollTimer = null
let lastStatusSignature = ''

const sessionAnchorPrefix = computed(() => sanitizeAnchorPart(props.sessionId).slice(0, 16) || 'session')

const messageAnchorIds = computed(() => {
  const duplicatedCount = new Map()
  return messages.value.map((message, index) => {
    const baseAnchor = buildBaseAnchor(message, index)
    const count = duplicatedCount.get(baseAnchor) || 0
    duplicatedCount.set(baseAnchor, count + 1)
    return count === 0 ? baseAnchor : `${baseAnchor}-${count + 1}`
  })
})

const loadedUserAnchors = computed(() => {
  const map = new Map()
  messages.value.forEach((message, index) => {
    if (message.type !== 'user' || !message.userMessageNumber) {
      return
    }
    map.set(message.userMessageNumber, messageAnchorIds.value[index])
  })
  return map
})

const tocItems = computed(() => outlineItems.value)

watch(tocItems, () => {
  if (!tocItems.value.length) {
    activeTocUserNumber.value = null
    return
  }
  if (!tocItems.value.some(item => item.userMessageNumber === activeTocUserNumber.value)) {
    activeTocUserNumber.value = tocItems.value[0].userMessageNumber
  }
  scheduleTocSync()
}, { deep: true })

watch(visible, (isVisible) => {
  if (isVisible) {
    nextTick(() => {
      scheduleTocSync()
    })
  } else {
    stopStatusPolling()
  }
})

onBeforeUnmount(() => {
  if (scrollSyncRaf) {
    cancelAnimationFrame(scrollSyncRaf)
    scrollSyncRaf = 0
  }
  stopStatusPolling()
})

function buildStatusSignature(status = {}) {
  return [status.lastModified || '', status.size || 0].join(':')
}

async function loadOutline() {
  try {
    outlineLoading.value = true
    const response = await getSessionOutline(props.projectName, props.sessionId, props.channel)
    outlineItems.value = Array.isArray(response?.items) ? response.items : []
  } catch (err) {
    console.error('Failed to load session outline:', err)
  } finally {
    outlineLoading.value = false
  }
}

async function syncSessionStatus() {
  const status = await getSessionStatus(props.projectName, props.sessionId, props.channel)
  lastStatusSignature = buildStatusSignature(status)
  return status
}

async function loadMessages(page = 1, options = {}) {
  if (loading.value) return

  const {
    skipFirstPageScroll = false,
    limitOverride = PAGE_SIZE
  } = options

  try {
    loading.value = true
    const response = await getSessionMessages(
      props.projectName,
      props.sessionId,
      page,
      limitOverride,
      'desc',
      props.channel
    )
    const { messages: newMessages, metadata: meta, pagination } = response

    if (page === 1) {
      messages.value = newMessages.reverse()
      metadata.value = meta
    } else {
      messages.value = [...newMessages.reverse(), ...messages.value]
    }

    currentPage.value = pagination.page
    totalMessages.value = pagination.total
    hasMore.value = pagination.hasMore

    if (page === 1) {
      nextTick(async () => {
        if (pendingJumpTarget.value) {
          await jumpToTarget(pendingJumpTarget.value, { allowLoadMore: true })
        } else if (!skipFirstPageScroll) {
          scrollToBottom(false)
        }
        scheduleTocSync()
      })
    }
  } catch (err) {
    console.error('Failed to load messages:', err)
    const errorMsg = '加载聊天记录失败: ' + (err.response?.data?.error || err.message)
    emit('error', errorMsg)
  } finally {
    loading.value = false
  }
}

function loadMore() {
  if (!hasMore.value || loading.value) return

  const container = messagesContainer.value
  const oldScrollHeight = container?.scrollHeight || 0

  loadMessages(currentPage.value + 1).then(() => {
    nextTick(() => {
      if (container) {
        const newScrollHeight = container.scrollHeight
        container.scrollTop = newScrollHeight - oldScrollHeight
        scheduleTocSync()
      }
    })
  })
}

function scrollToBottom(smooth = true) {
  nextTick(() => {
    const container = messagesContainer.value
    if (container) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto'
      })
      scheduleTocSync()
    }
  })
}

function handleScroll(event) {
  const target = event.target
  if (!target) return

  const { scrollTop, scrollHeight, clientHeight } = target
  showScrollButton.value = scrollHeight - scrollTop - clientHeight > 200

  if (scrollTop < 100 && hasMore.value && !loading.value) {
    loadMore()
  }

  scheduleTocSync()
}

function scheduleTocSync() {
  if (scrollSyncRaf) return
  scrollSyncRaf = requestAnimationFrame(() => {
    scrollSyncRaf = 0
    syncActiveTocItem()
  })
}

function syncActiveTocItem() {
  const container = messagesContainer.value
  if (!container || tocItems.value.length === 0) {
    activeTocUserNumber.value = null
    return
  }

  const loadedNumbers = Array.from(loadedUserAnchors.value.keys()).sort((left, right) => left - right)
  if (!loadedNumbers.length) {
    activeTocUserNumber.value = tocItems.value[tocItems.value.length - 1]?.userMessageNumber || null
    return
  }

  // When the list is at the bottom, the last user entry may not be able to reach
  // the visual "top" anchor line. In that case force the TOC highlight to the last item.
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
  if (maxScrollTop > 0 && maxScrollTop - container.scrollTop <= 6) {
    activeTocUserNumber.value = loadedNumbers[loadedNumbers.length - 1]
    return
  }

  const viewportTop = container.scrollTop
  const viewportBottom = viewportTop + container.clientHeight
  const anchorLine = viewportTop + getScrollOffset()

  let firstVisible = null
  let nearestAnchorAligned = null

  for (const item of tocItems.value) {
    const anchorId = loadedUserAnchors.value.get(item.userMessageNumber)
    const element = getAnchorElement(anchorId)
    if (!element) continue

    const top = getElementTopInContainer(element, container)
    const bottom = top + element.offsetHeight

    // Use the last TOC item whose top is not below the anchor line.
    // This keeps consecutive user messages individually selectable/highlightable.
    if (top <= anchorLine + 1) {
      nearestAnchorAligned = item
    }

    if (!firstVisible && bottom > viewportTop && top < viewportBottom) {
      firstVisible = item
    }
  }

  const nextActive = nearestAnchorAligned?.userMessageNumber
    || firstVisible?.userMessageNumber
    || loadedNumbers[0]
    || tocItems.value[0].userMessageNumber
  if (nextActive) {
    activeTocUserNumber.value = nextActive
  }
}

function jumpToTocItem(item) {
  if (!item?.userMessageNumber) return
  activeTocUserNumber.value = item.userMessageNumber
  jumpToTarget({ userMessageNumber: item.userMessageNumber }, { allowLoadMore: true })
}

function scrollToAnchor(anchorId, smooth = true) {
  const container = messagesContainer.value
  if (!container || !anchorId) return false

  const element = getAnchorElement(anchorId)
  if (!element) return false

  const targetTop = getElementTopInContainer(element, container)
  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight)
  const desiredTop = clamp(targetTop - getScrollOffset(), 0, maxTop)

  container.scrollTo({
    top: desiredTop,
    behavior: smooth ? 'smooth' : 'auto'
  })

  scheduleTocSync()
  return true
}

async function jumpToTarget(target, options = {}) {
  if (!target) return false
  const { allowLoadMore = false } = options

  let safetyCounter = 0
  while (safetyCounter < 50) {
    safetyCounter += 1
    const anchorId = resolveJumpAnchor(target)
    if (anchorId && scrollToAnchor(anchorId, true)) {
      if (Number.isInteger(target.userMessageNumber)) {
        activeTocUserNumber.value = target.userMessageNumber
      }
      pendingJumpTarget.value = null
      return true
    }

    if (!allowLoadMore || !hasMore.value || loading.value) {
      break
    }

    const beforePage = currentPage.value
    await loadMessages(currentPage.value + 1)
    if (currentPage.value === beforePage) {
      break
    }
  }

  pendingJumpTarget.value = null
  scheduleTocSync()
  return false
}

function resolveJumpAnchor(target) {
  if (target.anchorId && typeof target.anchorId === 'string') {
    return target.anchorId
  }

  if (Number.isInteger(target.userMessageNumber)) {
    return loadedUserAnchors.value.get(target.userMessageNumber) || ''
  }

  if (typeof target.messageIndex === 'number' && target.messageIndex >= 0) {
    return messageAnchorIds.value[target.messageIndex] || ''
  }

  if (target.messageId) {
    const targetId = String(target.messageId)
    const index = messages.value.findIndex(message => extractBackendMessageId(message) === targetId)
    if (index >= 0) {
      return messageAnchorIds.value[index]
    }
  }

  return ''
}

function normalizeOpenOptions(options) {
  if (!options || typeof options !== 'object') return null
  const jump = options.jumpTo && typeof options.jumpTo === 'object' ? options.jumpTo : options

  const normalized = {
    anchorId: typeof jump.anchorId === 'string' ? jump.anchorId : '',
    messageId: jump.messageId || jump.id || '',
    messageIndex: Number.isInteger(jump.messageIndex) ? jump.messageIndex : null,
    userMessageNumber: Number.isInteger(jump.userMessageNumber) ? jump.userMessageNumber : null
  }

  if (!normalized.anchorId && !normalized.messageId && normalized.messageIndex === null && normalized.userMessageNumber === null) {
    return null
  }

  return normalized
}

async function reloadMessagesForLiveSync() {
  if (loading.value) return

  const container = messagesContainer.value
  const wasNearBottom = container
    ? (container.scrollHeight - container.scrollTop - container.clientHeight <= 40)
    : true
  const previousScrollTop = container?.scrollTop || 0
  const targetPageCount = Math.max(currentPage.value, 1)

  try {
    loading.value = true
    const pageResponses = []
    for (let page = 1; page <= targetPageCount; page += 1) {
      pageResponses.push(await getSessionMessages(
        props.projectName,
        props.sessionId,
        page,
        PAGE_SIZE,
        'desc',
        props.channel
      ))
    }

    const nextMessages = []
    for (let index = pageResponses.length - 1; index >= 0; index -= 1) {
      const response = pageResponses[index]
      const pageMessages = Array.isArray(response?.messages) ? response.messages : []
      nextMessages.push(...pageMessages.slice().reverse())
    }

    messages.value = nextMessages
    metadata.value = pageResponses[0]?.metadata || metadata.value
    totalMessages.value = pageResponses[0]?.pagination?.total || nextMessages.length
    currentPage.value = targetPageCount
    hasMore.value = (targetPageCount * PAGE_SIZE) < totalMessages.value
  } finally {
    loading.value = false
  }

  await nextTick()
  if (!container) return

  if (wasNearBottom) {
    scrollToBottom(false)
  } else {
    const maxTop = Math.max(0, container.scrollHeight - container.clientHeight)
    container.scrollTop = clamp(previousScrollTop, 0, maxTop)
    scheduleTocSync()
  }
}

async function checkForLiveUpdates() {
  try {
    const status = await getSessionStatus(props.projectName, props.sessionId, props.channel)
    const nextSignature = buildStatusSignature(status)

    if (!nextSignature) return

    if (lastStatusSignature && nextSignature !== lastStatusSignature) {
      lastStatusSignature = nextSignature
      await Promise.all([
        loadOutline(),
        reloadMessagesForLiveSync()
      ])
      return
    }

    lastStatusSignature = nextSignature
  } catch (err) {
    console.error('Failed to live sync chat history:', err)
  }
}

function stopStatusPolling() {
  if (statusPollTimer) {
    clearInterval(statusPollTimer)
    statusPollTimer = null
  }
}

function startStatusPolling() {
  stopStatusPolling()
  statusPollTimer = setInterval(() => {
    if (!visible.value) return
    checkForLiveUpdates()
  }, 3000)
}

function open(options) {
  stopStatusPolling()
  pendingJumpTarget.value = normalizeOpenOptions(options)
  mobileTocCollapsed.value = false
  messages.value = []
  outlineItems.value = []
  metadata.value = {}
  currentPage.value = 1
  totalMessages.value = 0
  hasMore.value = false
  showScrollButton.value = false
  activeTocUserNumber.value = null
  lastStatusSignature = ''

  Promise.all([
    loadOutline(),
    loadMessages(1, { skipFirstPageScroll: Boolean(pendingJumpTarget.value) }),
    syncSessionStatus()
  ])
    .then(() => {
      if (visible.value) {
        startStatusPolling()
      }
    })
    .catch(() => {})
}

function extractBackendMessageId(message) {
  if (!message || typeof message !== 'object') return ''
  return String(message.messageId || message.id || message.uuid || message.turnId || '')
}

function buildBaseAnchor(message, index) {
  const backendId = extractBackendMessageId(message)
  if (backendId) {
    return `msg-${sessionAnchorPrefix.value}-${sanitizeAnchorPart(backendId)}`
  }

  const timestamp = message?.timestamp ? String(message.timestamp) : ''
  const type = message?.type ? String(message.type) : 'unknown'
  const content = getContentForHash(message)
  const hash = stringHash(`${type}|${timestamp}|${content}`)
  const fallbackPart = timestamp ? sanitizeAnchorPart(timestamp) : `idx${index}`

  return `msg-${sessionAnchorPrefix.value}-${type}-${fallbackPart}-${hash}`
}

function getContentForHash(message) {
  const content = message?.content
  if (typeof content === 'string') {
    return content.slice(0, 240)
  }

  if (Array.isArray(content)) {
    try {
      return JSON.stringify(content).slice(0, 240)
    } catch {
      return String(content)
    }
  }

  if (content == null) {
    return ''
  }

  return String(content).slice(0, 240)
}

function sanitizeAnchorPart(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function stringHash(input) {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

function getAnchorElement(anchorId) {
  const container = messagesContainer.value
  if (!container || !anchorId) return null
  const element = document.getElementById(anchorId)
  if (!element || !container.contains(element)) return null
  return element
}

function getElementTopInContainer(element, container) {
  const containerRect = container.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()
  return container.scrollTop + (elementRect.top - containerRect.top)
}

function getScrollOffset() {
  const headerHeight = headerRef.value?.offsetHeight || 0
  return headerHeight + TOC_SAFETY_GAP
}

function formatTocTime(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

defineExpose({ open })
</script>

<style scoped>
.drawer-wrapper {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--n-color);
}

.drawer-header {
  flex-shrink: 0;
  padding: 16px 20px;
  border-bottom: 1px solid var(--n-border-color);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.header-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.session-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--n-text-color);
}

.spacer {
  flex: 1;
}

.close-btn {
  cursor: pointer;
  color: var(--n-text-color-3);
  transition: color 0.2s;
}

.close-btn:hover {
  color: var(--n-text-color);
}

.session-summary {
  font-size: 13px;
  color: var(--n-text-color-2);
  line-height: 1.4;
}

.drawer-body {
  flex: 1;
  min-height: 0;
}

.loading-container,
.empty-container {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.history-layout {
  display: flex;
  height: 100%;
  min-height: 0;
  gap: 0;
}

.mobile-toc-toggle {
  display: none;
  padding: 12px 14px 0;
}

.toc-rail {
  width: 250px;
  border-right: 1px solid var(--n-border-color);
  background: var(--n-color-embedded);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.toc-header {
  font-size: 12px;
  font-weight: 600;
  color: var(--n-text-color-2);
  padding: 12px 14px;
  border-bottom: 1px solid var(--n-border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.toc-header-hint {
  font-weight: 400;
  color: var(--n-text-color-3);
}

.toc-empty {
  padding: 14px;
  font-size: 12px;
  color: var(--n-text-color-3);
}

.toc-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.toc-item {
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 8px;
  margin-bottom: 6px;
  cursor: pointer;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: inherit;
}

.toc-order {
  font-size: 11px;
  color: var(--n-text-color-3);
}

.toc-item:hover {
  background: rgba(24, 160, 88, 0.08);
}

.toc-item.active {
  border-color: rgba(24, 160, 88, 0.35);
  background: rgba(24, 160, 88, 0.12);
}

.toc-preview {
  font-size: 12px;
  color: var(--n-text-color);
  line-height: 1.35;
  word-break: break-word;
}

.toc-time {
  font-size: 11px;
  color: var(--n-text-color-3);
}

.messages-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  position: relative;
}

.messages-container {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px 20px;
}

.load-more-top {
  display: flex;
  justify-content: center;
  padding: 0 0 16px;
}

.messages-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.scroll-btn {
  position: absolute;
  right: 20px;
  bottom: 20px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--n-color);
  border: 1px solid var(--n-border-color);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transition: all 0.2s;
  z-index: 10;
}

.scroll-btn:hover {
  background: var(--n-color-hover);
  transform: scale(1.05);
}

@media (max-width: 820px) {
  .history-layout {
    flex-direction: column;
  }

  .mobile-toc-toggle {
    display: block;
  }

  .toc-rail {
    width: auto;
    border-right: none;
    border-bottom: 1px solid var(--n-border-color);
    max-height: 220px;
  }

  .toc-rail.mobile-collapsed {
    display: none;
  }

  .messages-container {
    padding: 14px 16px;
  }

  .scroll-btn {
    right: 16px;
    bottom: 16px;
  }
}
</style>
