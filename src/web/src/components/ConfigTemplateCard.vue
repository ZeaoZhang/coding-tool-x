<template>
  <div class="template-card" @click="$emit('click', template)">
    <div class="card-header">
      <div class="card-title">
        <span class="name">{{ template.name }}</span>
        <n-tag v-if="template.cliType" size="small" :color="cliTypeStyle(template.cliType)" round>
          {{ cliTypeLabel(template.cliType) }}
        </n-tag>
      </div>
      <div class="card-actions" @click.stop>
        <n-button size="small" type="primary" @click="$emit('apply', template)">应用</n-button>
        <n-button size="small" @click="$emit('preview', template)">预览</n-button>
        <n-button size="small" @click="$emit('edit', template)">编辑</n-button>
        <n-button size="small" type="error" :loading="deleting" @click="$emit('delete', template)">删除</n-button>
      </div>
    </div>
    <div class="card-body">
      <div class="description" v-if="template.description">{{ truncate(template.description, 80) }}</div>
      <div class="stats">
        <span v-if="activeAiConfigFile">{{ activeAiConfigFile }}</span>
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
import { computed } from 'vue'
import { NButton, NTag } from 'naive-ui'

const props = defineProps({
  template: { type: Object, required: true },
  deleting: { type: Boolean, default: false }
})

defineEmits(['click', 'apply', 'preview', 'edit', 'delete'])

function truncate(text, len) {
  return text?.length > len ? text.slice(0, len) + '...' : text
}

const CLI_TYPE_MAP = {
  claude: { label: 'Claude', color: '#cc785c', textColor: '#fff', borderColor: '#cc785c' },
  codex: { label: 'Codex', color: '#10a37f', textColor: '#fff', borderColor: '#10a37f' },
  gemini: { label: 'Gemini', color: '#4285f4', textColor: '#fff', borderColor: '#4285f4' },
  opencode: { label: 'OpenCode', color: '#ff6b35', textColor: '#fff', borderColor: '#ff6b35' }
}

const CLI_AI_FILE = {
  claude: 'CLAUDE.md',
  codex: 'AGENTS.md',
  gemini: 'GEMINI.md',
  opencode: '.opencode/AGENTS.md'
}

function cliTypeLabel(type) {
  return CLI_TYPE_MAP[type]?.label || type
}

function cliTypeStyle(type) {
  const style = CLI_TYPE_MAP[type]
  if (!style) return {}
  return { color: style.color, textColor: style.textColor, borderColor: style.borderColor }
}

const activeAiConfigFile = computed(() => {
  const t = props.template
  const cliType = t?.cliType
  if (!cliType || cliType === 'all') return null
  const aiCfg = t?.aiConfigs?.[cliType]
  if (aiCfg?.enabled) return CLI_AI_FILE[cliType] || null
  // fallback: legacy claudeMd
  if (cliType === 'claude' && t?.claudeMd?.enabled) return 'CLAUDE.md'
  return null
})
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
