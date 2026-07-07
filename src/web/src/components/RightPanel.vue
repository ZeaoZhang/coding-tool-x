<template>
  <div class="right-panel">
    <!-- 顶部工具栏：渠道独有功能 -->
    <div class="toolbar-section">
      <div class="toolbar-left">
        <n-text depth="3" class="toolbar-label">动态切换</n-text>
        <n-switch
          :value="proxyRunning"
          :loading="proxyLoading"
          :disabled="proxyLoading"
          size="small"
          @update:value="handleProxyToggle"
        />
        <n-tag v-if="managedConfigChannel && installedSkillsCount > 0" type="success" size="small" :bordered="false">
          {{ installedSkillsCount }} 技能
        </n-tag>
      </div>
      <div class="toolbar-right">
        <!-- Skills: Claude / Codex / Gemini / OpenCode / OMP 支持 -->
        <n-tooltip trigger="hover" v-if="skillsChannel">
          <template #trigger>
            <n-button text size="small" class="toolbar-btn" @click="handleShowSkills">
              <template #icon><n-icon :size="18"><ExtensionPuzzleOutline /></n-icon></template>
            </n-button>
          </template>
          Skills 技能
        </n-tooltip>
        <!-- Claude / Codex / OpenCode 共享功能 -->
        <template v-if="pluginChannel">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-button text size="small" class="toolbar-btn" @click="handleShowPlugins">
                <template #icon><n-icon :size="18"><CubeOutline /></n-icon></template>
              </n-button>
            </template>
            Plugins 插件
          </n-tooltip>
        </template>
        <template v-if="commandsChannel || agentsChannel">
          <n-tooltip v-if="commandsChannel" trigger="hover">
            <template #trigger>
              <n-button text size="small" class="toolbar-btn" @click="handleShowCommands">
                <template #icon><n-icon :size="18"><TerminalOutline /></n-icon></template>
              </n-button>
            </template>
            Commands 命令
          </n-tooltip>
          <n-tooltip v-if="agentsChannel" trigger="hover">
            <template #trigger>
              <n-button text size="small" class="toolbar-btn" @click="handleShowAgents">
                <template #icon><n-icon :size="18"><PersonOutline /></n-icon></template>
              </n-button>
            </template>
            Agents 代理
          </n-tooltip>
        </template>
        <div class="toolbar-divider" />
        <!-- 通用功能 -->
        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button text size="small" class="toolbar-btn" @click="handleShowRecent">
              <template #icon><n-icon :size="18"><ChatbubblesOutline /></n-icon></template>
            </n-button>
          </template>
          最新对话
        </n-tooltip>
      </div>
    </div>

    <!-- OAuth 控制提示 -->
    <div v-if="isOAuthControlled" class="oauth-banner">
      <n-icon :size="14" color="#2080f0"><KeyOutline /></n-icon>
      <span>{{ oauthBannerText }}</span>
      <n-button text size="small" type="primary" @click="openOAuthCredentialsDrawer">
        凭证管理 →
      </n-button>
    </div>

    <!-- 渠道管理区域 -->
    <div v-if="showChannels" class="channels-section" :class="{ 'full-height': !showLogs || !proxyRunning }">
      <div class="panel-header">
        <div class="header-title">
          <h3>{{ channelTitle }}</h3>
          <n-text depth="3" class="header-hint">启用渠道优先显示</n-text>
        </div>
        <n-button type="primary" size="small" @click="handleAddClick">
          <template #icon><n-icon><AddOutline /></n-icon></template>
          添加
        </n-button>
      </div>
      <div class="channels-scroll-area">
        <ClaudeChannelPanel v-if="currentChannel === 'claude'" ref="claudePanelRef" @open-website="openWebsite" />
        <CodexChannelPanel v-else-if="currentChannel === 'codex'" ref="codexPanelRef" @open-website="openWebsite" />
        <GeminiChannelPanel v-else-if="currentChannel === 'gemini'" ref="geminiPanelRef" @open-website="openWebsite" />
        <OpenCodeChannelPanel v-else-if="currentChannel === 'opencode'" ref="opencodePanelRef" @open-website="openWebsite" />
        <PiChannelPanel v-else-if="currentChannel === 'pi'" ref="piPanelRef" @open-website="openWebsite" />
      </div>
    </div>

    <!-- 实时日志区域 -->
    <div v-if="showLogs" class="logs-section" :class="{ 'full-height': !showChannels }">
      <ProxyLogs :source="currentChannel" />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import {
  NButton, NIcon, NText, NSwitch, NTooltip, NTag, NAlert
} from 'naive-ui'
import {
  AddOutline,
  ChatbubblesOutline,
  ExtensionPuzzleOutline,
  TerminalOutline,
  PersonOutline,
  CubeOutline,
  KeyOutline,
} from '@vicons/ionicons5'
import ClaudeChannelPanel from './channel/ClaudeChannelPanel.vue'
import CodexChannelPanel from './channel/CodexChannelPanel.vue'
import GeminiChannelPanel from './channel/GeminiChannelPanel.vue'
import OpenCodeChannelPanel from './channel/OpenCodeChannelPanel.vue'
import PiChannelPanel from './channel/PiChannelPanel.vue'
import ProxyLogs from './ProxyLogs.vue'
import { getSkills } from '../api/skills'
import { getOAuthCredentialSummaries } from '../api/oauth-credentials'

