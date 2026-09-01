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
import { useEnabledCliPlatforms } from '../composables/useEnabledCliPlatforms'

const route = useRoute()
const { byCapability } = useEnabledCliPlatforms()
const skillPlatforms = computed(() => byCapability('skills').map(item => item.key))
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
