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
import { usePlatformStore } from '../stores/platforms'

const route = useRoute()
const platformStore = usePlatformStore()
const skillPlatforms = computed(() => platformStore.all
  .filter(item => item.capabilities?.skills === true)
  .map(item => item.key))
const platform = computed(() => {
  const queryPlatform = Array.isArray(route.query.platform)
    ? route.query.platform[0]
    : route.query.platform
  return skillPlatforms.value.includes(queryPlatform) ? queryPlatform : ''
})

</script>
<style scoped>
.skill-manager {
  padding: 16px;
}
</style>
