<template>
  <div class="terminal-tabs">
    <div class="tabs-container">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-item"
        :class="{ active: tab.id === activeTab }"
        @click="$emit('select', tab.id)"
      >
        <n-icon :size="14" class="tab-icon" :color="getChannelColor(tab.channel)">
          <component :is="getChannelIcon(tab.channel)" />
        </n-icon>
        <span class="tab-title">{{ tab.title || getDefaultTitle(tab) }}</span>
        <n-button
          text
          size="tiny"
          class="tab-close"
          @click.stop="$emit('close', tab.id)"
        >
          <template #icon>
            <n-icon :size="12"><CloseOutline /></n-icon>
          </template>
        </n-button>
      </div>
    </div>

    <div class="tabs-actions">
      <!-- 现有终端下拉列表 -->
      <n-dropdown
        v-if="existingTerminals.length > 0"
        :options="existingTerminalOptions"
        @select="handleAttachTerminal"
        placement="bottom-end"
      >
        <n-button text size="small" class="existing-terminals-btn">
          <template #icon>
            <n-icon :size="16"><ListOutline /></n-icon>
          </template>
          <span class="btn-label">终端列表</span>
          <n-badge :value="existingTerminals.length" :max="99" type="info" />
        </n-button>
      </n-dropdown>

      <!-- 新建终端下拉 -->
      <n-dropdown :options="newTabOptions" @select="handleNewTab" placement="bottom-end">
        <n-button text size="small" class="add-tab-btn">
          <template #icon>
            <n-icon :size="16"><AddOutline /></n-icon>
          </template>
          <span class="btn-label">新建</span>
        </n-button>
      </n-dropdown>
    </div>
  </div>
</template>

<script setup>
import { h, computed } from 'vue'
import { NIcon, NButton, NDropdown, NBadge } from 'naive-ui'
import {
  CloseOutline,
  AddOutline,
  TerminalOutline,
  CodeSlashOutline,
  SparklesOutline,
  ListOutline,
  CheckmarkCircleOutline,
  CloseCircleOutline,
  EllipseOutline
} from '@vicons/ionicons5'

const props = defineProps({
  tabs: {
    type: Array,
    default: () => []
  },
  activeTab: {
    type: String,
    default: null
  },
  existingTerminals: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['select', 'close', 'add', 'attach'])

// 渠道图标
function getChannelIcon(channel) {
  switch (channel) {
    case 'codex':
      return CodeSlashOutline
    case 'gemini':
      return SparklesOutline
    default:
      return TerminalOutline
  }
}

// 渠道颜色
function getChannelColor(channel) {
  switch (channel) {
    case 'codex':
      return '#10a37f'
    case 'gemini':
      return '#4285f4'
    default:
      return '#18a058'
  }
}

// 默认标题
function getDefaultTitle(tab) {
  const channelName = {
    claude: 'Claude',
    codex: 'Codex',
    gemini: 'Gemini'
  }[tab.channel] || 'Terminal'

  if (tab.sessionId) {
    return `${channelName} - ${tab.sessionId.slice(0, 8)}`
  }
  return channelName
}

// 格式化终端标题
function formatTerminalTitle(term) {
  if (term.metadata?.sessionId) {
    return `会话: ${term.metadata.sessionId.substring(0, 8)}`
  }
  return `终端 ${term.id.split('_')[1] || term.id}`
}

// 获取状态图标
function getStatusIcon(term) {
  if (term.connected) return CheckmarkCircleOutline
  if (term.exited) return CloseCircleOutline
  return EllipseOutline
}

// 获取状态颜色
function getStatusColor(term) {
  if (term.connected) return '#a6e3a1'
  if (term.exited) return '#f38ba8'
  return '#f9e2af'
}

// 检查终端是否已在标签页中打开
function isTerminalOpened(terminalId) {
  return props.tabs.some(tab => tab.terminalId === terminalId)
}

// 现有终端选项
const existingTerminalOptions = computed(() => {
  return props.existingTerminals.map(term => ({
    label: () => h('div', { style: 'display: flex; align-items: center; gap: 8px; width: 100%;' }, [
      h(NIcon, {
        size: 14,
        color: getChannelColor(term.metadata?.channel)
      }, {
        default: () => h(getChannelIcon(term.metadata?.channel))
      }),
      h('span', { style: 'flex: 1;' }, formatTerminalTitle(term)),
      h(NIcon, {
        size: 12,
        color: getStatusColor(term)
      }, {
        default: () => h(getStatusIcon(term))
      }),
      isTerminalOpened(term.id) ? h('span', {
        style: 'font-size: 10px; color: #89b4fa; margin-left: 4px;'
      }, '已打开') : null
    ]),
    key: term.id,
    disabled: isTerminalOpened(term.id)
  }))
})

// 新建标签选项
const newTabOptions = computed(() => [
  {
    label: 'Claude Code',
    key: 'claude',
    icon: () => h(NIcon, { color: '#18a058' }, { default: () => h(TerminalOutline) })
  },
  {
    label: 'Codex CLI',
    key: 'codex',
    icon: () => h(NIcon, { color: '#10a37f' }, { default: () => h(CodeSlashOutline) })
  },
  {
    label: 'Gemini CLI',
    key: 'gemini',
    icon: () => h(NIcon, { color: '#4285f4' }, { default: () => h(SparklesOutline) })
  }
])

function handleNewTab(channel) {
  emit('add', { channel })
}

function handleAttachTerminal(terminalId) {
  const term = props.existingTerminals.find(t => t.id === terminalId)
  if (term) {
    emit('attach', term)
  }
}
</script>

<style scoped>
.terminal-tabs {
  display: flex;
  align-items: center;
  height: 40px;
  background: var(--terminal-tabs-bg);
  border-bottom: 1px solid var(--terminal-border);
  padding: 0 8px;
  gap: 8px;
}

.tabs-container {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: none;
}

.tabs-container::-webkit-scrollbar {
  display: none;
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: var(--terminal-tab-bg);
  border: 1px solid var(--terminal-border);
  border-radius: 6px 6px 0 0;
  cursor: pointer;
  transition: all 0.15s ease;
  min-width: 100px;
  max-width: 180px;
}

.tab-item:hover {
  background: var(--terminal-tab-hover);
}

.tab-item.active {
  background: var(--terminal-bg);
  border-color: var(--terminal-tab-active-border);
  border-bottom-color: var(--terminal-bg);
  margin-bottom: -1px;
}

.tab-icon {
  flex-shrink: 0;
}

.tab-title {
  flex: 1;
  font-size: 12px;
  color: var(--terminal-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-close {
  flex-shrink: 0;
  opacity: 0.5;
  transition: opacity 0.15s ease;
}

.tab-item:hover .tab-close {
  opacity: 1;
}

.tabs-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.existing-terminals-btn,
.add-tab-btn {
  color: var(--terminal-text-muted);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.15s ease;
}

.existing-terminals-btn:hover,
.add-tab-btn:hover {
  color: var(--terminal-text);
  background: var(--terminal-btn-hover);
}

.btn-label {
  font-size: 12px;
}

:deep(.n-badge) {
  margin-left: 4px;
}

:deep(.n-badge .n-badge-sup) {
  font-size: 10px;
  padding: 0 4px;
  height: 14px;
  line-height: 14px;
}
</style>
