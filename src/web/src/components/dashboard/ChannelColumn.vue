<template>
  <div class="channel-column">
    <!-- 渠道头部 -->
    <div class="channel-header" :class="channelType">
      <div class="header-icon">
        <n-icon :size="20">
          <component :is="channelIcon" />
        </n-icon>
      </div>
      <h2 class="channel-title">{{ channelTitle }}</h2>
    </div>

    <!-- 滚动内容区 -->
    <div class="channel-content">
      <!-- 代理控制 -->
      <div class="card">
        <div class="card-header">
          <n-icon :size="16">
            <PowerOutline />
          </n-icon>
          <h3 class="card-title">代理控制</h3>
          <span v-if="proxyState.running && runtimeDisplay" class="runtime-badge">
            {{ runtimeDisplay }}
          </span>
          <n-switch
            v-model:value="proxyState.running"
            @update:value="handleProxyToggle"
            :loading="proxyState.loading"
            size="small"
            style="margin-left: auto;"
          />
        </div>
        <div class="card-body" style="padding: 6px 10px;">
          <div class="proxy-info-row">
            <div class="proxy-status">
              <div class="status-dot" :class="{ active: proxyState.running }"></div>
              <n-text :type="proxyState.running ? 'success' : 'default'" style="font-size: 12px;">
                {{ proxyState.running ? '运行中' : '已停止' }}
              </n-text>
              <n-text depth="3" style="font-size: 11px; margin-left: 6px;">端口: {{ proxyState.port }}</n-text>
            </div>
            <n-popselect
              v-model:value="selectedChannelId"
              :options="channelOptions"
              trigger="click"
              @update:value="handleChannelSwitch"
              size="small"
              :disabled="channels.length === 0"
            >
              <n-tooltip trigger="hover" :disabled="channels.length === 0">
                <template #trigger>
                  <n-button text size="tiny" class="channel-selector" :disabled="channels.length === 0">
                    <span class="channel-name">{{ currentChannelName }}</span>
                    <n-icon :size="10" style="margin-left: 2px;"><ChevronDownOutline /></n-icon>
                  </n-button>
                </template>
                点击切换渠道
              </n-tooltip>
            </n-popselect>
          </div>
        </div>
      </div>

      <!-- 快速访问 -->
      <div class="card">
        <div class="card-header compact">
          <n-icon :size="14">
            <RocketOutline />
          </n-icon>
          <h3 class="card-title">快速访问</h3>
        </div>
        <div class="card-body" style="padding: 8px 10px;">
          <div class="quick-access-list">
            <div class="access-card clickable" @click="goToProjects">
              <div class="access-card-content">
                <n-text depth="3" style="font-size: 11px;">项目</n-text>
                <n-text strong style="font-size: 16px; margin-top: 2px;">{{ stats.projects }}</n-text>
              </div>
              <n-icon :size="16" style="color: var(--text-tertiary);">
                <ChevronForwardOutline />
              </n-icon>
            </div>
            <div class="access-card clickable" @click="showRecentSessions = true">
              <div class="access-card-content">
                <n-text depth="3" style="font-size: 11px;">最新对话</n-text>
                <n-text strong style="font-size: 16px; margin-top: 2px;">{{ stats.sessions }}</n-text>
              </div>
              <n-icon :size="16" style="color: var(--text-tertiary);">
                <ChevronForwardOutline />
              </n-icon>
            </div>
            <div class="access-card clickable primary" @click="goToChannelPage">
              <div class="access-card-content">
                <n-text depth="3" style="font-size: 11px;">前往</n-text>
                <n-text strong style="font-size: 12px; margin-top: 2px;">进入{{ channelTypeName }}页面</n-text>
              </div>
              <n-icon :size="16" style="color: var(--primary-color);">
                <ChevronForwardOutline />
              </n-icon>
            </div>
          </div>
        </div>
      </div>

      <!-- 今日数据 -->
      <div class="card stats-card" :class="`stats-card-${channelType}`">
        <div class="card-header compact">
          <n-icon :size="14">
            <TrendingUpOutline />
          </n-icon>
          <h3 class="card-title">今日数据</h3>
        </div>
        <div class="card-body" style="padding: 8px 10px;">
          <div class="stats-inline stats-3col">
            <div class="stat-inline-item stat-requests">
              <div class="stat-icon-dot requests"></div>
              <div class="stat-info">
                <span class="stat-label">请求</span>
                <span class="stat-value">{{ todayStats.requests }}</span>
              </div>
            </div>
            <div class="stat-inline-item stat-input">
              <div class="stat-icon-dot input"></div>
              <div class="stat-info">
                <span class="stat-label">输入</span>
                <span class="stat-value">{{ formatTokens(todayStats.inputTokens) }}</span>
              </div>
            </div>
            <div class="stat-inline-item stat-output">
              <div class="stat-icon-dot output"></div>
              <div class="stat-info">
                <span class="stat-label">输出</span>
                <span class="stat-value">{{ formatTokens(todayStats.outputTokens) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 实时日志 -->
      <div class="card logs-card">
        <div class="card-header compact">
          <n-icon :size="14">
            <RadioOutline />
          </n-icon>
          <h3 class="card-title">实时日志</h3>
          <n-button text size="tiny" @click="clearLogs" style="margin-left: auto;">
            <template #icon>
              <n-icon :size="14"><TrashOutline /></n-icon>
            </template>
          </n-button>
        </div>
        <div class="logs-table-wrapper">
          <!-- 表头 -->
          <div class="logs-table-header" :class="`logs-header-${channelType}`">
            <div class="log-col col-channel" :class="`col-channel-${channelType}`">渠道</div>
            <div class="log-col col-token" :class="`col-token-${channelType}`">请求</div>
            <div class="log-col col-token" :class="`col-token-${channelType}`">回复</div>
            <template v-if="channelType === 'claude'">
              <div class="log-col col-token" :class="`col-token-${channelType}`">写入</div>
              <div class="log-col col-token" :class="`col-token-${channelType}`">命中</div>
            </template>
            <template v-else-if="channelType === 'codex'">
              <div class="log-col col-token" :class="`col-token-${channelType}`">推理</div>
              <div class="log-col col-token" :class="`col-token-${channelType}`">缓存</div>
            </template>
            <template v-else-if="channelType === 'gemini'">
              <div class="log-col col-token" :class="`col-token-${channelType}`">缓存</div>
              <div class="log-col col-token" :class="`col-token-${channelType}`">总计</div>
            </template>
            <div class="log-col col-time" :class="`col-time-${channelType}`">时间</div>
          </div>
          <!-- 日志内容 -->
          <div class="logs-container" ref="logsContainer">
            <div v-if="logs.length === 0" class="empty-logs">
              <n-text depth="3" style="font-size: 11px;">暂无日志</n-text>
            </div>

            <div v-for="log in logs" :key="log.id" class="log-row" :class="{ 'action-row': log.status === 'action', 'new-log': log.isNew }">
              <!-- Action 类型日志 -->
              <template v-if="log.status === 'action'">
                <div class="action-content">
                  <n-icon :size="12" color="#18a058"><CheckmarkCircleOutline /></n-icon>
                  <span class="action-msg">{{ log.message }}</span>
                  <span class="action-time">{{ log.time }}</span>
                </div>
              </template>
              <!-- 普通日志 -->
              <template v-else>
                <div class="log-col col-channel" :class="`col-channel-${channelType}`">
                  <n-tag size="tiny" type="success">{{ log.channelName }}</n-tag>
                </div>
                <div class="log-col col-token" :class="`col-token-${channelType}`">{{ log.tokens?.input || 0 }}</div>
                <div class="log-col col-token" :class="`col-token-${channelType}`">{{ log.tokens?.output || 0 }}</div>
                <template v-if="channelType === 'claude'">
                  <div class="log-col col-token" :class="`col-token-${channelType}`">{{ log.tokens?.cacheCreation || 0 }}</div>
                  <div class="log-col col-token" :class="`col-token-${channelType}`">{{ log.tokens?.cacheRead || 0 }}</div>
                </template>
                <template v-else-if="channelType === 'codex'">
                  <div class="log-col col-token" :class="`col-token-${channelType}`">{{ log.tokens?.reasoning || 0 }}</div>
                  <div class="log-col col-token" :class="`col-token-${channelType}`">{{ log.tokens?.cached || 0 }}</div>
                </template>
                <template v-else-if="channelType === 'gemini'">
                  <div class="log-col col-token" :class="`col-token-${channelType}`">{{ log.tokens?.cached || 0 }}</div>
                  <div class="log-col col-token" :class="`col-token-${channelType}`">{{ formatTokens(log.tokens?.total || 0) }}</div>
                </template>
                <div class="log-col col-time" :class="`col-time-${channelType}`">{{ log.time }}</div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 最新对话抽屉 -->
    <RecentSessionsDrawer v-model:visible="showRecentSessions" :channel="channelType" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { NIcon, NText, NSwitch, NTag, NButton, NPopselect, NTooltip, useMessage } from 'naive-ui'
import {
  LayersOutline,
  CodeSlashOutline,
  ColorPaletteOutline,
  PowerOutline,
  RocketOutline,
  TrendingUpOutline,
  FlashOutline,
  RadioOutline,
  TrashOutline,
  DocumentTextOutline,
  ChevronForwardOutline,
  ChevronDownOutline,
  SwapHorizontalOutline,
  CheckmarkCircleOutline
} from '@vicons/ionicons5'
import { useProxyState } from '../../composables/useProxyState'
import RecentSessionsDrawer from '../RecentSessionsDrawer.vue'
import api from '../../api'
import axios from 'axios'

const props = defineProps({
  channelType: {
    type: String,
    required: true,
    validator: (value) => ['claude', 'codex', 'gemini'].includes(value)
  }
})

const router = useRouter()
const message = useMessage()
const { claudeProxy, codexProxy, geminiProxy, toggleClaudeProxy, toggleCodexProxy, toggleGeminiProxy, initialize } = useProxyState()

// 渠道配置
const channelConfig = {
  claude: {
    title: 'Claude Code',
    subtitle: '智能编程助手',
    icon: LayersOutline
  },
  codex: {
    title: 'Codex',
    subtitle: '高效代码生成',
    icon: CodeSlashOutline
  },
  gemini: {
    title: 'Gemini',
    subtitle: '多模态AI助手',
    icon: ColorPaletteOutline
  }
}

const channelTitle = computed(() => channelConfig[props.channelType].title)
const channelSubtitle = computed(() => channelConfig[props.channelType].subtitle)
const channelIcon = computed(() => channelConfig[props.channelType].icon)

// 代理状态（根据渠道类型选择）
const proxyState = computed(() => {
  if (props.channelType === 'claude') return claudeProxy.value
  if (props.channelType === 'codex') return codexProxy.value
  if (props.channelType === 'gemini') return geminiProxy.value
  return {}
})

// 渠道类型名称
const channelTypeName = computed(() => {
  if (props.channelType === 'claude') return 'Claude'
  if (props.channelType === 'codex') return 'Codex'
  if (props.channelType === 'gemini') return 'Gemini'
  return ''
})

// 统计数据
const stats = ref({ projects: 0, sessions: 0 })
const todayStats = ref({
  requests: 0,
  tokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheTokens: 0,
  cost: 0
})

// 最新对话抽屉
const showRecentSessions = ref(false)

// 代理运行时间（实时更新）
const currentTime = ref(Date.now())
const runtimeDisplay = computed(() => {
  if (!proxyState.value.running) return ''

  const startTime = proxyState.value.startTime
  if (!startTime) return ''

  // 使用 currentTime 实时计算运行时长
  const runtime = currentTime.value - startTime
  if (runtime <= 0) return ''

  const totalSeconds = Math.floor(runtime / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  let display = '已运行 '
  if (hours > 0) {
    display += `${hours}小时`
  }
  if (minutes > 0) {
    display += `${minutes}分`
  }
  if (seconds > 0 || (hours === 0 && minutes === 0)) {
    display += `${seconds}秒`
  }

  return display
})

// 日志
const logs = ref([])
const logsContainer = ref(null)
const maxLogs = 20

// 渠道列表
const channels = ref([])
const selectedChannelId = ref(null)

// 渠道选项（用于下拉选择）
const channelOptions = computed(() => {
  return channels.value.map(ch => ({
    label: ch.name,
    value: ch.id
  }))
})

// 当前渠道名称
const currentChannelName = computed(() => {
  // 优先从已选择的渠道ID查找
  if (selectedChannelId.value) {
    const current = channels.value.find(ch => ch.id === selectedChannelId.value)
    if (current) return current.name
  }
  // 然后从 proxyState 获取
  if (proxyState.value.activeChannel) {
    return proxyState.value.activeChannel.name
  }
  // 查找 isActive 为 true 的渠道
  const active = channels.value.find(ch => ch.isActive)
  if (active) return active.name
  // 最后显示默认文字
  return channels.value.length > 0 ? '选择渠道' : '无渠道'
})

let ws = null
let isReceivingHistory = true // 标记是否正在接收历史日志
let reconnectAttempts = 0 // 重连尝试次数
let reconnectTimer = null // 重连定时器

// 格式化 Token
function formatTokens(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
  return num.toString()
}

// 格式化时间
function formatTime(timestamp) {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// 处理代理切换
async function handleProxyToggle(value) {
  let result
  if (props.channelType === 'claude') {
    result = await toggleClaudeProxy(value)
  } else if (props.channelType === 'codex') {
    result = await toggleCodexProxy(value)
  } else if (props.channelType === 'gemini') {
    result = await toggleGeminiProxy(value)
  }

  if (result.success) {
    message.success(value ? `${channelTitle.value} 代理已启动` : `${channelTitle.value} 代理已停止`)
  } else {
    message.error(result.error || '操作失败')
  }
}

// 跳转到项目列表
function goToProjects() {
  router.push({ name: `${props.channelType}-projects` })
}

// 跳转到渠道单独页面
function goToChannelPage() {
  router.push({ name: props.channelType })
}

// 加载渠道列表
async function loadChannels() {
  try {
    let data
    if (props.channelType === 'claude') {
      data = await api.getChannels()
    } else if (props.channelType === 'codex') {
      data = await api.getCodexChannels()
    } else if (props.channelType === 'gemini') {
      data = await api.getGeminiChannels()
    }
    channels.value = data?.channels || []
    // 设置当前选中的渠道
    const active = channels.value.find(ch => ch.isActive)
    if (active) {
      selectedChannelId.value = active.id
    }
  } catch (error) {
    console.error('Failed to load channels:', error)
  }
}

// 切换渠道
async function handleChannelSwitch(channelId) {
  if (!channelId || channelId === selectedChannelId.value) return
  try {
    if (props.channelType === 'claude') {
      await api.activateChannel(channelId)
    } else if (props.channelType === 'codex') {
      await api.activateCodexChannel(channelId)
    } else if (props.channelType === 'gemini') {
      await api.activateGeminiChannel(channelId)
    }
    message.success('渠道切换成功')
    selectedChannelId.value = channelId
    // 重新加载渠道列表以更新状态
    await loadChannels()
  } catch (error) {
    message.error(error.response?.data?.error || error.message || '切换失败')
  }
}

// 加载统计数据
async function loadStats() {
  // 加载项目和会话数
  try {
    const apiPrefix = props.channelType === 'claude' ? '' : `/${props.channelType}`
    const [projectsRes, sessionsRes] = await Promise.all([
      axios.get(`/api${apiPrefix}/projects`),
      axios.get(`/api${apiPrefix}/sessions/recent/list?limit=1000`)
    ])
    stats.value.projects = projectsRes.data.projects?.length || 0
    stats.value.sessions = sessionsRes.data.sessions?.length || 0
  } catch (error) {
    console.error('Failed to load stats:', error)
  }

  // 加载今日统计
  try {
    const response = await axios.get('/api/statistics/today')
    const byChannel = response.data.byChannel || {}

    // 找到当前渠道的数据
    let channelData = null
    Object.values(byChannel).forEach(channel => {
      const toolType = channel.toolType
      if ((props.channelType === 'claude' && (toolType === 'claude' || toolType === 'claude-code')) ||
          (props.channelType === 'codex' && toolType === 'codex') ||
          (props.channelType === 'gemini' && toolType === 'gemini')) {
        if (!channelData) {
          channelData = channel
        } else {
          // 合并多个渠道的数据
          channelData.requests += channel.requests || 0
          channelData.tokens.input += channel.tokens?.input || 0
          channelData.tokens.output += channel.tokens?.output || 0
          channelData.tokens.cacheRead += channel.tokens?.cacheRead || 0
          channelData.tokens.total += channel.tokens?.total || 0
          channelData.cost += channel.cost || 0
        }
      }
    })

    if (channelData) {
      todayStats.value.requests = channelData.requests || 0
      todayStats.value.tokens = channelData.tokens?.total || 0
      todayStats.value.inputTokens = channelData.tokens?.input || 0
      todayStats.value.outputTokens = channelData.tokens?.output || 0
      todayStats.value.cacheTokens = channelData.tokens?.cacheRead || 0
      todayStats.value.cost = channelData.cost || 0
    }
  } catch (error) {
    console.error('Failed to load today stats:', error)
  }
}

// 添加日志
function addLog(logData) {
  const log = {
    id: logData.id || Date.now() + Math.random(),
    timestamp: logData.timestamp || new Date().toISOString(),
    channelName: logData.channelName || 'Unknown',
    status: logData.success ? 'success' : 'error',
    statusCode: logData.statusCode || (logData.success ? '200' : '500'),
    tokens: logData.tokens || { total: 0 },
    cost: logData.cost || 0
  }

  logs.value.unshift(log)

  if (logs.value.length > maxLogs) {
    logs.value = logs.value.slice(0, maxLogs)
  }
}

// 清空日志
function clearLogs() {
  logs.value = []
}

// WebSocket 连接
function connectWebSocket() {
  // 如果有待处理的重连定时器，先清除
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  // 如果已有连接，先关闭
  if (ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
    try {
      ws.close()
    } catch (e) {
      // 忽略关闭错误
    }
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${protocol}//${window.location.host}/ws`

  console.log(`[${props.channelType.toUpperCase()} WS] Connecting to ${wsUrl}...`)

  ws = new WebSocket(wsUrl)

  ws.onopen = () => {
    console.log(`[${props.channelType.toUpperCase()} WS] Connected successfully`)
    reconnectAttempts = 0 // 重置重连计数

    // WebSocket 连接成功，开始接收历史日志
    isReceivingHistory = true

    // 2秒后认为历史日志接收完毕，之后的日志都是新推送的
    setTimeout(() => {
      isReceivingHistory = false
      console.log(`[${props.channelType.toUpperCase()} WS] History receiving completed, now accepting real-time logs`)
    }, 2000)
  }

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)

      // 根据 source 字段过滤日志
      let logSource = data.source

      // 如果没有 source 字段，尝试从其他字段推断
      if (!logSource) {
        // 1. 从 toolType 推断
        if (data.toolType === 'codex') {
          logSource = 'codex'
        } else if (data.toolType === 'gemini') {
          logSource = 'gemini'
        } else if (data.toolType === 'claude' || data.toolType === 'claude-code') {
          logSource = 'claude'
        }
        // 2. 从 model 名称推断
        else if (data.model) {
          const model = data.model.toLowerCase()
          if (model.includes('claude')) {
            logSource = 'claude'
          } else if (model.includes('gpt') || model.includes('o1') || model.includes('o3')) {
            logSource = 'codex'
          } else if (model.includes('gemini')) {
            logSource = 'gemini'
          }
        }
        // 3. 从 channel 名称匹配已加载的渠道列表
        if (!logSource && data.channel) {
          const matchedChannel = channels.value.find(ch => ch.name === data.channel)
          if (matchedChannel) {
            // 找到了对应的渠道，使用当前 channelType
            logSource = props.channelType
          }
        }
        // 4. 从 action 字段推断
        if (!logSource) {
          if (data.action?.includes('codex')) {
            logSource = 'codex'
          } else if (data.action?.includes('gemini')) {
            logSource = 'gemini'
          }
        }
        // 5. 最后默认是 claude
        if (!logSource) {
          logSource = 'claude'
        }
      }

      // 过滤日志
      if (data.type === 'action') {
        // action 类型日志根据 action 字段判断
        const actionSource = data.action?.includes('codex') ? 'codex' :
                            data.action?.includes('gemini') ? 'gemini' : 'claude'
        if (actionSource !== props.channelType) return
      } else {
        // 普通日志根据 source 字段判断
        if (logSource !== props.channelType) return
      }

      // 格式化时间
      const time = data.time || new Date(data.timestamp || Date.now()).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })

      const log = {
        id: data.id || `${Date.now()}-${Math.random()}`,
        timestamp: data.timestamp || new Date().toISOString(),
        channelName: data.channel || 'Unknown',
        status: data.type === 'action' ? 'action' : 'success',
        tokens: {
          input: data.inputTokens || 0,
          output: data.outputTokens || 0,
          cacheCreation: data.cacheCreation || 0,
          cacheRead: data.cacheRead || 0,
          reasoning: data.reasoningTokens || 0,
          cached: data.cachedTokens || 0,
          total: data.totalTokens || ((data.inputTokens || 0) + (data.outputTokens || 0))
        },
        cost: data.cost || 0,
        model: data.model,
        message: data.message,
        time: time,
        isNew: !isReceivingHistory // 只有非历史日志才标记为新
      }

      // 检查用户是否在顶部附近（前20px）
      const isNearTop = logsContainer.value ? logsContainer.value.scrollTop < 20 : true

      // 添加到日志列表前面（新日志在前）
      logs.value.unshift(log)

      // 如果是新日志，4.5秒后移除高亮效果
      if (log.isNew) {
        setTimeout(() => {
          log.isNew = false
        }, 4500)
      }

      // 限制日志数量
      if (logs.value.length > maxLogs) {
        logs.value = logs.value.slice(0, maxLogs)
      }

      // 只在用户在顶部时才自动滚动到顶部，避免打断用户查看历史日志
      if (isNearTop) {
        nextTick(() => {
          if (logsContainer.value) {
            logsContainer.value.scrollTop = 0
          }
        })
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error)
    }
  }

  ws.onerror = (error) => {
    console.error(`[${props.channelType.toUpperCase()} WS] Error:`, error)
  }

  ws.onclose = (event) => {
    console.log(`[${props.channelType.toUpperCase()} WS] Connection closed (code: ${event.code}, reason: ${event.reason || 'none'})`)

    // 计算重连延迟（指数退避，最大 30 秒）
    reconnectAttempts++
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 30000)

    console.log(`[${props.channelType.toUpperCase()} WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})...`)

    reconnectTimer = setTimeout(() => {
      connectWebSocket()
    }, delay)
  }
}

