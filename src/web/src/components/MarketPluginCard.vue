<template>
  <div class="market-plugin-card">
    <div class="card-header">
      <div class="plugin-icon">
        <n-icon :size="32"><ExtensionPuzzleOutline /></n-icon>
      </div>
      <div class="plugin-info">
        <div class="plugin-name">{{ plugin.name }}</div>
        <div class="plugin-stats">
          <span class="stat-item">
            <n-icon :size="14"><StarOutline /></n-icon>
            {{ plugin.stars || 0 }}
          </span>
          <span class="stat-item">
            <n-icon :size="14"><DownloadOutline /></n-icon>
            {{ plugin.downloads || 0 }}
          </span>
        </div>
      </div>
    </div>

    <div class="plugin-description">
      {{ plugin.description }}
    </div>

    <div class="plugin-meta">
      <n-tag v-if="plugin.version" size="small" :bordered="false" type="info">
        v{{ plugin.version }}
      </n-tag>
      <span v-if="plugin.author" class="meta-item">
        <n-icon :size="12"><PersonOutline /></n-icon>
        {{ plugin.author }}
      </span>
    </div>

    <div class="card-footer">
      <n-button
        type="primary"
        size="small"
        :loading="installing"
        @click="$emit('install')"
      >
        <template #icon>
          <n-icon><DownloadOutline /></n-icon>
        </template>
        安装
      </n-button>
      <n-button
        quaternary
        size="small"
        @click="$emit('view-details')"
      >
        详情
      </n-button>
    </div>
  </div>
</template>

<script setup>
import { NButton, NIcon, NTag, NTooltip } from 'naive-ui'
import { ExtensionPuzzleOutline, StarOutline, DownloadOutline, PersonOutline } from '@vicons/ionicons5'

defineProps({
  plugin: {
    type: Object,
    required: true
  },
  installing: Boolean
})

defineEmits(['install', 'view-details'])
</script>

<style scoped>
@import '../styles/plugin-card-common.css';

.market-plugin-card {
  composes: plugin-card-base;
  cursor: pointer;
}

.card-header {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}

.plugin-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  background: linear-gradient(135deg, var(--primary-color), var(--primary-color-hover));
  border-radius: 10px;
  color: white;
  flex-shrink: 0;
}

.plugin-info {
  flex: 1;
  min-width: 0;
}

.plugin-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.plugin-stats {
  display: flex;
  gap: 12px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-tertiary);
}

.plugin-description {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 12px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 42px;
}

.plugin-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.card-footer {
  display: flex;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--border-primary);
}
</style>
