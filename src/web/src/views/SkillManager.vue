<template>
  <div class="skill-manager">
    <n-card title="Skills 技能管理" :bordered="false">
      <SkillsPanel :in-drawer="false" :hide-back="true" :platform="platform" />
    </n-card>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { NCard } from 'naive-ui'
import SkillsPanel from '../components/SkillsPanel.vue'
import { BUILT_IN_CLI_PLATFORMS } from '../config/platforms'

const route = useRoute()
const skillPlatforms = BUILT_IN_CLI_PLATFORMS
  .filter(platform => platform.supportsSkills !== false)
  .map(platform => platform.key)
const platform = computed(() => skillPlatforms.includes(route.query.platform) ? route.query.platform : '')
</script>

<style scoped>
.skill-manager {
  padding: 16px;
}
</style>
