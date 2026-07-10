<template>
  <div class="channel-column">
    <!-- 渠道头部 -->
    <div
      class="channel-header"
      :class="[channelType, { 'custom-cli': platformConfig.custom }]"
      :style="platformConfig.custom ? { '--channel-accent': accentColor } : null"
    >
      <!-- 拖拽手柄 -->
      <div class="drag-handle" title="拖拽排序">
        <n-icon :size="16">
          <ReorderTwoOutline />
        </n-icon>
      </div>

      <div class="header-icon">
        <n-icon :size="20">
          <component :is="channelIcon" />
        </n-icon>
      </div>
      <h2 class="channel-title">{{ channelTitle }}</h2>

      <!-- 配置入口 -->
      <div v-if="platformConfig.supportsManagedConfig !== false" class="claude-extra-area">
        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button
              text
              class="config-shortcut-button"
              @click="openSkillsManager"
              title="Skills 技能管理"
            >
              <template #icon>
                <n-icon :size="18">
                  <ExtensionPuzzleOutline />
                </n-icon>
              </template>
            </n-button>
          </template>
          Skills 技能管理
        </n-tooltip>
        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button
              text
              class="config-shortcut-button"
              @click="openCommandsManager"
              title="Commands 命令管理"
            >
              <template #icon>
                <n-icon :size="18">
                  <TerminalOutline />
                </n-icon>
              </template>
            </n-button>
          </template>
          Commands 命令管理
        </n-tooltip>
        <n-tooltip v-if="platformConfig.supportsAgents !== false" trigger="hover">
          <template #trigger>
            <n-button
              text
              class="config-shortcut-button"
              @click="openAgentsManager"
              title="Agents 代理管理"
            >
              <template #icon>
                <n-icon :size="18">
                  <PersonOutline />
                </n-icon>
              </template>
            </n-button>
          </template>
          Agents 代理管理
        </n-tooltip>
      </div>

      <!-- 锁定按钮 -->
      <n-button
        text
        class="lock-button"
        @click="toggleLock"
        :title="isLocked ? '解锁此列' : '锁定此列'"
      >
        <template #icon>
          <n-icon :size="18">
            <LockClosed v-if="isLocked" />
            <LockOpen v-else />
          </n-icon>
        </template>
      </n-button>
    </div>

    <!-- 滚动内容区 -->
    <div v-if="!isLocked" class="channel-content">
      <!-- 代理控制 -->
      <div v-if="platformConfig.supportsProxy !== false" class="card">
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
              <span class="proxy-port">端口: {{ proxyState.port }}</span>
            </div>
            <n-popover trigger="click" placement="bottom" :width="320" class="channel-popover">
              <template #trigger>
                <n-button text size="tiny" class="channel-status">
                  <span class="channel-name">{{ statusText }}</span>
                </n-button>
              </template>
              <div class="channel-quick-panel">
                <div class="panel-title">
                  <span>渠道快捷管理</span>
                  <n-text depth="3" style="font-size: 11px;">点击开关切换状态</n-text>
                </div>
                <div v-if="channels.length === 0" class="no-channels">
                  <n-text depth="3">暂无配置渠道</n-text>
                </div>
                <div v-else class="channel-quick-list">
                  <div
                    v-for="channel in channels"
                    :key="channel.id"
                    class="channel-quick-item"
                    :class="{ disabled: channel.enabled === false }"
                  >
                    <div class="channel-quick-info">
                      <span class="channel-quick-name">{{ channel.name }}</span>
                      <n-tag v-if="channel.health?.status === 'frozen'" size="tiny" type="error" :bordered="false">
                        冻结
                      </n-tag>
                      <n-switch
                        size="small"
                        :value="channel.enabled !== false"
                        @update:value="value => handleQuickToggle(channel, value)"
                        :loading="isQuickToggleLoading(channel.id)"
                        :disabled="isQuickToggleLoading(channel.id)"
                        style="margin-left: auto;"
                      />
                    </div>
                    <div v-if="isQuickToggleLoading(channel.id)" class="channel-switching-tip">
                      正在切换渠道状态...
                    </div>
                    <!-- 渠道统计指标 -->
                    <div class="channel-metrics">
                      <span class="metric-item">
                        <span class="metric-label">请求</span>
                        <span class="metric-value">{{ getChannelTodayStats(channel.id).requests }}</span>
                      </span>
                      <span class="metric-item">
                        <span class="metric-label">Tokens</span>
                        <span class="metric-value">{{ formatStatNumber(getChannelTodayStats(channel.id).tokens) }}</span>
                      </span>
                      <span class="metric-item">
                        <span class="metric-label">权重</span>
                        <span class="metric-value">{{ channel.weight || 1 }}</span>
                      </span>
                      <span class="metric-item">
                        <span class="metric-label">并发</span>
                        <span class="metric-value" :class="{ active: getChannelInflight(channel.id) > 0 }">
                          {{ getChannelInflight(channel.id) }}{{ channel.maxConcurrency ? `/${channel.maxConcurrency}` : '' }}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </n-popover>
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
            <div
              class="access-card access-card-projects"
              :class="{ clickable: platformConfig.supportsProjects !== false, disabled: platformConfig.supportsProjects === false }"
              @click="goToProjects"
            >
              <div class="access-icon">
                <n-icon :size="16"><FolderOutline /></n-icon>
              </div>
              <div class="access-content">
                <span class="access-label">项目</span>
                <span class="access-value">{{ stats.projects }}</span>
              </div>
            </div>
            <div
              class="access-card access-card-sessions"
              :class="{ clickable: platformConfig.supportsSessions !== false, disabled: platformConfig.supportsSessions === false }"
              @click="openRecentSessions"
            >
              <div class="access-icon">
                <n-icon :size="16"><ChatbubblesOutline /></n-icon>
              </div>
              <div class="access-content">
                <span class="access-label">最新对话</span>
                <span class="access-value">{{ stats.sessions }}</span>
              </div>
            </div>
            <div
              class="access-card access-card-goto"
              :class="{ clickable: platformConfig.supportsProjects !== false, disabled: platformConfig.supportsProjects === false }"
              @click="goToChannelPage"
            >
              <div class="access-icon">
                <n-icon :size="16"><ArrowForwardOutline /></n-icon>
              </div>
              <div class="access-content">
                <span class="access-label">前往</span>
                <span class="access-goto">{{ channelTypeName }}</span>
              </div>
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
                <span class="stat-value" :class="{ animating: isAnimating.requests }">{{ animatedStats.requests }}</span>
              </div>
            </div>
            <div class="stat-inline-item stat-input">
              <div class="stat-icon-dot tokens"></div>
              <div class="stat-info">
                <span class="stat-label">总 Tokens</span>
                <span class="stat-value" :class="{ animating: isAnimating.tokens }">{{ formatTokens(animatedStats.tokens) }}</span>
              </div>
            </div>
            <div class="stat-inline-item stat-output">
              <div class="stat-icon-dot cost"></div>
              <div class="stat-info">
                <span class="stat-label">成本 / USD</span>
                <span class="stat-value" :class="{ animating: isAnimating.cost }">{{ formatCurrency(animatedStats.cost) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Model Usage Chart (Collapsible) -->
      <div class="card chart-card" :class="`chart-card-${channelType}`" v-if="Object.keys(modelStats).length > 0">
        <n-collapse :default-expanded-names="[]" accordion>
        </n-collapse>
      </div>

      <!-- 实时日志 -->
      <div v-if="showLogs" class="card logs-card">
        <div class="card-header compact">
          <n-icon :size="14">
            <RadioOutline />
          </n-icon>
          <h3 class="card-title">实时日志</h3>
          <n-button
            text
            size="tiny"
            @click.stop="clearLogs"
            style="margin-left: auto;"
            title="清空日志"
          >
            <template #icon>
              <n-icon :size="14"><TrashOutline /></n-icon>
            </template>
          </n-button>
        </div>
        <div class="card-body logs-card-body">
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
              <div class="log-col col-token" :class="`col-token-${channelType}`">总计</div>
            </template>
            <template v-else-if="channelType === 'gemini'">
              <div class="log-col col-token" :class="`col-token-${channelType}`">缓存</div>
              <div class="log-col col-token" :class="`col-token-${channelType}`">总计</div>
            </template>
            <template v-else-if="channelType === 'opencode' || channelType === 'omp'">
              <div class="log-col col-token" :class="`col-token-${channelType}`">推理</div>
              <div class="log-col col-token" :class="`col-token-${channelType}`">缓存</div>
              <div class="log-col col-token" :class="`col-token-${channelType}`">总计</div>
            </template>
            <div class="log-col col-time" :class="`col-time-${channelType}`">时间</div>
          </div>
          <!-- 日志内容 -->
          <div class="logs-container" ref="logsContainer">
            <div v-if="logsToDisplay.length === 0" class="empty-logs">
              <n-icon :size="32" depth="3" style="margin-bottom: 8px;">
                <RadioOutline />
              </n-icon>
              <n-text depth="3" style="font-size: 12px; font-weight: 500;">暂无实时日志</n-text>
              <n-text depth="3" style="font-size: 11px; margin-top: 4px;">开启代理后将显示请求记录</n-text>
            </div>

            <div
              v-for="log in logsToDisplay"
              :key="log.id"
              class="log-row"
              :class="{ 'action-row': log.type === 'action', 'error-row': log.status === 'error', 'new-log': log.isNew }"
              :title="getLogTitle(log)"
            >
              <!-- Action 类型日志 -->
              <template v-if="log.type === 'action'">
                <div class="action-content">
                  <n-icon :size="12" color="#18a058"><CheckmarkCircleOutline /></n-icon>
                  <span class="action-msg">{{ log.message }}</span>
                  <span class="action-time">{{ log.time }}</span>
                </div>
              </template>
              <template v-else-if="log.status === 'error'">
                <div class="action-content">
                  <n-icon :size="12" color="#d03050"><CloseCircleOutline /></n-icon>
                  <span class="action-msg error-msg">{{ log.channel }}: {{ log.error || log.message || '请求失败' }}</span>
                  <span class="action-time error-time">{{ log.time }}</span>
                </div>
              </template>
              <!-- 普通日志 -->
              <template v-else>
                <div class="log-col col-channel" :class="`col-channel-${channelType}`">
                  <n-tag size="tiny" type="success">{{ log.channel }}</n-tag>
                </div>
                <div class="log-col col-token" :class="`col-token-${channelType}`">{{ formatLogToken(log, 'input') }}</div>
                <div class="log-col col-token" :class="`col-token-${channelType}`">{{ formatLogToken(log, 'output') }}</div>
                <template v-if="channelType === 'claude'">
                  <div class="log-col col-token" :class="`col-token-${channelType}`">{{ formatLogToken(log, 'cacheCreation') }}</div>
                  <div class="log-col col-token" :class="`col-token-${channelType}`">{{ formatLogToken(log, 'cacheRead') }}</div>
                </template>
                <template v-else-if="channelType === 'codex'">
                  <div class="log-col col-token" :class="`col-token-${channelType}`">{{ formatLogToken(log, 'reasoning') }}</div>
                  <div class="log-col col-token" :class="`col-token-${channelType}`">{{ formatLogToken(log, 'cached') }}</div>
                  <div class="log-col col-token" :class="`col-token-${channelType}`">{{ formatLogToken(log, 'total') }}</div>
                </template>
                <template v-else-if="channelType === 'gemini'">
                  <div class="log-col col-token" :class="`col-token-${channelType}`">{{ formatLogToken(log, 'cached') }}</div>
                  <div class="log-col col-token" :class="`col-token-${channelType}`">{{ formatLogToken(log, 'total') }}</div>
                </template>
                <template v-else-if="channelType === 'opencode' || channelType === 'omp'">
                  <div class="log-col col-token" :class="`col-token-${channelType}`">{{ formatLogToken(log, 'reasoning') }}</div>
                  <div class="log-col col-token" :class="`col-token-${channelType}`">{{ formatLogToken(log, 'cached') }}</div>
                  <div class="log-col col-token" :class="`col-token-${channelType}`">{{ formatLogToken(log, 'total') }}</div>
                </template>
                <div class="log-col col-time" :class="`col-time-${channelType}`">{{ log.time }}</div>
              </template>
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 锁定状态 UI -->
    <div v-if="isLocked" class="locked-overlay" :class="`locked-${channelType}`">
      <div class="locked-content">
        <div class="lock-icon">
          <n-icon :size="48">
            <LockClosed />
          </n-icon>
        </div>
        <h3 class="locked-title">该渠道已锁定</h3>
        <n-text depth="3" class="locked-hint">
          点击上方按钮解锁以查看内容
        </n-text>
      </div>
    </div>

    <!-- 最新对话抽屉 -->
    <RecentSessionsDrawer
      v-if="platformConfig.supportsSessions !== false"
      v-model:visible="showRecentSessions"
      :channel="channelType"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { NIcon, NText, NSwitch, NTag, NButton, NTooltip, NPopover, useMessage } from 'naive-ui'
import {
  PowerOutline,
  RocketOutline,
  TrendingUpOutline,
  RadioOutline,
  TrashOutline,
  CheckmarkCircleOutline,
  CloseCircleOutline,
  FolderOutline,
  ChatbubblesOutline,
  ArrowForwardOutline,
  LockClosed,
  LockOpen,
  ReorderTwoOutline,
  ExtensionPuzzleOutline,
  TerminalOutline,
  PersonOutline
} from '@vicons/ionicons5'
import { useGlobalState } from '../../composables/useGlobalState'
import { useDashboard } from '../../composables/useDashboard'
import { useUIConfig } from '../../composables/useUIConfig'
import { getPlatformConfig } from '../../config/platforms'
import RecentSessionsDrawer from '../RecentSessionsDrawer.vue'
import {
  getUIConfig,
  updateNestedUIConfig
} from '../../api/ui-config'
import {
  updateChannel,
  updateCodexChannel,
  updateGeminiChannel,
  updateOpenCodeChannel,
  updateOmpChannel
} from '../../api/channels'
import {
  getClaudeTodayStatistics,
  getCodexTodayStatistics,
  getGeminiTodayStatistics,
  getOpenCodeTodayStatistics,
  getOmpTodayStatistics
} from '../../api/statistics'

const props = defineProps({
  channelType: {
    type: String,
    required: true
  }
})

const router = useRouter()
const message = useMessage()
const { uiConfig } = useUIConfig()
const {
  claudeProxy,
  codexProxy,
  geminiProxy,
  opencodeProxy,
  ompProxy,
  claudeChannels,
  codexChannels,
  geminiChannels,
  opencodeChannels,
  ompChannels,
  schedulerState,
  getProxyState,
  startProxy,
  stopProxy,
  getLogs,
  clearLogsForSource,
  loadChannels: loadGlobalChannels,
  logLimit,
  statsInterval: statsIntervalSetting
} = useGlobalState()

// Dashboard 聚合数据
const { dashboardData, isLoading: dashboardLoading, loadDashboard } = useDashboard()

// 渠道配置
const platformConfig = computed(() => getPlatformConfig(props.channelType, uiConfig.value.customCliPlatforms))
const channelTitle = computed(() => platformConfig.value.title || platformConfig.value.label || props.channelType)
const channelIcon = computed(() => platformConfig.value.icon || TerminalOutline)
const accentColor = computed(() => platformConfig.value.color || '#64748b')

// 代理状态（根据渠道类型选择）
const proxyState = computed(() => {
  if (props.channelType === 'claude') return claudeProxy.value
  if (props.channelType === 'codex') return codexProxy.value
  if (props.channelType === 'gemini') return geminiProxy.value
  if (props.channelType === 'opencode') return opencodeProxy.value
  if (props.channelType === 'omp') return ompProxy.value
  if (platformConfig.value.custom) {
    return {
      running: false,
      loading: false,
      activeChannel: null,
      port: null,
      runtime: null,
      startTime: null
    }
  }
  return {}
})

// 渠道类型名称
const channelTypeName = computed(() => {
  if (props.channelType === 'claude') return 'Claude'
  if (props.channelType === 'codex') return 'Codex'
  if (props.channelType === 'gemini') return 'Gemini'
  if (props.channelType === 'opencode') return 'OpenCode'
  if (props.channelType === 'omp') return 'OMP'
  return platformConfig.value.label || props.channelType
})

// 统计数据
const stats = ref({ projects: 0, sessions: 0 })
const todayStats = ref({
  requests: 0,
  tokens: 0,
  cost: 0
})

// 动画数值（用于显示滚动动画）
const animatedStats = ref({
  requests: 0,
  tokens: 0,
  cost: 0
})

const statPrecision = {
  requests: 0,
  tokens: 0,
  cost: 3
}

// 动画计时器ID
let animationFrameIds = {
  requests: null,
  tokens: null,
  cost: null
}

// 跟踪哪些数值正在动画中
const isAnimating = ref({
  requests: false,
  tokens: false,
  cost: false
})

// 模型统计数据（用于图表）
const modelStats = computed(() => {
  return dashboardData.value?.todayStats?.[props.channelType]?.byModel || {}
})

// 数字滚动动画函数
function animateValue(key, startValue, endValue, duration = 600) {
  if (animationFrameIds[key]) {
    cancelAnimationFrame(animationFrameIds[key])
  }

  // 开始动画，触发CSS动画效果
  isAnimating.value[key] = true

  const startTime = Date.now()

  const animate = () => {
    const elapsed = Date.now() - startTime
    const progress = Math.min(elapsed / duration, 1)

    // 使用 easeOutQuad 缓动函数
    const easeProgress = 1 - Math.pow(1 - progress, 2)
    const rawValue = startValue + (endValue - startValue) * easeProgress
    const precision = statPrecision[key] ?? 0
    const factor = Math.pow(10, precision)
    const currentValue = precision > 0
      ? Math.round(rawValue * factor) / factor
      : Math.round(rawValue)

    animatedStats.value[key] = currentValue

    if (progress < 1) {
      animationFrameIds[key] = requestAnimationFrame(animate)
    } else {
      // 动画结束，移除CSS动画效果
      isAnimating.value[key] = false
    }
  }

  animationFrameIds[key] = requestAnimationFrame(animate)
}

// 最新对话抽屉
const showRecentSessions = ref(false)

// localStorage key
const LOCK_STORAGE_KEY = 'channelLocks'
const CHANNEL_COLLAPSE_STORAGE_KEYS = {
  claude: 'claudeChannelCollapse',
  codex: 'codexChannelCollapse',
  gemini: 'geminiChannelCollapse',
  opencode: 'opencodeChannelCollapse',
  omp: 'ompChannelCollapse'
}

// 从 localStorage 读取锁定状态
function getLockFromStorage() {
  try {
    const stored = localStorage.getItem(LOCK_STORAGE_KEY)
    if (stored) {
      const locks = JSON.parse(stored)
      return locks[props.channelType] || false
    }
  } catch (e) {}
  return false
}

// 保存锁定状态到 localStorage
function saveLockToStorage(locked) {
  try {
    const stored = localStorage.getItem(LOCK_STORAGE_KEY)
    const locks = stored ? JSON.parse(stored) : {}
    locks[props.channelType] = locked
    localStorage.setItem(LOCK_STORAGE_KEY, JSON.stringify(locks))
  } catch (e) {}
}

// 锁定状态 - 初始值从 localStorage 读取，避免闪烁
const isLocked = ref(getLockFromStorage())

// 加载锁定状态（从服务器同步）
async function loadLockState() {
  try {
    let serverLocked = false
    if (dashboardData.value && dashboardData.value.uiConfig) {
      serverLocked = dashboardData.value.uiConfig.channelLocks?.[props.channelType] || false
    } else {
      const response = await getUIConfig()
      if (response.success && response.config) {
        serverLocked = response.config.channelLocks?.[props.channelType] || false
      }
    }
    // 服务器状态同步到本地
    isLocked.value = serverLocked
    saveLockToStorage(serverLocked)
  } catch (err) {
    // 出错时保持 localStorage 的状态
  }
}

// 切换锁定状态
async function toggleLock() {
  isLocked.value = !isLocked.value
  saveLockToStorage(isLocked.value)
  try {
    await updateNestedUIConfig('channelLocks', props.channelType, isLocked.value)
    if (dashboardData.value) {
      const config = dashboardData.value.uiConfig || {}
      const channelLocks = { ...(config.channelLocks || {}) }
      channelLocks[props.channelType] = isLocked.value
      dashboardData.value = {
        ...dashboardData.value,
        uiConfig: {
          ...config,
          channelLocks
        }
      }
    }
  } catch (err) {
    console.error('Failed to save lock state:', err)
  }
}

// 显示实时日志（从服务器读取，默认true）
const showLogs = ref(true)

// 加载显示设置
async function loadShowLogs() {
  try {
    // 优先从 dashboard 数据读取
    if (dashboardData.value && dashboardData.value.uiConfig) {
      showLogs.value = dashboardData.value.uiConfig.panelVisibility?.showLogs !== false
    } else {
      const response = await getUIConfig()
      if (response.success && response.config) {
        showLogs.value = response.config.panelVisibility?.showLogs !== false
      }
    }
  } catch (err) {
    console.error('Failed to load panel settings:', err)
  }
}

// 监听设置变化
function handleVisibilityChange(event) {
  if (event.detail && event.detail.showLogs !== undefined) {
    showLogs.value = event.detail.showLogs
  }
}

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
const logsContainer = ref(null)
const maxLogs = computed(() => logLimit.value)
const logStreams = {
  claude: getLogs('claude'),
  codex: getLogs('codex'),
  gemini: getLogs('gemini'),
  opencode: getLogs('opencode'),
  omp: getLogs('omp')
}
const logsToDisplay = computed(() => {
  if (!supportsKnownRuntime()) {
    return []
  }
  const stream = logStreams[props.channelType] || logStreams.claude
  const list = stream.value || []
  return list.slice(0, maxLogs.value)
})
let latestLogId = null
let statsIntervalId = null
let timeIntervalId = null
let componentMounted = false
let statsDebounceTimer = null

// 渠道列表 - 使用 Pinia store 的共享数据，启用的排前面
const channels = computed(() => {
  let list = []
  if (props.channelType === 'claude') list = claudeChannels.value || []
  else if (props.channelType === 'codex') list = codexChannels.value || []
  else if (props.channelType === 'gemini') list = geminiChannels.value || []
  else if (props.channelType === 'opencode') list = opencodeChannels.value || []
  else if (props.channelType === 'omp') list = ompChannels.value || []

  // 启用的排前面，禁用的排后面
  const enabled = list.filter(ch => ch.enabled !== false)
  const disabled = list.filter(ch => ch.enabled === false)
  return [...enabled, ...disabled]
})

// 获取渠道的实时并发数
function getChannelInflight(channelId) {
  const scheduler = schedulerState[props.channelType]
  if (!scheduler || !scheduler.channels) return 0
  const ch = scheduler.channels.find(c => c.id === channelId)
  return ch ? ch.inflight : 0
}

// 当前状态文本
const statusText = computed(() => {
  const enabledCount = channels.value.filter(ch => ch.enabled !== false).length
  if (proxyState.value.running) {
    return `${enabledCount}个渠道调度中`
  }
  return channels.value.length > 0 ? `${enabledCount}个渠道已启用` : '无渠道'
})

// 渠道统计数据
const channelStats = ref({})

// 获取渠道的今日统计
function getChannelTodayStats(channelId) {
  return channelStats.value[channelId] || { requests: 0, tokens: 0, cost: 0 }
}

// 加载渠道统计数据
async function loadChannelStats() {
  try {
    let statsData
    if (props.channelType === 'claude') {
      statsData = await getClaudeTodayStatistics()
    } else if (props.channelType === 'codex') {
      statsData = await getCodexTodayStatistics()
    } else if (props.channelType === 'gemini') {
      statsData = await getGeminiTodayStatistics()
    } else if (props.channelType === 'opencode') {
      statsData = await getOpenCodeTodayStatistics()
    } else if (props.channelType === 'omp') {
      statsData = await getOmpTodayStatistics()
    }

    // 从 byChannel 提取各渠道统计
    if (statsData && statsData.byChannel) {
      const stats = {}
      for (const [channelId, data] of Object.entries(statsData.byChannel)) {
        stats[channelId] = {
          requests: data.requests || 0,
          tokens: data.tokens?.total || 0,
          cost: data.cost || 0
        }
      }
      channelStats.value = stats
    }
  } catch (err) {
    console.error('Failed to load channel stats:', err)
  }
}

// 格式化统计数字
function formatStatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
  return num.toString()
}

function formatLogToken(log, key) {
  if (log?.usageMissing) {
    return '--'
  }
  return log?.tokens?.[key] || 0
}

function supportsKnownRuntime() {
  return ['claude', 'codex', 'gemini', 'opencode', 'omp'].includes(props.channelType)
}

function getLogTitle(log) {
  if (!log || log.type === 'action' || log.status === 'error') {
    return ''
  }

  const lines = []
  if (log.model) {
    lines.push(`模型: ${log.model}`)
  }
  if (log.originalModel && log.originalModel !== log.model) {
    lines.push(`重定向: ${log.originalModel} -> ${log.model}`)
  }
  if (log.usageMissing) {
    lines.push('上游响应未返回 usage，当前无法计算 token。')
  }
  return lines.join('\n')
}

// 防抖调用渠道统计（避免频繁日志导致大量请求）
function debouncedLoadChannelStats() {
  if (statsDebounceTimer) {
    clearTimeout(statsDebounceTimer)
  }
  // 5秒内的多次调用只执行最后一次
  statsDebounceTimer = setTimeout(() => {
    loadChannelStats()
  }, 5000)
}

watch(logsToDisplay, (newLogs) => {
  const newestId = newLogs[0]?.id || null
  if (!newestId || newestId === latestLogId) {
    latestLogId = newestId
    return
  }
  latestLogId = newestId

  // 有新日志时使用防抖刷新渠道统计（避免大量请求）
  debouncedLoadChannelStats()

  const isNearTop = logsContainer.value ? logsContainer.value.scrollTop < 20 : true
  if (isNearTop) {
    nextTick(() => {
      if (logsContainer.value) {
        logsContainer.value.scrollTop = 0
      }
    })
  }
})

// 监听今日统计数据变化，触发滚动动画
watch(() => todayStats.value.requests, (newVal) => {
  animateValue('requests', animatedStats.value.requests, newVal, 600)
})

watch(() => todayStats.value.tokens, (newVal) => {
  animateValue('tokens', animatedStats.value.tokens, newVal, 600)
})

watch(() => todayStats.value.cost, (newVal) => {
  animateValue('cost', animatedStats.value.cost, newVal, 600)
})

watch(() => props.channelType, () => {
  latestLogId = logsToDisplay.value[0]?.id || null
})

watch(() => dashboardData.value?.counts?.[props.channelType], () => {
  syncCountsFromDashboard()
})

watch(statsIntervalSetting, () => {
  if (componentMounted) {
    setupStatsTimer()
  }
})

// 格式化 Token
function formatTokens(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
  return num.toString()
}

function formatCurrency(value) {
  if (!value || Number.isNaN(value)) return '$0'
  return '$' + Number(value).toFixed(3)
}

// 格式化时间
function formatTime(timestamp) {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// 处理代理切换
async function handleProxyToggle(value) {
  if (platformConfig.value.supportsProxy === false || !supportsKnownRuntime()) {
    message.warning(`${channelTitle.value} 暂未接入动态代理`)
    return
  }
  const proxyState = getProxyState(props.channelType)
  proxyState.value.loading = true
  try {
    let result
    if (value) {
      result = await startProxy(props.channelType)
    } else {
      result = await stopProxy(props.channelType, { refreshChannelsDrawer: true })
    }

    if (result.success !== false) {
      message.success(value ? `${channelTitle.value} 代理已启动` : `${channelTitle.value} 代理已停止`)
    } else {
      message.error(result.error || '操作失败')
      // 回滚状态
      proxyState.value.running = !value
    }
  } catch (error) {
    message.error(error.response?.data?.error || error.message || '操作失败')
    // 回滚状态
    proxyState.value.running = !value
  } finally {
    proxyState.value.loading = false
  }
}

// 跳转到项目列表
function goToProjects() {
  if (platformConfig.value.supportsProjects === false || !supportsKnownRuntime()) {
    message.info(`${channelTitle.value} 当前仅作为首页显示项`)
    return
  }
  router.push({ name: `${props.channelType}-projects` })
}

// 跳转到渠道单独页面
function goToChannelPage() {
  if (platformConfig.value.supportsProjects === false || !supportsKnownRuntime()) {
    message.info(`${channelTitle.value} 当前仅作为首页显示项`)
    return
  }
  router.push({ name: `${props.channelType}-projects` })
}

function openRecentSessions() {
  if (platformConfig.value.supportsSessions === false || !supportsKnownRuntime()) {
    message.info(`${channelTitle.value} 当前没有托管会话列表`)
    return
  }
  showRecentSessions.value = true
}

// 快捷切换渠道状态
const quickToggleLoading = ref({})

function isQuickToggleLoading(channelId) {
  return !!quickToggleLoading.value[channelId]
}

function setQuickToggleLoading(channelId, value) {
  if (!channelId) return
  quickToggleLoading.value = {
    ...quickToggleLoading.value,
    [channelId]: !!value
  }
}

async function syncChannelCollapseForToggle(channelId, enabled) {
  if (!channelId) return
  const storageKey = CHANNEL_COLLAPSE_STORAGE_KEYS[props.channelType]
  let collapse = {}

  try {
    const stored = storageKey ? localStorage.getItem(storageKey) : null
    collapse = stored ? JSON.parse(stored) : {}
  } catch (error) {
    collapse = {}
  }

  if (enabled) {
    delete collapse[channelId]
  } else {
    collapse[channelId] = true
  }

  try {
    if (storageKey) {
      localStorage.setItem(storageKey, JSON.stringify(collapse))
    }
  } catch (error) {}

  try {
    await updateNestedUIConfig('channelCollapse', props.channelType, collapse)
  } catch (error) {
    console.error('Failed to sync channel collapse state:', error)
  }
}

async function handleQuickToggle(channel, enabled) {
  if (!channel || isQuickToggleLoading(channel.id)) return
  setQuickToggleLoading(channel.id, true)
  try {
    let updateFn
    if (props.channelType === 'claude') {
      updateFn = updateChannel
    } else if (props.channelType === 'codex') {
      updateFn = updateCodexChannel
    } else if (props.channelType === 'gemini') {
      updateFn = updateGeminiChannel
    } else if (props.channelType === 'opencode') {
      updateFn = updateOpenCodeChannel
    } else if (props.channelType === 'omp') {
      updateFn = updateOmpChannel
    }

    if (updateFn) {
      await updateFn(channel.id, { enabled })
      await syncChannelCollapseForToggle(channel.id, enabled)
      message.success(enabled ? `渠道「${channel.name}」已启用` : `渠道「${channel.name}」已停用`)
      // 使用全局 store 的 loadChannels 刷新数据
      await loadGlobalChannels()
      window.dispatchEvent(new CustomEvent('channel-management-refresh', { detail: { channel: props.channelType } }))
    }
  } catch (error) {
    message.error('操作失败: ' + error.message)
  } finally {
    setQuickToggleLoading(channel.id, false)
  }
}


function syncCountsFromDashboard() {
  const counts = dashboardData.value?.counts?.[props.channelType]
  stats.value.projects = counts?.projectCount || 0
  stats.value.sessions = counts?.sessionCount || 0
}

// 加载统计数据
async function loadStats() {
  if (dashboardData.value && dashboardData.value.todayStats) {
    const statsData = dashboardData.value.todayStats[props.channelType]
    if (statsData) {
      todayStats.value.requests = statsData.requests || 0
      todayStats.value.tokens = statsData.tokens || 0
      todayStats.value.cost = statsData.cost || 0
    }
  }
  syncCountsFromDashboard()
}

// 清空日志
function clearLogs() {
  clearLogsForSource(props.channelType)
}

function setupStatsTimer() {
  if (statsIntervalId) {
    clearInterval(statsIntervalId)
    statsIntervalId = null
  }
  const intervalSeconds = statsIntervalSetting.value || 30
  const delay = Math.max(intervalSeconds * 1000, 10000)
  statsIntervalId = setInterval(() => {
    loadStats()
    loadChannelStats()  // 同时刷新渠道统计
  }, delay)
}

function blurShortcutButton(event) {
  event?.currentTarget?.blur?.()
}

function openSkillsManager(event) {
  window.dispatchEvent(new CustomEvent('open-skills-drawer', { detail: { platform: props.channelType } }))
  blurShortcutButton(event)
}

function openCommandsManager(event) {
  window.dispatchEvent(new CustomEvent('open-commands-drawer', { detail: { platform: props.channelType } }))
  blurShortcutButton(event)
}

function openAgentsManager(event) {
  if (platformConfig.value.supportsAgents === false) {
    message.info(`${channelTitle.value} 的 Agent 能力通过插件/扩展提供`)
    blurShortcutButton(event)
    return
  }
  window.dispatchEvent(new CustomEvent('open-agents-drawer', { detail: { platform: props.channelType } }))
  blurShortcutButton(event)
}

onMounted(async () => {
  // 并行加载：loadDashboard（有缓存防重）和 loadChannelStats 同时发起
  await Promise.all([
    loadDashboard().then(() => loadStats()),
    loadChannelStats()
  ])
  // 渠道数据现在从 Pinia store 获取，由 store 自动管理
  loadShowLogs()
  loadLockState()
  window.addEventListener('panel-visibility-change', handleVisibilityChange)

  // 初始化动画数值
  animatedStats.value = { ...todayStats.value }

  componentMounted = true
  timeIntervalId = setInterval(() => {
    currentTime.value = Date.now()
  }, 1000)
})

onUnmounted(() => {
  componentMounted = false
  if (statsIntervalId) clearInterval(statsIntervalId)
  if (timeIntervalId) clearInterval(timeIntervalId)
  if (statsDebounceTimer) clearTimeout(statsDebounceTimer)
  window.removeEventListener('panel-visibility-change', handleVisibilityChange)

  // 清理动画计时器
  Object.values(animationFrameIds).forEach(id => {
    if (id) cancelAnimationFrame(id)
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
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 22px 52px rgba(15, 23, 29, 0.1);
}

.channel-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: linear-gradient(180deg, var(--bg-elevated) 0%, var(--bg-secondary) 100%);
  position: relative;
}

.drag-handle {
  cursor: grab;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  padding: 4px;
  margin: -4px;
  margin-right: 0;
  border-radius: 4px;
  transition: all 0.2s;
}

.drag-handle:hover {
  color: var(--text-secondary);
  background: var(--bg-tertiary);
}

.drag-handle:active {
  cursor: grabbing;
}

.channel-header::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 18px;
  right: 18px;
  height: 2px;
  border-radius: 1px;
}

.channel-header.claude {
  background: linear-gradient(135deg, rgba(24, 160, 88, 0.10) 0%, var(--bg-secondary) 100%);
}

.channel-header.claude::after {
  background: linear-gradient(90deg, #18a058, rgba(24, 160, 88, 0.3));
}

.channel-header.codex {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.10) 0%, var(--bg-secondary) 100%);
}

.channel-header.codex::after {
  background: linear-gradient(90deg, #3b82f6, rgba(59, 130, 246, 0.3));
}

.channel-header.gemini {
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.10) 0%, var(--bg-secondary) 100%);
}

.channel-header.gemini::after {
  background: linear-gradient(90deg, #a855f7, rgba(168, 85, 247, 0.3));
}

.channel-header.opencode {
  background: linear-gradient(135deg, rgba(234, 88, 12, 0.10) 0%, var(--bg-secondary) 100%);
}

.channel-header.opencode::after {
  background: linear-gradient(90deg, #ea580c, rgba(234, 88, 12, 0.3));
}

.channel-header.omp {
  background: linear-gradient(135deg, rgba(15, 159, 154, 0.10) 0%, var(--bg-secondary) 100%);
}

.channel-header.omp::after {
  background: linear-gradient(90deg, #0f9f9a, rgba(15, 159, 154, 0.3));
}

.channel-header.custom-cli {
  background: linear-gradient(135deg, color-mix(in srgb, var(--channel-accent, #64748b) 12%, transparent) 0%, var(--bg-secondary) 100%);
}

.channel-header.custom-cli::after {
  background: linear-gradient(90deg, var(--channel-accent, #64748b), color-mix(in srgb, var(--channel-accent, #64748b) 32%, transparent));
}

.header-icon {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 10px 24px rgba(15, 23, 29, 0.14);
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

.channel-header.opencode .header-icon {
  background: linear-gradient(135deg, #ea580c 0%, #c2410c 100%);
  color: white;
}

.channel-header.omp .header-icon {
  background: linear-gradient(135deg, #0f9f9a 0%, #0f766e 100%);
  color: white;
}

.channel-header.custom-cli .header-icon {
  background: linear-gradient(135deg, var(--channel-accent, #64748b) 0%, color-mix(in srgb, var(--channel-accent, #64748b) 72%, #0f172a) 100%);
  color: white;
}

.channel-title {
  font-size: 13px;
  font-weight: 700;
  margin: 0;
  color: var(--text-primary);
  letter-spacing: 0.3px;
  line-height: 1.15;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
}

.channel-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.card {
  background: var(--gradient-card);
  border: 1px solid var(--border-primary);
  border-radius: 14px;
  overflow: hidden;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
  box-shadow: 0 10px 28px rgba(15, 23, 29, 0.06);
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
  box-shadow: 0 18px 38px rgba(15, 23, 29, 0.1);
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
  padding: 9px 12px;
  background: linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-primary) 100%);
  border-bottom: 1px solid var(--border-primary);
  position: relative;
  min-height: 24px;
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
  border-radius: 999px;
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
  padding: 8px 10px;
  background: transparent;
}

.card-body.compact {
  padding: 7px 10px;
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

.proxy-port {
  font-size: 11px;
  color: var(--text-secondary);
  margin-left: 6px;
}

.channel-selector {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  background: linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
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
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}

.access-card {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 8px;
  border-radius: 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
  position: relative;
  min-height: 44px;
  overflow: hidden;
}

.access-card::before {
  content: '';
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
}

.access-icon {
  width: 28px;
  height: 28px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.3s ease;
}

.access-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

/* 项目卡片 */
.access-card-projects .access-icon {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(139, 92, 246, 0.15));
  color: #6366f1;
}

.access-card-projects::before {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(139, 92, 246, 0.08));
}

.access-card-projects:hover .access-icon {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(139, 92, 246, 0.25));
  transform: translateY(-1px);
}

/* 对话卡片 */
.access-card-sessions .access-icon {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(5, 150, 105, 0.15));
  color: #10b981;
}

.access-card-sessions::before {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(5, 150, 105, 0.08));
}

.access-card-sessions:hover .access-icon {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(5, 150, 105, 0.25));
  transform: translateY(-1px);
}

/* 前往卡片 */
.access-card-goto .access-icon {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(251, 146, 60, 0.15));
  color: #f59e0b;
}

.access-card-goto::before {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.08), rgba(251, 146, 60, 0.08));
}

.access-card-goto:hover .access-icon {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(251, 146, 60, 0.25));
  transform: translateX(2px);
}

.access-card.clickable:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.1);
  border-color: var(--border-secondary);
}

.access-card.clickable:hover::before {
  opacity: 1;
}

.access-card.disabled {
  cursor: default;
  opacity: 0.62;
}

.access-card.disabled:hover {
  transform: none;
  box-shadow: none;
  border-color: var(--border-primary);
}

.access-card.clickable:active {
  transform: translateY(0);
}

.access-label {
  display: block;
  font-size: 8px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  white-space: nowrap;
  line-height: 1.1;
}

.access-value {
  display: block;
  font-size: 13px;
  font-weight: 800;
  color: var(--text-primary);
  line-height: 1;
  white-space: nowrap;
}

.access-goto {
  display: block;
  font-size: 9px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
  padding: 10px;
  background: var(--bg-secondary);
  border-radius: 10px;
  border: 1px solid var(--border-primary);
  transition: all 0.2s ease;
}

.stat-inline-item:hover {
  border-color: var(--border-secondary);
  background: var(--hover-bg);
}

/* 统计项图标点 */
.stat-icon-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.stat-icon-dot.requests {
  background: #3b82f6;
  box-shadow: 0 0 6px rgba(59, 130, 246, 0.5);
}

.stat-icon-dot.tokens {
  background: #18a058;
  box-shadow: 0 0 6px rgba(24, 160, 88, 0.5);
}

.stat-icon-dot.cost {
  background: #f59e0b;
  box-shadow: 0 0 6px rgba(245, 158, 11, 0.5);
}

.stat-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.stat-label {
  font-size: 10px;
  color: var(--text-tertiary);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.2px;
}

.stat-value {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
  transition: all 0.3s ease;
}

/* 数字变化时的动画效果 */
.stat-value.animating {
  animation: numberChange 0.6s ease;
}

@keyframes numberChange {
  0% {
    transform: translateY(-6px);
    opacity: 0.5;
  }
  50% {
    transform: translateY(0);
    opacity: 1;
    color: var(--primary-color);
  }
  100% {
    transform: translateY(0);
    opacity: 1;
  }
}

/* 统计卡片特殊样式 */
.stats-card {
  border-left: 2px solid transparent;
}

/* 图表卡片样式 */
.chart-card {
  border-left: 2px solid transparent;
}

.stats-card-claude,
.chart-card:has(+ .stats-card-claude),
.card:has(.panel-card):nth-child(4) {
  border-left-color: #18a058;
}

/* Fallback for browsers without :has() support (Firefox < 121) */
.chart-card.chart-card-claude {
  border-left-color: #18a058;
}

.stats-card-codex,
.chart-card:has(+ .stats-card-codex),
.card:has(.panel-card):nth-child(4) {
  border-left-color: #3b82f6;
}

/* Fallback for browsers without :has() support (Firefox < 121) */
.chart-card.chart-card-codex {
  border-left-color: #3b82f6;
}

.stats-card-gemini,
.chart-card:has(+ .stats-card-gemini),
.card:has(.panel-card):nth-child(4) {
  border-left-color: #a855f7;
}

/* Fallback for browsers without :has() support (Firefox < 121) */
.chart-card.chart-card-gemini {
  border-left-color: #a855f7;
}

.stats-card-opencode,
.chart-card:has(+ .stats-card-opencode),
.card:has(.panel-card):nth-child(4) {
  border-left-color: #ea580c;
}

/* Fallback for browsers without :has() support (Firefox < 121) */
.chart-card.chart-card-opencode {
  border-left-color: #ea580c;
}

.stats-card-omp,
.chart-card:has(+ .stats-card-omp),
.card:has(.panel-card):nth-child(4) {
  border-left-color: #0f9f9a;
}

.chart-card.chart-card-omp {
  border-left-color: #0f9f9a;
}

.chart-card {
  padding: 0;
  overflow: hidden;
}

.chart-card :deep(.panel-card) {
  border: none;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
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
  border-radius: 14px;
}

.logs-card-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0;
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
  padding: 8px 12px;
  background: linear-gradient(180deg, var(--bg-tertiary) 0%, var(--bg-secondary) 100%);
  border-bottom: 1px solid var(--border-primary);
  font-size: 11px;
  font-weight: 700;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.6px;
  flex-shrink: 0;
}

