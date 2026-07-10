<template>
  <div class="layout">
    <!-- 环境变量冲突弹窗 -->
    <EnvConflictModal
      v-model:visible="showEnvModal"
      :conflicts="envConflicts"
      @deleted="handleEnvDeleted"
      @close="showEnvModal = false"
      @ignore="handleEnvIgnore"
      @never-remind="handleEnvNeverRemind"
    />

    <n-modal
      :show="showPanelAccessAuth"
      preset="card"
      title="验证访问密码"
      :mask-closable="false"
      :close-on-esc="false"
      :closable="false"
      style="width: 460px; max-width: 92vw;"
    >
      <div class="panel-security-auth">
        <n-text depth="3" style="font-size: 13px;">
          请输入访问密码后进入面板
        </n-text>
        <n-input
          v-model:value="panelAccessPassword"
          type="password"
          placeholder="访问密码"
          show-password-on="click"
          autofocus
          @keydown.enter="handlePanelAccessVerify"
        />
        <n-text v-if="panelAccessError" depth="3" class="panel-security-error">
          {{ panelAccessError }}
        </n-text>
        <n-text depth="3" class="panel-security-hint">
          忘记密码可在终端执行 <n-text code>ctx security reset</n-text> 关闭密码
        </n-text>
        <n-space justify="end" style="margin-top: 16px;">
          <n-button type="primary" :loading="panelAccessVerifying" @click="handlePanelAccessVerify">
            验证
          </n-button>
        </n-space>
      </div>
    </n-modal>

    <!-- Global Header -->
    <header class="header">
      <div class="logo-section" @click="goHome">
        <div class="logo-wrapper">
          <img src="/logo.png" :alt="`${APP_NAME} logo`" class="logo-image" />
        </div>
        <div class="title-group">
          <h1 class="title-main">{{ APP_NAME }}</h1>
          <span class="title-sub">AI 编程工作台</span>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div class="nav-tabs">
        <div
          class="nav-tab"
          :class="{ active: currentRoute === 'home' }"
          @click="router.push({ name: 'home' })"
        >
          <n-icon :size="18" class="nav-icon">
            <HomeOutline />
          </n-icon>
          <span class="nav-label">Home</span>
        </div>
        <div
          class="nav-tab"
          :class="{ active: currentChannel === 'claude' }"
          @click="router.push({ name: 'claude-projects' })"
        >
          <n-icon :size="18" class="nav-icon">
            <ChatboxEllipsesOutline />
          </n-icon>
          <span class="nav-label">Claude</span>
        </div>
        <div
          class="nav-tab"
          :class="{ active: currentChannel === 'codex' }"
          @click="router.push({ name: 'codex-projects' })"
        >
          <n-icon :size="18" class="nav-icon">
            <CodeSlashOutline />
          </n-icon>
          <span class="nav-label">Codex</span>
        </div>
        <div
          class="nav-tab"
          :class="{ active: currentChannel === 'gemini' }"
          @click="router.push({ name: 'gemini-projects' })"
        >
          <n-icon :size="18" class="nav-icon">
            <SparklesOutline />
          </n-icon>
          <span class="nav-label">Gemini</span>
        </div>
        <div
          class="nav-tab"
          :class="{ active: currentChannel === 'opencode' }"
          @click="router.push({ name: 'opencode-projects' })"
        >
          <n-icon :size="18" class="nav-icon">
            <ExtensionPuzzleOutline />
          </n-icon>
          <span class="nav-label">OpenCode</span>
        </div>
        <div
          class="nav-tab"
          :class="{ active: currentChannel === 'omp' }"
          @click="router.push({ name: 'omp-projects' })"
        >
          <n-icon :size="18" class="nav-icon">
            <PlanetOutline />
          </n-icon>
          <span class="nav-label">OMP</span>
        </div>
        <div
          class="nav-tab"
          :class="{ active: currentRoute === 'analytics' }"
          @click="router.push({ name: 'analytics' })"
        >
          <n-icon :size="18" class="nav-icon">
            <StatsChartOutline />
          </n-icon>
          <span class="nav-label">Analytics</span>
        </div>
      </div>

      <div class="header-actions">
        <!-- Env Conflict Warning -->
        <n-tooltip v-if="envConflicts.length > 0" trigger="hover">
          <template #trigger>
            <div class="env-warning-btn" @click="showEnvModal = true">
              <n-icon :size="18" class="env-warning-icon">
                <WarningOutline />
              </n-icon>
              <span class="env-warning-count">{{ envConflicts.length }}</span>
            </div>
          </template>
          检测到 {{ envConflicts.length }} 个环境变量冲突，点击查看
        </n-tooltip>

        <!-- Theme Toggle -->
        <HeaderButton
          :icon="isDark ? SunnyOutline : MoonOutline"
          :tooltip="isDark ? '切换到亮色主题' : '切换到暗色主题'"
          @click="toggleTheme"
        />

        <div class="header-divider" />

        <!-- Favorites Button -->
        <div class="favorites-button-wrapper">
          <HeaderButton
            :icon="BookmarkOutline"
            :tooltip="`我的收藏 (${totalFavorites})`"
            @click="showFavoritesDrawer = true"
          />
          <div v-if="totalFavorites > 0" class="favorites-badge">
            {{ totalFavorites }}
          </div>
        </div>

        <!-- Workspace Button -->
        <HeaderButton
          :icon="FolderOpenOutline"
          tooltip="工作区管理"
          @click="showWorkspaceDrawer = true"
        />

        <!-- Prompts Button -->
        <HeaderButton
          :icon="ChatboxOutline"
          tooltip="Prompts 管理"
          @click="showPromptsDrawer = true"
        />

        <!-- MCP Button -->
        <HeaderButton
          :icon="ServerOutline"
          tooltip="MCP 服务器管理"
          @click="showMcpDrawer = true"
        />


        <HeaderButton
          :icon="SettingsOutline"
          tooltip="设置"
          @click="showSettingsDrawer = true"
        />
        <n-dropdown trigger="click" placement="bottom-end" :options="moreMenuOptions" @select="handleMoreMenuSelect">
          <div class="more-menu-trigger" aria-label="更多工具">
            <HeaderButton :icon="EllipsisHorizontal" tooltip="更多工具" />
          </div>
        </n-dropdown>
      </div>
    </header>

    <div class="main-container">
      <!-- Global Loading Overlay -->
      <div v-if="globalLoading" class="global-loading-overlay">
        <n-spin size="large">
          <template #description>
            加载配置中...
          </template>
        </n-spin>
      </div>

      <!-- Left Content Area (Router View) -->
      <div class="left-content">
        <router-view v-slot="{ Component }">
          <component :is="Component" :key="routeViewKey" />
        </router-view>
      </div>

      <!-- Right Panel (Global) - Only show if not on home page and at least one panel is enabled -->
      <!-- 首页不显示过渡动画，避免页面从窄变宽的卡顿感 -->
      <RightPanel
        v-if="shouldShowRightPanel"
        :show-channels="showChannels"
        :show-logs="showLogs"
        :proxy-running="effectiveProxyRunning"
        :proxy-loading="effectiveProxyLoading"
        @proxy-toggle="handleProxyToggle"
        @show-recent="showRecentDrawer = true"
      />
    </div>

    <!-- Recent Sessions Drawer -->
    <RecentSessionsDrawer v-model:visible="showRecentDrawer" :channel="currentChannel" />

    <!-- Favorites Drawer -->
    <FavoritesDrawer v-model:visible="showFavoritesDrawer" @view-history="handleViewHistoryFromFavorites" />

    <!-- Chat History Drawer -->
    <ChatHistoryDrawer
      ref="chatHistoryRef"
      v-if="chatHistorySession"
      v-model:show="showChatHistory"
      :project-name="chatHistorySession.projectName"
      :session-id="chatHistorySession.sessionId"
      :session-alias="chatHistorySession.alias"
      :channel="chatHistoryChannel"
    />

    <!-- Settings Drawer -->
    <SettingsDrawer v-model:visible="showSettingsDrawer" />

    <!-- MCP Drawer -->
    <McpDrawer v-model:visible="showMcpDrawer" />

    <!-- Prompts Drawer -->
    <PromptsDrawer v-model:visible="showPromptsDrawer" />

    <!-- Speed Test Drawer -->
    <SpeedTestDrawer v-model:visible="showSpeedTestDrawer" />

    <!-- OpenCode Gateway Convert Drawer -->
    <GatewayConvertDrawer
      v-if="currentChannel === 'opencode'"
      v-model:visible="showGatewayConvertDrawer"
    />

    <!-- Workspace Drawer -->
    <WorkspaceDrawer v-model:visible="showWorkspaceDrawer" />

    <!-- Config Templates Drawer -->
    <ConfigTemplatesDrawer v-model:visible="showConfigTemplatesDrawer" />

    <!-- Config Export/Import Drawer -->
    <ConfigExportDrawer v-model:visible="showConfigExportDrawer" />

    <!-- OAuth Credentials Drawer -->
    <OAuthCredentialsDrawer v-model:visible="showOAuthCredentialsDrawer" />

    <!-- Skills/Commands/Agents Drawers -->
    <SkillsDrawer v-model:visible="showSkillsDrawer" :platform="skillsDrawerPlatform" />
    <CommandsDrawer v-model:visible="showCommandsDrawer" :platform="commandsDrawerPlatform" />
    <AgentsDrawer v-model:visible="showAgentsDrawer" :platform="agentsDrawerPlatform" />
    <PluginsDrawer v-model:visible="showPluginsDrawer" :platform="pluginsDrawerPlatform" />

    <!-- Help Modal -->
    <n-modal v-model:show="showHelpModal" preset="card" :title="`${APP_NAME} 使用帮助`" style="width: 800px; max-width: 90vw;">
      <div class="help-content">
        <div class="help-section">
          <h4>[START] 快速开始</h4>
          <p>{{ APP_NAME }} 是面向 Claude Code、Codex、Gemini 和 OpenCode 的统一 AI 编程工作台，提供会话管理、动态渠道切换、全局搜索与实时监控能力。</p>

          <h5 style="margin: 12px 0 8px 0; font-size: 13px; color: #18a058;">[STAR] 最简单的启动方式：</h5>
          <div style="background: var(--bg-primary); padding: 12px; border-radius: 6px; margin: 8px 0; border-left: 3px solid #18a058;">
            <p style="margin: 0; font-family: 'Courier New', monospace; font-size: 13px; font-weight: 600; color: var(--primary-color);">ctx start</p>
            <p style="margin: 4px 0 0 0; font-size: 12px; color: var(--text-secondary);">• 后台启动所有服务<br/>• 可以关闭终端窗口<br/>• 代理服务保持运行</p>
          </div>

          <h5 style="margin: 12px 0 8px 0; font-size: 13px; color: #18a058;">[LOG] 日常工作流：</h5>
          <div style="font-size: 12px; line-height: 1.8; color: var(--text-secondary);">
            <code style="background: var(--bg-primary); padding: 2px 6px; border-radius: 3px; color: var(--primary-color);">ctx start</code> 启动服务<br/>
            <code style="background: var(--bg-primary); padding: 2px 6px; border-radius: 3px; color: var(--primary-color);">ctx status</code> 查看状态<br/>
            <code style="background: var(--bg-primary); padding: 2px 6px; border-radius: 3px; color: var(--primary-color);">ctx logs</code> 查看日志<br/>
            <code style="background: var(--bg-primary); padding: 2px 6px; border-radius: 3px; color: var(--primary-color);">ctx stop</code> 停止服务
          </div>
        </div>

        <div class="help-section">
          <h4>[AI] 支持的 AI 工具</h4>
          <ul>
            <li><strong>Claude Code</strong>：Anthropic 官方命令行工具，支持 Claude 系列模型</li>
            <li><strong>Codex</strong>：支持 OpenAI GPT 系列和 Claude 模型（通过 OpenAI 兼容格式）</li>
            <li><strong>Gemini</strong>：支持 Google Gemini 系列模型</li>
          </ul>
        </div>

        <div class="help-section">
          <h4>[LOG] 命令行用法</h4>

          <h5 style="margin: 16px 0 8px 0; font-size: 14px; color: var(--primary-color);">[START] 服务管理</h5>
          <div class="command-list">
            <div class="command-item">
              <code>ctx start</code>
              <span>后台启动所有服务（推荐）</span>
            </div>
            <div class="command-item">
              <code>ctx stop</code>
              <span>停止所有服务</span>
            </div>
            <div class="command-item">
              <code>ctx restart</code>
              <span>重启所有服务</span>
            </div>
            <div class="command-item">
              <code>ctx status</code>
              <span>查看服务状态</span>
            </div>
          </div>

          <h5 style="margin: 16px 0 8px 0; font-size: 14px; color: var(--primary-color);">[PROXY] 代理管理</h5>
          <div class="command-list">
            <div class="command-item">
              <code>ctx claude start</code>
              <span>启动 Claude 代理</span>
            </div>
            <div class="command-item">
              <code>ctx codex start</code>
              <span>启动 Codex 代理</span>
            </div>
            <div class="command-item">
              <code>ctx gemini start</code>
              <span>启动 Gemini 代理</span>
            </div>
            <div class="command-item">
              <code>ctx claude stop</code>
              <span>停止指定代理（支持 stop/restart/status）</span>
            </div>
          </div>

          <h5 style="margin: 16px 0 8px 0; font-size: 14px; color: var(--primary-color);">[LOG] 日志管理</h5>
          <div class="command-list">
            <div class="command-item">
              <code>ctx logs</code>
              <span>查看所有日志</span>
            </div>
            <div class="command-item">
              <code>ctx logs claude</code>
              <span>查看 Claude 日志（支持 ui/codex/gemini）</span>
            </div>
            <div class="command-item">
              <code>ctx logs --follow</code>
              <span>实时跟踪日志</span>
            </div>
            <div class="command-item">
              <code>ctx logs --clear</code>
              <span>清空日志</span>
            </div>
          </div>

          <h5 style="margin: 16px 0 8px 0; font-size: 14px; color: var(--primary-color);">[STATS] 其他命令</h5>
          <div class="command-list">
            <div class="command-item">
              <code>ctx stats</code>
              <span>查看统计信息</span>
            </div>
            <div class="command-item">
              <code>ctx doctor</code>
              <span>系统诊断</span>
            </div>
            <div class="command-item">
              <code>ctx -h</code>
              <span>完整帮助</span>
            </div>
          </div>
        </div>

        <div class="help-section">
          <h4>[TARGET] Web UI 功能</h4>
          <ul>
            <li><strong>多类型支持</strong>：统一管理 Claude Code、Codex、Gemini 三种工具的项目和会话</li>
            <li><strong>项目管理</strong>：查看所有项目，支持拖拽排序、搜索过滤、删除项目</li>
            <li><strong>会话管理</strong>：查看项目会话列表，支持搜索、Fork、删除、重命名</li>
            <li><strong>快速启动</strong>：点击会话可直接复制对应 AI 工具启动命令</li>
            <li><strong>动态切换</strong>：每种工具独立的渠道管理，可在右侧面板快速切换 API 渠道</li>
            <li><strong>实时日志</strong>：查看各类型代理的实时请求日志、token 消耗和成本统计</li>
            <li><strong>全局搜索</strong>：使用 <kbd>Cmd/Ctrl</kbd> + <kbd>K</kbd> 在所有项目中搜索对话内容</li>
          </ul>
        </div>

        <div class="help-section">
          <h4>[BOLT] 代理服务与渠道管理</h4>
          <p>每种 AI 工具都有独立的代理服务和渠道配置：</p>
          <ul>
            <li><strong>Claude 代理</strong>：端口 20088，支持 Anthropic API 格式</li>
            <li><strong>Codex 代理</strong>：端口 20089，支持 OpenAI API 格式（兼容 Claude）</li>
            <li><strong>Gemini 代理</strong>：端口 20090，支持 Gemini API 格式</li>
          </ul>
          <p>在 Dashboard 或各工具详情页，可以添加多个渠道并快速切换，无需修改配置文件或重启工具。</p>
        </div>

        <div class="help-section">
          <h4>[STAR] 后台启动与开机自启</h4>

          <h5 style="margin: 12px 0 8px 0; font-size: 13px; color: #18a058;">后台启动服务</h5>
          <p style="font-size: 12px; line-height: 1.8;">使用 <code style="background: var(--bg-primary); padding: 2px 6px;">ctx start</code> 命令后台启动所有服务，可以安全关闭终端窗口而不影响代理服务的运行。</p>

          <h5 style="margin: 12px 0 8px 0; font-size: 13px; color: #18a058;">配置开机自启（可选）</h5>
          <p style="font-size: 12px; color: var(--text-secondary); margin: 0 0 8px 0;">第一次启用开机自启只需三个步骤：</p>
          <div style="background: var(--bg-primary); padding: 12px; border-radius: 6px; margin: 8px 0; border-left: 3px solid #18a058; font-family: 'Courier New', monospace; font-size: 11px; line-height: 1.8; color: var(--text-secondary);">
            # 第 1 步：启用 PM2 开机自启<br/>
            <span style="color: var(--primary-color);">pm2 startup</span><br/>
            <br/>
            # 第 2 步：保存配置<br/>
            <span style="color: var(--primary-color);">pm2 save</span><br/>
            <br/>
            # 第 3 步：重启电脑，服务自动启动 [v]
          </div>

          <h5 style="margin: 12px 0 8px 0; font-size: 13px; color: #18a058;">相关命令</h5>
          <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.8;">
            <code style="background: var(--bg-primary); padding: 2px 6px;">ctx start</code> 后台启动<br/>
            <code style="background: var(--bg-primary); padding: 2px 6px;">ctx status</code> 查看状态<br/>
            <code style="background: var(--bg-primary); padding: 2px 6px;">ctx logs</code> 查看日志<br/>
            <code style="background: var(--bg-primary); padding: 2px 6px;">pm2 list</code> 查看所有后台进程<br/>
            <code style="background: var(--bg-primary); padding: 2px 6px;">pm2 unstartup</code> 禁用开机自启
          </div>

          <p style="color: #18a058; font-size: 12px; margin-top: 8px;">[TIP] 提示：配置开机自启后，重启电脑时 {{ APP_NAME }} 会自动启动，无需手动运行命令。</p>
        </div>

        <div class="help-section">
          <h4>[LINK] 相关链接</h4>
          <div class="link-list">
            <a href="https://github.com/ZeaoZhang/coding-tool" target="_blank">GitHub 仓库</a>
            <a href="https://github.com/ZeaoZhang/coding-tool/issues" target="_blank">问题反馈</a>
          </div>
        </div>
      </div>
    </n-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { NTooltip, NSwitch, NSpin, NModal, NIcon, NText, NInput, NButton, NSpace, NDropdown } from 'naive-ui'
