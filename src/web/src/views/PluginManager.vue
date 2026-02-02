<template>
  <div class="plugin-manager">
    <n-card title="Plugins 插件管理" :bordered="false">
      <PluginsPanel :in-drawer="false" :hide-back="true" />
    </n-card>
  </div>
</template>

<script setup>
import { NCard } from 'naive-ui'
import PluginsPanel from '../components/PluginsPanel.vue'
</script>

<style scoped>
.plugin-manager {
  padding: 16px;
}
</style>