/* 柔和的日志表头颜色 */
.logs-header-claude .log-col {
  color: rgba(24, 160, 88, 0.7);
  font-weight: 600;
}

.logs-header-codex .log-col {
  color: rgba(59, 130, 246, 0.7);
  font-weight: 600;
}

.logs-header-gemini .log-col {
  color: rgba(168, 85, 247, 0.7);
  font-weight: 600;
}

.logs-header-opencode .log-col {
  color: rgba(234, 88, 12, 0.7);
  font-weight: 600;
}

.logs-header-omp .log-col {
  color: rgba(15, 159, 154, 0.7);
  font-weight: 600;
}

/* 暗色主题下稍微提亮 */
[data-theme="dark"] .logs-header-claude .log-col {
  color: rgba(52, 211, 153, 0.65);
}

[data-theme="dark"] .logs-header-codex .log-col {
  color: rgba(96, 165, 250, 0.65);
}

[data-theme="dark"] .logs-header-gemini .log-col {
  color: rgba(192, 132, 252, 0.65);
}

[data-theme="dark"] .logs-header-opencode .log-col {
  color: rgba(251, 146, 60, 0.65);
}

[data-theme="dark"] .logs-header-omp .log-col {
  color: rgba(45, 212, 191, 0.65);
}

[data-theme="dark"] .channel-column {
  background: linear-gradient(180deg, rgba(18, 27, 34, 0.98) 0%, rgba(9, 16, 22, 0.98) 100%);
  border-color: rgba(54, 76, 86, 0.82);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.28);
}