import { ChatbubblesOutline, ServerOutline, MoonOutline, SunnyOutline, SettingsOutline, HomeOutline, ChatboxEllipsesOutline, CodeSlashOutline, SparklesOutline, BookmarkOutline, ChatboxOutline, WarningOutline, FolderOpenOutline, ExtensionPuzzleOutline, PlanetOutline, StatsChartOutline, EllipsisHorizontal } from '@vicons/ionicons5'
import RightPanel from './RightPanel.vue'
import RecentSessionsDrawer from './RecentSessionsDrawer.vue'
import FavoritesDrawer from './FavoritesDrawer.vue'
import ChatHistoryDrawer from './ChatHistoryDrawer.vue'
import SettingsDrawer from './SettingsDrawer.vue'
import McpDrawer from './McpDrawer.vue'
import PromptsDrawer from './PromptsDrawer.vue'
import SpeedTestDrawer from './SpeedTestDrawer.vue'
import GatewayConvertDrawer from './GatewayConvertDrawer.vue'
import SkillsDrawer from './SkillsDrawer.vue'
import CommandsDrawer from './CommandsDrawer.vue'
import AgentsDrawer from './AgentsDrawer.vue'
import PluginsDrawer from './PluginsDrawer.vue'
import WorkspaceDrawer from './WorkspaceDrawer.vue'
import ConfigTemplatesDrawer from './ConfigTemplatesDrawer.vue'
import ConfigExportDrawer from './ConfigExportDrawer.vue'
import OAuthCredentialsDrawer from './OAuthCredentialsDrawer.vue'
import HeaderButton from './HeaderButton.vue'
import EnvConflictModal from './EnvConflictModal.vue'
import { updateNestedUIConfig } from '../api/ui-config'
import { checkEnvConflicts } from '../api/env'
import { getSecurityStatus, verifySecurityPassword } from '../api/security'
import message from '../utils/message'
import { useTheme } from '../composables/useTheme'
import { useGlobalState } from '../composables/useGlobalState'
import { useFavorites } from '../composables/useFavorites'
import { useDashboard } from '../composables/useDashboard'

