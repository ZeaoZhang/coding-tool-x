<template>
  <div class="terminal-view">
    <!-- 标签栏 -->
    <TerminalTabs
      :tabs="tabs"
      :active-tab="activeTabId"
      :existing-terminals="existingTerminals"
      @select="selectTab"
      @close="closeTab"
      @add="handleTabAdd"
      @attach="attachToTerminal"
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

      <!-- 空状态 - 显示现有终端列表或创建新终端 -->
      <div v-else class="empty-state">
        <n-icon :size="64" color="#45475a">
          <TerminalOutline />
        </n-icon>
        <h3 class="empty-title">Web 终端</h3>
        <p class="empty-desc">在浏览器中运行 Claude Code / Codex / Gemini CLI</p>

        <!-- 现有终端列表 -->
        <div v-if="existingTerminals.length > 0" class="existing-terminals">
          <h4 class="section-title">现有终端</h4>
          <div class="terminal-list">
            <div
              v-for="term in existingTerminals"
              :key="term.id"
              class="terminal-item"
              @click="attachToTerminal(term)"
            >
              <div class="terminal-item-icon">
                <n-icon :size="20" :color="getChannelColor(term.metadata.channel)">
                  <component :is="getChannelIcon(term.metadata.channel)" />
                </n-icon>
              </div>
              <div class="terminal-item-info">
                <div class="terminal-item-title">
                  {{ formatTerminalTitle(term) }}
                </div>
                <div class="terminal-item-meta">
                  <n-tag size="tiny" :bordered="false" :type="getChannelType(term.metadata.channel)">
                    {{ term.metadata.channel }}
                  </n-tag>
                  <span v-if="term.metadata.projectName" class="meta-text">
                    {{ decodeProjectName(term.metadata.projectName) }}
                  </span>
                  <n-tag v-if="term.connected" size="tiny" type="success" :bordered="false">已连接</n-tag>
                  <n-tag v-else-if="term.exited" size="tiny" type="error" :bordered="false">已退出</n-tag>
                  <n-tag v-else size="tiny" type="warning" :bordered="false">待连接</n-tag>
                </div>
              </div>
              <div class="terminal-item-actions">
                <n-button size="tiny" quaternary @click.stop="destroyTerminal(term.id)">
                  <template #icon>
                    <n-icon><CloseOutline /></n-icon>
                  </template>
                </n-button>
              </div>
            </div>
          </div>
        </div>

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
import { ref, onMounted, onBeforeUnmount, onActivated, onDeactivated, watch, nextTick, computed, h } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NIcon, NButton, NTag, NDropdown, useMessage } from 'naive-ui'
import { TerminalOutline, AddOutline, CloseOutline, LogoReact, LogoGoogle } from '@vicons/ionicons5'
import TerminalTabs from '@/components/terminal/TerminalTabs.vue'
import TerminalPane from '@/components/terminal/TerminalPane.vue'
import { listWebTerminals, destroyWebTerminal } from '@/api/terminal'

const route = useRoute()
const router = useRouter()
const message = useMessage()

// 标签状态
const tabs = ref([])
const activeTabId = ref(null)
const paneRefs = ref({})
let nextTabId = 1

// 现有终端列表
const existingTerminals = ref([])
const loadingTerminals = ref(false)

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

// 获取渠道颜色
function getChannelColor(channel) {
  switch (channel) {
    case 'claude': return '#cc785c'
    case 'codex': return '#10a37f'
    case 'gemini': return '#4285f4'
    default: return '#45475a'
  }
}

// 获取渠道图标
function getChannelIcon(channel) {
  switch (channel) {
    case 'claude': return TerminalOutline
    case 'codex': return LogoReact
    case 'gemini': return LogoGoogle
    default: return TerminalOutline
  }
}

// 获取渠道类型（用于标签）
function getChannelType(channel) {
  switch (channel) {
    case 'claude': return 'warning'
    case 'codex': return 'success'
    case 'gemini': return 'info'
    default: return 'default'
  }
}

// 格式化终端标题
function formatTerminalTitle(term) {
  if (term.metadata.sessionId) {
    return `会话: ${term.metadata.sessionId.substring(0, 8)}`
  }
  return `终端 ${term.id.split('_')[1] || term.id}`
}

