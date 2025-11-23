<template>
  <div class="dashboard-container">
    <div class="dashboard-grid">
      <!-- Claude 渠道列 -->
      <ChannelColumn channel-type="claude" />

      <!-- Codex 渠道列 -->
      <ChannelColumn channel-type="codex" />

      <!-- Gemini 渠道列 -->
      <ChannelColumn channel-type="gemini" />
    </div>
  </div>
</template>

<script setup>
import ChannelColumn from '../components/dashboard/ChannelColumn.vue'
</script>

<style scoped>
.dashboard-container {
  height: 100%;
  background: var(--bg-primary);
  overflow: hidden;
  padding: 12px;
  box-sizing: border-box;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  height: 100%;
  overflow: hidden;
  box-sizing: border-box;
}

/* 响应式设计 */
@media (max-width: 1400px) {
  .dashboard-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 900px) {
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
}
</style>