[data-theme="dark"] .channel-header {
  background: linear-gradient(180deg, rgba(22, 34, 42, 0.9) 0%, rgba(13, 22, 29, 0.82) 100%);
}

[data-theme="dark"] .card,
[data-theme="dark"] .access-card,
[data-theme="dark"] .stat-inline-item {
  background: linear-gradient(180deg, rgba(18, 28, 35, 0.94) 0%, rgba(12, 21, 28, 0.96) 100%);
  border-color: rgba(54, 76, 86, 0.78);
}

[data-theme="dark"] .card:hover,
[data-theme="dark"] .access-card.clickable:hover,
[data-theme="dark"] .stat-inline-item:hover {
  border-color: rgba(76, 101, 112, 0.92);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.24);
}

[data-theme="dark"] .card-header {
  background: linear-gradient(180deg, rgba(22, 34, 42, 0.92) 0%, rgba(14, 24, 31, 0.96) 100%);
  border-bottom-color: rgba(54, 76, 86, 0.72);
}

[data-theme="dark"] .logs-table-wrapper {
  background: rgba(9, 16, 22, 0.96);
}

[data-theme="dark"] .logs-table-header {
  background: linear-gradient(180deg, rgba(18, 29, 37, 0.96) 0%, rgba(11, 20, 27, 0.98) 100%);
  border-bottom-color: rgba(54, 76, 86, 0.76);
}