onMounted(() => {
  initialize()
  loadStats()
  loadChannels()
  connectWebSocket()

  // 定时刷新统计和渠道
  const statsInterval = setInterval(loadStats, 30000)
  const channelsInterval = setInterval(loadChannels, 10000)

  // 定时更新当前时间（每秒），用于实时计算代理运行时长
  const timeInterval = setInterval(() => {
    currentTime.value = Date.now()
  }, 1000)

  onUnmounted(() => {
    clearInterval(statsInterval)
    clearInterval(channelsInterval)
    clearInterval(timeInterval)

    // 清除重连定时器
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    // 关闭 WebSocket 连接
    if (ws) {
      ws.close()
      ws = null
    }
  })
})
</script>

<style scoped>
.channel-column {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--gradient-card);
  border: 1px solid var(--border-primary);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--shadow-sm);
}

.channel-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: var(--bg-primary);
  position: relative;
}

.channel-header::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 14px;
  right: 14px;
  height: 2px;
  border-radius: 1px;
}

.channel-header.claude {
  background: linear-gradient(135deg, rgba(24, 160, 88, 0.08) 0%, transparent 100%);
}

.channel-header.claude::after {
  background: linear-gradient(90deg, #18a058, rgba(24, 160, 88, 0.3));
}

.channel-header.codex {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, transparent 100%);
}

