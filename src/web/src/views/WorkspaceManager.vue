<template>
  <div class="workspace-manager">
    <n-card title="工作区管理" :bordered="false">
      <WorkspacePanel :in-drawer="false" :hide-back="true" />
    </n-card>
  </div>
</template>

<script setup>
import { NCard } from 'naive-ui'
import WorkspacePanel from '../components/WorkspacePanel.vue'
</script>

<style scoped>
.workspace-manager {
  padding: 16px;
}
</style>