const route = useRoute()
// Props for panel visibility
const props = defineProps({
  showChannels: {
    type: Boolean,
    default: true
  },
  showLogs: {
    type: Boolean,
    default: true
  },
  proxyRunning: {
    type: Boolean,
    default: false
  },
  proxyLoading: {
    type: Boolean,
    default: false
  }
})

// Emits
const emit = defineEmits(['proxy-toggle', 'show-recent'])

// Get current channel from route
const currentChannel = computed(() => route.meta.channel || 'claude')

const claudePanelRef = ref(null)
const codexPanelRef = ref(null)
const geminiPanelRef = ref(null)
const opencodePanelRef = ref(null)
const piPanelRef = ref(null)
const installedSkillsCount = ref(0)
const oauthSummaries = ref({})
const managedConfigChannels = ['claude', 'codex', 'gemini', 'opencode', 'pi']
const pluginChannels = ['claude', 'codex', 'opencode', 'pi']
const agentChannels = ['claude', 'codex', 'gemini', 'opencode']
const managedConfigChannel = computed(() => managedConfigChannels.includes(currentChannel.value))
const skillsChannel = managedConfigChannel
const commandsChannel = managedConfigChannel
const pluginChannel = computed(() => pluginChannels.includes(currentChannel.value))
const agentsChannel = computed(() => agentChannels.includes(currentChannel.value))

// 当前渠道是否处于 OAuth 控制模式
const isOAuthControlled = computed(() => {
  const tool = currentChannel.value
  const state = oauthSummaries.value?.[tool]?.nativeState
  return !!(state?.oauthPresent && state?.mode === 'oauth')
})

const oauthBannerText = computed(() => {
  if (currentChannel.value === 'opencode') {
    return '检测到 OAuth 凭证。OpenCode 支持保留 OAuth 与 API providers 并存。'
  }
  return '当前由 OAuth 控制。写入渠道或开启动态切换时，会自动退出 OAuth 控制。'
})

async function loadOAuthSummaries() {
  try {
    const result = await getOAuthCredentialSummaries()
    oauthSummaries.value = result.tools || {}
  } catch {
    // 静默失败，不影响渠道功能
  }
}

function openOAuthCredentialsDrawer() {
  window.dispatchEvent(new CustomEvent('open-oauth-credentials-drawer'))
}

// 加载已安装技能数量
async function loadInstalledSkillsCount() {
  if (!managedConfigChannel.value) {
    installedSkillsCount.value = 0
    return
  }
  try {
    const result = await getSkills(false, currentChannel.value)
    if (result.success && result.skills) {
      installedSkillsCount.value = result.skills.filter(s => s.installed).length
    }
  } catch (err) {
    console.error('Failed to load skills count:', err)
  }
}

const channelRefs = {
  claude: claudePanelRef,
  codex: codexPanelRef,
  gemini: geminiPanelRef,
  opencode: opencodePanelRef,
  pi: piPanelRef
}

const channelTitles = {
  claude: 'Claude 渠道管理',
  codex: 'Codex 渠道管理',
  gemini: 'Gemini 渠道管理',
  opencode: 'OpenCode 渠道管理',
  pi: 'OMP 渠道管理'
}

const channelTitle = computed(() => channelTitles[currentChannel.value] || 'Claude 渠道管理')

function openWebsite(url) {
  window.open(url, '_blank')
}

function handleAddClick() {
  channelRefs[currentChannel.value]?.value?.openAddDialog?.()
}

function refreshChannelPanel(channel = currentChannel.value) {
  channelRefs[channel]?.value?.refresh?.()
}

function handleChannelManagementRefresh(event) {
  const targetChannel = event?.detail?.channel
  if (!targetChannel || targetChannel === currentChannel.value) {
    refreshChannelPanel()
  }
  loadOAuthSummaries()
}

// 处理代理切换
function handleProxyToggle(value) {
  emit('proxy-toggle', value)
}