.channel-header.codex::after {
  background: linear-gradient(90deg, #3b82f6, rgba(59, 130, 246, 0.3));
}

.channel-header.gemini {
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.08) 0%, transparent 100%);
}

.channel-header.gemini::after {
  background: linear-gradient(90deg, #a855f7, rgba(168, 85, 247, 0.3));
}

.header-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.channel-header.claude .header-icon {
  background: linear-gradient(135deg, #18a058 0%, #15803d 100%);
  color: white;
}

.channel-header.codex .header-icon {
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: white;
}

.channel-header.gemini .header-icon {
  background: linear-gradient(135deg, #a855f7 0%, #9333ea 100%);
  color: white;
}

.channel-title {
  font-size: 15px;
  font-weight: 700;
  margin: 0;
  color: var(--text-primary);
  letter-spacing: 0.3px;
}

.channel-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.card {
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 10px;
  overflow: hidden;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  position: relative;
}

.card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.card:hover {
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.1);
  border-color: var(--border-secondary);
}

.card:hover::before {
  opacity: 1;
}

.card.clickable {
  cursor: pointer;
}

.card.clickable:hover {
  border-color: #18a058;
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(24, 160, 88, 0.18);
}

.card.clickable::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(24, 160, 88, 0.02) 0%, transparent 100%);
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
}