// 使用主题 composable
const { isDark, toggleTheme } = useTheme()

// 使用全局状态 composable
const {
  claudeProxy,
  codexProxy,
  geminiProxy,
  opencodeProxy,
  ompProxy,
  startProxy,
  stopProxy
} = useGlobalState()

// 使用收藏功能
const { totalFavorites } = useFavorites()

// 使用 dashboard 聚合数据
const { dashboardData, isLoading: dashboardLoading, loadDashboard } = useDashboard()

const router = useRouter()
const route = useRoute()
const APP_NAME = 'coding-tool-x'

const moreMenuOptions = [
  { label: '配置模板', key: 'config-templates' },
  { label: '配置导入/导出', key: 'config-export' },
  { label: 'OAuth 凭证', key: 'oauth' },
  { label: '渠道速度测试', key: 'speed-test' },
  { type: 'divider', key: 'divider-1' },
  { label: '使用帮助', key: 'help' },
  { label: 'GitHub 仓库', key: 'github' }
]

// 导航状态
const currentRoute = computed(() => route.name)
const currentChannel = computed(() => route.meta.channel || null)
const routeViewKey = computed(() => route.path)

// 切换到渠道页时关闭 OAuth 凭证抽屉
watch(currentChannel, (val) => {
  if (val) {
    showOAuthCredentialsDrawer.value = false
  }
})

