<template>
  <n-drawer v-model:show="visible" :width="drawerWidth" placement="right" :show-mask="true">
    <n-drawer-content title="项目配置" closable :native-scrollbar="false">
      <div class="project-config-content">
        <div class="project-config-header">
          <div>
            <div class="project-config-title">当前项目</div>
            <n-text depth="3" class="project-path">{{ projectPath }}</n-text>
          </div>
          <n-select
            v-model:value="selectedPlatform"
            size="small"
            :options="platformOptions"
            :disabled="loading"
            style="width: 130px"
          />
        </div>

        <n-spin :show="loading">
          <n-tabs v-model:value="activeTab" type="line" animated>
            <n-tab-pane name="instruction" tab="项目指令">
              <ProjectInstructionPanel
                :project-path="projectPath"
                :platform="selectedPlatform"
                :instruction="snapshot?.instruction"
                @updated="loadSnapshot"
              />
            </n-tab-pane>
            <n-tab-pane name="skills" tab="Skills">
              <div v-if="snapshot?.capabilities?.skills === false" class="unsupported-state">
                当前平台不提供项目 Skills
              </div>
              <SkillsPanel
                v-else
                :platform="selectedPlatform"
                :project-path="projectPath"
                scope="project"
                in-drawer
                :drawer-visible="visible"
              />
            </n-tab-pane>
            <n-tab-pane name="mcp" tab="MCP">
              <div v-if="snapshot?.capabilities?.mcp === false" class="unsupported-state">
                当前平台不提供项目 MCP
              </div>
              <ProjectMcpPanel
                v-else
                :project-path="projectPath"
                :platform="selectedPlatform"
                :mcp="snapshot?.mcp"
                @updated="loadSnapshot"
              />
            </n-tab-pane>
          </n-tabs>
        </n-spin>
      </div>
    </n-drawer-content>
  </n-drawer>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { NDrawer, NDrawerContent, NSelect, NSpin, NTabPane, NTabs, NText } from 'naive-ui'
import { getProjectConfig } from '../api/project-config'
import ProjectInstructionPanel from './ProjectInstructionPanel.vue'
import ProjectMcpPanel from './ProjectMcpPanel.vue'
import SkillsPanel from './SkillsPanel.vue'
import { useResponsiveDrawer } from '../composables/useResponsiveDrawer'

const props = defineProps({
  show: { type: Boolean, default: false },
  projectPath: { type: String, default: '' },
  platform: { type: String, default: 'claude' }
})

const emit = defineEmits(['update:show'])
const { drawerWidth } = useResponsiveDrawer(760)
const visible = computed({
  get: () => props.show,
  set: value => emit('update:show', value)
})

const platformOptions = [
  { label: 'Claude', value: 'claude' },
  { label: 'Codex', value: 'codex' },
  { label: 'Gemini', value: 'gemini' },
  { label: 'OpenCode', value: 'opencode' },
  { label: 'OMP', value: 'omp' }
]
const selectedPlatform = ref(props.platform || 'claude')
const activeTab = ref('instruction')
const snapshot = ref(null)
const loading = ref(false)
const requestId = ref(0)

async function loadSnapshot() {
  if (!props.projectPath || !selectedPlatform.value) return
  const currentRequestId = ++requestId.value
  loading.value = true
  try {
    const result = await getProjectConfig(props.projectPath, selectedPlatform.value)
    if (currentRequestId !== requestId.value) return
    snapshot.value = result
  } finally {
    if (currentRequestId === requestId.value) loading.value = false
  }
}

watch(visible, value => {
  if (!value) {
    requestId.value += 1
    return
  }
  selectedPlatform.value = props.platform || 'claude'
  activeTab.value = 'instruction'
  loadSnapshot()
})

watch([() => props.projectPath, () => props.platform, selectedPlatform], ([nextPath, nextPlatform], previous) => {
  if (!visible.value || !nextPath || !nextPlatform) return
  if (nextPlatform !== previous?.[1] || nextPath !== previous?.[0]) loadSnapshot()
})

onMounted(() => {
  if (visible.value) loadSnapshot()
})
</script>

<style scoped>
.project-config-content { padding: 2px 0 12px; }
.project-config-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.project-config-title {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 4px;
}
.project-path {
  display: block;
  max-width: 520px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
  font-size: 11px;
}
.unsupported-state {
  padding: 36px 12px;
  color: var(--text-tertiary);
  text-align: center;
}
</style>
