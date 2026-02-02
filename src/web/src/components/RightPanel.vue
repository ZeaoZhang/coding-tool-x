<template>
  <div class="right-panel">
    <!-- 顶部工具栏：渠道独有功能 -->
    <div class="toolbar-section">
      <div class="toolbar-left">
        <n-text depth="3" class="toolbar-label">动态切换</n-text>
        <n-switch
          :value="proxyRunning"
          :loading="proxyLoading"
          size="small"
          @update:value="handleProxyToggle"
        />
        <n-tag v-if="(currentChannel === 'claude' || currentChannel === 'codex') && installedSkillsCount > 0" type="success" size="small" :bordered="false">
          {{ installedSkillsCount }} 技能
        </n-tag>
      </div>
      <div class="toolbar-right">
        <!-- Skills: Claude 和 Codex 都支持 -->
        <n-tooltip trigger="hover" v-if="currentChannel === 'claude' || currentChannel === 'codex'">
          <template #trigger>
            <n-button text size="small" class="toolbar-btn" @click="handleShowSkills">
              <template #icon><n-icon :size="18"><ExtensionPuzzleOutline /></n-icon></template>
            </n-button>
          </template>
          Skills 技能
        </n-tooltip>
        <!-- Claude Code 特有功能 -->
        <template v-if="currentChannel === 'claude'">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-button text size="small" class="toolbar-btn" @click="handleShowPlugins">
                <template #icon><n-icon :size="18"><CubeOutline /></n-icon></template>
              </n-button>
            </template>
            Plugins 插件
          </n-tooltip>
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-button text size="small" class="toolbar-btn" @click="handleShowCommands">
                <template #icon><n-icon :size="18"><TerminalOutline /></n-icon></template>
              </n-button>
            </template>
            Commands 命令
          </n-tooltip>
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-button text size="small" class="toolbar-btn" @click="handleShowAgents">
                <template #icon><n-icon :size="18"><PersonOutline /></n-icon></template>
              </n-button>
            </template>
            Agents 代理
          </n-tooltip>
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-button text size="small" class="toolbar-btn" @click="handleShowRules">
                <template #icon><n-icon :size="18"><BookOutline /></n-icon></template>
              </n-button>
            </template>
            Rules 规则
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

    <!-- 渠道管理区域 -->
    <div v-if="showChannels" class="channels-section" :class="{ 'full-height': !showLogs || !proxyRunning }">
      <div class="panel-header">
        <div class="header-title">
          <h3>{{ channelTitle }}</h3>
          <n-text depth="3" class="header-hint">拖拽调整顺序</n-text>
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
      </div>
    </div>

    <!-- 实时日志区域 -->
    <div v-if="showLogs" class="logs-section" :class="{ 'full-height': !showChannels }">
      <ProxyLogs :source="currentChannel" />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import {
  NButton, NIcon, NText, NSwitch, NTooltip, NTag
} from 'naive-ui'
import {
  AddOutline,
  ChatbubblesOutline,
  ExtensionPuzzleOutline,
  TerminalOutline,
  PersonOutline,
  BookOutline,
  CubeOutline
} from '@vicons/ionicons5'
import ClaudeChannelPanel from './channel/ClaudeChannelPanel.vue'
import CodexChannelPanel from './channel/CodexChannelPanel.vue'
import GeminiChannelPanel from './channel/GeminiChannelPanel.vue'
import ProxyLogs from './ProxyLogs.vue'
import { getSkills } from '../api/skills'

const route = useRoute()
// Props for panel visibility
defineProps({
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
const installedSkillsCount = ref(0)

// 加载已安装技能数量
async function loadInstalledSkillsCount() {
  try {
    const result = await getSkills()
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
  gemini: geminiPanelRef
}

const channelTitles = {
  claude: 'Claude 渠道管理',
  codex: 'Codex 渠道管理',
  gemini: 'Gemini 渠道管理'
}

const channelTitle = computed(() => channelTitles[currentChannel.value] || 'Claude 渠道管理')

function openWebsite(url) {
  window.open(url, '_blank')
}

function handleAddClick() {
  channelRefs[currentChannel.value]?.value?.openAddDialog?.()
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
function handleShowSkills() {
  window.dispatchEvent(new CustomEvent('open-skills-drawer'))
}

// 处理显示 Commands
function handleShowCommands() {
  window.dispatchEvent(new CustomEvent('open-commands-drawer'))
}

// 处理显示 Agents
function handleShowAgents() {
  window.dispatchEvent(new CustomEvent('open-agents-drawer'))
}

// 处理显示 Rules
function handleShowRules() {
  window.dispatchEvent(new CustomEvent('open-rules-drawer'))
}

// 处理显示 Plugins
function handleShowPlugins() {
  window.dispatchEvent(new CustomEvent('open-plugins-drawer'))
}

onMounted(() => {
  loadInstalledSkillsCount()
})

function refreshChannel(channel) {
  channelRefs[channel]?.value?.refresh?.()
}

watch(() => currentChannel.value, refreshChannel)
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
  padding: 5px !important;
  border-radius: 4px;
  color: var(--text-secondary);
}

.toolbar-btn:hover {
  background: var(--hover-bg);
  color: var(--primary-color, #18a058);
}

.toolbar-divider {
  width: 1px;
  height: 16px;
  background: var(--border-primary);
  margin: 0 4px;
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
