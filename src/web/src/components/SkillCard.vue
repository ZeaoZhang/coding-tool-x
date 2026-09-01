<template>
  <div class="skill-card asset-card" :class="{ 'is-enabled': skill.enabled, 'is-protected': skill.protected }" @click="$emit('click', skill)">
    <div class="asset-card-main">
      <div class="asset-card-top">
        <div class="asset-card-title-stack">
          <div class="asset-card-title-row">
            <span class="asset-status-dot" :class="{ active: skill.enabled }"></span>
            <span class="asset-name">{{ skill.name }}</span>
          </div>
          <div class="asset-tags">
            <n-tag v-if="skill.enabled" type="success" size="tiny" :bordered="false">已启用</n-tag>
            <n-tag v-else type="default" size="tiny" :bordered="false">已关闭</n-tag>
            <n-tag v-if="skill.cached" type="info" size="tiny" :bordered="false">已缓存</n-tag>
            <n-tag v-if="skill.trust === 'approved'" type="success" size="tiny" :bordered="false">已批准</n-tag>
            <n-tag v-if="skill.trust === 'blocked'" type="error" size="tiny" :bordered="false">已阻止</n-tag>
            <n-tag v-if="skill.trust === 'pending'" type="warning" size="tiny" :bordered="false">待审批</n-tag>
            <n-tag v-if="skill.trust === 'needs_review'" type="warning" size="tiny" :bordered="false">需复审</n-tag>
            <n-tag v-if="skill.protected" type="default" size="tiny" :bordered="false">受保护</n-tag>
            <n-tag v-if="skill.projection?.state === 'unsupported'" type="warning" size="tiny" :bordered="false">不支持投影</n-tag>
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
    <div class="asset-card-actions" @click.stop>
      <n-button
        v-if="['pending', 'needs_review'].includes(skill.trust) && !(panelScope === 'project' && skill.sourceScope !== 'project')"
        size="small"
        tertiary
        type="warning"
        @click="$emit('approve', skill)"
      >审批</n-button>
      <n-switch
        :value="skill.enabled"
        :loading="toggling"
        :disabled="skill.protected || skill.readonly || skill.managed === false || !skill.cached || skill.trust !== 'approved' || skill.projection?.state === 'unsupported' || (panelScope === 'project' && skill.sourceScope !== 'project')"
        :aria-label="`${skill.name} 开关`"
        @update:value="$emit('toggle', skill, $event)"
      />
    </div>
  </div>
</template>

<script setup>
import { NTag, NButton, NSwitch } from 'naive-ui'
import {
  getSkillSourceLink,
  getSkillSourceLinkLabel,
  getSkillSourceLocation,
  getSkillSourceTag
} from '../utils/skill-source'

defineProps({
  skill: { type: Object, required: true },
  toggling: { type: Boolean, default: false },
  panelScope: { type: String, default: 'user' }
})

defineEmits(['click', 'toggle', 'approve'])

function truncate(text, len) {
  return text?.length > len ? text.slice(0, len) + '...' : text
}
</script>

<style scoped>
.source-item {
  max-width: 100%;
}
</style>