// 是否显示右侧面板（首页不显示）
const shouldShowRightPanel = computed(() => {
  return currentChannel.value && (showChannels.value || (showLogs.value && effectiveProxyRunning.value))
})

const showRecentDrawer = ref(false)
const showFavoritesDrawer = ref(false)
const showSettingsDrawer = ref(false)
const showMcpDrawer = ref(false)
const showPromptsDrawer = ref(false)
const showSpeedTestDrawer = ref(false)
const showGatewayConvertDrawer = ref(false)
const showHelpModal = ref(false)
const showWorkspaceDrawer = ref(false)
const showConfigTemplatesDrawer = ref(false)
const showConfigExportDrawer = ref(false)
const showOAuthCredentialsDrawer = ref(false)
const showSkillsDrawer = ref(false)
const skillsDrawerPlatform = ref('')
const showCommandsDrawer = ref(false)
const commandsDrawerPlatform = ref('')
const showAgentsDrawer = ref(false)
const agentsDrawerPlatform = ref('')
const showPluginsDrawer = ref(false)
const pluginsDrawerPlatform = ref('')

// Chat history drawer state
const showChatHistory = ref(false)
const chatHistorySession = ref(null)
const chatHistoryChannel = ref(null)
const chatHistoryRef = ref(null)

// 环境变量冲突检测
const envConflicts = ref([])
const showEnvModal = ref(false)
const panelAccessRequired = ref(false)
const panelAccessVerified = ref(false)
const panelAccessPassword = ref('')
const panelAccessError = ref('')
const panelAccessVerifying = ref(false)
const showPanelAccessAuth = computed(() => panelAccessRequired.value && !panelAccessVerified.value)

