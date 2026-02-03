<template>
  <n-drawer v-model:show="visible" :width="drawerWidth" placement="right" :show-mask="true">
    <n-drawer-content closable :native-scrollbar="false">
      <template #header>
        <div class="drawer-header">
          <div class="server-info">
            <n-icon :size="20" class="server-icon">
              <ExtensionPuzzleOutline />
            </n-icon>
            <div class="server-details">
              <span class="server-name">{{ server?.name || server?.id }}</span>
              <div class="server-meta">
                <n-tag v-if="server?.server?.type" size="tiny" :bordered="false" type="info">
                  {{ server.server.type }}
                </n-tag>
                <span
                  v-if="server?.status"
                  class="status-dot"
                  :class="{
                    online: server.status === 'online',
                    error: server.status === 'error'
                  }"
                ></span>
              </div>
            </div>
          </div>
        </div>
      </template>

      <div class="drawer-body">
        <n-tabs type="line" animated>
          <n-tab-pane name="tools" tab="工具列表">
            <n-spin :show="loading">
              <!-- Tools list -->
              <div v-if="!loading && tools.length > 0" class="tools-container">
                <div class="tools-stats">
                  <span class="stats-text">共 {{ tools.length }} 个工具</span>
                  <span v-if="fetchDuration" class="stats-duration">
                    耗时 {{ fetchDuration }}ms
                  </span>
                </div>

                <n-collapse
                  arrow-placement="right"
                  :default-expanded-names="[]"
                >
                  <n-collapse-item
                    v-for="(tool, index) in tools"
                    :key="tool.name"
                    :name="index"
                  >
                    <template #header>
                      <div class="collapse-header">
                        <span class="tool-index">{{ index + 1 }}</span>
                        <span class="tool-title">{{ tool.name }}</span>
                      </div>
                    </template>

                    <McpToolCard
                      :tool="tool"
                      @test="openTestModal(tool)"
                    />
                  </n-collapse-item>
                </n-collapse>
              </div>

              <!-- Empty state -->
              <div v-else-if="!loading && tools.length === 0" class="empty-state">
                <n-icon :size="48" class="empty-icon">
                  <ConstructOutline />
                </n-icon>
                <p class="empty-title">该服务器未提供工具</p>
                <p class="empty-desc">此 MCP 服务器没有注册任何可用工具</p>
              </div>

              <!-- Error state -->
              <div v-if="error" class="error-state">
                <n-alert type="error" :bordered="false">
                  <template #icon>
                    <n-icon><AlertCircleOutline /></n-icon>
                  </template>
                  {{ error }}
                </n-alert>
              </div>
            </n-spin>
          </n-tab-pane>
        </n-tabs>
      </div>
    </n-drawer-content>
  </n-drawer>

  <!-- Tool test modal -->
  <McpToolTestModal
    v-model:visible="testModalVisible"
    :server-id="server?.id"
    :tool="selectedTool"
  />
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import {
  NDrawer, NDrawerContent, NIcon, NTag, NTabs, NTabPane,
  NSpin, NCollapse, NCollapseItem, NAlert
} from 'naive-ui'
import {
  ExtensionPuzzleOutline, ConstructOutline, AlertCircleOutline
} from '@vicons/ionicons5'
import { getServerTools } from '../api/mcp'
import message from '../utils/message'
import { useResponsiveDrawer } from '../composables/useResponsiveDrawer'
import McpToolCard from './McpToolCard.vue'
import McpToolTestModal from './McpToolTestModal.vue'

const { drawerWidth } = useResponsiveDrawer(600)

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  server: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['update:visible'])

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

const loading = ref(false)
const tools = ref([])
const error = ref('')
const fetchDuration = ref(0)

// Test modal
const testModalVisible = ref(false)
const selectedTool = ref(null)

// Load tools when drawer opens
async function loadTools() {
  if (!props.server?.id) return

  loading.value = true
  error.value = ''
  tools.value = []
  fetchDuration.value = 0

  try {
    const result = await getServerTools(props.server.id)

    if (result.success) {
      tools.value = result.tools || []
      fetchDuration.value = result.duration || 0
    } else {
      error.value = result.message || '获取工具列表失败'
    }
  } catch (err) {
    console.error('Failed to load tools:', err)
    error.value = err.response?.data?.message || err.message || '连接服务器失败'
    message.error('获取工具列表失败: ' + error.value)
  } finally {
    loading.value = false
  }
}

// Open test modal
function openTestModal(tool) {
  selectedTool.value = tool
  testModalVisible.value = true
}

// Watch drawer open
watch(() => props.visible, (val) => {
  if (val && props.server) {
    loadTools()
  } else {
    // Reset state when closed
    tools.value = []
    error.value = ''
    fetchDuration.value = 0
  }
})
</script>

<style scoped>
.drawer-header {
  width: 100%;
}

.server-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.server-icon {
  color: #18a058;
  flex-shrink: 0;
}

.server-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.server-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-quaternary);
}

.status-dot.online {
  background: #18a058;
  box-shadow: 0 0 6px rgba(24, 160, 88, 0.5);
}

.status-dot.error {
  background: #f56c6c;
  box-shadow: 0 0 6px rgba(245, 108, 108, 0.5);
}

.drawer-body {
  height: 100%;
}

.tools-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.tools-stats {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--bg-secondary);
  border-radius: 8px;
  border: 1px solid var(--border-primary);
}

.stats-text {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

.stats-duration {
  font-size: 12px;
  color: var(--text-tertiary);
  font-family: 'SF Mono', Monaco, Consolas, monospace;
}

.collapse-header {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 48px;
}

.tool-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  font-size: 11px;
  font-weight: 600;
  color: #18a058;
  background: rgba(24, 160, 88, 0.1);
  border-radius: 4px;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
}

[data-theme="dark"] .tool-index {
  background: rgba(24, 160, 88, 0.15);
  color: #36ad6a;
}

.tool-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  font-family: 'SF Mono', Monaco, Consolas, monospace;
}

/* Empty state */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  text-align: center;
}

.empty-icon {
  color: var(--text-quaternary);
  margin-bottom: 16px;
}

.empty-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 8px 0;
}

.empty-desc {
  font-size: 13px;
  color: var(--text-tertiary);
  margin: 0;
  max-width: 300px;
}

/* Error state */
.error-state {
  margin-top: 16px;
}

/* Naive UI overrides */
:deep(.n-tabs) {
  height: 100%;
}

:deep(.n-tabs-pane-wrapper) {
  padding-top: 16px;
}

:deep(.n-collapse) {
  background: transparent;
}

:deep(.n-collapse-item) {
  width: 100%;
  margin-bottom: 8px;
  border-radius: 8px;
  border: 1px solid var(--border-primary);
  background: var(--bg-secondary);
  overflow: hidden;
}

:deep(.n-collapse-item__header) {
  padding: 8px !important;
  background: transparent;
}

:deep(.n-collapse-item__content-wrapper) {
  padding: 0 16px 16px 16px;
}

:deep(.n-collapse-item__content-inner) {
  padding-top: 0;
}
</style>
