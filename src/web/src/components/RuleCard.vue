<template>
  <div class="rule-card" :class="{ 'is-project': rule.scope === 'project', 'is-conditional': !!rule.paths }" @click="emit('click', rule)">
    <div class="card-main">
      <div class="card-header">
        <div class="rule-name">{{ rule.name }}</div>
        <div class="rule-badges">
          <n-tag :type="rule.scope === 'user' ? 'info' : 'success'" size="tiny" :bordered="false">
            {{ rule.scope === 'user' ? '用户级' : '项目级' }}
          </n-tag>
          <n-tag v-if="rule.paths" type="warning" size="tiny" :bordered="false">
            条件规则
          </n-tag>
          <n-tag v-if="rule.directory" type="default" size="tiny" :bordered="false">
            {{ rule.directory }}
          </n-tag>
        </div>
      </div>

      <div class="rule-preview" v-if="rule.body">
        {{ truncateBody(rule.body) }}
      </div>

      <div class="rule-meta">
        <span class="meta-item" v-if="rule.paths">
          <n-icon size="12"><GitBranchOutline /></n-icon>
          {{ rule.paths }}
        </span>
        <span class="meta-item" v-if="rule.path">
          <n-icon size="12"><DocumentOutline /></n-icon>
          {{ rule.path }}
        </span>
      </div>
    </div>

    <div class="card-actions">
      <n-button
        size="tiny"
        tertiary
        @click.stop="emit('edit', rule)"
      >
        编辑
      </n-button>
      <n-button
        size="tiny"
        tertiary
        type="error"
        :loading="props.deleting"
        @click.stop="emit('delete', rule)"
      >
        删除
      </n-button>
    </div>
  </div>
</template>

<script setup>
import { NButton, NTag, NIcon } from 'naive-ui'
import { GitBranchOutline, DocumentOutline } from '@vicons/ionicons5'

const props = defineProps({
  rule: {
    type: Object,
    required: true
  },
  deleting: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['click', 'edit', 'delete'])

function truncateBody(body) {
  if (!body) return ''
  const firstLine = body.split('\n')[0]
  return firstLine.length > 80 ? firstLine.slice(0, 80) + '...' : firstLine
}
</script>

<style scoped>
.rule-card {
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

.rule-card:hover {
  border-color: #18a058;
  background: var(--bg-tertiary);
  box-shadow: 0 4px 12px rgba(24, 160, 88, 0.1);
}

.rule-card.is-project {
  border-left: 3px solid #18a058;
}

.rule-card.is-conditional {
  border-left: 3px solid #f0a020;
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

.rule-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.rule-badges {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.rule-preview {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rule-meta {
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
  max-width: 200px;
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
