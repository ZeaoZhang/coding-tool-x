<template>
  <n-drawer v-model:show="visible" :width="drawerWidth" placement="right" :show-mask="true">
    <n-drawer-content closable :native-scrollbar="false">
      <template #header>
        <div class="drawer-header">
          <div class="plugin-info">
            <n-icon :size="20" class="plugin-icon">
              <ExtensionPuzzleOutline />
            </n-icon>
            <div class="plugin-details">
              <span class="plugin-name">{{ plugin?.name }}</span>
              <div class="plugin-meta">
                <n-tag v-if="plugin?.version" size="tiny" :bordered="false" type="info">
                  v{{ plugin.version }}
                </n-tag>
                <span v-if="plugin?.author" class="author-text">
                  <n-icon :size="12"><PersonOutline /></n-icon>
                  {{ plugin.author }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </template>

      <div class="drawer-body">
        <n-tabs type="line" animated>
          <n-tab-pane name="overview" tab="概览">
            <div class="overview-container">
              <!-- Description -->
              <div class="info-section">
                <h3 class="section-title">描述</h3>
                <p class="description-text">{{ plugin?.description || '暂无描述' }}</p>
              </div>

              <!-- Repository -->
              <div class="info-section" v-if="plugin?.repoUrl || plugin?.gitUrl || plugin?.repoLocalPath">
                <h3 class="section-title">仓库地址</h3>
                <div class="repo-link">
                  <n-icon :size="16"><LogoGithub /></n-icon>
                  <a v-if="isRemoteRepoLink" :href="plugin.repoUrl || plugin.gitUrl" target="_blank" rel="noopener noreferrer">
                    {{ plugin.repoUrl || plugin.gitUrl }}
                  </a>
                  <span v-else>{{ plugin.repoLocalPath }}</span>
                </div>
              </div>

              <!-- Plugin Info -->
              <div class="info-section" v-if="plugin?.directory || plugin?.installPath">
                <h3 class="section-title">安装路径</h3>
                <div class="path-info">
                  <code>{{ plugin.installPath || plugin.directory }}</code>
                </div>
              </div>
            </div>
          </n-tab-pane>

          <n-tab-pane name="readme" tab="README">
            <div class="readme-container">
              <div v-if="loadingReadme" class="loading-state">
                <n-spin size="medium" />
                <p class="loading-text">加载 README 中...</p>
              </div>
              <div v-else-if="readmeContent" class="readme-content" v-html="renderedReadme"></div>
              <div v-else class="empty-state">
                <n-icon :size="48" class="empty-icon"><DocumentTextOutline /></n-icon>
                <p class="empty-text">暂无 README 文档</p>
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

<style scoped>
.drawer-header {
  width: 100%;
}

.plugin-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.plugin-icon {
  color: var(--primary-color);
  flex-shrink: 0;
}

.plugin-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.plugin-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.author-text {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-tertiary);
}

.drawer-body {
  height: 100%;
}

.overview-container,
.readme-container {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.info-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.description-text {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
}

.stat-icon {
  color: var(--primary-color);
}

.stat-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-value {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.stat-label {
  font-size: 12px;
  color: var(--text-tertiary);
}

.repo-link {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  font-size: 13px;
}

.repo-link a {
  color: var(--primary-color);
  text-decoration: none;
  word-break: break-all;
}

.repo-link a:hover {
  text-decoration: underline;
}

.path-info {
  padding: 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
}

.path-info code {
  font-size: 12px;
  color: var(--text-secondary);
  word-break: break-all;
}

.readme-content {
  padding: 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.readme-content :deep(h1),
.readme-content :deep(h2),
.readme-content :deep(h3),
.readme-content :deep(h4) {
  color: var(--text-primary);
  margin: 16px 0 8px 0;
  font-weight: 600;
}

.readme-content :deep(h1) { font-size: 1.5em; }
.readme-content :deep(h2) { font-size: 1.3em; }
.readme-content :deep(h3) { font-size: 1.1em; }

.readme-content :deep(p) {
  margin: 8px 0;
}

.readme-content :deep(code) {
  background: var(--bg-tertiary, rgba(0,0,0,0.1));
  padding: 2px 6px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 0.9em;
}

.readme-content :deep(pre) {
  background: var(--bg-tertiary, rgba(0,0,0,0.1));
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 12px 0;
}

.readme-content :deep(pre code) {
  background: none;
  padding: 0;
}

.readme-content :deep(ul),
.readme-content :deep(ol) {
  padding-left: 20px;
  margin: 8px 0;
}

.readme-content :deep(li) {
  margin: 4px 0;
}

.readme-content :deep(a) {
  color: var(--primary-color);
  text-decoration: none;
}

.readme-content :deep(a:hover) {
  text-decoration: underline;
}

.readme-content :deep(blockquote) {
  border-left: 3px solid var(--primary-color);
  padding-left: 12px;
  margin: 12px 0;
  color: var(--text-tertiary);
}

.readme-content :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
}

.readme-content :deep(th),
.readme-content :deep(td) {
  border: 1px solid var(--border-primary);
  padding: 8px;
  text-align: left;
}

.readme-content :deep(th) {
  background: var(--bg-tertiary, rgba(0,0,0,0.05));
}

.readme-content :deep(img) {
  max-width: 100%;
  height: auto;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  text-align: center;
  gap: 16px;
}

.loading-text {
  font-size: 14px;
  color: var(--text-tertiary);
  margin: 0;
}

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

.empty-text {
  font-size: 14px;
  color: var(--text-tertiary);
  margin: 0;
}

:deep(.n-tabs) {
  height: 100%;
}

:deep(.n-tabs-pane-wrapper) {
  padding-top: 16px;
}
</style>