.logs-container {
  flex: 1;
  min-height: 0;
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
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: var(--text-tertiary);
  min-height: 200px;
  text-align: center;
}

.log-row {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  min-height: 40px;
  border-bottom: 1px solid var(--border-primary);
  font-size: 12px;
  transition: all 0.2s ease;
  background: var(--bg-primary);
  position: relative;
}

.log-row:nth-child(even) {
  background: var(--bg-secondary);
}

[data-theme="dark"] .log-row {
  background: rgba(9, 16, 22, 0.96);
  border-bottom-color: rgba(54, 76, 86, 0.58);
}

[data-theme="dark"] .log-row:nth-child(even) {
  background: rgba(13, 22, 29, 0.96);
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

.log-row.error-row {
  background: linear-gradient(90deg, rgba(208, 48, 80, 0.14) 0%, rgba(208, 48, 80, 0.04) 100%);
  border-left: 3px solid #d03050;
  padding-left: 8px;
}

.log-row.action-row:hover {
  background: linear-gradient(90deg, rgba(24, 160, 88, 0.18) 0%, rgba(24, 160, 88, 0.08) 100%);
}

.log-row.error-row:hover {
  background: linear-gradient(90deg, rgba(208, 48, 80, 0.2) 0%, rgba(208, 48, 80, 0.08) 100%);
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

.action-msg.error-msg {
  color: #d03050;
}

.action-time {
  font-size: 10px;
  font-family: 'SF Mono', Monaco, monospace;
  color: var(--text-tertiary);
  background: rgba(24, 160, 88, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
}

.action-time.error-time {
  background: rgba(208, 48, 80, 0.12);
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
  font-size: 11px;
  font-weight: 600;
  border-radius: 4px;
  padding: 3px 10px;
}

.col-token {
  justify-content: center;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  background: rgba(0, 0, 0, 0.03);
  padding: 4px 8px;
  border-radius: 4px;
  margin: 0 3px;
}

[data-theme="dark"] .col-token {
  background: rgba(255, 255, 255, 0.045);
  color: var(--text-secondary);
}

.col-time {
  justify-content: flex-end;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-tertiary);
  padding-right: 2px;
  opacity: 0.85;
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

/* OpenCode 列宽 (4列: 渠道, 请求, 回复, 时间) */
.col-channel-opencode {
  flex: 2.5 1 70px;
  min-width: 55px;
}

.col-token-opencode {
  flex: 1.2 1 45px;
  min-width: 40px;
}

.col-time-opencode {
  flex: 1.8 1 60px;
  min-width: 55px;
}

.col-channel-omp {
  flex: 2.5 1 70px;
  min-width: 55px;
}

.col-token-omp {
  flex: 1.2 1 45px;
  min-width: 40px;
}

.col-time-omp {
  flex: 1.8 1 60px;
  min-width: 55px;
}

/* Claude 额外区域样式 (MCP & Skills) */
.claude-extra-area {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.mcp-count-tag,
.skills-count-tag {
  font-size: 10px;
  font-weight: 500;
  padding: 0 8px;
  height: 22px;
  line-height: 22px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.mcp-count-tag.clickable:hover,
.skills-count-tag.clickable:hover {
  transform: scale(1.03);
  filter: brightness(1.1);
}

/* MCP 快捷面板样式 */
.mcp-quick-panel,
.skills-quick-panel {
  padding: 2px 0;
}

.mcp-quick-panel .panel-title,
.skills-quick-panel .panel-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px 8px 10px;
  border-bottom: 1px solid var(--border-primary);
  margin-bottom: 4px;
}

.mcp-quick-panel .panel-title span:first-child,
.skills-quick-panel .panel-title span:first-child {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.no-items {
  padding: 16px 10px;
  text-align: center;
}

.mcp-quick-list,
.skills-quick-list {
  max-height: 300px;
  overflow-y: auto;
  padding: 0 4px 4px 4px;
}

.mcp-quick-item,
.skill-quick-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 5px;
  margin-bottom: 4px;
  background: var(--bg-secondary);
  transition: all 0.2s ease;
}

.mcp-quick-item:hover,
.skill-quick-item:hover {
  background: var(--hover-bg);
}

.mcp-item-icon,
.skill-item-icon {
  width: 24px;
  height: 24px;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.mcp-item-icon {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(59, 130, 246, 0.05));
  color: #3b82f6;
}

.skill-item-icon {
  background: linear-gradient(135deg, rgba(24, 160, 88, 0.15), rgba(24, 160, 88, 0.05));
  color: #18a058;
}

.mcp-item-info,
.skill-item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.mcp-item-name,
.skill-item-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mcp-item-type {
  font-size: 10px;
  color: var(--text-tertiary);
  text-transform: uppercase;
}

.skill-item-desc {
  font-size: 10px;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mcp-item-status {
  flex-shrink: 0;
}

.mcp-item-status .status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--border-secondary);
}

.mcp-item-status.online .status-dot {
  background: #18a058;
  box-shadow: 0 0 6px rgba(24, 160, 88, 0.5);
}

.mcp-item-status.error .status-dot {
  background: #d03050;
  box-shadow: 0 0 6px rgba(208, 48, 80, 0.5);
}

.mcp-quick-list::-webkit-scrollbar,
.skills-quick-list::-webkit-scrollbar {
  width: 4px;
}

.mcp-quick-list::-webkit-scrollbar-thumb,
.skills-quick-list::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.15);
  border-radius: 2px;
}

[data-theme="dark"] .mcp-quick-list::-webkit-scrollbar-thumb,
[data-theme="dark"] .skills-quick-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
}