.card.clickable:hover::after {
  opacity: 1;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-primary) 100%);
  border-bottom: 1px solid var(--border-primary);
  position: relative;
}

.card-header.compact {
  padding: 8px 12px;
}

.card-header .n-icon {
  color: var(--text-tertiary);
  transition: color 0.2s ease;
}

.card:hover .card-header .n-icon {
  color: var(--text-secondary);
}

.card-title {
  font-size: 11px;
  font-weight: 700;
  margin: 0;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.8px;
}

.runtime-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  margin-left: 8px;
  font-size: 10px;
  font-weight: 600;
  color: #10b981;
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(52, 211, 153, 0.1) 100%);
  border: 1px solid rgba(16, 185, 129, 0.2);
  border-radius: 12px;
  white-space: nowrap;
  animation: pulse-runtime 2s ease-in-out infinite;
}

@keyframes pulse-runtime {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.8;
    transform: scale(0.98);
  }
}

.card-body {
  padding: 12px;
  background: var(--bg-primary);
}

.card-body.compact {
  padding: 10px 12px;
}

.proxy-control {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.proxy-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.proxy-info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.proxy-status {
  display: flex;
  align-items: center;
  gap: 6px;
}

.channel-selector {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  background: linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%);
  border: 1px solid var(--border-primary);
  border-radius: 6px;
  color: var(--text-secondary);
  transition: all 0.2s ease;
}

