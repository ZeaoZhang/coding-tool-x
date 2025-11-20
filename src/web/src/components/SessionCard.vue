<template>
  <div
    class="session-item"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <!-- Left Content -->
    <div class="session-left">
      <div class="session-icon">
        <n-icon size="24" color="#18a058">
          <ChatbubbleEllipsesOutline />
        </n-icon>
      </div>

      <div class="session-info">
        <div class="session-header">
          <div class="session-title-row">
            <!-- Project badge if showProject is true -->
            <n-tag v-if="showProject && session.projectDisplayName" size="small" type="info" :bordered="false" style="margin-right: 8px;">
              {{ session.projectDisplayName }}
            </n-tag>

            <span class="session-title">
              {{ displayTitle }}
            </span>
            <n-tooltip v-if="session.forkedFrom" placement="top">
              <template #trigger>
                <n-tag size="small" type="warning" :bordered="false" style="margin-left: 8px; cursor: help;">
                  <template #icon>
                    <n-icon><GitBranchOutline /></n-icon>
                  </template>
                  Fork
                </n-tag>
              </template>
              <span>Fork 自 {{ session.forkedFrom }}</span>
            </n-tooltip>
          </div>
          <div class="session-meta">
            <span class="meta-item">
              <n-icon size="14"><CalendarOutline /></n-icon>
              {{ formatTime(session.mtime) }}
            </span>
            <n-tag size="small" :bordered="false" type="info">
              <template #icon>
                <n-icon><DocumentOutline /></n-icon>
              </template>
              {{ formatSize(session.size) }}
            </n-tag>
            <n-tag v-if="session.gitBranch" size="small" :bordered="false" type="success">
              <template #icon>
                <n-icon><GitBranchOutline /></n-icon>
              </template>
              {{ session.gitBranch }}
            </n-tag>
          </div>
        </div>
        <div v-if="session.firstMessage" class="session-message">
          {{ session.firstMessage }}
        </div>
        <div v-if="showProject && session.projectFullPath" class="session-path">
          路径: {{ session.projectFullPath }}
        </div>
      </div>
    </div>

    <!-- Right Actions -->
    <div class="session-actions">
      <!-- Alias Button -->
      <n-button
        size="small"
        @click="$emit('set-alias', session)"
      >
        <template #icon>
          <n-icon><PricetagOutline /></n-icon>
        </template>
        别名
      </n-button>

      <!-- Launch Button -->
      <n-button
        type="primary"
        size="small"
        @click="$emit('launch', session)"
      >
        <template #icon>
          <n-icon><TerminalOutline /></n-icon>
        </template>
        使用对话
      </n-button>

      <!-- Fork Button (only show if not hideFork) -->
      <n-button
        v-if="!hideFork"
        size="small"
        @click="$emit('fork', session)"
      >
        <template #icon>
          <n-icon><GitBranchOutline /></n-icon>
        </template>
        Fork
      </n-button>

      <!-- Delete Button (only show if not hideDelete) -->
      <n-button
        v-if="!hideDelete"
        size="small"
        type="error"
        @click="$emit('delete', session)"
      >
        <template #icon>
          <n-icon><TrashOutline /></n-icon>
        </template>
      </n-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { NButton, NIcon, NTag, NTooltip } from 'naive-ui'
import {
  ChatbubbleEllipsesOutline,
  CalendarOutline,
  DocumentOutline,
  GitBranchOutline,
  PricetagOutline,
  TerminalOutline,
  TrashOutline
} from '@vicons/ionicons5'

const props = defineProps({
  session: {
    type: Object,
    required: true
  },
  showProject: {
    type: Boolean,
    default: false
  },
  hideFork: {
    type: Boolean,
    default: false
  },
  hideDelete: {
    type: Boolean,
    default: false
  }
})

defineEmits(['set-alias', 'launch', 'fork', 'delete'])

const hovered = ref(false)

const displayTitle = computed(() => {
  if (props.session.alias) {
    return `${props.session.alias} (${props.session.sessionId.substring(0, 8)})`
  }
  return props.session.sessionId
})

function formatTime(timestamp) {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now - date
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 7) return `${days}天前`

  return date.toLocaleDateString('zh-CN')
}

function formatSize(bytes) {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
}
</script>

<style scoped>
.session-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  margin-bottom: 8px;
  transition: all 0.2s;
}

.session-item:hover {
  border-color: #18a058;
  box-shadow: 0 2px 8px rgba(24, 160, 88, 0.1);
}

.session-left {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}

.session-icon {
  flex-shrink: 0;
}

.session-info {
  flex: 1;
  min-width: 0;
}

.session-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.session-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

.session-title {
  font-weight: 500;
  color: #333;
  font-size: 14px;
}

.session-meta {
  display: flex;
  gap: 16px;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: #666;
}

.session-message {
  font-size: 13px;
  color: #888;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 6px;
}

.session-path {
  font-size: 12px;
  color: #999;
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
</style>
