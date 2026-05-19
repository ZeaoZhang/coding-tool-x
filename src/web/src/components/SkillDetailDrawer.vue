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
              <span class="asset-detail-name">{{ detail?.name || skill?.name || '技能详情' }}</span>
              <div class="asset-detail-meta">
                <n-tag v-if="detail?.installed" type="success" size="tiny" :bordered="false">已安装</n-tag>
                <n-tag v-else type="default" size="tiny" :bordered="false">未安装</n-tag>
                <n-tag v-if="detail?.protected" type="default" size="tiny" :bordered="false">受保护</n-tag>
                <span v-if="detail" class="asset-detail-subtle">{{ formatSkillSourceText(detail) }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>

      <div class="asset-detail-body">
        <div v-if="loading" class="asset-detail-loading">
          <n-spin size="medium" />
          <p>加载技能详情中...</p>
        </div>

        <div v-else-if="error" class="asset-detail-error">
          <n-icon :size="44" class="asset-detail-error-icon"><AlertCircleOutline /></n-icon>
          <p>{{ error }}</p>
          <n-button size="small" @click="loadDetail">重试</n-button>
        </div>

        <n-tabs v-else-if="detail" type="line" animated class="asset-detail-tabs">
          <n-tab-pane name="overview" tab="概览">
            <div class="asset-detail-container">
              <div class="asset-detail-info-section">
                <h3 class="asset-detail-section-title">描述</h3>
                <p class="asset-detail-description">{{ detail.description || '暂无描述' }}</p>
              </div>

              <AssetPathField :path="skillPath" />

              <div class="asset-detail-info-section" v-if="sourceLocation || sourceLink">
                <h3 class="asset-detail-section-title">来源</h3>
                <div class="asset-detail-box">
                  <n-icon :size="16"><GitBranchOutline /></n-icon>
                  <a
                    v-if="sourceLink"
                    class="asset-detail-link"
                    :href="sourceLink"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {{ sourceLinkLabel }}
                  </a>
                  <code v-else>{{ sourceLocation }}</code>
                </div>
              </div>

              <div class="asset-detail-info-section">
                <h3 class="asset-detail-section-title">操作</h3>
                <div class="asset-detail-actions">
                  <n-button
                    v-if="!detail.installed && canInstallSkill(detail)"
                    type="primary"
                    size="small"
                    :loading="installing"
                    @click="handleInstall"
                  >
                    安装此技能
                  </n-button>
                  <n-button
                    v-if="detail.installed && !detail.protected"
                    type="error"
                    tertiary
                    size="small"
                    :loading="uninstalling"
                    @click="handleUninstall"
                  >
                    卸载
                  </n-button>
                  <n-button v-else-if="detail.installed && detail.protected" tertiary size="small" disabled>
                    受保护
                  </n-button>
                  <n-button
                    text
                    size="small"
                    :disabled="!detail.content"
                    @click="copyContent"
                  >
                    <template #icon>
                      <n-icon><CopyOutline /></n-icon>
                    </template>
                    复制内容
                  </n-button>
                </div>
              </div>
            </div>
          </n-tab-pane>

          <n-tab-pane name="content" tab="内容">
            <div v-if="detail.content" class="asset-detail-content" v-html="renderedContent"></div>
            <div v-else class="asset-detail-empty">
              <n-icon :size="44" class="asset-detail-empty-icon"><DocumentTextOutline /></n-icon>
              <p>暂无技能内容</p>
            </div>
          </n-tab-pane>
        </n-tabs>
      </div>
    </n-drawer-content>
  </n-drawer>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { NDrawer, NDrawerContent, NButton, NIcon, NTag, NTabs, NTabPane, NSpin } from 'naive-ui'
import {
  AlertCircleOutline,
  CopyOutline,
  DocumentTextOutline,
  ExtensionPuzzleOutline,
  GitBranchOutline
} from '@vicons/ionicons5'
import { marked } from 'marked'
import { getSkillDetail, installSkill, uninstallSkill } from '../api/skills'
import { useResponsiveDrawer } from '../composables/useResponsiveDrawer'
import { copyTextToClipboard } from '../utils/clipboard'
import message from '../utils/message'
import AssetPathField from './AssetPathField.vue'
import {
  canInstallSkill,
  formatSkillSourceText,
  getSkillSourceLink,
  getSkillSourceLinkLabel,
  getSkillSourceLocation
} from '../utils/skill-source'

const { drawerWidth } = useResponsiveDrawer(600)

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  skill: {
    type: Object,
    default: null
  },
  platform: {
    type: String,
    default: 'claude'
  }
})

