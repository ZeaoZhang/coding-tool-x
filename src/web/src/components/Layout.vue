<template>
  <div class="layout">
    <!-- Global Header -->
    <header class="header">
      <div class="logo-section" @click="goHome">
        <n-icon size="32" color="#18a058">
          <CodeSlashOutline />
        </n-icon>
        <h1 class="title">CC-Tool 辅助工具</h1>
      </div>

      <div class="header-actions">
        <n-tooltip placement="bottom">
          <template #trigger>
            <n-button text @click="showRecentDrawer = true">
              <n-icon size="24" color="#18a058">
                <ChatbubblesOutline />
              </n-icon>
            </n-button>
          </template>
          最新对话
        </n-tooltip>
      </div>
    </header>

    <div class="main-container">
      <!-- Left Content Area (Router View) -->
      <div class="left-content">
        <router-view />
      </div>

      <!-- Right Panel (Global) -->
      <RightPanel />
    </div>

    <!-- Recent Sessions Drawer -->
    <RecentSessionsDrawer v-model:visible="showRecentDrawer" />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { NIcon, NButton, NTooltip } from 'naive-ui'
import { CodeSlashOutline, ChatbubblesOutline } from '@vicons/ionicons5'
import RightPanel from './RightPanel.vue'
import RecentSessionsDrawer from './RecentSessionsDrawer.vue'

const router = useRouter()
const showRecentDrawer = ref(false)

function goHome() {
  router.push({ name: 'projects' })
}
</script>

<style scoped>
.layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #ffffff;
}

.header {
  height: 64px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  z-index: 10;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo-section {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  transition: opacity 0.2s;
}

.logo-section:hover {
  opacity: 0.8;
}

.title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: #18181b;
  user-select: none;
}

.main-container {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.left-content {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
</style>