.channel-selector:hover {
  background: var(--hover-bg);
  border-color: var(--border-secondary);
  color: var(--text-primary);
}

.channel-selector:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.channel-name {
  font-size: 11px;
  font-weight: 500;
  max-width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--border-secondary);
  transition: all 0.3s ease;
}

.status-dot.active {
  background: #18a058;
  box-shadow: 0 0 8px rgba(24, 160, 88, 0.5);
}

.quick-stats {
  display: flex;
  gap: 16px;
  padding: 4px 0;
}

.stat-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px 0;
}

.stat-divider {
  width: 1px;
  background: linear-gradient(180deg, transparent 0%, var(--border-primary) 50%, transparent 100%);
}

.quick-access-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.access-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  transition: all 0.2s ease;
  position: relative;
}

.access-card-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.access-card.clickable:hover {
  background: var(--hover-bg);
  border-color: var(--border-hover);
  transform: translateX(2px);
}

.access-card.clickable:active {
  transform: translateX(0);
}

.access-card.primary {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(168, 85, 247, 0.1) 100%);
  border-color: rgba(99, 102, 241, 0.3);
}

.access-card.primary:hover {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(168, 85, 247, 0.15) 100%);
  border-color: rgba(99, 102, 241, 0.5);
}

.stats-inline {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.stats-inline.stats-3col {
  grid-template-columns: repeat(3, 1fr);
}

.stat-inline-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%);
  border-radius: 8px;
  border: 1px solid var(--border-primary);
  transition: all 0.25s ease;
}

