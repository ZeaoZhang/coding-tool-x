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
      <!-- 新建终端按钮 -->
      <n-button text size="small" class="add-tab-btn" @click="handleNewTab('shell')">
        <template #icon>
          <n-icon :size="16"><AddOutline /></n-icon>
        </template>
        <span class="btn-label">新建</span>
      </n-button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { NIcon, NButton } from 'naive-ui'
import {
  CloseOutline,
  AddOutline,
  TerminalOutline,
  CodeSlashOutline,
  SparklesOutline
} from '@vicons/ionicons5'

const props = defineProps({
  tabs: {
    type: Array,
    default: () => []
  },
  activeTab: {
    type: String,
    default: null
  }
})

const emit = defineEmits(['select', 'close', 'add'])

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
    case 'shell':
      return '#888888'
    default:
      return '#18a058'
  }
}

// 默认标题
function getDefaultTitle(tab) {
  const channelName = {
    claude: 'Claude',
    codex: 'Codex',
    gemini: 'Gemini',
    shell: 'Terminal'
  }[tab.channel] || 'Terminal'

  if (tab.sessionId) {
    return `${channelName} - ${tab.sessionId.slice(0, 8)}`
  }
  return channelName
}

function handleNewTab(channel) {
  emit('add', { channel })
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

.add-tab-btn {
  color: var(--terminal-text-muted);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.15s ease;
}

.add-tab-btn:hover {
  color: var(--terminal-text);
  background: var(--terminal-btn-hover);
}

.btn-label {
  font-size: 12px;
}
</style>
