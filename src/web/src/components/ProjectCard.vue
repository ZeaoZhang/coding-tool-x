<template>
  <n-card
    hoverable
    class="project-card"
    @click="handleCardClick"
    :style="{ cursor: 'pointer' }"
    @mouseenter="showDelete = true"
    @mouseleave="showDelete = false"
  >
    <div class="card-content">
      <!-- Header row: Icon + Title -->
      <div class="header-row">
        <n-icon size="24" :color="projectColor">
          <FolderOpenOutline />
        </n-icon>
        <span class="project-name">{{ projectName }}</span>

        <!-- Delete button (shows on hover) -->
        <n-button
          v-show="showDelete"
          text
          type="error"
          size="small"
          class="delete-btn"
          @click.stop="handleDelete"
        >
          <template #icon>
            <n-icon size="18">
              <TrashOutline />
            </n-icon>
          </template>
        </n-button>
      </div>

      <!-- Full Path -->
      <n-text depth="3" class="project-path">{{ projectPath }}</n-text>

      <!-- Stats -->
      <div class="stats-row">
        <n-tag size="small" :bordered="false" type="info">
          {{ sessionCount }} 会话
        </n-tag>
        <n-text v-if="lastUsed" depth="3" class="last-used">
          {{ formatTime(lastUsed) }}
        </n-text>
      </div>
    </div>
  </n-card>
</template>

<script setup>
import { ref, computed } from 'vue'
import { NCard, NIcon, NText, NTag, NButton } from 'naive-ui'
import { FolderOpenOutline, TrashOutline } from '@vicons/ionicons5'

const props = defineProps({
  project: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['click', 'delete'])

const showDelete = ref(false)

function handleCardClick() {
  emit('click')
}

function handleDelete() {
  emit('delete', props.project)
}

// Project name (使用后端解析的显示名称)
const projectName = computed(() => {
  return props.project?.displayName || props.project?.name || ''
})

// Full path for display (使用后端解析的完整路径)
const projectPath = computed(() => {
  return props.project?.fullPath || props.project?.name || ''
})

const sessionCount = computed(() => props.project?.sessionCount || 0)
const lastUsed = computed(() => props.project?.lastUsed)

const projectColor = computed(() => {
  const colors = ['#18a058', '#2080f0', '#f0a020', '#d03050', '#9333ea', '#06b6d4']
  const name = props.project?.name || ''
  const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return colors[hash % colors.length]
})

function formatTime(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now - date

  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`

  return date.toLocaleDateString('zh-CN')
}
</script>

<style scoped>
.project-card {
  height: 140px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.12);
}

.project-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.15), 0 4px 8px rgba(0, 0, 0, 0.1);
}

.card-content {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.header-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  position: relative;
}

.project-name {
  font-size: 18px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.delete-btn {
  margin-left: auto;
  opacity: 0.8;
  transition: opacity 0.2s;
}

.delete-btn:hover {
  opacity: 1;
}

.project-path {
  font-size: 12px;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 12px;
  flex: 1;
}

.stats-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
}

.last-used {
  font-size: 12px;
}
</style>
