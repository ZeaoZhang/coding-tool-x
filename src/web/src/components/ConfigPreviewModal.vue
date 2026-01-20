<template>
  <n-modal
    :show="show"
    preset="card"
    :title="`模版预览: ${template?.name || ''}`"
    style="width: 750px; max-height: 80vh"
    :mask-closable="true"
    @update:show="emit('update:show', $event)"
  >
    <div class="preview-content" v-if="template">
      <!-- 基本信息 -->
      <div class="info-section">
        <div class="info-row">
          <span class="label">名称：</span>
          <span class="value">{{ template.name }}</span>
        </div>
        <div class="info-row" v-if="template.description">
          <span class="label">描述：</span>
          <span class="value">{{ template.description }}</span>
        </div>
      </div>

      <!-- 配置统计 -->
      <div class="stats-section">
        <div class="section-title">包含配置</div>
        <div class="stats-grid">
          <!-- AI 配置文件 -->
          <template v-if="hasAiConfigs">
            <div class="stat-item" v-for="ai in enabledAiConfigs" :key="ai.key">
              <n-icon size="20" :color="ai.color"><DocumentTextOutline /></n-icon>
              <span>{{ ai.fileName }}</span>
            </div>
          </template>
          <div class="stat-item" v-else-if="template.claudeMd?.enabled">
            <n-icon size="20"><DocumentTextOutline /></n-icon>
            <span>CLAUDE.md</span>
          </div>
          <div class="stat-item" v-if="template.skills?.length">
            <n-icon size="20"><ExtensionPuzzleOutline /></n-icon>
            <span>{{ template.skills.length }} Skills</span>
          </div>
          <div class="stat-item" v-if="template.agents?.length">
            <n-icon size="20"><PeopleOutline /></n-icon>
            <span>{{ template.agents.length }} Agents</span>
          </div>
          <div class="stat-item" v-if="template.commands?.length">
            <n-icon size="20"><TerminalOutline /></n-icon>
            <span>{{ template.commands.length }} Commands</span>
          </div>
          <div class="stat-item" v-if="template.rules?.length">
            <n-icon size="20"><ShieldCheckmarkOutline /></n-icon>
            <span>{{ template.rules.length }} Rules</span>
          </div>
          <div class="stat-item" v-if="template.mcpServers?.length">
            <n-icon size="20"><ServerOutline /></n-icon>
            <span>{{ template.mcpServers.length }} MCP Servers</span>
          </div>
        </div>
      </div>

      <!-- 详细内容 -->
      <n-collapse v-if="hasDetails" class="details-section">
        <!-- AI 配置文件内容（支持多个） -->
        <n-collapse-item
          v-for="ai in enabledAiConfigs"
          :key="ai.key"
          :title="`${ai.name} 配置 (${ai.fileName})`"
          :name="ai.key"
        >
          <div class="markdown-content">
            <MarkdownViewer :content="ai.content" />
          </div>
        </n-collapse-item>
        <!-- 兼容旧的 claudeMd 字段 -->
        <n-collapse-item
          v-if="!hasAiConfigs && template.claudeMd?.content"
          title="CLAUDE.md 内容"
          name="claudeMd"
        >
          <div class="markdown-content">
            <MarkdownViewer :content="template.claudeMd.content" />
          </div>
        </n-collapse-item>
        <n-collapse-item title="Skills 列表" name="skills" v-if="template.skills?.length">
          <div class="list-items">
            <div v-for="(item, idx) in template.skills" :key="idx" class="list-item">
              {{ item.name || item }}
            </div>
          </div>
        </n-collapse-item>
        <n-collapse-item title="Agents 列表" name="agents" v-if="template.agents?.length">
          <div class="list-items">
            <div v-for="(item, idx) in template.agents" :key="idx" class="list-item">
              {{ item.name || item }}
            </div>
          </div>
        </n-collapse-item>
        <n-collapse-item title="Commands 列表" name="commands" v-if="template.commands?.length">
          <div class="list-items">
            <div v-for="(item, idx) in template.commands" :key="idx" class="list-item">
              {{ item.name || item }}
            </div>
          </div>
        </n-collapse-item>
        <n-collapse-item title="Rules 列表" name="rules" v-if="template.rules?.length">
          <div class="list-items">
            <div v-for="(item, idx) in template.rules" :key="idx" class="list-item">
              {{ item.name || item }}
            </div>
          </div>
        </n-collapse-item>
        <n-collapse-item title="MCP Servers" name="mcpServers" v-if="template.mcpServers?.length">
          <div class="list-items">
            <div v-for="(item, idx) in template.mcpServers" :key="idx" class="list-item">
              {{ item.name || item }}
            </div>
          </div>
        </n-collapse-item>
      </n-collapse>
    </div>

    <template #footer>
      <n-space justify="end">
        <n-button @click="emit('update:show', false)">关闭</n-button>
        <n-button type="primary" @click="handleApply">应用此模版</n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup>