/* 配置快捷按钮样式 */
.config-shortcut-button {
  --asset-shortcut-text: var(--text-color-3);
  --n-text-color: var(--asset-shortcut-text) !important;
  --n-text-color-hover: var(--asset-shortcut-text) !important;
  --n-text-color-pressed: var(--asset-shortcut-text) !important;
  --n-text-color-focus: var(--asset-shortcut-text) !important;
  padding: 6px !important;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  color: var(--asset-shortcut-text) !important;
  transition: transform 0.18s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.18s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.config-shortcut-button .n-icon {
  color: var(--asset-shortcut-text) !important;
  transition: transform 0.18s ease;
}

.config-shortcut-button :deep(.n-button__content),
.config-shortcut-button :deep(.n-button__icon) {
  color: var(--asset-shortcut-text) !important;
}

.config-shortcut-button:hover,
.config-shortcut-button:focus,
.config-shortcut-button:focus-visible {
  background: var(--bg-secondary);
  border-color: var(--border-primary);
  color: var(--asset-shortcut-text) !important;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.08);
  transform: translateY(-1px);
}

.config-shortcut-button:hover .n-icon,
.config-shortcut-button:focus .n-icon,
.config-shortcut-button:focus-visible .n-icon {
  color: var(--asset-shortcut-text) !important;
  transform: scale(1.1);
}

