<template>
  <div class="workspace-card" @click="$emit('click', workspace)">
    <div class="card-header">
      <div class="card-title">
        <span class="name">{{ workspace.name }}</span>
        <n-tag :type="workspace.exists ? 'success' : 'error'" size="small">
          {{ workspace.exists ? '存在' : '不存在' }}
        </n-tag>
      </div>
      <div class="card-actions" @click.stop>
        <n-button text size="small" @click="$emit('view', workspace)">
          <template #icon><n-icon><EyeOutline /></n-icon></template>
        </n-button>
        <n-button text size="small" type="error" @click="$emit('delete', workspace)">
          <template #icon><n-icon><TrashOutline /></n-icon></template>
        </n-button>
      </div>
    </div>

    <div class="card-body">
      <div class="info-row" v-if="workspace.description">
        <span class="label">描述</span>
        <span class="value">{{ workspace.description }}</span>
      </div>
      <div class="info-row">
        <span class="label">项目数</span>
        <span class="value">{{ workspace.projectCount || 0 }}</span>
      </div>
      <div class="info-row">
        <span class="label">路径</span>
        <span class="value path">{{ workspace.path }}</span>
      </div>
      <div class="info-row" v-if="workspace.lastUsed">
        <span class="label">最后使用</span>
        <span class="value">{{ formatDate(workspace.lastUsed) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { NTag, NButton, NIcon } from 'naive-ui'
import { EyeOutline, TrashOutline } from '@vicons/ionicons5'

defineProps({
  workspace: {
    type: Object,
    required: true
  }
})

defineEmits(['click', 'view', 'delete'])

function formatDate(dateStr) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('zh-CN')
}
</script>

<style scoped>
.workspace-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  padding: 12px 16px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.workspace-card:hover {
  border-color: var(--primary-color);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-title .name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.card-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.info-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
}

.info-row .label {
  color: var(--text-tertiary);
  min-width: 60px;
  flex-shrink: 0;
}

.info-row .value {
  color: var(--text-secondary);
  word-break: break-all;
}

.info-row .value.path {
  font-family: monospace;
  font-size: 12px;
}
</style>
