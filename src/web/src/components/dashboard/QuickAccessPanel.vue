<template>
  <div class="panel-card">
    <div class="panel-header">
      <n-icon :size="20" color="#18a058">
        <RocketOutline />
      </n-icon>
      <h3 class="panel-title">Quick Access</h3>
    </div>

    <div class="access-list">
      <!-- Claude -->
      <div class="access-item" @click="goToChannel('claude')">
        <div class="access-icon claude">
          <n-icon :size="24">
            <LayersOutline />
          </n-icon>
        </div>
        <div class="access-info">
          <div class="access-name">Claude Code</div>
          <div class="access-stats">{{ claudeStats.projects }} Projects · {{ claudeStats.sessions }} Sessions</div>
        </div>
        <n-icon :size="16" color="var(--text-tertiary)">
          <ChevronForwardOutline />
        </n-icon>
      </div>

      <!-- Codex -->
      <div class="access-item" @click="goToChannel('codex')">
        <div class="access-icon codex">
          <n-icon :size="24">
            <CodeSlashOutline />
          </n-icon>
        </div>
        <div class="access-info">
          <div class="access-name">Codex</div>
          <div class="access-stats">{{ codexStats.projects }} Projects · {{ codexStats.sessions }} Sessions</div>
        </div>
        <n-icon :size="16" color="var(--text-tertiary)">
          <ChevronForwardOutline />
        </n-icon>
      </div>

      <!-- Gemini -->
      <div class="access-item" @click="goToChannel('gemini')">
        <div class="access-icon gemini">
          <n-icon :size="24">
            <ColorPaletteOutline />
          </n-icon>
        </div>
        <div class="access-info">
          <div class="access-name">Gemini</div>
          <div class="access-stats">{{ geminiStats.projects }} Projects · {{ geminiStats.sessions }} Sessions</div>
        </div>
        <n-icon :size="16" color="var(--text-tertiary)">
          <ChevronForwardOutline />
        </n-icon>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { NIcon } from 'naive-ui'
import { RocketOutline, LayersOutline, CodeSlashOutline, ColorPaletteOutline, ChevronForwardOutline } from '@vicons/ionicons5'
import axios from 'axios'

const router = useRouter()

const claudeStats = ref({ projects: 0, sessions: 0 })
const codexStats = ref({ projects: 0, sessions: 0 })
const geminiStats = ref({ projects: 0, sessions: 0 })

async function loadStats() {
  // Claude
  try {
    const projects = await axios.get('/api/projects')
    const sessions = await axios.get('/api/sessions')
    claudeStats.value.projects = projects.data.length || 0
    claudeStats.value.sessions = sessions.data.length || 0
  } catch (error) {
    console.error('Failed to load Claude stats:', error)
  }

  // Codex
  try {
    const projects = await axios.get('/api/codex/projects')
    const sessions = await axios.get('/api/codex/sessions')
    codexStats.value.projects = projects.data.length || 0
    codexStats.value.sessions = sessions.data.length || 0
  } catch (error) {
    console.error('Failed to load Codex stats:', error)
  }

  // Gemini
  try {
    const projects = await axios.get('/api/gemini/projects')
    const sessions = await axios.get('/api/gemini/sessions')
    geminiStats.value.projects = projects.data.length || 0
    geminiStats.value.sessions = sessions.data.length || 0
  } catch (error) {
    console.error('Failed to load Gemini stats:', error)
  }
}

function goToChannel(channel) {
  router.push({ name: `${channel}-projects` })
}

onMounted(() => {
  loadStats()
})
</script>

<style scoped>
.panel-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 12px;
  padding: 20px;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.panel-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary);
}

.access-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.access-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.access-item:hover {
  border-color: #18a058;
  transform: translateX(4px);
}

.access-icon {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.access-icon.claude {
  background: rgba(24, 160, 88, 0.1);
  color: #18a058;
}

.access-icon.codex {
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
}

.access-icon.gemini {
  background: rgba(168, 85, 247, 0.1);
  color: #a855f7;
}

.access-item:hover .access-icon {
  transform: scale(1.1);
}

.access-info {
  flex: 1;
}

.access-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.access-stats {
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
