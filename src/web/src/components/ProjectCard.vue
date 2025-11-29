<template>
  <div
    class="project-card"
    @click="handleCardClick"
    @mouseenter="showDelete = true"
    @mouseleave="showDelete = false"
  >
    <div class="card-content">
      <!-- Header row: Icon + Title + Delete -->
      <div class="header-row">
        <n-icon size="18" :color="projectColor">
          <FolderOpenOutline />
        </n-icon>
        <span class="project-name">{{ projectName }}</span>
        <n-button
          v-show="showDelete"
          text
          type="error"
          size="tiny"
          class="delete-btn"
          @click.stop="handleDelete"
        >
          <template #icon>
            <n-icon size="14">
              <TrashOutline />
            </n-icon>
          </template>
        </n-button>
      </div>

      <!-- Full Path -->
      <n-text depth="3" class="project-path">{{ projectPath }}</n-text>

      <!-- Stats Row -->
      <div class="stats-row">
        <n-tag size="tiny" :bordered="false" type="success">
          {{ sessionCount }} 会话
        </n-tag>
        <n-text v-if="lastUsed" depth="3" class="last-used">
          {{ formatTime(lastUsed) }}
        </n-text>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { NIcon, NText, NTag, NButton } from 'naive-ui'
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
  return props.project?.path || props.project?.fullPath || props.project?.name || ''
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
  padding: 12px 14px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  border-radius: 8px;
  border: 1px solid var(--border-primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  background: var(--bg-primary);
  position: relative;
  overflow: hidden;
}

.project-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 3px;
  height: 100%;
  background: linear-gradient(180deg, #18a058, rgba(24, 160, 88, 0.4));
  opacity: 0;
  transition: opacity 0.25s ease;
}

.project-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 20px rgba(24, 160, 88, 0.12), 0 2px 6px rgba(0, 0, 0, 0.06);
  border-color: rgba(24, 160, 88, 0.4);
}

.project-card:hover::before {
  opacity: 1;
}

.card-content {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.header-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.project-name {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  color: var(--text-primary);
  letter-spacing: -0.2px;
}

.delete-btn {
  opacity: 0.7;
  transition: opacity 0.2s;
  padding: 2px !important;
}

.delete-btn:hover {
  opacity: 1;
}

.project-path {
  font-size: 11px;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.3;
}

.stats-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px dashed var(--border-primary);
}

.stats-row :deep(.n-tag) {
  font-size: 11px;
  font-weight: 600;
  padding: 0 6px;
  height: 18px;
  border-radius: 4px;
}

.last-used {
  font-size: 11px;
  font-weight: 500;
}
</style>
