<template>
  <div class="terminal-view">
    <!-- 标签栏 -->
    <TerminalTabs
      :tabs="tabs"
      :active-tab="activeTabId"
      @select="selectTab"
      @close="closeTab"
      @add="handleTabAdd"
    />

    <!-- 终端面板区域 -->
    <div class="terminal-panels">
      <template v-if="tabs.length > 0">
        <TerminalPane
          v-for="tab in tabs"
          :key="tab.id"
          :ref="el => setPaneRef(tab.id, el)"
          v-show="tab.id === activeTabId"
          :terminal-id="tab.terminalId"
          :channel="tab.channel"
          :session-id="tab.sessionId"
          :project-name="tab.projectName"
          :cwd="tab.cwd"
          @created="handleTerminalCreated(tab.id, $event)"
          @exit="handleTerminalExit(tab.id, $event)"
          @error="handleTerminalError(tab.id, $event)"
        />
      </template>

      <!-- 空状态 - 创建新终端 -->
      <div v-else class="empty-state">
        <n-icon :size="64" color="#45475a">
          <TerminalOutline />
        </n-icon>
        <h3 class="empty-title">Web 终端</h3>
        <p class="empty-desc">在浏览器中运行命令行工具</p>

        <!-- 新建终端按钮 -->
        <div class="empty-actions">
          <n-button type="primary" size="large" @click="addNewTab({ channel: 'shell' })">
            <template #icon>
              <n-icon><AddOutline /></n-icon>
            </template>
            新建 Web 终端
          </n-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
// 定义组件名称，用于 keep-alive
export default {
  name: 'Terminal'
}
</script>

<script setup>
import { ref, onBeforeUnmount, onActivated, watch, nextTick, h } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NIcon, NButton, useMessage } from 'naive-ui'
import { TerminalOutline, AddOutline } from '@vicons/ionicons5'
import TerminalTabs from '@/components/terminal/TerminalTabs.vue'
import TerminalPane from '@/components/terminal/TerminalPane.vue'
import { listWebTerminals } from '@/api/terminal'

const route = useRoute()
const router = useRouter()
const message = useMessage()

// 标签状态
const tabs = ref([])
const activeTabId = ref(null)
const paneRefs = ref({})
let nextTabId = 1

// 新建菜单状态 (已移除)
const showNewMenu = ref(false)

const STORAGE_KEY = 'terminal-tabs-v1'
let persistTimer = null
const isRestoring = ref(true)

function getNextTabId(tabsList) {
  let maxId = 0
  tabsList.forEach(tab => {
    const match = typeof tab.id === 'string' ? tab.id.match(/^tab_(\d+)$/) : null
    if (match) {
      const num = parseInt(match[1], 10)
      if (Number.isFinite(num) && num > maxId) {
        maxId = num
      }
    }
  })
  return maxId + 1
}

function serializeTabs() {
  return tabs.value.map(tab => ({
    id: tab.id,
    terminalId: tab.terminalId || null,
    channel: tab.channel,
    sessionId: tab.sessionId || null,
    projectName: tab.projectName || null,
    cwd: tab.cwd || null,
    title: tab.title || null,
    status: tab.status || null
  }))
}

function persistTabs() {
  if (typeof window === 'undefined') return
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    try {
      const payload = {
        tabs: serializeTabs(),
        activeTabId: activeTabId.value
      }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch (err) {
      // 忽略持久化错误
    }
  }, 100)
}

function restoreTabsFromStorage() {
  if (typeof window === 'undefined') return false
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.tabs)) return false

    const restored = parsed.tabs
      .filter(tab => tab && tab.id && tab.channel)
      .map(tab => ({
        id: tab.id,
        terminalId: tab.terminalId || null,
        channel: tab.channel,
        sessionId: tab.sessionId || null,
        projectName: tab.projectName || null,
        cwd: tab.cwd || null,
        title: tab.title || null,
        status: tab.status || 'connecting'
      }))

    tabs.value = restored
    activeTabId.value = restored.some(t => t.id === parsed.activeTabId)
      ? parsed.activeTabId
      : (restored[0]?.id || null)
    nextTabId = getNextTabId(restored)
    return restored.length > 0
  } catch (err) {
    return false
  }
}

async function restoreTabsFromServer(options = {}) {
  const { merge = false } = options
  if (!merge && tabs.value.length > 0) return
  try {
    const res = await listWebTerminals()
    if (!res?.success || !Array.isArray(res.terminals) || res.terminals.length === 0) return

    const existingIds = new Set(
      tabs.value.map(tab => tab.terminalId).filter(Boolean)
    )
    const candidates = res.terminals.filter(terminal => !existingIds.has(terminal.id))
    if (candidates.length === 0) return

    const startIndex = getNextTabId(tabs.value)
    const restored = candidates.map((terminal, index) => ({
      id: `tab_${startIndex + index}`,
      terminalId: terminal.id,
      channel: terminal.metadata?.channel || 'shell',
      sessionId: terminal.metadata?.sessionId || null,
      projectName: terminal.metadata?.projectName || null,
      cwd: terminal.metadata?.cwd || null,
      title: null,
      status: terminal.exited ? 'exited' : 'connected'
    }))

    if (merge && tabs.value.length > 0) {
      tabs.value = [...tabs.value, ...restored]
    } else {
      tabs.value = restored
    }
    if (!activeTabId.value) {
      activeTabId.value = tabs.value[0]?.id || null
    }
    nextTabId = getNextTabId(tabs.value)
    persistTabs()
  } catch (err) {
    // 忽略恢复失败
  }
}

