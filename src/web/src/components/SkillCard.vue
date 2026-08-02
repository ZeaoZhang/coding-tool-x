<template>
  <div class="skill-card asset-card" :class="{ 'is-installed': skill.installed, 'is-protected': skill.protected }" @click="$emit('click', skill)">
    <div class="asset-card-main">
      <div class="asset-card-top">
        <div class="asset-card-title-stack">
          <div class="asset-card-title-row">
            <span class="asset-status-dot" :class="{ active: skill.installed }"></span>
            <span class="asset-name">{{ skill.name }}</span>
          </div>
          <div class="asset-tags">
            <n-tag v-if="skill.installed" type="success" size="tiny" :bordered="false">已安装</n-tag>
            <n-tag v-if="skill.protected" type="default" size="tiny" :bordered="false">受保护</n-tag>
            <n-tag v-if="skill.readonly" type="default" size="tiny" :bordered="false">只读</n-tag>
            <n-tag v-if="getSkillSourceTag(skill)" type="info" size="tiny" :bordered="false">{{ getSkillSourceTag(skill) }}</n-tag>
          </div>
        </div>
      </div>
      <div class="asset-description" v-if="skill.description">{{ truncate(skill.description, 120) }}</div>
      <div class="asset-meta">
        <span class="asset-meta-item mono">{{ skill.directory }}</span>
        <span v-if="getSkillSourceLocation(skill)" class="asset-meta-item source-item" :title="getSkillSourceLocation(skill)">
          {{ getSkillSourceLocation(skill) }}
        </span>
        <a
          v-if="getSkillSourceLink(skill)"
          class="asset-link"
          :href="getSkillSourceLink(skill)"
          target="_blank"
          rel="noopener noreferrer"
          @click.stop
        >{{ getSkillSourceLinkLabel(skill) }}</a>
      </div>
    </div>
    <div v-if="!skill.readonly" class="asset-card-actions" @click.stop>
      <n-button
        v-if="skill.installed && !skill.protected && !skill.readonly"
        size="small"
        tertiary
        type="error"
        :loading="uninstalling"
        :focusable="false"
        @click="$emit('uninstall', skill)"
      >卸载</n-button>
      <n-button
        v-else-if="skill.installed && skill.protected"
        size="small"
        tertiary
        disabled
        :focusable="false"
      >受保护</n-button>
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
.source-item {
  max-width: 100%;
}
</style>
