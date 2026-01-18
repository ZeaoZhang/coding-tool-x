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
        <p class="empty-desc">在浏览器中运行 Claude Code / Codex / Gemini CLI</p>

        <!-- 新建终端按钮 -->
        <div class="empty-actions">
          <n-button type="primary" @click="addNewTab({ channel: 'claude' })">
            <template #icon>
              <n-icon><AddOutline /></n-icon>
            </template>
            新建 Claude 终端
          </n-button>
          <n-button @click="addNewTab({ channel: 'codex' })">
            新建 Codex 终端
          </n-button>
          <n-button @click="addNewTab({ channel: 'gemini' })">
            新建 Gemini 终端
          </n-button>
        </div>
      </div>
    </div>

    <!-- 新建终端下拉菜单 -->
    <n-dropdown
      :show="showNewMenu"
      :options="newTerminalOptions"
      @select="handleNewTerminalSelect"
      @clickoutside="showNewMenu = false"
      placement="bottom-start"
      trigger="manual"
      :x="menuX"
      :y="menuY"
    />
  </div>
</template>

<script>
// 定义组件名称，用于 keep-alive
export default {
  name: 'Terminal'
}
</script>

<script setup>
import { ref, onMounted, onBeforeUnmount, onActivated, watch, nextTick, h } from 'vue'
import { useRoute } from 'vue-router'
import { NIcon, NButton, NDropdown, useMessage } from 'naive-ui'
import { TerminalOutline, AddOutline } from '@vicons/ionicons5'
import TerminalTabs from '@/components/terminal/TerminalTabs.vue'
import TerminalPane from '@/components/terminal/TerminalPane.vue'

const route = useRoute()
const message = useMessage()

// 标签状态
const tabs = ref([])
const activeTabId = ref(null)
const paneRefs = ref({})
let nextTabId = 1

// 新建菜单状态
const showNewMenu = ref(false)
const menuX = ref(0)
const menuY = ref(0)

const newTerminalOptions = [
  { label: 'Claude 终端', key: 'claude' },
  { label: 'Codex 终端', key: 'codex' },
  { label: 'Gemini 终端', key: 'gemini' }
]

// 设置面板引用
function setPaneRef(tabId, el) {
  if (el) {
    paneRefs.value[tabId] = el
  } else {
    delete paneRefs.value[tabId]
  }
}

// 显示新建终端菜单
function showNewTerminalMenu(event) {
  menuX.value = event.clientX
  menuY.value = event.clientY
  showNewMenu.value = true
}

// 处理新建终端选择
function handleNewTerminalSelect(key) {
  showNewMenu.value = false
  addNewTab({ channel: key })
}

// 处理标签栏的添加事件
function handleTabAdd(options) {
  if (options && options.channel) {
    addNewTab({ channel: options.channel })
  }
}

// 添加新标签
function addNewTab(options = {}) {
  const tab = {
    id: `tab_${nextTabId++}`,
    terminalId: null,
    channel: options.channel || 'claude',
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
}

// 终端创建成功
function handleTerminalCreated(tabId, { terminalId, metadata }) {
  const tab = tabs.value.find(t => t.id === tabId)
  if (tab) {
    tab.terminalId = terminalId
    tab.status = 'connected'
  }
}

// 终端退出
function handleTerminalExit(tabId, { exitCode }) {
  const tab = tabs.value.find(t => t.id === tabId)
  if (tab) {
    tab.status = 'exited'
    message.warning(`终端已退出 (code: ${exitCode})`)
  }
}

// 终端错误
function handleTerminalError(tabId, error) {
  message.error(`终端错误: ${error}`)
}

// 处理路由参数
function handleRouteParams() {
  const { channel, projectName, sessionId } = route.params
  const { cwd } = route.query  // 从 query 中获取 cwd

  if (channel) {
    // 检查是否已有相同会话的标签
    const existingTab = tabs.value.find(
      t => t.channel === channel &&
           t.projectName === projectName &&
           t.sessionId === sessionId
    )

    if (existingTab) {
      activeTabId.value = existingTab.id
    } else {
      addNewTab({
        channel,
        projectName: projectName ? decodeURIComponent(projectName) : null,
        sessionId: sessionId || null,
        cwd: cwd || null
      })
    }
  }
}

// 监听路由变化
watch(() => route.params, handleRouteParams, { immediate: false })

onMounted(() => {
  // 处理路由参数
  handleRouteParams()
})

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
