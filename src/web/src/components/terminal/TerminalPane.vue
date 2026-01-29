<template>
  <div class="terminal-pane" ref="containerRef">
    <div class="terminal-container" ref="terminalRef"></div>
    <div v-if="!connected" class="terminal-overlay">
      <n-spin size="large" />
      <span class="connecting-text">{{ connecting ? '连接中...' : '已断开' }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick, computed } from 'vue'
import { NSpin } from 'naive-ui'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useTheme } from '../../composables/useTheme'

const props = defineProps({
  terminalId: {
    type: String,
    default: null
  },
  channel: {
    type: String,
    default: 'claude'
  },
  sessionId: {
    type: String,
    default: null
  },
  projectName: {
    type: String,
    default: null
  },
  cwd: {
    type: String,
    default: null
  }
})

const emit = defineEmits(['created', 'exit', 'error'])

const { isDark } = useTheme()

const containerRef = ref(null)
const terminalRef = ref(null)
const connected = ref(false)
const connecting = ref(true)

let terminal = null
let fitAddon = null
let ws = null
let currentTerminalId = null
let resizeObserver = null
let reconnectTimer = null
let shouldReconnect = true  // 控制是否允许重连
let lastSentCols = null
let lastSentRows = null
let serverCols = null
let serverRows = null
let allowResize = false
let pendingResize = null

// 深色主题配色 (Catppuccin Mocha)
const darkTheme = {
  background: '#1e1e2e',
  foreground: '#cdd6f4',
  cursor: '#f5e0dc',
  cursorAccent: '#1e1e2e',
  selectionBackground: 'rgba(166, 227, 161, 0.3)',
  selectionForeground: '#cdd6f4',
  black: '#45475a',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#f5c2e7',
  cyan: '#94e2d5',
  white: '#bac2de',
  brightBlack: '#585b70',
  brightRed: '#f38ba8',
  brightGreen: '#a6e3a1',
  brightYellow: '#f9e2af',
  brightBlue: '#89b4fa',
  brightMagenta: '#f5c2e7',
  brightCyan: '#94e2d5',
  brightWhite: '#a6adc8'
}

// 浅色主题配色 (Catppuccin Latte)
const lightTheme = {
  background: '#eff1f5',
  foreground: '#4c4f69',
  cursor: '#dc8a78',
  cursorAccent: '#eff1f5',
  selectionBackground: 'rgba(64, 160, 43, 0.3)',
  selectionForeground: '#4c4f69',
  black: '#5c5f77',
  red: '#d20f39',
  green: '#40a02b',
  yellow: '#df8e1d',
  blue: '#1e66f5',
  magenta: '#ea76cb',
  cyan: '#179299',
  white: '#acb0be',
  brightBlack: '#6c6f85',
  brightRed: '#d20f39',
  brightGreen: '#40a02b',
  brightYellow: '#df8e1d',
  brightBlue: '#1e66f5',
  brightMagenta: '#ea76cb',
  brightCyan: '#179299',
  brightWhite: '#bcc0cc'
}

// 根据主题获取配色
const currentTheme = computed(() => isDark.value ? darkTheme : lightTheme)

// 初始化终端
function initTerminal() {
  if (terminal) return

  terminal = new Terminal({
    theme: currentTheme.value,
    fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Monaco, "Cascadia Code", Consolas, monospace',
    fontSize: 14,
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 10000,
    allowTransparency: true,
    convertEol: true
  })

  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.loadAddon(new WebLinksAddon())

  terminal.open(terminalRef.value)

  // 延迟 fit 以确保容器尺寸正确
  nextTick(() => {
    fitAddon.fit()
  })

  // 监听终端输入
  terminal.onData((data) => {
    if (ws && ws.readyState === WebSocket.OPEN && currentTerminalId) {
      ws.send(JSON.stringify({
        type: 'terminal:input',
        terminalId: currentTerminalId,
        data
      }))
    }
  })

  // 监听终端大小变化
  terminal.onResize(({ cols, rows }) => {
    handleResize(cols, rows)
  })

  // 监听容器大小变化
  resizeObserver = new ResizeObserver(() => {
    if (fitAddon && isContainerVisible()) {
      fitAddon.fit()
    }
  })
  resizeObserver.observe(containerRef.value)
}

