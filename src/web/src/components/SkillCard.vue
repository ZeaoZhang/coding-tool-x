<template>
  <div class="skill-card" :class="{ installed: skill.installed }" @click="$emit('click', skill)">
    <div class="card-header">
      <div class="card-title">
        <span class="name">{{ skill.name }}</span>
        <n-tag v-if="skill.installed" type="info" size="small">已安装</n-tag>
        <n-tag v-if="getSkillSourceTag(skill)" type="info" size="small">{{ getSkillSourceTag(skill) }}</n-tag>
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
          :disabled="!canInstallSkill(skill)"
          :focusable="false"
          @click="$emit('install', skill)"
        >安装</n-button>
      </div>
    </div>
    <div class="card-body">
      <div class="description" v-if="skill.description">{{ truncate(skill.description, 80) }}</div>
      <div class="meta">
        <span class="meta-item">{{ skill.directory }}</span>
        <span v-if="getSkillSourceLocation(skill)" class="meta-item source-item" :title="getSkillSourceLocation(skill)">
          {{ getSkillSourceLocation(skill) }}
        </span>
        <a
          v-if="getSkillSourceLink(skill)"
          class="meta-link"
          :href="getSkillSourceLink(skill)"
          target="_blank"
          rel="noopener noreferrer"
          @click.stop
        >{{ getSkillSourceLinkLabel(skill) }}</a>
      </div>
    </div>
  </div>
</template>

<script setup>
import { NTag, NButton } from 'naive-ui'
import {
  canInstallSkill,
  getSkillSourceLink,
  getSkillSourceLinkLabel,
  getSkillSourceLocation,
  getSkillSourceTag
} from '../utils/skill-source'

defineProps({
  skill: { type: Object, required: true },
  installing: { type: Boolean, default: false },
  uninstalling: { type: Boolean, default: false }
})

defineEmits(['click', 'install', 'uninstall'])

function truncate(text, len) {
  return text?.length > len ? text.slice(0, len) + '...' : text
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
  flex-wrap: wrap;
  gap: 12px;
  font-size: 12px;
}
.meta-item {
  color: var(--text-tertiary);
  font-family: monospace;
}
.source-item {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta-link {
  color: var(--primary-color);
  text-decoration: none;
}
.meta-link:hover {
  text-decoration: underline;
}

</style>
