<template>
  <div class="app-layout">
    <!-- Left Content Area -->
    <div class="left-content">
      <!-- Project List View -->
      <ProjectList
        v-if="currentView === 'projects'"
        @select-project="handleSelectProject"
      />

      <!-- Session List View -->
      <SessionList
        v-else-if="currentView === 'sessions'"
        :project-name="selectedProject"
        @back="handleBack"
      />
    </div>

    <!-- Right Panel (Fixed 400px) -->
    <RightPanel />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import ProjectList from '../views/ProjectList.vue'
import SessionList from '../views/SessionList.vue'
import RightPanel from './RightPanel.vue'

const currentView = ref('projects') // 'projects' or 'sessions'
const selectedProject = ref('')

function handleSelectProject(projectName) {
  selectedProject.value = projectName
  currentView.value = 'sessions'
}

function handleBack() {
  currentView.value = 'projects'
  selectedProject.value = ''
}
</script>

<style scoped>
.app-layout {
  display: flex;
  min-height: 100vh;
  background: #ffffff;
}

.left-content {
  flex: 1;
  min-width: 0; /* Important for flex child */
  overflow: hidden;
}
</style>