function resetPanelAccessForm() {
  panelAccessPassword.value = ''
  panelAccessError.value = ''
  panelAccessVerifying.value = false
}

async function loadPanelAccessStatus() {
  globalLoading.value = true
  try {
    const response = await getSecurityStatus()
    panelAccessRequired.value = Boolean(response?.success && response.hasPassword)
    panelAccessVerified.value = !panelAccessRequired.value
    if (!panelAccessRequired.value) {
      resetPanelAccessForm()
    }
  } catch (err) {
    console.error('Failed to load security status:', err)
    panelAccessRequired.value = false
    panelAccessVerified.value = true
    resetPanelAccessForm()
  } finally {
    globalLoading.value = false
  }
}

async function handlePanelAccessVerify() {
  if (!panelAccessPassword.value) {
    panelAccessError.value = '请输入密码'
    return
  }

  panelAccessVerifying.value = true
  panelAccessError.value = ''
  try {
    const response = await verifySecurityPassword(panelAccessPassword.value)
    if (response.success) {
      panelAccessVerified.value = true
      resetPanelAccessForm()
    } else {
      panelAccessError.value = response.error || '密码错误'
    }
  } catch (error) {
    panelAccessError.value = error.response?.data?.error || '密码错误'
  } finally {
    panelAccessVerifying.value = false
  }
}

