<template>
  <n-drawer v-model:show="visible" :width="drawerWidth" placement="right" :show-mask="true">
    <n-drawer-content closable :native-scrollbar="false" :body-content-style="bodyContentStyle">
      <template #header>
        <div class="asset-detail-drawer-header">
          <div class="asset-detail-identity">
            <n-icon :size="20" class="asset-detail-icon">
              <ExtensionPuzzleOutline />
            </n-icon>
            <div class="asset-detail-heading">
              <span class="asset-detail-name">{{ plugin?.name || '插件详情' }}</span>
              <div class="asset-detail-meta">
                <n-tag v-if="plugin?.version" size="tiny" :bordered="false" type="info">
                  v{{ plugin.version }}
                </n-tag>
                <span v-if="plugin?.author" class="asset-detail-subtle">
                  <n-icon :size="12"><PersonOutline /></n-icon>
                  {{ plugin.author }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </template>

      <div class="asset-detail-body">
        <n-tabs type="line" animated class="asset-detail-tabs">
          <n-tab-pane name="overview" tab="概览">
            <div class="asset-detail-container">
              <div class="asset-detail-info-section">
                <h3 class="asset-detail-section-title">描述</h3>
                <p class="asset-detail-description">{{ plugin?.description || '暂无描述' }}</p>
              </div>

              <div class="asset-detail-info-section" v-if="plugin?.repoUrl || plugin?.gitUrl || plugin?.repoLocalPath">
                <h3 class="asset-detail-section-title">仓库地址</h3>
                <div class="asset-detail-box">
                  <n-icon :size="16"><LogoGithub /></n-icon>
                  <a
                    v-if="isRemoteRepoLink"
                    class="asset-detail-link"
                    :href="plugin.repoUrl || plugin.gitUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {{ plugin.repoUrl || plugin.gitUrl }}
                  </a>
                  <span v-else>{{ plugin.repoLocalPath }}</span>
                </div>
              </div>

              <AssetPathField :path="pluginPath" />
            </div>
          </n-tab-pane>

          <n-tab-pane name="readme" tab="README">
            <div class="asset-detail-container">
              <div v-if="loadingReadme" class="asset-detail-loading">
                <n-spin size="medium" />
                <p>加载 README 中...</p>
              </div>
              <div v-else-if="readmeContent" class="asset-detail-content" v-html="renderedReadme"></div>
              <div v-else class="asset-detail-empty">
                <n-icon :size="44" class="asset-detail-empty-icon"><DocumentTextOutline /></n-icon>
                <p>暂无 README 文档</p>
              </div>
            </div>
          </n-tab-pane>
        </n-tabs>
      </div>
    </n-drawer-content>
  </n-drawer>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import {
  NDrawer, NDrawerContent, NIcon, NTag, NTabs, NTabPane, NSpin
} from 'naive-ui'
import {
  ExtensionPuzzleOutline, PersonOutline,
  LogoGithub, DocumentTextOutline
} from '@vicons/ionicons5'
import { marked } from 'marked'
import { useResponsiveDrawer } from '../composables/useResponsiveDrawer'
import { getPluginReadme } from '../api/plugins'
import AssetPathField from './AssetPathField.vue'

// Configure marked for safe rendering
marked.setOptions({
  breaks: true,
  gfm: true
})

const { drawerWidth } = useResponsiveDrawer(600)

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  plugin: {
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

const readmeContent = ref('')
const loadingReadme = ref(false)

const isRemoteRepoLink = computed(() => /^(https?:)?\/\//.test(props.plugin?.repoUrl || props.plugin?.gitUrl || ''))
const pluginPath = computed(() => props.plugin?.installPath || props.plugin?.fullPath || props.plugin?.path || props.plugin?.directory || '')

const bodyContentStyle = {
  height: '100%',
  minHeight: 0,
  overflow: 'hidden'
}

// Fetch README when drawer opens
watch(() => props.visible, async (newVisible) => {
  if (newVisible && props.plugin) {
    loadingReadme.value = true
    try {
      const repoInfo = {
        repoId: props.plugin.repoId,
        repoProvider: props.plugin.repoProvider,
        repoHost: props.plugin.repoHost,
        repoOwner: props.plugin.repoOwner,
        repoName: props.plugin.repoName,
        repoBranch: props.plugin.repoBranch,
        directory: props.plugin.directory,
        source: props.plugin.source,
        repoUrl: props.plugin.repoUrl,
        repoProjectPath: props.plugin.repoProjectPath,
        repoLocalPath: props.plugin.repoLocalPath,
        installPath: props.plugin.installPath
      }
      const response = await getPluginReadme(props.plugin.name, repoInfo, props.platform)
      readmeContent.value = response.readme || ''
    } catch (error) {
      console.error('Failed to fetch README:', error)
      readmeContent.value = ''
    } finally {
      loadingReadme.value = false
    }
  }
})

const renderedReadme = computed(() => {
  if (!readmeContent.value) return ''
  return marked(readmeContent.value)
})
</script>
