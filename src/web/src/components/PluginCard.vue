<template>
  <div class="plugin-card" :class="{ disabled: !plugin.enabled }">
    <div class="plugin-header">
      <div class="plugin-info">
        <div class="plugin-name">{{ plugin.name }}</div>
        <n-tag v-if="plugin.version" size="small" :bordered="false" type="info">
          v{{ plugin.version }}
        </n-tag>
      </div>
      <n-switch
        :value="plugin.enabled"
        @update:value="$emit('toggle', $event)"
        size="small"
      />
    </div>

    <div class="plugin-description" v-if="plugin.description">
      {{ plugin.description }}
    </div>

    <div class="plugin-meta">
      <span v-if="plugin.author" class="meta-item">
        <n-icon :size="12"><PersonOutline /></n-icon>
        {{ plugin.author }}
      </span>
      <span v-if="plugin.source" class="meta-item">
        <n-icon :size="12"><GitBranchOutline /></n-icon>
        {{ formatSource(plugin.source) }}
      </span>
    </div>

    <div class="plugin-actions">
      <n-tooltip trigger="hover">
        <template #trigger>
          <n-button size="small" quaternary @click="$emit('config')">
            <template #icon>
              <n-icon><SettingsOutline /></n-icon>
            </template>
          </n-button>
        </template>
        配置
      </n-tooltip>
      <n-tooltip trigger="hover">
        <template #trigger>
          <n-button size="small" quaternary type="error" @click="$emit('uninstall')">
            <template #icon>
              <n-icon><TrashOutline /></n-icon>
            </template>
          </n-button>
        </template>
        卸载
      </n-tooltip>
    </div>
  </div>
</template>

<script setup>
import { NSwitch, NButton, NIcon, NTag, NTooltip } from 'naive-ui'
import { SettingsOutline, TrashOutline, PersonOutline, GitBranchOutline } from '@vicons/ionicons5'

defineProps({
  plugin: {
    type: Object,
    required: true
  }
})

defineEmits(['toggle', 'config', 'uninstall'])

function formatSource(source) {
  if (!source) return ''
  // Extract repo name from git URL
  const match = source.match(/github\.com[\/:]([^\/]+\/[^\/]+?)(?:\.git)?$/)
  return match ? match[1] : source.split('/').pop()
}
</script>

<style scoped>
.plugin-card {
  padding: 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  transition: all 0.2s;
}

.plugin-card:hover {
  border-color: var(--primary-color);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.plugin-card.disabled {
  opacity: 0.6;
}

.plugin-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.plugin-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.plugin-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.plugin-description {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 8px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.plugin-meta {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.plugin-actions {
  display: flex;
  gap: 4px;
  justify-content: flex-end;
  border-top: 1px solid var(--border-primary);
  padding-top: 12px;
  margin-top: 4px;
}
</style>
