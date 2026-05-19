<template>
  <n-drawer v-model:show="visible" :width="drawerWidth" placement="right" :show-mask="true">
    <n-drawer-content closable :native-scrollbar="false" :body-content-style="bodyContentStyle">
      <template #header>
        <div class="asset-detail-drawer-header">
          <div class="asset-detail-identity">
            <n-icon :size="20" class="asset-detail-icon">
              <PersonOutline />
            </n-icon>
            <div class="asset-detail-heading">
              <span class="asset-detail-name">{{ agent?.name || '代理详情' }}</span>
              <div class="asset-detail-meta">
                <n-tag v-if="agent?.scope" :type="agent.scope === 'project' ? 'success' : 'info'" size="tiny" :bordered="false">
                  {{ formatScope(agent.scope) }}
                </n-tag>
                <n-tag v-if="agent?.model" type="warning" size="tiny" :bordered="false">{{ agent.model }}</n-tag>
                <span v-if="platformLabel" class="asset-detail-subtle">{{ platformLabel }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>

      <div class="asset-detail-body">
        <div v-if="loading && !agent" class="asset-detail-loading">
          <n-spin size="medium" />
          <p>加载代理详情中...</p>
        </div>

        <n-tabs v-else-if="agent" type="line" animated class="asset-detail-tabs">
          <n-tab-pane name="overview" tab="概览">
            <div class="asset-detail-container">
              <n-alert
                v-if="platform === 'codex' && agent.configReadError"
                type="warning"
                :bordered="false"
              >
                {{ agent.configReadError }}
              </n-alert>

              <div class="asset-detail-info-section">
                <h3 class="asset-detail-section-title">描述</h3>
                <p class="asset-detail-description">{{ agent.description || '暂无描述' }}</p>
              </div>

              <div class="asset-detail-info-section">
                <h3 class="asset-detail-section-title">基础信息</h3>
                <div class="asset-detail-list">
                  <div class="asset-detail-row">
                    <span class="asset-detail-label">作用域</span>
                    <span class="asset-detail-value">{{ formatScope(agent.scope) }}</span>
                  </div>
                  <div v-if="agent.fileName" class="asset-detail-row">
                    <span class="asset-detail-label">文件名</span>
                    <span class="asset-detail-value mono">{{ displayFileName }}</span>
                  </div>
                  <div v-if="platform === 'codex' && agent.configFile" class="asset-detail-row">
                    <span class="asset-detail-label">config_file</span>
                    <span class="asset-detail-value mono">{{ agent.configFile }}</span>
                  </div>
                  <div v-if="agent.model" class="asset-detail-row">
                    <span class="asset-detail-label">模型</span>
                    <span class="asset-detail-value">{{ agent.model }}</span>
                  </div>
                  <div v-if="agent.permissionMode" class="asset-detail-row">
                    <span class="asset-detail-label">权限模式</span>
                    <span class="asset-detail-value">{{ agent.permissionMode }}</span>
                  </div>
                  <div v-if="agent.skills" class="asset-detail-row">
                    <span class="asset-detail-label">技能</span>
                    <span class="asset-detail-value">{{ agent.skills }}</span>
                  </div>
                </div>
              </div>

              <div v-if="agent.tools" class="asset-detail-info-section">
                <h3 class="asset-detail-section-title">可用工具</h3>
                <div class="asset-detail-box">
                  <n-icon :size="16"><HammerOutline /></n-icon>
                  <code>{{ agent.tools }}</code>
                </div>
              </div>

              <AssetPathField :path="agentPath" />
            </div>
          </n-tab-pane>

          <n-tab-pane name="content" :tab="platform === 'codex' ? '配置' : '提示词'">
            <pre class="asset-detail-code">{{ detailContent }}</pre>
          </n-tab-pane>
        </n-tabs>

        <div v-else class="asset-detail-empty">
          <n-icon :size="44" class="asset-detail-empty-icon"><DocumentTextOutline /></n-icon>
          <p>未选择代理</p>
        </div>
      </div>
    </n-drawer-content>
  </n-drawer>
</template>

<script setup>
import { computed } from 'vue'
import { NAlert, NDrawer, NDrawerContent, NIcon, NSpin, NTag, NTabs, NTabPane } from 'naive-ui'
import { DocumentTextOutline, HammerOutline, PersonOutline } from '@vicons/ionicons5'
import { useResponsiveDrawer } from '../composables/useResponsiveDrawer'
import AssetPathField from './AssetPathField.vue'

const { drawerWidth } = useResponsiveDrawer(600)

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  agent: {
    type: Object,
    default: null
  },
  platform: {
    type: String,
    default: 'claude'
  },
  loading: {
    type: Boolean,
    default: false
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
  const map = {
    claude: 'Claude Code',
    codex: 'Codex CLI',
    gemini: 'Gemini CLI',
    opencode: 'OpenCode'
  }
  return map[props.platform] || ''
})

const displayFileName = computed(() => {
  if (!props.agent?.fileName) return ''
  return props.platform === 'codex'
    ? `[agents.${props.agent.fileName}]`
    : `${props.agent.fileName}.md`
})

const detailContent = computed(() => {
  if (!props.agent) return '(无内容)'
  return props.platform === 'codex'
    ? (props.agent.fullContent || '(无内容)')
    : (props.agent.systemPrompt || '(无内容)')
})

const agentPath = computed(() => props.agent?.fullPath || props.agent?.path || '')

function formatScope(scope) {
  return scope === 'project' ? '项目级' : '用户级'
}
</script>