.config-shortcut-button:active {
  background: var(--bg-secondary);
  border-color: var(--border-primary);
  color: var(--asset-shortcut-text) !important;
  transform: translateY(0);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

/* 锁定按钮样式 - 与 Skills 按钮统一风格 */
.lock-button {
  margin-left: 6px;
  padding: 6px !important;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.lock-button .n-icon {
  color: var(--text-color-3);
  transition: all 0.25s ease;
}

.lock-button:hover {
  background: linear-gradient(135deg, rgba(107, 114, 128, 0.1), rgba(107, 114, 128, 0.05));
  border-color: rgba(107, 114, 128, 0.3);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  transform: translateY(-1px);
}

.lock-button:hover .n-icon {
  color: var(--text-color-1);
  transform: scale(1.1);
}

.lock-button:active {
  transform: translateY(0);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

/* 锁定状态覆盖层 - 精致版本 */
.locked-overlay {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  margin: 10px;
  position: relative;
  overflow: hidden;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  backdrop-filter: blur(10px);
}

/* 背景装饰 */
.locked-overlay::before {
  content: '';
  position: absolute;
  width: 400px;
  height: 400px;
  border-radius: 50%;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  opacity: 0.4;
  filter: blur(60px);
  pointer-events: none;
}

/* 根据不同渠道类型设置主题色 */
.locked-claude {
  background: linear-gradient(135deg,
    rgba(24, 160, 88, 0.03) 0%,
    var(--bg-secondary) 50%,
    rgba(24, 160, 88, 0.02) 100%);
}

.locked-claude::before {
  background: radial-gradient(circle, rgba(24, 160, 88, 0.15) 0%, transparent 70%);
}

.locked-codex {
  background: linear-gradient(135deg,
    rgba(59, 130, 246, 0.03) 0%,
    var(--bg-secondary) 50%,
    rgba(59, 130, 246, 0.02) 100%);
}

.locked-codex::before {
  background: radial-gradient(circle, rgba(59, 130, 246, 0.15) 0%, transparent 70%);
}

.locked-gemini {
  background: linear-gradient(135deg,
    rgba(168, 85, 247, 0.03) 0%,
    var(--bg-secondary) 50%,
    rgba(168, 85, 247, 0.02) 100%);
}

.locked-gemini::before {
  background: radial-gradient(circle, rgba(168, 85, 247, 0.15) 0%, transparent 70%);
}

.locked-opencode {
  background: linear-gradient(135deg,
    rgba(234, 88, 12, 0.03) 0%,
    var(--bg-secondary) 50%,
    rgba(234, 88, 12, 0.02) 100%);
}

.locked-opencode::before {
  background: radial-gradient(circle, rgba(234, 88, 12, 0.15) 0%, transparent 70%);
}

.locked-omp {
  background: linear-gradient(135deg,
    rgba(15, 159, 154, 0.03) 0%,
    var(--bg-secondary) 50%,
    rgba(15, 159, 154, 0.02) 100%);
}

.locked-omp::before {
  background: radial-gradient(circle, rgba(15, 159, 154, 0.15) 0%, transparent 70%);
}

/* 锁定内容 */
.locked-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: 60px 40px;
  text-align: center;
  position: relative;
  z-index: 1;
}

.lock-icon {
  width: 96px;
  height: 96px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: var(--bg-primary);
  border: 2px solid var(--border-primary);
  margin-bottom: 8px;
  position: relative;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  animation: lock-float 3s ease-in-out infinite;
}

@keyframes lock-float {
  0%, 100% {
    transform: translateY(0px);
  }
  50% {
    transform: translateY(-6px);
  }
}

/* 光晕效果 */
.lock-icon::before {
  content: '';
  position: absolute;
  inset: -8px;
  border-radius: 20px;
  opacity: 0.6;
  filter: blur(12px);
}

/* Claude 主题色 */
.locked-claude .lock-icon {
  background: linear-gradient(135deg,
    rgba(24, 160, 88, 0.12) 0%,
    var(--bg-primary) 100%);
  border-color: rgba(24, 160, 88, 0.25);
  box-shadow:
    0 8px 24px rgba(24, 160, 88, 0.15),
    0 0 0 1px rgba(24, 160, 88, 0.1) inset;
}

.locked-claude .lock-icon::before {
  background: radial-gradient(circle, rgba(24, 160, 88, 0.3) 0%, transparent 60%);
}

.locked-claude .lock-icon .n-icon {
  color: #18a058;
  filter: drop-shadow(0 2px 4px rgba(24, 160, 88, 0.3));
}

/* Codex 主题色 */
.locked-codex .lock-icon {
  background: linear-gradient(135deg,
    rgba(59, 130, 246, 0.12) 0%,
    var(--bg-primary) 100%);
  border-color: rgba(59, 130, 246, 0.25);
  box-shadow:
    0 8px 24px rgba(59, 130, 246, 0.15),
    0 0 0 1px rgba(59, 130, 246, 0.1) inset;
}

.locked-codex .lock-icon::before {
  background: radial-gradient(circle, rgba(59, 130, 246, 0.3) 0%, transparent 60%);
}

.locked-codex .lock-icon .n-icon {
  color: #3b82f6;
  filter: drop-shadow(0 2px 4px rgba(59, 130, 246, 0.3));
}

/* Gemini 主题色 */
.locked-gemini .lock-icon {
  background: linear-gradient(135deg,
    rgba(168, 85, 247, 0.12) 0%,
    var(--bg-primary) 100%);
  border-color: rgba(168, 85, 247, 0.25);
  box-shadow:
    0 8px 24px rgba(168, 85, 247, 0.15),
    0 0 0 1px rgba(168, 85, 247, 0.1) inset;
}

.locked-gemini .lock-icon::before {
  background: radial-gradient(circle, rgba(168, 85, 247, 0.3) 0%, transparent 60%);
}

.locked-gemini .lock-icon .n-icon {
  color: #a855f7;
  filter: drop-shadow(0 2px 4px rgba(168, 85, 247, 0.3));
}

/* OpenCode 主题色 */
.locked-opencode .lock-icon {
  background: linear-gradient(135deg,
    rgba(234, 88, 12, 0.12) 0%,
    var(--bg-primary) 100%);
  border-color: rgba(234, 88, 12, 0.25);
  box-shadow:
    0 8px 24px rgba(234, 88, 12, 0.15),
    0 0 0 1px rgba(234, 88, 12, 0.1) inset;
}

.locked-opencode .lock-icon::before {
  background: radial-gradient(circle, rgba(234, 88, 12, 0.3) 0%, transparent 60%);
}

.locked-opencode .lock-icon .n-icon {
  color: #ea580c;
  filter: drop-shadow(0 2px 4px rgba(234, 88, 12, 0.3));
}

.locked-omp .lock-icon {
  background: linear-gradient(135deg,
    rgba(15, 159, 154, 0.12) 0%,
    var(--bg-primary) 100%);
  border-color: rgba(15, 159, 154, 0.25);
  box-shadow:
    0 8px 24px rgba(15, 159, 154, 0.15),
    0 0 0 1px rgba(15, 159, 154, 0.1) inset;
}

.locked-omp .lock-icon::before {
  background: radial-gradient(circle, rgba(15, 159, 154, 0.3) 0%, transparent 60%);
}

.locked-omp .lock-icon .n-icon {
  color: #0f9f9a;
  filter: drop-shadow(0 2px 4px rgba(15, 159, 154, 0.3));
}

.lock-icon .n-icon {
  opacity: 0.85;
  position: relative;
  z-index: 1;
}

.locked-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--text-color-1);
  margin: 0;
  letter-spacing: 0.3px;
}

