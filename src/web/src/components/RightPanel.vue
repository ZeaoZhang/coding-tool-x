<template>
  <div class="right-panel">
    <!-- 上半部分：API 渠道管理 -->
    <div v-if="showChannels" class="channels-section" :class="{ 'full-height': !showLogs || !proxyRunning }">
      <!-- 动作按钮区域 -->
      <div class="actions-section">
        <div class="action-buttons">
          <!-- 左侧：代理切换 + 已安装技能数 -->
          <div class="action-left">
            <div class="action-item">
              <n-text depth="3" style="font-size: 13px; margin-right: 8px;">动态切换</n-text>
              <n-switch
                :value="proxyRunning"
                :loading="proxyLoading"
                size="small"
                @update:value="handleProxyToggle"
              />
            </div>
            <n-tag v-if="installedSkillsCount > 0" type="success" size="small" :bordered="false" class="skills-count-tag">
              已安装 {{ installedSkillsCount }} 个技能
            </n-tag>
          </div>

          <!-- 右侧：图标按钮 -->
          <div class="action-right">
            <!-- Skills 技能 -->
            <n-tooltip trigger="hover">
              <template #trigger>
                <n-button
                  text
                  size="small"
                  @click="handleShowSkills"
                  class="recent-sessions-icon-btn"
                >
                  <template #icon>
                    <n-icon :size="18"><ExtensionPuzzleOutline /></n-icon>
                  </template>
                </n-button>
              </template>
              Skills 技能
            </n-tooltip>

            <!-- 最近对话 -->
            <n-tooltip trigger="hover">
              <template #trigger>
                <n-button
                  text
                  size="small"
                  @click="handleShowRecent"
                  class="recent-sessions-icon-btn"
                >
                  <template #icon>
                    <n-icon :size="18"><ChatbubblesOutline /></n-icon>
                  </template>
                </n-button>
              </template>
              最新对话
            </n-tooltip>
          </div>
        </div>
      </div>

      <!-- 固定的标题栏 -->
      <div class="panel-header">
        <div class="header-title">
          <h3>{{ channelTitle }}</h3>
          <n-text depth="3" style="font-size: 12px; margin-left: 8px;">拖拽可调整顺序</n-text>
        </div>
        <n-button type="primary" size="small" @click="handleAddClick">
          <template #icon>
            <n-icon><AddOutline /></n-icon>
          </template>
          添加渠道
        </n-button>
      </div>

      <!-- 可滚动的渠道列表区域 -->
      <div class="channels-scroll-area">
        <!-- Claude 渠道列表 -->
        <template v-if="currentChannel === 'claude'">
          <ClaudeChannelPanel ref="claudePanelRef" @open-website="openWebsite" />
        </template>

        <template v-else-if="currentChannel === 'codex'">
          <CodexChannelPanel ref="codexPanelRef" @open-website="openWebsite" />
        </template>
        <template v-else-if="currentChannel === 'gemini'">
          <GeminiChannelPanel ref="geminiPanelRef" @open-website="openWebsite" />
        </template>
      </div>
    </div>

    <!-- 下半部分：实时日志（用户开启日志显示时显示） -->
    <div
      v-if="showLogs"
      class="logs-section"
      :class="{ 'full-height': !showChannels }"
    >
      <ProxyLogs :source="currentChannel" />
    </div>

    <!-- Skills 抽屉 -->
    <SkillsDrawer v-model:visible="showSkillsDrawer" />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import {
  NButton, NIcon, NText, NSwitch, NTooltip, NTag
} from 'naive-ui'
import { AddOutline, ChatbubblesOutline, ExtensionPuzzleOutline } from '@vicons/ionicons5'
import ClaudeChannelPanel from './channel/ClaudeChannelPanel.vue'
import CodexChannelPanel from './channel/CodexChannelPanel.vue'
import GeminiChannelPanel from './channel/GeminiChannelPanel.vue'
import ProxyLogs from './ProxyLogs.vue'
import SkillsDrawer from './SkillsDrawer.vue'
import { useGlobalStore } from '../stores/global'
import { getSkills } from '../api/skills'

const route = useRoute()
const globalStore = useGlobalStore()

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
const showSkillsDrawer = ref(false)
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
  showSkillsDrawer.value = true
}

// 监听 drawer 关闭后刷新计数
watch(showSkillsDrawer, (val) => {
  if (!val) {
    loadInstalledSkillsCount()
  }
})

onMounted(() => {
  loadInstalledSkillsCount()
})

function refreshChannel(channel) {
  channelRefs[channel]?.value?.refresh?.()
}

watch(() => currentChannel.value, refreshChannel)
</script>

<style scoped>
.right-panel {
  width: 520px;
  min-width: 520px;
  border-left: 1px solid var(--border-primary);
  background: var(--gradient-bg);
  height: 100vh;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.03);
}

/* 动作按钮区域 */
.actions-section {
  flex-shrink: 0;
  padding: 16px 18px 12px 18px;
  border-bottom: 1px solid var(--border-primary);
  background: var(--gradient-card);
}

.action-buttons {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.action-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.action-item :deep(.n-switch) {
  flex-shrink: 0;
}

.action-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.action-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.skills-count-tag {
  font-size: 11px;
}

.recent-sessions-icon-btn {
  padding: 6px !important;
  border-radius: 8px;
  transition: all 0.2s ease;
  color: var(--text-secondary);
}

.recent-sessions-icon-btn:hover {
  background: var(--hover-bg);
  color: #18a058;
  transform: scale(1.1);
}

[data-theme="dark"] .recent-sessions-icon-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #34d399;
}