function isContainerVisible() {
  if (!containerRef.value) return false
  const rect = containerRef.value.getBoundingClientRect()
  return rect.width > 20 && rect.height > 20
}

function updateServerSize(metadata) {
  if (!metadata) return
  if (Number.isFinite(metadata.cols)) {
    serverCols = metadata.cols
  }
  if (Number.isFinite(metadata.rows)) {
    serverRows = metadata.rows
  }
}

function sendResizeIfNeeded(cols, rows) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !currentTerminalId) return
  if (Number.isFinite(serverCols) && Number.isFinite(serverRows) && cols === serverCols && rows === serverRows) {
    lastSentCols = cols
    lastSentRows = rows
    return
  }
  if (lastSentCols === cols && lastSentRows === rows) return
  ws.send(JSON.stringify({
    type: 'terminal:resize',
    terminalId: currentTerminalId,
    cols,
    rows
  }))
  lastSentCols = cols
  lastSentRows = rows
}

function handleResize(cols, rows) {
  if (!isContainerVisible()) {
    pendingResize = { cols, rows }
    return
  }
  if (!allowResize) {
    pendingResize = { cols, rows }
    return
  }
  sendResizeIfNeeded(cols, rows)
}

function syncSizeWithServer() {
  if (!terminal) return
  const cols = terminal.cols
  const rows = terminal.rows
  if (!isContainerVisible()) {
    pendingResize = { cols, rows }
    return
  }
  sendResizeIfNeeded(cols, rows)
}

// 连接 WebSocket
function connectWebSocket() {
  if (ws) {
    ws.close()
  }

  // 重置重连标志
  shouldReconnect = true
  connecting.value = true
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${protocol}//${window.location.host}/ws`

  ws = new WebSocket(wsUrl)

  ws.onopen = () => {
    console.log('Terminal WebSocket connected')

    // 如果有传入的 terminalId，绑定到现有终端
    if (props.terminalId) {
      sendAttach(props.terminalId)
    } else {
      // 创建新终端
      ws.send(JSON.stringify({
        type: 'terminal:create',
        channel: props.channel,
        sessionId: props.sessionId,
        projectName: props.projectName,
        cwd: props.cwd
      }))
    }
  }

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data)
      handleMessage(message)
    } catch (e) {
      // 可能是非 JSON 数据，忽略
    }
  }

  ws.onclose = () => {
    console.log('Terminal WebSocket closed')
    connected.value = false
    connecting.value = false

    // 尝试重连（仅在允许重连时）
    if (shouldReconnect && !reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        if (shouldReconnect) {
          connectWebSocket()
        }
      }, 3000)
    }
  }

  ws.onerror = (error) => {
    console.error('Terminal WebSocket error:', error)
    connecting.value = false
    emit('error', error)
  }
}

function sendAttach(terminalId) {
  if (!terminalId || !ws || ws.readyState !== WebSocket.OPEN) return
  lastSentCols = null
  lastSentRows = null
  serverCols = null
  serverRows = null
  allowResize = false
  pendingResize = null
  if (terminal) {
    terminal.clear()
    terminal.reset()
  }
  const payload = {
    type: 'terminal:attach',
    terminalId
  }
  if (terminal && Number.isFinite(terminal.cols) && Number.isFinite(terminal.rows)
    && terminal.cols > 0 && terminal.rows > 0) {
    payload.cols = terminal.cols
    payload.rows = terminal.rows
  }
  ws.send(JSON.stringify(payload))
}

