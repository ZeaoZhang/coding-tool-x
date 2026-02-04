<template>
  <div class="command-card" :class="{ 'is-project': command.scope === 'project', 'managed': registryInfo }" @click="emit('click', command)">
    <div class="card-main">
      <div class="card-header">
        <div class="command-name">/{{ command.name }}</div>
        <div class="command-badges">
          <n-tag :type="command.scope === 'user' ? 'info' : 'success'" size="tiny" :bordered="false">
            {{ command.scope === 'user' ? '用户级' : '项目级' }}
          </n-tag>
          <n-tag v-if="command.namespace" type="warning" size="tiny" :bordered="false">
            {{ command.namespace }}
          </n-tag>
        </div>
      </div>

      <div class="command-desc" v-if="command.description">
        {{ truncateDesc(command.description) }}
      </div>

      <div class="command-meta">
        <span class="meta-item" v-if="command.allowedTools">
          <n-icon size="12"><HammerOutline /></n-icon>
          {{ command.allowedTools }}
        </span>
        <span class="meta-item" v-if="command.argumentHint">
          <n-icon size="12"><CodeOutline /></n-icon>
          {{ command.argumentHint }}
        </span>
      </div>
    </div>

    <div class="card-actions">
      <!-- 注册表管理模式 -->
      <template v-if="registryInfo">
        <n-tooltip trigger="hover">
          <template #trigger>
            <n-switch
              :value="registryInfo.enabled"
              size="small"
              :loading="toggling"
              @update:value="emit('toggle-enabled', command, $event)"
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
                @click.stop="emit('toggle-platform', command, 'claude', !registryInfo.platforms?.claude)"
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
                @click.stop="emit('toggle-platform', command, 'codex', !registryInfo.platforms?.codex)"
              >
                <n-icon size="14"><TerminalOutline /></n-icon>
              </span>
            </template>
            Codex CLI {{ registryInfo.platforms?.codex ? '已启用' : '未启用' }}
          </n-tooltip>
        </div>
      </template>
      <!-- 原有模式 -->
      <template v-else>
        <n-button
          size="tiny"
          tertiary
          @click.stop="emit('edit', command)"
        >
          编辑
        </n-button>
        <n-button
          size="tiny"
          tertiary
          type="error"
          :loading="props.deleting"
          @click.stop="emit('delete', command)"
        >
          删除
        </n-button>
      </template>
    </div>
  </div>
</template>

<script setup>
import { NButton, NTag, NIcon, NSwitch, NTooltip } from 'naive-ui'
import { HammerOutline, CodeOutline, LogoApple, TerminalOutline } from '@vicons/ionicons5'

const props = defineProps({
  command: {
    type: Object,
    required: true
  },
  deleting: {
    type: Boolean,
    default: false
  },
  registryInfo: {
    type: Object,
    default: null
  },
  toggling: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['click', 'edit', 'delete', 'toggle-enabled', 'toggle-platform'])

function truncateDesc(desc) {
  if (!desc) return ''
  return desc.length > 80 ? desc.slice(0, 80) + '...' : desc
}
</script>

<style scoped>
.command-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 6px;
  transition: all 0.15s ease;
  cursor: pointer;
}

.command-card:hover {
  border-color: #18a058;
  background: var(--bg-tertiary);
  box-shadow: 0 4px 12px rgba(24, 160, 88, 0.1);
}

.command-card.is-project {
  border-left: 3px solid #18a058;
}

.command-card.managed {
  border-left: 3px solid var(--primary-color);
}

.card-main {
  flex: 1;
  min-width: 0;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.command-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  font-family: monospace;
}

.command-badges {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.command-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 8px;
}

.command-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.platform-icons {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 8px;
}

.platform-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--text-tertiary);
  background: var(--bg-tertiary);
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