async function restoreTabs() {
  const restored = restoreTabsFromStorage()
  if (!restored) {
    await restoreTabsFromServer()
  } else {
    await restoreTabsFromServer({ merge: true })
  }
  isRestoring.value = false
  handleRouteParams()
}

restoreTabs()

// 设置面板引用
function setPaneRef(tabId, el) {
  if (el) {
    paneRefs.value[tabId] = el
  } else {
    delete paneRefs.value[tabId]
  }
}

// 处理标签栏的添加事件
function handleTabAdd(options) {
  // 默认使用 shell 或传入的 channel
  const channel = (options && options.channel) || 'shell'
  addNewTab({ channel })
}

// 添加新标签
function addNewTab(options = {}) {
  const tab = {
    id: `tab_${nextTabId++}`,
    terminalId: null,
    channel: options.channel || 'shell',
    sessionId: options.sessionId || null,
    projectName: options.projectName || null,
    cwd: options.cwd || null,
    title: options.title || null,
    status: 'connecting'
  }

  tabs.value.push(tab)
  activeTabId.value = tab.id

  // 聚焦终端
  nextTick(() => {
    const pane = paneRefs.value[tab.id]
    if (pane) {
      pane.focus()
    }
  })

  persistTabs()

  return tab
}

// 选择标签
function selectTab(tabId) {
  activeTabId.value = tabId

  nextTick(() => {
    const pane = paneRefs.value[tabId]
    if (pane) {
      pane.focus()
    }
  })

  persistTabs()
}

// 关闭标签
function closeTab(tabId) {
  const index = tabs.value.findIndex(t => t.id === tabId)
  if (index === -1) return

  // 销毁终端
  const pane = paneRefs.value[tabId]
  if (pane) {
    pane.destroy()
  }

  tabs.value.splice(index, 1)

  // 选择相邻标签
  if (activeTabId.value === tabId && tabs.value.length > 0) {
    const newIndex = Math.max(0, index - 1)
    activeTabId.value = tabs.value[newIndex]?.id
  }

  persistTabs()
}

// 终端创建成功
function handleTerminalCreated(tabId, { terminalId, metadata }) {
  const tab = tabs.value.find(t => t.id === tabId)
  if (tab) {
    tab.terminalId = terminalId
    tab.status = 'connected'
    persistTabs()
  }
}

// 终端退出
function handleTerminalExit(tabId, { exitCode }) {
  const tab = tabs.value.find(t => t.id === tabId)
  if (tab) {
    tab.status = 'exited'
    message.warning(`终端已退出 (code: ${exitCode})`)
    persistTabs()
  }
}

// 终端错误
function handleTerminalError(tabId, error) {
  message.error(`终端错误: ${error}`)
}

function normalizeQueryValue(value) {
  if (Array.isArray(value)) return value[0]
  return value || null
}

function safeDecode(value) {
  if (!value || typeof value !== 'string') return value
  try {
    return decodeURIComponent(value)
  } catch (err) {
    return value
  }
}

// 处理路由参数
function handleRouteParams() {
  const { channel, projectName, sessionId } = route.params
  const queryCwd = normalizeQueryValue(route.query.cwd)
  const queryProjectName = normalizeQueryValue(route.query.projectName)
  const querySessionId = normalizeQueryValue(route.query.sessionId)
  const queryOpenTs = normalizeQueryValue(route.query.openTs)
  const resolvedProjectName = projectName || queryProjectName
  const resolvedSessionId = sessionId || querySessionId
  const normalizedProjectName = resolvedProjectName ? safeDecode(resolvedProjectName) : null
  const normalizedSessionId = resolvedSessionId || null

  if (channel) {
    const forceNewTab = Boolean(queryOpenTs)
    const hasSession = Boolean(normalizedSessionId)
    // 有 sessionId 时才复用，避免新会话被复用
    const existingTab = (!forceNewTab && hasSession)
      ? tabs.value.find(
          t => t.channel === channel &&
               t.projectName === normalizedProjectName &&
               t.sessionId === normalizedSessionId
        )
      : null

    if (existingTab) {
      activeTabId.value = existingTab.id
    } else if (forceNewTab || hasSession || tabs.value.length === 0) {
      addNewTab({
        channel,
        projectName: normalizedProjectName,
        sessionId: normalizedSessionId,
        cwd: queryCwd || null
      })
    }

    if (forceNewTab) {
      const { openTs, ...restQuery } = route.query
      router.replace({
        name: route.name,
        params: route.params,
        query: restQuery
      })
    }
    persistTabs()
  }
}

// 监听路由变化（包含 query 变更）
watch(() => route.fullPath, () => {
  if (isRestoring.value) return
  handleRouteParams()
}, { immediate: true })

// keep-alive 激活时（从其他页面返回）
onActivated(() => {
  // 聚焦当前激活的终端
  if (activeTabId.value) {
    nextTick(() => {
      const pane = paneRefs.value[activeTabId.value]
      if (pane) {
        pane.focus()
      }
    })
  }
})

onBeforeUnmount(() => {
  // 只有组件真正销毁时才断开连接
  // 这样终端可以在后台继续运行
  tabs.value.forEach(tab => {
    const pane = paneRefs.value[tab.id]
    if (pane) {
      pane.disconnect() // 只断开连接
    }
  })

  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
})
</script>

<style scoped>
.terminal-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--terminal-bg);
}

.terminal-panels {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  height: 100%;
  gap: 16px;
  padding: 48px 32px;
  overflow-y: auto;
}

.empty-title {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  color: var(--terminal-text);
}

.empty-desc {
  margin: 0;
  font-size: 14px;
  color: var(--terminal-text-muted);
}

.empty-actions {
  display: flex;
  gap: 12px;
  margin-top: 24px;
}
</style>