// 解码项目名
function decodeProjectName(name) {
  try {
    return decodeURIComponent(name).replace(/-/g, '/')
  } catch {
    return name
  }
}

// 加载现有终端列表
async function loadExistingTerminals() {
  loadingTerminals.value = true
  try {
    const result = await listWebTerminals()
    if (result.success) {
      existingTerminals.value = result.terminals || []
    }
  } catch (err) {
    console.error('Failed to load terminals:', err)
  } finally {
    loadingTerminals.value = false
  }
}

// 连接到现有终端
function attachToTerminal(term) {
  const tab = {
    id: `tab_${nextTabId++}`,
    terminalId: term.id,
    channel: term.metadata.channel,
    sessionId: term.metadata.sessionId || null,
    projectName: term.metadata.projectName || null,
    cwd: term.metadata.cwd || null,
    title: formatTerminalTitle(term),
    status: 'connecting'
  }

  tabs.value.push(tab)
  activeTabId.value = tab.id

  nextTick(() => {
    const pane = paneRefs.value[tab.id]
    if (pane) {
      pane.focus()
    }
  })
}

// 销毁现有终端
async function destroyTerminal(terminalId) {
  try {
    await destroyWebTerminal(terminalId)
    await loadExistingTerminals()
    message.success('终端已销毁')
  } catch (err) {
    message.error('销毁失败: ' + err.message)
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
  // 刷新现有终端列表
  loadExistingTerminals()
}

// 终端退出
function handleTerminalExit(tabId, { exitCode }) {
  const tab = tabs.value.find(t => t.id === tabId)
  if (tab) {
    tab.status = 'exited'
    message.warning(`终端已退出 (code: ${exitCode})`)
  }
  // 刷新现有终端列表
  loadExistingTerminals()
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
    // 先检查现有终端中是否有匹配的
    const existingTerm = existingTerminals.value.find(
      t => t.metadata.channel === channel &&
           t.metadata.projectName === projectName &&
           t.metadata.sessionId === sessionId
    )

    if (existingTerm) {
      // 检查是否已有相同的标签
      const existingTab = tabs.value.find(t => t.terminalId === existingTerm.id)
      if (existingTab) {
        activeTabId.value = existingTab.id
      } else {
        attachToTerminal(existingTerm)
      }
    } else {
      // 检查是否已有相同会话的标签（新创建的）
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
          cwd: cwd || null  // 传递 cwd
        })
      }
    }
  }
}

// 监听路由变化
watch(() => route.params, handleRouteParams, { immediate: false })

// 定期刷新终端列表
let refreshInterval = null

onMounted(async () => {
  await loadExistingTerminals()

  // 处理路由参数
  handleRouteParams()

  // 定期刷新终端列表（每 10 秒）
  refreshInterval = setInterval(loadExistingTerminals, 10000)
})

// keep-alive 激活时（从其他页面返回）
onActivated(() => {
  // 刷新终端列表
  loadExistingTerminals()

  // 重新启动定时刷新
  if (!refreshInterval) {
    refreshInterval = setInterval(loadExistingTerminals, 10000)
  }

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

// keep-alive 停用时（导航到其他页面）
onDeactivated(() => {
  // 暂停定时刷新以节省资源
  if (refreshInterval) {
    clearInterval(refreshInterval)
    refreshInterval = null
  }
  // 注意：不断开 WebSocket 连接，保持终端活跃
})

onBeforeUnmount(() => {
  // 清理定时器
  if (refreshInterval) {
    clearInterval(refreshInterval)
    refreshInterval = null
  }

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

/* 现有终端列表样式 */
.existing-terminals {
  width: 100%;
  max-width: 600px;
  margin-top: 24px;
}

.section-title {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--terminal-text-muted);
}

.terminal-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.terminal-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--terminal-item-bg);
  border: 1px solid var(--terminal-item-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.terminal-item:hover {
  background: var(--terminal-item-hover);
  border-color: var(--primary-color);
}

.terminal-item-icon {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--terminal-icon-bg);
  border-radius: 6px;
}

.terminal-item-info {
  flex: 1;
  min-width: 0;
}

.terminal-item-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--terminal-text);
  margin-bottom: 4px;
}

.terminal-item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.meta-text {
  font-size: 12px;
  color: var(--terminal-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}

.terminal-item-actions {
  flex-shrink: 0;
}
</style>