.locked-hint {
  font-size: 13px;
  color: var(--text-color-3);
  max-width: 220px;
  line-height: 1.7;
  opacity: 0.9;
}

/* 渠道快捷管理面板 */
.channel-status {
  cursor: pointer;
  padding: 4px 8px !important;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.channel-status:hover {
  background: var(--hover-bg);
}

.channel-quick-panel {
  padding: 4px 0;
}

.panel-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px 12px 12px;
  border-bottom: 1px solid var(--border-primary);
  margin-bottom: 8px;
}

.panel-title span:first-child {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.no-channels {
  padding: 24px 12px;
  text-align: center;
}

.channel-quick-list {
  max-height: 360px;
  overflow-y: auto;
}

.channel-quick-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 6px;
  margin: 0 4px 6px 4px;
  background: var(--bg-secondary);
  transition: all 0.2s ease;
}

.channel-quick-item:hover {
  background: var(--hover-bg);
}

.channel-quick-item.disabled {
  opacity: 0.6;
}

.channel-quick-info {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.channel-quick-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 渠道指标行 */
.channel-metrics {
  display: flex;
  gap: 6px;
  width: 100%;
}

.channel-metrics .metric-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 4px;
  background: var(--bg-primary);
  border-radius: 4px;
  border: 1px solid var(--border-primary);
}

