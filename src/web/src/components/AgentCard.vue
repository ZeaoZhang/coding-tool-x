<template>
  <div class="agent-card" :class="{ 'is-project': agent.scope === 'project' }" @click="emit('click', agent)">
    <div class="card-main">
      <div class="card-header">
        <div class="agent-name">{{ agent.name }}</div>
        <div class="agent-badges">
          <n-tag :type="agent.scope === 'user' ? 'info' : 'success'" size="tiny" :bordered="false">
            {{ agent.scope === 'user' ? '用户级' : '项目级' }}
          </n-tag>
          <n-tag v-if="agent.model" type="warning" size="tiny" :bordered="false">
            {{ agent.model }}
          </n-tag>
        </div>
      </div>

      <div class="agent-desc" v-if="agent.description">
        {{ truncateDesc(agent.description) }}
      </div>

      <div class="agent-meta">
        <span class="meta-item" v-if="agent.tools">
          <n-icon size="12"><HammerOutline /></n-icon>
          {{ truncateTools(agent.tools) }}
        </span>
        <span class="meta-item" v-if="agent.permissionMode">
          <n-icon size="12"><ShieldOutline /></n-icon>
          {{ agent.permissionMode }}
        </span>
      </div>
    </div>

    <div class="card-actions">
      <n-button
        size="tiny"
        tertiary
        @click.stop="emit('edit', agent)"
      >
        编辑
      </n-button>
      <n-button
        size="tiny"
        tertiary
        type="error"
        :loading="props.deleting"
        @click.stop="emit('delete', agent)"
      >
        删除
      </n-button>
    </div>
  </div>
</template>

<script setup>
import { NButton, NTag, NIcon } from 'naive-ui'
import { HammerOutline, ShieldOutline } from '@vicons/ionicons5'

const props = defineProps({
  agent: {
    type: Object,
    required: true
  },
  deleting: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['click', 'edit', 'delete'])

function truncateDesc(desc) {
  if (!desc) return ''
  return desc.length > 80 ? desc.slice(0, 80) + '...' : desc
}

function truncateTools(tools) {
  if (!tools) return ''
  return tools.length > 30 ? tools.slice(0, 30) + '...' : tools
}
</script>

<style scoped>
.agent-card {
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

.agent-card:hover {
  border-color: #18a058;
  background: var(--bg-tertiary);
  box-shadow: 0 4px 12px rgba(24, 160, 88, 0.1);
}

.agent-card.is-project {
  border-left: 3px solid #18a058;
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

.agent-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.agent-badges {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.agent-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 8px;
}

.agent-meta {
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
</style>
