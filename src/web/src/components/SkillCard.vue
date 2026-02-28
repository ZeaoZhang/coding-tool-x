<template>
  <div class="skill-card" :class="{ installed: skill.installed, managed: !!registryInfo }" @click="$emit('click', skill)">
    <div class="card-header">
      <div class="card-title">
        <span class="name">{{ skill.name }}</span>
        <n-tag v-if="skill.installed" type="info" size="small">已安装</n-tag>
        <n-tag v-if="skill.repoOwner" type="info" size="small">{{ skill.repoOwner }}</n-tag>
      </div>
      <div class="card-actions" @click.stop>
        <n-button
          v-if="skill.installed"
          size="small"
          type="error"
          :loading="uninstalling"
          :focusable="false"
          @click="$emit('uninstall', skill)"
        >卸载</n-button>
        <n-button
          v-else
          size="small"
          type="primary"
          :loading="installing"
          :disabled="!canInstall(skill)"
          :focusable="false"
          @click="$emit('install', skill)"
        >安装</n-button>
      </div>
    </div>
    <div class="card-body">
      <div class="description" v-if="skill.description">{{ truncate(skill.description, 80) }}</div>
      <div class="meta">
        <span class="meta-item">{{ skill.directory }}</span>
        <a v-if="skill.readmeUrl" class="meta-link" :href="skill.readmeUrl" target="_blank" @click.stop>GitHub</a>
      </div>
      <div class="managed-actions" v-if="registryInfo">
        <n-tooltip trigger="hover">
          <template #trigger>
            <n-switch
              :value="registryInfo.enabled"
              size="small"
              :loading="toggling"
              @update:value="$emit('toggle-enabled', skill, $event)"
              @click.stop
            />
          </template>
          {{ registryInfo.enabled ? '已启用' : '已禁用' }}
        </n-tooltip>
        <div class="platform-icons">
          <n-tooltip trigger="hover">
            <template #trigger>
              <span
                class="platform-icon"
                :class="{ active: registryInfo.platforms?.claude }"
                @click.stop="$emit('toggle-platform', skill, 'claude', !registryInfo.platforms?.claude)"
              >
                <n-icon size="14"><LogoApple /></n-icon>
              </span>
            </template>
            Claude Code {{ registryInfo.platforms?.claude ? '已启用' : '未启用' }}
          </n-tooltip>
          <n-tooltip trigger="hover">
            <template #trigger>
              <span
                class="platform-icon"
                :class="{ active: registryInfo.platforms?.codex }"
                @click.stop="$emit('toggle-platform', skill, 'codex', !registryInfo.platforms?.codex)"
              >
                <n-icon size="14"><TerminalOutline /></n-icon>
              </span>
            </template>
            Codex CLI {{ registryInfo.platforms?.codex ? '已启用' : '未启用' }}
          </n-tooltip>
          <n-tooltip trigger="hover">
            <template #trigger>
              <span
                class="platform-icon"
                :class="{ active: registryInfo.platforms?.opencode }"
                @click.stop="$emit('toggle-platform', skill, 'opencode', !registryInfo.platforms?.opencode)"
              >
                <n-icon size="14"><CodeSlashOutline /></n-icon>
              </span>
            </template>
            OpenCode {{ registryInfo.platforms?.opencode ? '已启用' : '未启用' }}
          </n-tooltip>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { NTag, NButton, NTooltip, NSwitch, NIcon } from 'naive-ui'
import { LogoApple, TerminalOutline, CodeSlashOutline } from '@vicons/ionicons5'

defineProps({
  skill: { type: Object, required: true },
  installing: { type: Boolean, default: false },
  uninstalling: { type: Boolean, default: false },
  registryInfo: { type: Object, default: null },
  toggling: { type: Boolean, default: false }
})

defineEmits(['click', 'install', 'uninstall', 'toggle-enabled', 'toggle-platform'])

function truncate(text, len) {
  return text?.length > len ? text.slice(0, len) + '...' : text
}

function canInstall(skill) {
  return !!(skill?.repoOwner || skill?.installSource)
}
</script>

<style scoped>
.skill-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  padding: 12px 16px;
  cursor: pointer;
  transition: all 0.2s ease;
}
.skill-card:hover {
  border-color: var(--primary-color);
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}
.skill-card.installed {
  border-left: 3px solid var(--success-color);
}
.skill-card.managed {
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
}
.description {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.4;
}
.meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
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