.channel-metrics .metric-label {
  font-size: 10px;
  color: var(--text-tertiary);
  font-weight: 500;
}

.channel-metrics .metric-value {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary);
  font-family: 'SF Mono', Monaco, monospace;
}

.channel-metrics .metric-value.active {
  color: #f59e0b;
}

.channel-switching-tip {
  font-size: 11px;
  color: var(--text-tertiary);
  padding: 0 2px;
}

.channel-quick-item.disabled .channel-metrics .metric-value {
  color: var(--text-tertiary);
}

.channel-quick-list::-webkit-scrollbar {
  width: 4px;
}

.channel-quick-list::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.15);
  border-radius: 2px;
}

[data-theme="dark"] .channel-quick-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
}

/* ========== 响应式样式 ========== */

/* 平板端 (768px - 1024px) */
@media (max-width: 1024px) {
  .channel-column {
    border-radius: 6px;
  }

  .card-header {
    padding: 8px 10px;
  }

  .card-title {
    font-size: 13px;
  }

  .stats-inline {
    gap: 6px;
  }

  .stat-inline-item {
    padding: 8px;
  }

  .stat-value {
    font-size: 14px;
  }

  .stat-label {
    font-size: 9px;
  }

  .logs-table-header {
    padding: 8px 10px;
    font-size: 10px;
  }

  .log-row {
    padding: 8px 10px;
    font-size: 11px;
  }
}

/* 小屏幕 (640px - 768px) */
@media (max-width: 768px) {
  .channel-column {
    border-radius: 6px;
    min-height: 300px;
    height: auto;
    max-height: 400px;
  }

  .card-header {
    padding: 8px;
    gap: 6px;
  }

  .card-title {
    font-size: 12px;
  }

  .stats-inline {
    gap: 4px;
  }

  .stat-inline-item {
    padding: 6px;
    gap: 6px;
  }

  .stat-icon-dot {
    width: 6px;
    height: 6px;
  }

  .stat-value {
    font-size: 13px;
  }

  .stat-label {
    font-size: 8px;
  }

  .logs-card {
    min-height: 150px;
  }

  .logs-table-header {
    padding: 6px 8px;
    font-size: 9px;
  }

  .log-row {
    padding: 6px 8px;
    font-size: 10px;
    min-height: 32px;
  }

  .col-token {
    font-size: 10px;
    padding: 2px 4px;
  }

  .col-time {
    font-size: 9px;
  }

  .mcp-count-tag,
  .skills-count-tag {
    font-size: 9px;
    padding: 0 6px;
    height: 18px;
    line-height: 18px;
  }

  .config-shortcut-button {
    padding: 4px 8px;
    font-size: 10px;
    gap: 4px;
  }

  .lock-button {
    width: 26px;
    height: 26px;
  }
}

/* 移动端 (< 640px) */
@media (max-width: 640px) {
  .channel-column {
    min-height: 250px;
    max-height: 350px;
  }

  .card-header {
    padding: 6px;
    gap: 4px;
    flex-wrap: wrap;
  }

  .card-title {
    font-size: 11px;
  }

  .stats-card .card-content {
    padding: 6px;
  }

  .stats-inline {
    gap: 3px;
    flex-wrap: wrap;
  }

  .stat-inline-item {
    padding: 5px;
    gap: 4px;
    min-width: calc(33% - 3px);
    flex: 1 1 auto;
  }

  .stat-icon-dot {
    width: 5px;
    height: 5px;
  }

  .stat-value {
    font-size: 12px;
  }

  .stat-label {
    font-size: 7px;
  }

  .logs-card {
    min-height: 120px;
  }

  .logs-table-header {
    padding: 5px 6px;
    font-size: 8px;
    letter-spacing: 0.3px;
  }

  .log-row {
    padding: 5px 6px;
    font-size: 9px;
    min-height: 28px;
  }

  .col-channel .n-tag {
    font-size: 9px;
    padding: 2px 6px;
  }

  .col-token {
    font-size: 9px;
    padding: 2px 3px;
    margin: 0 1px;
  }

  .col-time {
    font-size: 8px;
  }

  .claude-extra-area {
    gap: 4px;
  }

  .mcp-count-tag,
  .skills-count-tag {
    font-size: 8px;
    padding: 0 4px;
    height: 16px;
    line-height: 16px;
  }

  .config-shortcut-button {
    padding: 3px 6px;
    font-size: 9px;
    gap: 3px;
  }

  .config-shortcut-button .n-icon {
    font-size: 12px !important;
  }

  .lock-button {
    width: 24px;
    height: 24px;
    margin-left: 4px;
  }

  .lock-button .n-icon {
    font-size: 12px !important;
  }

  /* 锁定状态覆盖层适配 */
  .locked-content {
    padding: 30px 20px;
    gap: 12px;
  }

  .lock-icon {
    width: 64px;
    height: 64px;
  }

  .lock-icon .n-icon {
    font-size: 28px !important;
  }

  .lock-title {
    font-size: 14px;
  }

  .lock-subtitle {
    font-size: 10px;
  }

  .unlock-btn {
    padding: 8px 16px;
    font-size: 11px;
  }
}

/* 超小屏幕 (< 480px) */
@media (max-width: 480px) {
  .channel-column {
    min-height: 220px;
    max-height: 300px;
  }

  .card-header {
    padding: 5px;
  }

  .card-title {
    font-size: 10px;
  }

  .stats-inline {
    gap: 2px;
  }

  .stat-inline-item {
    padding: 4px;
    gap: 3px;
  }

  .stat-value {
    font-size: 11px;
  }

  .stat-label {
    font-size: 6px;
  }

  .logs-table-header {
    padding: 4px 5px;
    font-size: 7px;
  }

  .log-row {
    padding: 4px 5px;
    font-size: 8px;
    min-height: 24px;
  }

  .col-token {
    font-size: 8px;
  }

  .col-time {
    font-size: 7px;
  }
}

/* General collapse styling for cards (not logs-card) */
.card:not(.logs-card) :deep(.n-collapse) {
  background: transparent;
}

.card:not(.logs-card) :deep(.n-collapse-item) {
  background: transparent;
}

.card :deep(.n-collapse-item__header) {
  padding: 12px 16px;
  background: transparent;
  transition: all 0.3s ease;
}

.card :deep(.n-collapse-item__header:hover) {
  background: rgba(0, 0, 0, 0.02);
}

.card :deep(.n-collapse-item__header-main) {
  width: 100%;
}

.card:not(.logs-card) :deep(.n-collapse-item__content-wrapper) {
  padding: 0 16px 12px;
}

.card:not(.logs-card) :deep(.n-collapse-item__content-inner) {
  padding-top: 0;
}

/* Remove default card padding when using collapse */
.chart-card:has(.n-collapse) {
  padding: 0;
}
</style>