// 处理显示最近对话
function handleShowRecent() {
  emit('show-recent')
}

// 处理显示 Skills
function blurToolbarButton(event) {
  event?.currentTarget?.blur?.()
}

function handleShowSkills(event) {
  window.dispatchEvent(new CustomEvent('open-skills-drawer', { detail: { platform: currentChannel.value } }))
  blurToolbarButton(event)
}

// 处理显示 Commands
function handleShowCommands(event) {
  window.dispatchEvent(new CustomEvent('open-commands-drawer', { detail: { platform: currentChannel.value } }))
  blurToolbarButton(event)
}

// 处理显示 Agents
function handleShowAgents(event) {
  window.dispatchEvent(new CustomEvent('open-agents-drawer', { detail: { platform: currentChannel.value } }))
  blurToolbarButton(event)
}

// 处理显示 Plugins
function handleShowPlugins(event) {
  window.dispatchEvent(new CustomEvent('open-plugins-drawer', { detail: { platform: currentChannel.value } }))
  blurToolbarButton(event)
}

onMounted(() => {
  loadInstalledSkillsCount()
  loadOAuthSummaries()
  if (typeof window !== 'undefined') {
    window.addEventListener('channel-management-refresh', handleChannelManagementRefresh)
  }
})

watch(() => currentChannel.value, () => {
  loadInstalledSkillsCount()
  loadOAuthSummaries()
})

watch(() => props.proxyRunning, () => {
  loadOAuthSummaries()
})

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('channel-management-refresh', handleChannelManagementRefresh)
  }
})
</script>

<style scoped>
/* ========== 右侧面板容器 ========== */
.right-panel {
  width: 480px;
  min-width: 480px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border-left: 1px solid var(--border-primary);
}

/* ========== 顶部工具栏 ========== */
.toolbar-section {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-primary);
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-label {
  font-size: 12px;
  margin-right: 2px;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 2px;
}

.toolbar-btn {
  --toolbar-button-text: var(--text-secondary);
  --n-text-color: var(--toolbar-button-text) !important;
  --n-text-color-hover: var(--toolbar-button-text) !important;
  --n-text-color-pressed: var(--toolbar-button-text) !important;
  --n-text-color-focus: var(--toolbar-button-text) !important;
  --n-color-hover: transparent !important;
  --n-color-pressed: transparent !important;
  --n-color-focus: transparent !important;
  padding: 5px !important;
  border-radius: 4px;
  color: var(--toolbar-button-text) !important;
  transition: transform 0.18s cubic-bezier(0.4, 0, 0.2, 1);
}

.toolbar-btn :deep(.n-button__content),
.toolbar-btn :deep(.n-button__icon) {
  color: var(--toolbar-button-text) !important;
}

.toolbar-btn:hover,
.toolbar-btn:focus,
.toolbar-btn:focus-visible,
.toolbar-btn:active {
  background: transparent;
  color: var(--toolbar-button-text) !important;
  transform: translateY(-1px);
}

.toolbar-btn:active {
  transform: translateY(0);
}

.toolbar-divider {
  width: 1px;
  height: 16px;
  background: var(--border-primary);
  margin: 0 4px;
}

/* ========== OAuth 控制 banner ========== */
.oauth-banner {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: rgba(32, 128, 240, 0.08);
  border-bottom: 1px solid rgba(32, 128, 240, 0.2);
  font-size: 12px;
  color: #2080f0;
}

.oauth-banner span {
  flex: 1;
}

/* ========== 渠道管理区域 ========== */
.channels-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.channels-section.full-height {
  flex: 1;
}

.panel-header {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-primary);
}

.header-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.header-title h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.header-hint {
  font-size: 11px;
}

.channels-scroll-area {
  flex: 1;
  min-height: 0;
  padding: 12px;
  overflow-y: auto;
}

/* ========== 日志区域 ========== */
.logs-section {
  flex: 0 0 340px;
  min-height: 340px;
  max-height: 340px;
  overflow: hidden;
}

.logs-section.full-height {
  flex: 1;
  min-height: 0;
  max-height: none;
}

/* ========== 响应式 ========== */
@media (max-width: 1024px) {
  .right-panel { width: 420px; min-width: 420px; }
  .logs-section { flex: 0 0 300px; min-height: 300px; max-height: 300px; }
}

@media (max-width: 768px) {
  .right-panel { width: 100%; min-width: 100%; }
  .toolbar-section { padding: 8px 12px; }
  .toolbar-label { font-size: 11px; }
  .logs-section { flex: 0 0 260px; min-height: 260px; max-height: 260px; }
}
</style>