.stat-inline-item:hover {
  border-color: var(--border-secondary);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

/* 统计项图标点 */
.stat-icon-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.stat-icon-dot.requests {
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.4);
}

.stat-icon-dot.input {
  background: linear-gradient(135deg, #18a058, #15803d);
  box-shadow: 0 0 8px rgba(24, 160, 88, 0.4);
}

.stat-icon-dot.output {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.4);
}

.stat-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.stat-label {
  font-size: 10px;
  color: var(--text-tertiary);
  font-weight: 500;
}

.stat-value {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
}

/* 统计卡片特殊样式 */
.stats-card {
  border-left: 3px solid transparent;
}

.stats-card-claude {
  border-left-color: #18a058;
}

.stats-card-codex {
  border-left-color: #3b82f6;
}

.stats-card-gemini {
  border-left-color: #a855f7;
}

/* 请求数值颜色 */
.stat-requests .stat-value {
  color: #3b82f6;
}

/* 输入数值颜色 */
.stat-input .stat-value {
  color: #18a058;
}

/* 输出数值颜色 */
.stat-output .stat-value {
  color: #f59e0b;
}

.token-label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.token-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.logs-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-primary);
  border-radius: 10px;
}

.logs-card .card-header {
  background: linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%);
}

.logs-table-wrapper {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-primary);
}

