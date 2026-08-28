<template>
  <n-drawer v-model:show="visible" :width="drawerWidth" placement="right" :show-mask="true">
    <n-drawer-content closable :native-scrollbar="false" :body-content-style="bodyContentStyle">
      <template #header>
        <div class="asset-detail-drawer-header">
          <div class="asset-detail-identity">
            <n-icon :size="20" class="asset-detail-icon">
              <TerminalOutline />
            </n-icon>
            <div class="asset-detail-heading">
              <span class="asset-detail-name mono">{{ command?.name ? `/${command.name}` : '命令详情' }}</span>
              <div class="asset-detail-meta">
                <n-tag v-if="command?.scope" :type="command.scope === 'project' ? 'success' : 'info'" size="tiny" :bordered="false">
                  {{ formatScope(command.scope) }}
                </n-tag>
                <n-tag v-if="command?.namespace" type="warning" size="tiny" :bordered="false">
                  {{ command.namespace }}
                </n-tag>
                <span v-if="platformLabel" class="asset-detail-subtle">{{ platformLabel }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>

      <div class="asset-detail-body">
        <n-tabs v-if="command" type="line" animated class="asset-detail-tabs">
          <n-tab-pane name="overview" tab="概览">
            <div class="asset-detail-container">
              <div class="asset-detail-info-section">
                <h3 class="asset-detail-section-title">描述</h3>
                <p class="asset-detail-description">{{ command.description || '暂无描述' }}</p>
              </div>

              <div class="asset-detail-info-section">
                <h3 class="asset-detail-section-title">基础信息</h3>
                <div class="asset-detail-list">
                  <div class="asset-detail-row">
                    <span class="asset-detail-label">作用域</span>
                    <span class="asset-detail-value">{{ formatScope(command.scope) }}</span>
                  </div>
                  <div v-if="command.namespace" class="asset-detail-row">
                    <span class="asset-detail-label">命名空间</span>
                    <span class="asset-detail-value">{{ command.namespace }}</span>
                  </div>
                  <div v-if="command.argumentHint" class="asset-detail-row">
                    <span class="asset-detail-label">参数提示</span>
                    <span class="asset-detail-value">{{ command.argumentHint }}</span>
                  </div>
                  <div v-if="command.model" class="asset-detail-row">
                    <span class="asset-detail-label">模型</span>
                    <span class="asset-detail-value">{{ command.model }}</span>
                  </div>
                  <div v-if="command.agent" class="asset-detail-row">
                    <span class="asset-detail-label">Agent</span>
                    <span class="asset-detail-value">{{ command.agent }}</span>
                  </div>
                  <div v-if="command.subtask !== '' && command.subtask !== undefined && command.subtask !== null" class="asset-detail-row">
                    <span class="asset-detail-label">Subtask</span>
                    <span class="asset-detail-value">{{ String(command.subtask) }}</span>
                  </div>
                </div>
              </div>

              <div v-if="command.allowedTools" class="asset-detail-info-section">
                <h3 class="asset-detail-section-title">允许的工具</h3>
                <div class="asset-detail-box">
                  <n-icon :size="16"><HammerOutline /></n-icon>
                  <code>{{ command.allowedTools }}</code>
                </div>
              </div>

              <AssetPathField :path="commandPath" />
            </div>
          </n-tab-pane>

          <n-tab-pane name="content" tab="内容">
            <pre class="asset-detail-code">{{ command.body || '(无内容)' }}</pre>
          </n-tab-pane>
        </n-tabs>

        <div v-else class="asset-detail-empty">
          <n-icon :size="44" class="asset-detail-empty-icon"><DocumentTextOutline /></n-icon>
          <p>未选择命令</p>
        </div>
      </div>
    </n-drawer-content>
  </n-drawer>
</template>

<script setup>
import { computed } from 'vue'
import { NDrawer, NDrawerContent, NIcon, NTag, NTabs, NTabPane } from 'naive-ui'
import { DocumentTextOutline, HammerOutline, TerminalOutline } from '@vicons/ionicons5'
import { useResponsiveDrawer } from '../composables/useResponsiveDrawer'
import AssetPathField from './AssetPathField.vue'
import { getPlatformConfig } from '../config/platforms'
import { usePlatformStore } from '../stores/platforms'

const platformStore = usePlatformStore()
const { drawerWidth } = useResponsiveDrawer(600)

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  command: {
    type: Object,
    default: null
  },
  platform: {
    type: String,
    default: 'claude'
  }
})

const emit = defineEmits(['update:visible'])

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

const bodyContentStyle = {
  height: '100%',
  minHeight: 0,
  overflow: 'hidden'
}

const platformLabel = computed(() => {
  const platform = platformStore.get(props.platform) || getPlatformConfig(props.platform)
  return platform.label || platform.title || ''
})

const commandPath = computed(() => props.command?.fullPath || props.command?.path || '')

function formatScope(scope) {
  return scope === 'project' ? '项目级' : '用户级'
}
</script>