// 检测环境变量冲突
async function checkEnvConflictsOnLoad() {
  try {
    const result = await checkEnvConflicts()
    if (result.success && result.conflicts?.length > 0) {
      envConflicts.value = result.conflicts

      // 检查是否用户选择了"不再提醒"，如果没有则自动弹出
      const neverRemind = localStorage.getItem('envConflictNeverRemind')
      if (neverRemind !== 'true') {
        showEnvModal.value = true
      }
    }
  } catch (err) {
    console.error('Check env conflicts failed:', err)
  }
}

// 处理删除后
async function handleEnvDeleted() {
  try {
    const result = await checkEnvConflicts()
    if (result.success) {
      envConflicts.value = result.conflicts || []
      if (envConflicts.value.length === 0) {
        showEnvModal.value = false
      }
    }
  } catch (err) {
    console.error('Recheck env conflicts failed:', err)
  }
}

// 暂时忽略
function handleEnvIgnore() {
  showEnvModal.value = false
}

// 不再提醒（只是不自动弹出，顶部图标还在）
function handleEnvNeverRemind() {
  showEnvModal.value = false
  localStorage.setItem('envConflictNeverRemind', 'true')
}
const globalLoading = ref(false) // 全局 loading 状态

// 根据当前 channel 计算有效的代理状态
const effectiveProxyRunning = computed(() => {
  if (currentChannel.value === 'codex') return codexProxy.value.running
  if (currentChannel.value === 'gemini') return geminiProxy.value.running
  if (currentChannel.value === 'opencode') return opencodeProxy.value.running
  if (currentChannel.value === 'omp') return ompProxy.value.running
  return claudeProxy.value.running
})
const effectiveProxyLoading = computed(() => {
  if (currentChannel.value === 'codex') return codexProxy.value.loading
  if (currentChannel.value === 'gemini') return geminiProxy.value.loading
  if (currentChannel.value === 'opencode') return opencodeProxy.value.loading
  if (currentChannel.value === 'omp') return ompProxy.value.loading
  return claudeProxy.value.loading
})

function getCurrentProxyState(channelType = currentChannel.value) {
  if (channelType === 'codex') return codexProxy
  if (channelType === 'gemini') return geminiProxy
  if (channelType === 'opencode') return opencodeProxy
  if (channelType === 'omp') return ompProxy
  return claudeProxy
}

// Panel visibility settings (with file persistence)
const showChannels = ref(true)
const showLogs = ref(true)

// Load panel visibility from server using dashboard API
async function loadPanelSettings() {
  try {
    const data = await loadDashboard()
    if (data && data.uiConfig) {
      showChannels.value = data.uiConfig.panelVisibility?.showChannels !== false
      showLogs.value = data.uiConfig.panelVisibility?.showLogs !== false
    }
  } catch (err) {
    console.error('Failed to load dashboard data:', err)
  }
}

// Save panel visibility to server
async function savePanelSettings() {
  try {
    await updateNestedUIConfig('panelVisibility', 'showChannels', showChannels.value)
    await updateNestedUIConfig('panelVisibility', 'showLogs', showLogs.value)
  } catch (err) {
    console.error('Failed to save panel settings:', err)
  }
}

// Toggle handlers
function toggleChannels() {
  showChannels.value = !showChannels.value
  savePanelSettings()
}

function toggleLogs() {
  showLogs.value = !showLogs.value
  savePanelSettings()
}

function goHome() {
  router.push({ name: 'home' })
}

function openGithub() {
  window.open('https://github.com/ZeaoZhang/coding-tool', '_blank')
}

function handleMoreMenuSelect(key) {
  if (key === 'config-templates') {
    showConfigTemplatesDrawer.value = true
    return
  }
  if (key === 'config-export') {
    showConfigExportDrawer.value = true
    return
  }
  if (key === 'oauth') {
    showOAuthCredentialsDrawer.value = true
    return
  }
  if (key === 'speed-test') {
    showSpeedTestDrawer.value = true
    return
  }
  if (key === 'help') {
    showHelpModal.value = true
    return
  }
  if (key === 'github') {
    openGithub()
  }
}

// 统一的代理切换处理器（根据当前 channel 路由到正确的代理）
async function handleProxyToggle(newValue) {
  const channelType = currentChannel.value || 'claude'
  const proxyState = getCurrentProxyState(channelType)
  proxyState.value.loading = true

  try {
    let result
    if (newValue) {
      result = await startProxy(channelType)
    } else {
      result = await stopProxy(channelType, { refreshChannelsDrawer: true })
    }

    // 处理结果
    if (result.success !== false) {
      message.success(newValue ? '代理已启动' : '代理已停止')
      // 自动展示/隐藏日志面板
      if (newValue) {
        showLogs.value = true
      }
      savePanelSettings()
    } else {
      message.error(result.error || '操作失败')
    }
  } catch (error) {
    message.error(error.response?.data?.error || error.message || '操作失败')
  } finally {
    proxyState.value.loading = false
  }
}