.logs-table-header {
  display: flex;
  padding: 8px 10px;
  background: linear-gradient(180deg, var(--bg-tertiary) 0%, var(--bg-secondary) 100%);
  border-bottom: 1px solid var(--border-primary);
  font-size: 10px;
  font-weight: 700;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex-shrink: 0;
}

.logs-header-claude .log-col {
  color: rgba(24, 160, 88, 0.8);
}

.logs-header-codex .log-col {
  color: rgba(59, 130, 246, 0.8);
}

.logs-header-gemini .log-col {
  color: rgba(168, 85, 247, 0.8);
}

.logs-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.logs-container::-webkit-scrollbar {
  width: 4px;
}

.logs-container::-webkit-scrollbar-thumb {
  background: rgba(24, 160, 88, 0.3);
  border-radius: 2px;
}

.logs-container::-webkit-scrollbar-thumb:hover {
  background: rgba(24, 160, 88, 0.5);
}

.empty-logs {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px 12px;
  color: var(--text-tertiary);
}

.log-row {
  display: flex;
  align-items: center;
  padding: 8px 10px;
  min-height: 36px;
  border-bottom: 1px solid var(--border-primary);
  font-size: 11px;
  transition: all 0.2s ease;
  background: var(--bg-primary);
  position: relative;
}

.log-row:nth-child(even) {
  background: var(--bg-secondary);
}

.log-row:hover {
  background: var(--hover-bg);
  transform: translateX(2px);
}

/* 新日志高亮动画 - 柔和版本 */
.log-row.new-log {
  animation: newLogPulse 4.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
  border-left: 3px solid #18a058;
}

@keyframes newLogPulse {
  0% {
    background: linear-gradient(90deg, rgba(24, 160, 88, 0.15) 0%, rgba(24, 160, 88, 0.06) 100%);
    box-shadow: 0 0 8px 0 rgba(24, 160, 88, 0.2);
  }
  5% {
    background: linear-gradient(90deg, rgba(24, 160, 88, 0.18) 0%, rgba(24, 160, 88, 0.08) 100%);
    box-shadow: 0 0 12px 1px rgba(24, 160, 88, 0.25);
  }
  15% {
    background: linear-gradient(90deg, rgba(24, 160, 88, 0.16) 0%, rgba(24, 160, 88, 0.07) 100%);
    box-shadow: 0 0 10px 1px rgba(24, 160, 88, 0.2);
  }
  30% {
    background: linear-gradient(90deg, rgba(24, 160, 88, 0.12) 0%, rgba(24, 160, 88, 0.05) 100%);
    box-shadow: 0 0 6px 0 rgba(24, 160, 88, 0.15);
  }
  50% {
    background: linear-gradient(90deg, rgba(24, 160, 88, 0.08) 0%, rgba(24, 160, 88, 0.03) 100%);
    box-shadow: 0 0 4px 0 rgba(24, 160, 88, 0.1);
  }
  70% {
    background: linear-gradient(90deg, rgba(24, 160, 88, 0.04) 0%, rgba(24, 160, 88, 0.015) 100%);
    box-shadow: 0 0 2px 0 rgba(24, 160, 88, 0.06);
  }
  85% {
    background: linear-gradient(90deg, rgba(24, 160, 88, 0.02) 0%, rgba(24, 160, 88, 0.008) 100%);
    box-shadow: 0 0 1px 0 rgba(24, 160, 88, 0.03);
  }
  100% {
    background: transparent;
    box-shadow: 0 0 0 0 rgba(24, 160, 88, 0);
    border-left-color: transparent;
  }
}

/* 暗色主题下的新日志高亮 - 柔和版本 */
[data-theme="dark"] .log-row.new-log {
  animation: newLogPulseDark 4.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
}

