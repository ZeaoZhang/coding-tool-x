<template>
  <div class="template-card" :class="{ 'is-builtin': template.isBuiltin }" @click="$emit('click', template)">
    <div class="card-header">
      <div class="card-title">
        <span class="name">{{ template.name }}</span>
        <n-tag :type="template.isBuiltin ? 'info' : 'success'" size="small">
          {{ template.isBuiltin ? '内置' : '自定义' }}
        </n-tag>
      </div>
      <div class="card-actions" @click.stop>
        <n-button size="small" type="primary" @click="$emit('apply', template)">应用</n-button>
        <n-button size="small" @click="$emit('preview', template)">预览</n-button>
        <template v-if="!template.isBuiltin">
          <n-button size="small" @click="$emit('edit', template)">编辑</n-button>
          <n-button size="small" type="error" :loading="deleting" @click="$emit('delete', template)">删除</n-button>
        </template>
      </div>
    </div>
    <div class="card-body">
      <div class="description" v-if="template.description">{{ truncate(template.description, 80) }}</div>
      <div class="stats">
        <span v-if="template.claudeMd?.enabled">CLAUDE.md</span>
        <span v-if="template.skills?.length">{{ template.skills.length }} Skills</span>
        <span v-if="template.agents?.length">{{ template.agents.length }} Agents</span>
        <span v-if="template.commands?.length">{{ template.commands.length }} Commands</span>
        <span v-if="template.rules?.length">{{ template.rules.length }} Rules</span>
        <span v-if="template.mcpServers?.length">{{ template.mcpServers.length }} MCP</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { NTag, NButton } from 'naive-ui'

defineProps({
  template: { type: Object, required: true },
  deleting: { type: Boolean, default: false }
})

defineEmits(['click', 'apply', 'preview', 'edit', 'delete'])

function truncate(text, len) {
  return text?.length > len ? text.slice(0, len) + '...' : text
}
</script>

<style scoped>
.template-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  padding: 12px 16px;
  cursor: pointer;
  transition: all 0.2s ease;
}
.template-card:hover {
  border-color: var(--primary-color);
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}
.template-card.is-builtin {
  border-left: 3px solid var(--info-color);
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
}
.card-title .name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}
.card-actions {
  display: flex;
  gap: 4px;
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
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
  color: var(--text-tertiary);
}
</style>