/* 上半部分：API 渠道管理 */
.channels-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: flex 0.3s ease-out, min-height 0.3s ease-out, max-height 0.3s ease-out;
}

/* 当渠道列表占据全部高度时（日志面板隐藏或代理未运行） */
.channels-section.full-height {
  flex: 1;
  min-height: 0;
  max-height: none;
}

/* 固定的标题栏 */
.panel-header {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 18px 16px 18px;
  background: var(--gradient-card);
  border-bottom: 1px solid var(--border-primary);
  position: relative;
}

.panel-header::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 18px;
  right: 18px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(24, 160, 88, 0.08), transparent);
}

.header-title {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

/* 可滚动的渠道列表区域 */
.channels-scroll-area {
  flex: 1;
  min-height: 0;
  padding: 12px;
  overflow-y: auto;
  overflow-x: hidden;
}

/* 下半部分：实时日志 */
.logs-section {
  flex: 0 0 400px;
  min-height: 400px;
  max-height: 400px;
  overflow: hidden;
  transition: flex 0.3s ease-out, min-height 0.3s ease-out, max-height 0.3s ease-out;
}

/* 当日志面板占据全部高度时（渠道列表隐藏） */
.logs-section.full-height {
  flex: 1;
  min-height: 0;
  max-height: none;
}

.panel-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.3px;
}

.panel-header :deep(.n-button--primary-type) {
  border-radius: 8px;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(24, 160, 88, 0.25);
}

.panel-header :deep(.n-button--primary-type:hover) {
  box-shadow: 0 4px 12px rgba(24, 160, 88, 0.35);
  transform: translateY(-1px);
}

/* ========== 响应式样式 ========== */

/* 平板端 (768px - 1024px) */
@media (max-width: 1024px) {
  .right-panel {
    width: 480px;
    min-width: 480px;
  }

  .actions-section {
    padding: 14px 16px 10px 16px;
  }

  .panel-header {
    padding: 16px;
  }

  .panel-header::after {
    left: 16px;
    right: 16px;
  }

  .channels-scroll-area {
    padding: 10px;
  }

  .logs-section {
    flex: 0 0 350px;
    min-height: 350px;
    max-height: 350px;
  }
}

/* 小屏幕 (640px - 768px) */
@media (max-width: 768px) {
  .right-panel {
    width: 100%;
    min-width: 100%;
    position: fixed;
    top: 56px;
    right: 0;
    z-index: 9;
    box-shadow: -2px 0 16px rgba(0, 0, 0, 0.1);
  }

  .actions-section {
    padding: 12px 14px 8px 14px;
  }

  .action-buttons {
    gap: 8px;
  }

  .action-left {
    gap: 8px;
  }

  .action-left :deep(.n-text) {
    font-size: 12px;
    margin-right: 6px;
  }

  .skills-count-tag {
    font-size: 10px;
  }

  .recent-sessions-icon-btn {
    padding: 4px !important;
  }

  .panel-header {
    padding: 14px;
  }

  .panel-header h3 {
    font-size: 14px;
  }

  .panel-header :deep(.n-button) {
    font-size: 12px;
    padding: 0 12px;
  }

  .panel-header::after {
    left: 14px;
    right: 14px;
  }

  .channels-scroll-area {
    padding: 8px;
  }

  .logs-section {
    flex: 0 0 300px;
    min-height: 300px;
    max-height: 300px;
  }
}

/* 移动端 (< 640px) */
@media (max-width: 640px) {
  .right-panel {
    width: 100%;
    min-width: 100%;
    top: 52px;
  }

  .actions-section {
    padding: 10px 12px 6px 12px;
  }

  .action-buttons {
    gap: 6px;
  }

  .action-left {
    gap: 6px;
    flex-direction: column;
    align-items: flex-start;
    align-self: stretch;
  }

  .action-right {
    gap: 2px;
  }

  .action-item :deep(.n-text) {
    font-size: 11px;
    margin-right: 6px;
  }

  .skills-count-tag {
    font-size: 9px;
    align-self: flex-start;
  }

  .recent-sessions-icon-btn {
    padding: 3px !important;
  }

  .recent-sessions-icon-btn :deep(.n-icon) {
    font-size: 16px !important;
  }

  .panel-header {
    padding: 12px;
  }

  .panel-header h3 {
    font-size: 13px;
  }

  .panel-header :deep(.n-button) {
    font-size: 11px;
    padding: 0 10px;
  }

  .panel-header::after {
    left: 12px;
    right: 12px;
  }

  .channels-scroll-area {
    padding: 6px;
  }

  .logs-section {
    flex: 0 0 250px;
    min-height: 250px;
    max-height: 250px;
  }
}

/* 超小屏幕 (< 480px) */
@media (max-width: 480px) {
  .right-panel {
    top: 48px;
  }

  .actions-section {
    padding: 8px 10px 4px 10px;
  }

  .panel-header {
    padding: 10px;
  }

  .panel-header h3 {
    font-size: 12px;
  }

  .panel-header :deep(.n-button) {
    font-size: 10px;
    padding: 0 8px;
  }

  .channels-scroll-area {
    padding: 4px;
  }

  .logs-section {
    flex: 0 0 200px;
    min-height: 200px;
    max-height: 200px;
  }
}

</style>