@keyframes newLogPulseDark {
  0% {
    background: linear-gradient(90deg, rgba(24, 160, 88, 0.2) 0%, rgba(24, 160, 88, 0.08) 100%);
    box-shadow: 0 0 10px 0 rgba(24, 160, 88, 0.25);
  }
  5% {
    background: linear-gradient(90deg, rgba(24, 160, 88, 0.24) 0%, rgba(24, 160, 88, 0.1) 100%);
    box-shadow: 0 0 14px 2px rgba(24, 160, 88, 0.3);
  }
  15% {
    background: linear-gradient(90deg, rgba(24, 160, 88, 0.21) 0%, rgba(24, 160, 88, 0.09) 100%);
    box-shadow: 0 0 12px 1px rgba(24, 160, 88, 0.25);
  }
  30% {
    background: linear-gradient(90deg, rgba(24, 160, 88, 0.16) 0%, rgba(24, 160, 88, 0.07) 100%);
    box-shadow: 0 0 8px 1px rgba(24, 160, 88, 0.18);
  }
  50% {
    background: linear-gradient(90deg, rgba(24, 160, 88, 0.11) 0%, rgba(24, 160, 88, 0.045) 100%);
    box-shadow: 0 0 5px 0 rgba(24, 160, 88, 0.12);
  }
  70% {
    background: linear-gradient(90deg, rgba(24, 160, 88, 0.06) 0%, rgba(24, 160, 88, 0.024) 100%);
    box-shadow: 0 0 3px 0 rgba(24, 160, 88, 0.08);
  }
  85% {
    background: linear-gradient(90deg, rgba(24, 160, 88, 0.03) 0%, rgba(24, 160, 88, 0.012) 100%);
    box-shadow: 0 0 1px 0 rgba(24, 160, 88, 0.04);
  }
  100% {
    background: transparent;
    box-shadow: 0 0 0 0 rgba(24, 160, 88, 0);
    border-left-color: transparent;
  }
}

/* 新日志中的 action 样式 */
.log-row.new-log.action-row {
  border-left: 3px solid #18a058;
}

.log-row.action-row {
  background: linear-gradient(90deg, rgba(24, 160, 88, 0.12) 0%, rgba(24, 160, 88, 0.04) 100%);
  border-left: 3px solid #18a058;
  padding-left: 8px;
}

.log-row.action-row:hover {
  background: linear-gradient(90deg, rgba(24, 160, 88, 0.18) 0%, rgba(24, 160, 88, 0.08) 100%);
}

.action-content {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.action-msg {
  flex: 1;
  font-size: 11px;
  color: #18a058;
  font-weight: 600;
  letter-spacing: 0.2px;
}

.action-time {
  font-size: 10px;
  font-family: 'SF Mono', Monaco, monospace;
  color: var(--text-tertiary);
  background: rgba(24, 160, 88, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
}

.log-col {
  display: flex;
  align-items: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 通用列样式 */
.col-channel {
  min-width: 0;
}

.col-channel .n-tag {
  max-width: 100%;
  font-size: 10px;
  font-weight: 600;
  border-radius: 4px;
  padding: 2px 8px;
}

.col-token {
  justify-content: center;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
  background: rgba(0, 0, 0, 0.02);
  padding: 3px 6px;
  border-radius: 4px;
  margin: 0 2px;
}

[data-theme="dark"] .col-token {
  background: rgba(255, 255, 255, 0.04);
}

.col-time {
  justify-content: flex-end;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 10px;
  color: var(--text-tertiary);
  padding-right: 2px;
  opacity: 0.8;
}

.log-row:hover .col-time {
  opacity: 1;
  color: var(--text-secondary);
}

/* Claude 列宽 (6列: 渠道, 请求, 回复, 写入, 命中, 时间) */
.col-channel-claude {
  flex: 2 1 60px;
  min-width: 50px;
}

.col-token-claude {
  flex: 1 1 40px;
  min-width: 35px;
}

.col-time-claude {
  flex: 1.5 1 55px;
  min-width: 50px;
}

/* Codex 列宽 (6列: 渠道, 请求, 回复, 推理, 缓存, 时间) */
.col-channel-codex {
  flex: 2 1 60px;
  min-width: 50px;
}

.col-token-codex {
  flex: 1 1 40px;
  min-width: 35px;
}

.col-time-codex {
  flex: 1.5 1 55px;
  min-width: 50px;
}

/* Gemini 列宽 (5列: 渠道, 请求, 回复, 缓存, 时间) */
.col-channel-gemini {
  flex: 2.5 1 70px;
  min-width: 55px;
}

.col-token-gemini {
  flex: 1.2 1 45px;
  min-width: 40px;
}

.col-time-gemini {
  flex: 1.8 1 60px;
  min-width: 55px;
}
</style>
