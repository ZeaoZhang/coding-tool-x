<template>
  <div class="skill-manager">
    <n-card title="Skills 技能管理" :bordered="false">
      <SkillsPanel :in-drawer="false" :hide-back="true" />
    </n-card>
  </div>
</template>

<script setup>
import { NCard } from 'naive-ui'
import SkillsPanel from '../components/SkillsPanel.vue'
</script>

<style scoped>
.skill-manager {
  padding: 16px;
}
</style>