import { computed } from 'vue'
import { NModal, NIcon, NCollapse, NCollapseItem, NButton, NSpace } from 'naive-ui'
import MarkdownViewer from './MarkdownViewer.vue'
import {
  DocumentTextOutline,
  ExtensionPuzzleOutline,
  PeopleOutline,
  TerminalOutline,
  ShieldCheckmarkOutline,
  ServerOutline
} from '@vicons/ionicons5'

const props = defineProps({
  show: Boolean,
  template: Object
})

const emit = defineEmits(['update:show', 'apply'])

// AI 配置类型信息
const AI_CONFIG_INFO = {
  claude: { key: 'claude', name: 'Claude', fileName: 'CLAUDE.md', color: '#cc785c' },
  codex: { key: 'codex', name: 'Codex', fileName: 'AGENTS.md', color: '#10a37f' },
  gemini: { key: 'gemini', name: 'Gemini', fileName: 'GEMINI.md', color: '#4285f4' }
}

// 检查是否有新的 aiConfigs 结构
const hasAiConfigs = computed(() => {
  const aiConfigs = props.template?.aiConfigs
  if (!aiConfigs) return false
  return Object.values(aiConfigs).some(cfg => cfg?.enabled && cfg?.content)
})

// 获取启用的 AI 配置列表
const enabledAiConfigs = computed(() => {
  const aiConfigs = props.template?.aiConfigs
  if (!aiConfigs) return []

  return Object.entries(aiConfigs)
    .filter(([, cfg]) => cfg?.enabled && cfg?.content)
    .map(([key, cfg]) => ({
      ...AI_CONFIG_INFO[key],
      content: cfg.content
    }))
})

const hasDetails = computed(() => {
  const t = props.template
  if (!t) return false
  return hasAiConfigs.value || t.claudeMd?.content || t.skills?.length || t.agents?.length ||
         t.commands?.length || t.rules?.length || t.mcpServers?.length
})

function handleApply() {
  emit('apply', props.template)
}
</script>

<style scoped>
.preview-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: calc(80vh - 140px);
  overflow-y: auto;
}
.info-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.info-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.info-row .label {
  color: var(--text-tertiary);
  font-size: 13px;
  min-width: 50px;
}
.info-row .value {
  color: var(--text-primary);
  font-size: 14px;
}
.stats-section {
  background: var(--bg-secondary);
  border-radius: 8px;
  padding: 12px;
}
.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 10px;
}
.stats-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.stat-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--bg-primary);
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-secondary);
}
.details-section {
  margin-top: 8px;
}
.list-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.list-item {
  padding: 6px 10px;
  background: var(--bg-secondary);
  border-radius: 4px;
  font-size: 13px;
  color: var(--text-primary);
}
.markdown-content {
  max-height: 400px;
  overflow-y: auto;
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: 6px;
}
</style>