// 处理 WebSocket 消息
function handleMessage(message) {
  switch (message.type) {
    case 'terminal:created':
      currentTerminalId = message.terminalId
      connected.value = true
      connecting.value = false
      emit('created', { terminalId: message.terminalId, metadata: message.metadata })

      updateServerSize(message.metadata)
      allowResize = true
      if (pendingResize) {
        const { cols, rows } = pendingResize
        pendingResize = null
        handleResize(cols, rows)
      } else {
        syncSizeWithServer()
      }
      break

    case 'terminal:attached':
      currentTerminalId = message.terminalId
      connected.value = true
      connecting.value = false
      updateServerSize(message.metadata)
      allowResize = true
      if (pendingResize) {
        const { cols, rows } = pendingResize
        pendingResize = null
        handleResize(cols, rows)
      } else {
        syncSizeWithServer()
      }
      break

    case 'terminal:output':
      if (terminal && message.data) {
        terminal.write(message.data)
      }
      break

    case 'terminal:exited':
      connected.value = false
      emit('exit', { terminalId: message.terminalId, exitCode: message.exitCode })
      break

    case 'terminal:error':
      console.error('Terminal error:', message.error)
      emit('error', message.error)
      break
  }
}

// 聚焦终端
function focus() {
  if (terminal) {
    terminal.focus()
  }
}

// 断开连接（不销毁后台终端）
function disconnect() {
  // 禁止重连
  shouldReconnect = false
  
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (ws) {
    ws.close()
    ws = null
  }
}

// 销毁终端（完全销毁后台终端）
function destroy() {
  // 先清除 terminalId，防止 onclose 回调触发重连
  const terminalIdToDestroy = currentTerminalId
  currentTerminalId = null
  
  if (ws && ws.readyState === WebSocket.OPEN && terminalIdToDestroy) {
    ws.send(JSON.stringify({
      type: 'terminal:destroy',
      terminalId: terminalIdToDestroy
    }))
  }
  disconnect()
}

// 暴露方法
defineExpose({
  focus,
  disconnect,
  destroy,
  getTerminalId: () => currentTerminalId
})

onMounted(() => {
  initTerminal()
  connectWebSocket()
})

onBeforeUnmount(() => {
  // 禁止重连
  shouldReconnect = false

  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
  }

  if (resizeObserver) {
    resizeObserver.disconnect()
  }

  if (ws) {
    ws.close()
  }

  if (terminal) {
    terminal.dispose()
  }
})

// 监听 terminalId 变化
watch(() => props.terminalId, (newId) => {
  if (!newId || !ws || ws.readyState !== WebSocket.OPEN) return
  if (newId === currentTerminalId) return
  sendAttach(newId)
})

// 监听主题变化，动态更新终端主题
watch(isDark, () => {
  if (terminal) {
    terminal.options.theme = currentTheme.value
  }
})
</script>

<style scoped>
.terminal-pane {
  width: 100%;
  height: 100%;
  background: var(--terminal-bg);
  position: relative;
  overflow: hidden;
}

.terminal-container {
  width: 100%;
  height: 100%;
  padding: 8px;
  box-sizing: border-box;
}

.terminal-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--terminal-overlay-bg);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  z-index: 10;
}

.connecting-text {
  color: var(--terminal-text);
  font-size: 14px;
}

:deep(.xterm) {
  height: 100%;
  padding: 4px;
}

:deep(.xterm-viewport) {
  overflow-y: auto !important;
}

:deep(.xterm-viewport::-webkit-scrollbar) {
  width: 8px;
}

:deep(.xterm-viewport::-webkit-scrollbar-track) {
  background: transparent;
}

:deep(.xterm-viewport::-webkit-scrollbar-thumb) {
  background: var(--terminal-scrollbar);
  border-radius: 4px;
}

:deep(.xterm-viewport::-webkit-scrollbar-thumb:hover) {
  background: var(--terminal-scrollbar-hover);
}
</style>
