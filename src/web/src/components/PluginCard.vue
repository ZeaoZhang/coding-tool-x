<template>
  <div class="plugin-card" :class="{ installed: plugin.installed }" @click="$emit('click', plugin)">
    <div class="card-header">
      <div class="card-title">
        <span class="name">{{ plugin.name }}</span>
        <n-tag v-if="plugin.installed" type="info" size="small">已安装</n-tag>
        <n-tag v-if="plugin.repoProvider === 'gitlab'" type="info" size="small">GitLab</n-tag>
        <n-tag v-else-if="plugin.repoProvider === 'local'" type="info" size="small">本地</n-tag>
        <n-tag v-else-if="plugin.repoOwner" type="info" size="small">{{ plugin.repoOwner }}</n-tag>
      </div>
      <div class="card-actions" @click.stop>
        <n-button
          v-if="plugin.installed"
          size="small"
          type="error"
          :loading="uninstalling"
          :focusable="false"
          @click="$emit('uninstall', plugin)"
        >卸载</n-button>
        <n-button
          v-else
          size="small"
          type="primary"
          :loading="installing"
          :disabled="!canInstall(plugin)"
          :focusable="false"
          @click="$emit('install', plugin)"
        >安装</n-button>
      </div>
    </div>
    <div class="card-body">
      <div class="description" v-if="plugin.description">{{ truncate(plugin.description, 80) }}</div>
      <div class="meta">
        <span class="meta-item">{{ plugin.directory }}</span>
        <a v-if="plugin.readmeUrl" class="meta-link" :href="plugin.readmeUrl" target="_blank" @click.stop>{{ getRepoLinkLabel(plugin) }}</a>
      </div>
    </div>
  </div>
</template>

<script setup>
import { NTag, NButton, NIcon } from 'naive-ui'

defineProps({
  plugin: { type: Object, required: true },
  installing: { type: Boolean, default: false },
  uninstalling: { type: Boolean, default: false }
})

defineEmits(['click', 'install', 'uninstall'])

function truncate(text, len) {
  return text?.length > len ? text.slice(0, len) + '...' : text
}

function canInstall(plugin) {
  return !!(plugin?.installSource || plugin?.repoOwner || plugin?.repoProjectPath || plugin?.repoLocalPath)
}

function getRepoLinkLabel(plugin) {
  if (plugin?.repoProvider === 'gitlab') return 'GitLab'
  if (plugin?.repoProvider === 'local') return '本地'
  return 'GitHub'
}
</script>

<style scoped>
.plugin-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 12px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  min-height: 120px;
  display: flex;
  flex-direction: column;
}
.plugin-card:hover {
  border-color: var(--primary-color);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
}
.plugin-card.installed {
  border-left: 3px solid var(--info-color, #2080f0);
}
.plugin-card.managed {
  border-left: 3px solid var(--primary-color);
}
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.card-title .name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}
.card-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}
.description {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}
.meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  margin-top: auto;
}
.meta-item {
  color: var(--text-tertiary);
  font-family: monospace;
}
.meta-link {
  color: var(--primary-color);
  text-decoration: none;
}
.meta-link:hover {
  text-decoration: underline;
}

.managed-actions {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.platform-icons {
  display: flex;
  align-items: center;
  gap: 6px;
}

.platform-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  color: var(--text-tertiary);
  background: var(--bg-tertiary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.platform-icon:hover {
  background: var(--bg-quaternary);
}

.platform-icon.active {
  color: var(--primary-color);
  background: rgba(24, 160, 88, 0.1);
}
</style>