// 监听来自 SettingsDrawer 的面板可见性变化
function handlePanelVisibilityChange(event) {
  const { showChannels: newShowChannels, showLogs: newShowLogs } = event.detail
  showChannels.value = newShowChannels
  showLogs.value = newShowLogs
}

onMounted(() => {
  loadPanelAccessStatus()

  // 加载面板可见性设置
  loadPanelSettings()

  // 监听面板可见性变化事件
  window.addEventListener('panel-visibility-change', handlePanelVisibilityChange)

  window.addEventListener('open-skills-drawer', openSkillsDrawer)
  window.addEventListener('open-commands-drawer', openCommandsDrawer)
  window.addEventListener('open-agents-drawer', openAgentsDrawer)
  window.addEventListener('open-plugins-drawer', openPluginsDrawer)
  window.addEventListener('open-gateway-convert-drawer', openGatewayConvertDrawer)
  window.addEventListener('open-oauth-credentials-drawer', openOAuthCredentialsDrawer)

  // 检测环境变量冲突
  checkEnvConflictsOnLoad()
})

onUnmounted(() => {
  // 移除事件监听
  window.removeEventListener('panel-visibility-change', handlePanelVisibilityChange)
  window.removeEventListener('open-skills-drawer', openSkillsDrawer)
  window.removeEventListener('open-commands-drawer', openCommandsDrawer)
  window.removeEventListener('open-agents-drawer', openAgentsDrawer)
  window.removeEventListener('open-plugins-drawer', openPluginsDrawer)
  window.removeEventListener('open-gateway-convert-drawer', openGatewayConvertDrawer)
  window.removeEventListener('open-oauth-credentials-drawer', openOAuthCredentialsDrawer)
})

function openSkillsDrawer(event) {
  skillsDrawerPlatform.value = event?.detail?.platform || ''
  showSkillsDrawer.value = true
}

function openOAuthCredentialsDrawer(event) {
  showOAuthCredentialsDrawer.value = true
}

function openCommandsDrawer(event) {
  commandsDrawerPlatform.value = event?.detail?.platform || ''
  showCommandsDrawer.value = true
}

function openAgentsDrawer(event) {
  agentsDrawerPlatform.value = event?.detail?.platform || ''
  showAgentsDrawer.value = true
}

function openPluginsDrawer(event) {
  pluginsDrawerPlatform.value = event?.detail?.platform || ''
  showPluginsDrawer.value = true
}

function openGatewayConvertDrawer() {
  if (currentChannel.value !== 'opencode') {
    return
  }
  showGatewayConvertDrawer.value = true
}

watch(() => currentChannel.value, (channel) => {
  if (channel !== 'opencode' && showGatewayConvertDrawer.value) {
    showGatewayConvertDrawer.value = false
  }
})

// Handle view history from favorites
function handleViewHistoryFromFavorites({ session, channel }) {
  chatHistorySession.value = session
  chatHistoryChannel.value = channel
  showChatHistory.value = true
  nextTick(() => {
    chatHistoryRef.value?.open()
  })
}
</script>

<style scoped>
/* ========== 基础布局 ========== */
.layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg-primary);
}

/* ========== 顶部导航栏 ========== */
.header {
  height: 74px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 22px;
  background: var(--gradient-header);
  border-bottom: 1px solid var(--border-primary);
  flex-shrink: 0;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.34) inset;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-primary) 82%, transparent);
  border: 1px solid var(--border-primary);
  box-shadow: 0 14px 34px rgba(15, 23, 29, 0.08);
}

.more-menu-trigger {
  display: flex;
}

.header-divider {
  width: 1px;
  height: 24px;
  background: rgba(149, 167, 175, 0.35);
  margin: 0 2px;
}

/* 环境变量警告 */
.env-warning-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: rgba(245, 158, 11, 0.1);
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
}

.env-warning-btn:hover {
  background: rgba(245, 158, 11, 0.18);
}

.env-warning-icon {
  color: #f59e0b;
}

.env-warning-count {
  font-size: 11px;
  font-weight: 600;
  color: #f59e0b;
}

/* ========== Logo 区域 ========== */
.logo-section {
  display: flex;
  align-items: center;
  gap: 14px;
  cursor: pointer;
  padding: 8px 14px;
  border-radius: 18px;
  margin-left: -8px;
  transition: background 0.2s;
}

.logo-section:hover {
  background: var(--hover-bg);
}

.logo-wrapper {
  width: 40px;
  height: 40px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(24, 160, 88, 0.18), rgba(24, 160, 88, 0.05));
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 10px 24px rgba(15, 23, 29, 0.08);
}

.logo-image {
  width: 22px;
  height: 22px;
  object-fit: contain;
}

.title-group {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.title-main {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--brand-title-color);
  line-height: 1.2;
}

.title-sub {
  font-size: 11px;
  color: var(--text-tertiary);
}

