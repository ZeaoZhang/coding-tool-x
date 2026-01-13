<template>
  <div class="template-card" :class="{ 'is-builtin': template.isBuiltin }" @click="emit('click', template)">
    <div class="card-main">
      <div class="card-header">
        <div class="template-name">{{ template.name }}</div>
        <div class="template-badges">
          <n-tag :type="template.isBuiltin ? 'default' : 'success'" size="tiny" :bordered="false">
            {{ template.isBuiltin ? '内置' : '自定义' }}
          </n-tag>
        </div>
      </div>

      <div class="template-desc" v-if="template.description">
        {{ truncateDesc(template.description) }}
      </div>

      <div class="template-stats">
        <span class="stat-item" v-if="template.claudeMd?.enabled">
          <n-icon size="12"><DocumentTextOutline /></n-icon>
          CLAUDE.md
        </span>
        <span class="stat-item" v-if="template.skills?.length">
          <n-icon size="12"><ExtensionPuzzleOutline /></n-icon>
          {{ template.skills.length }} Skills
        </span>
        <span class="stat-item" v-if="template.agents?.length">
          <n-icon size="12"><PersonOutline /></n-icon>
          {{ template.agents.length }} Agents
        </span>
        <span class="stat-item" v-if="template.commands?.length">
          <n-icon size="12"><TerminalOutline /></n-icon>
          {{ template.commands.length }} Commands
        </span>
        <span class="stat-item" v-if="template.rules?.length">
          <n-icon size="12"><ListOutline /></n-icon>
          {{ template.rules.length }} Rules
        </span>
        <span class="stat-item" v-if="template.mcpServers?.length">
          <n-icon size="12"><ServerOutline /></n-icon>
          {{ template.mcpServers.length }} MCP
        </span>
      </div>
    </div>

    <div class="card-actions">
      <n-button
        size="tiny"
        tertiary
        type="primary"
        @click.stop="emit('apply', template)"
      >
        应用
      </n-button>
      <n-button
        size="tiny"
        tertiary
        @click.stop="emit('preview', template)"
      >
        预览
      </n-button>
      <template v-if="!template.isBuiltin">
        <n-button
          size="tiny"
          tertiary
          @click.stop="emit('edit', template)"
        >
          编辑
        </n-button>
        <n-button
          size="tiny"
          tertiary
          type="error"
          :loading="props.deleting"
          @click.stop="emit('delete', template)"
        >
          删除
        </n-button>
      </template>
    </div>
  </div>
</template>

<script setup>
import { NButton, NTag, NIcon } from 'naive-ui'
import { DocumentTextOutline, PersonOutline, TerminalOutline, ListOutline, ServerOutline, ExtensionPuzzleOutline } from '@vicons/ionicons5'

const props = defineProps({
  template: {
    type: Object,
    required: true
  },
  deleting: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['click', 'edit', 'delete', 'apply', 'preview'])

function truncateDesc(desc) {
  if (!desc) return ''
  return desc.length > 100 ? desc.slice(0, 100) + '...' : desc
}
</script>

<style scoped>
.template-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  transition: all 0.15s ease;
  cursor: pointer;
}

.template-card:hover {
  border-color: #18a058;
  background: var(--bg-tertiary);
  box-shadow: 0 4px 12px rgba(24, 160, 88, 0.1);
}

.template-card.is-builtin {
  border-left: 3px solid #2080f0;
}

.card-main {
  flex: 1;
  min-width: 0;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.template-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.template-badges {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.template-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 10px;
}

.template-stats {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.card-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