const emit = defineEmits(['update:visible', 'updated'])

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

const loading = ref(false)
const error = ref('')
const detail = ref(null)
const installing = ref(false)
const uninstalling = ref(false)

const bodyContentStyle = {
  height: '100%',
  minHeight: 0,
  overflow: 'hidden'
}

const renderedContent = computed(() => {
  if (!detail.value?.content) return ''
  try {
    return marked(detail.value.content, {
      breaks: true,
      gfm: true
    })
  } catch {
    return detail.value.content
  }
})

const sourceLocation = computed(() => detail.value ? getSkillSourceLocation(detail.value) : '')
const sourceLink = computed(() => detail.value ? getSkillSourceLink(detail.value) : '')
const sourceLinkLabel = computed(() => detail.value ? getSkillSourceLinkLabel(detail.value) : '')
const skillPath = computed(() => detail.value?.installPath || detail.value?.path || detail.value?.fullPath || '')

function buildSkillRepoContext(skill) {
  return {
    id: skill.repoId,
    provider: skill.repoProvider,
    host: skill.repoHost,
    owner: skill.repoOwner,
    name: skill.repoName,
    branch: skill.repoBranch || 'main',
    directory: skill.repoDirectory || '',
    projectPath: skill.repoProjectPath,
    localPath: skill.repoLocalPath,
    repoUrl: skill.repoUrl
  }
}

async function loadDetail() {
  if (!props.skill?.directory) return

  loading.value = true
  error.value = ''

  try {
    const result = await getSkillDetail(
      props.skill.directory,
      props.platform,
      buildSkillRepoContext(props.skill),
      props.skill.fullDirectory || null
    )

    if (result.success) {
      detail.value = {
        ...props.skill,
        ...result,
        source: result.source || props.skill?.source,
        repoProvider: result.repoProvider || props.skill?.repoProvider,
        repoOwner: result.repoOwner || props.skill?.repoOwner,
        repoName: result.repoName || props.skill?.repoName,
        repoProjectPath: result.repoProjectPath || props.skill?.repoProjectPath,
        repoLocalPath: result.repoLocalPath || props.skill?.repoLocalPath,
        repoUrl: result.repoUrl || props.skill?.repoUrl
      }
    } else {
      error.value = result.message || '加载失败'
    }
  } catch (err) {
    error.value = err.response?.data?.message || err.message || '加载失败'
  } finally {
    loading.value = false
  }
}

async function handleInstall() {
  if (!props.skill || props.skill.protected) return

  installing.value = true
  try {
    const result = await installSkill(
      props.skill.directory,
      buildSkillRepoContext(props.skill),
      props.skill.fullDirectory || null,
      props.platform
    )

    if (result.success) {
      message.success('安装成功')
      if (detail.value) detail.value.installed = true
      emit('updated')
    }
  } catch (err) {
    message.error('安装失败: ' + (err.response?.data?.message || err.message))
  } finally {
    installing.value = false
  }
}

async function handleUninstall() {
  if (!detail.value || detail.value.protected) return

  uninstalling.value = true
  try {
    const result = await uninstallSkill(detail.value.directory, props.platform)

    if (result.success) {
      message.success('卸载成功')
      if (detail.value) detail.value.installed = false
      emit('updated')
    }
  } catch (err) {
    message.error('卸载失败: ' + (err.response?.data?.message || err.message))
  } finally {
    uninstalling.value = false
  }
}

async function copyContent() {
  if (!detail.value?.content) return

  try {
    const copyResult = await copyTextToClipboard(detail.value.content)
    if (copyResult?.method === 'manual') {
      message.warning('自动复制失败，已弹出手动复制框')
      return
    }
    message.success('已复制到剪贴板')
  } catch {
    message.error('复制失败')
  }
}

watch(() => props.visible, (val) => {
  if (val && props.skill) {
    loadDetail()
  } else {
    detail.value = null
    error.value = ''
  }
})
</script>
