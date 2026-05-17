<template>
  <div class="plugin-card asset-card" :class="{ 'is-installed': plugin.installed, 'is-disabled': readonly }" @click="$emit('click', plugin)">
    <div class="asset-card-main">
      <div class="asset-card-top">
        <div class="asset-card-title-stack">
          <div class="asset-card-title-row">
            <span class="asset-status-dot" :class="{ active: plugin.installed }"></span>
            <span class="asset-name">{{ plugin.name }}</span>
          </div>
          <div class="asset-tags">
            <n-tag v-if="plugin.installed" type="success" size="tiny" :bordered="false">已安装</n-tag>
            <n-tag v-if="readonly" type="default" size="tiny" :bordered="false">缓存</n-tag>
            <n-tag v-if="plugin.repoProvider === 'gitlab'" type="info" size="tiny" :bordered="false">GitLab</n-tag>
            <n-tag v-else-if="plugin.repoProvider === 'local'" type="info" size="tiny" :bordered="false">本地</n-tag>
            <n-tag v-else-if="plugin.repoOwner" type="info" size="tiny" :bordered="false">{{ plugin.repoOwner }}</n-tag>
          </div>
        </div>
      </div>
      <div class="asset-description" v-if="plugin.description">{{ truncate(plugin.description, 120) }}</div>
      <div class="asset-meta">
        <span class="asset-meta-item mono">{{ plugin.directory }}</span>
        <a v-if="plugin.readmeUrl" class="asset-link" :href="plugin.readmeUrl" target="_blank" @click.stop>{{ getRepoLinkLabel(plugin) }}</a>
      </div>
    </div>
    <div v-if="!readonly" class="asset-card-actions" @click.stop>
      <n-button
        v-if="plugin.installed && canUninstall"
        size="small"
        tertiary
        type="error"
        :loading="uninstalling"
        :focusable="false"
        @click="$emit('uninstall', plugin)"
      >卸载</n-button>
      <n-button
        v-else-if="canInstall"
        size="small"
        type="primary"
        :loading="installing"
        :disabled="!canInstall(plugin)"
        :focusable="false"
        @click="$emit('install', plugin)"
      >安装</n-button>
    </div>
  </div>
</template>

<script setup>
import { NTag, NButton } from 'naive-ui'

defineProps({
  plugin: { type: Object, required: true },
  readonly: { type: Boolean, default: false },
  canInstall: { type: Boolean, default: true },
  canUninstall: { type: Boolean, default: true },
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
</style>