/* ========== 导航标签 ========== */
.nav-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 28px;
  padding: 6px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-primary) 86%, transparent);
  border: 1px solid var(--border-primary);
  box-shadow: 0 14px 36px rgba(15, 23, 29, 0.08);
}

.nav-tab {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 14px;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.2s;
  position: relative;
}

.nav-tab:hover {
  background: var(--hover-bg);
}

.nav-tab.active {
  background: var(--primary-color-soft);
}

.nav-tab.active::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  border: 1px solid rgba(24, 160, 88, 0.22);
  background: transparent;
}

.nav-icon {
  color: var(--text-tertiary);
}

.nav-tab:hover .nav-icon,
.nav-tab.active .nav-icon {
  color: var(--primary-color, #18a058);
}

.nav-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

.nav-tab:hover .nav-label,
.nav-tab.active .nav-label {
  color: var(--primary-color, #18a058);
}

.nav-tab.active .nav-label {
  font-weight: 600;
}

/* ========== 主容器 ========== */
.main-container {
  display: flex;
  flex: 1;
  height: calc(100vh - 74px);
  min-height: 0;
  overflow: hidden;
}

.global-loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  background: var(--bg-overlay);
  z-index: 1000;
}

.left-content {
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow: hidden;
}

/* ========== 收藏按钮 ========== */
.favorites-button-wrapper {
  position: relative;
}

.favorites-badge {
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ff4d4f;
  color: white;
  font-size: 9px;
  font-weight: 600;
  border-radius: 7px;
  pointer-events: none;
}

/* ========== 帮助弹窗 ========== */
.help-content {
  max-height: 70vh;
  overflow-y: auto;
}

.help-section {
  margin-bottom: 20px;
  padding: 16px;
  background: var(--bg-secondary);
  border-radius: 8px;
  border: 1px solid var(--border-primary);
}

.help-section:last-child {
  margin-bottom: 0;
}

.help-section h4 {
  margin: 0 0 12px 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-primary);
}

.help-section p {
  margin: 0 0 10px 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-secondary);
}

.help-section ul {
  margin: 8px 0 0 0;
  padding-left: 20px;
}

.help-section li {
  font-size: 13px;
  line-height: 1.8;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.help-section li strong {
  color: var(--primary-color, #18a058);
}

.command-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.command-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 6px;
}

.command-item code {
  min-width: 140px;
  font-family: monospace;
  font-size: 12px;
  font-weight: 600;
  color: var(--primary-color, #18a058);
  background: rgba(24, 160, 88, 0.1);
  padding: 4px 10px;
  border-radius: 4px;
}

.command-item span {
  font-size: 13px;
  color: var(--text-secondary);
}

.help-section kbd {
  display: inline-block;
  padding: 2px 6px;
  font-family: monospace;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 3px;
  margin: 0 2px;
}

.link-list {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.link-list a {
  font-size: 13px;
  color: var(--primary-color, #18a058);
  text-decoration: none;
  padding: 6px 10px;
  border-radius: 4px;
  background: rgba(24, 160, 88, 0.08);
}

.link-list a:hover {
  background: rgba(24, 160, 88, 0.15);
}

.panel-security-auth {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel-security-error {
  font-size: 12px;
  color: #d03050;
}

.panel-security-hint {
  font-size: 12px;
  line-height: 1.6;
}

/* ========== 响应式样式 ========== */
.header-actions,
.nav-tabs {
  backdrop-filter: blur(14px);
}

[data-theme="dark"] .header {
  border-bottom-color: rgba(43, 66, 74, 0.92);
  box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.03);
}

[data-theme="dark"] .header-actions,
[data-theme="dark"] .nav-tabs {
  background: rgba(12, 21, 27, 0.86);
  border-color: rgba(54, 76, 86, 0.9);
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.26);
}

[data-theme="dark"] .logo-section:hover {
  background: rgba(255, 255, 255, 0.05);
}

@media (max-width: 1024px) {
  .header { height: 68px; padding: 10px 16px; }
  .main-container { height: calc(100vh - 68px); }
  .nav-tabs { margin-left: 16px; padding: 5px 6px; }
  .title-sub { display: none; }
}

@media (max-width: 768px) {
  .header { height: 60px; padding: 8px 12px; }
  .main-container { height: calc(100vh - 60px); }
  .logo-wrapper { width: 28px; height: 28px; }
  .logo-image { width: 18px; height: 18px; }
  .title-main { font-size: 14px; }
  .title-sub { display: none; }
  .nav-tabs { margin-left: 10px; gap: 2px; padding: 4px 5px; }
  .nav-tab { padding: 6px 10px; gap: 4px; }
  .nav-label { font-size: 12px; }
  .header-actions { gap: 2px; }
}

@media (max-width: 640px) {
  .header { height: 54px; padding: 6px 8px; }
  .main-container { height: calc(100vh - 54px); }
  .title-group { display: none; }
  .nav-tabs { margin-left: 8px; flex: 1; justify-content: center; }
  .nav-tab { padding: 4px 6px; flex-direction: column; gap: 2px; }
  .nav-label { font-size: 10px; }
}
</style>
