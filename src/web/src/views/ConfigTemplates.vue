<template>
  <div class="config-templates-page">
    <n-card title="配置模版管理" :bordered="false">
      <ConfigTemplatesPanel :in-drawer="false" :hide-back="true" />
    </n-card>
  </div>
</template>

<script setup>
import { NCard } from 'naive-ui'
import ConfigTemplatesPanel from '../components/ConfigTemplatesPanel.vue'
</script>

<style scoped>
.config-templates-page {
  padding: 16px;
}
</style>
