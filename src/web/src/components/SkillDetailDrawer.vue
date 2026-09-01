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
                <n-tag v-if="detail?.enabled" type="success" size="tiny" :bordered="false">已启用</n-tag>
                <n-tag v-else type="default" size="tiny" :bordered="false">已关闭</n-tag>
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
                    v-if="detail.controlKey && detail.trust === 'approved' && detail.cached && !detail.protected && detail.projection?.state !== 'unsupported' && !(scope === 'project' && detail.sourceScope !== 'project')"
                    type="primary"
                    size="small"
                    :loading="toggling"
                    @click="handleToggle"
                  >
                    {{ detail.enabled ? '关闭此技能' : '启用此技能' }}
                  </n-button>
                  <n-button
                    v-else-if="detail.controlKey && ['pending', 'needs_review'].includes(detail.trust) && !(scope === 'project' && detail.sourceScope !== 'project')"
                    tertiary
                    type="warning"
                    size="small"
                    :loading="toggling"
                    @click="handleApprove"
                  >
                    审批
                  </n-button>
                  <n-button v-else-if="detail.protected" tertiary size="small" disabled>
                    受保护
                  </n-button>
                  <n-button v-else-if="detail.projection?.state === 'unsupported'" tertiary size="small" disabled>
                    不支持投影
                  </n-button>
                  <n-button v-else-if="['pending', 'needs_review'].includes(detail.trust)" tertiary size="small" disabled>
                    {{ detail.trust === 'needs_review' ? '需复审' : '待审批' }}
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
import { getSkillDetail, toggleSkill, setSkillTrust } from '../api/skills'
import { setProjectSkillEnabled } from '../api/project-config'
import { useResponsiveDrawer } from '../composables/useResponsiveDrawer'
import { copyTextToClipboard } from '../utils/clipboard'
import message from '../utils/message'
import AssetPathField from './AssetPathField.vue'
import {
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
  },
  scope: {
    type: String,
    default: 'user'
  },
  projectPath: {
    type: String,
    default: ''
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
const toggling = ref(false)
const loadRequestId = ref(0)

const bodyContentStyle = {
  height: '100%',
  minHeight: 0,
  overflow: 'hidden'
}

function sanitizeMarkdownHtml(html) {
  const rawHtml = String(html)
  if (typeof document === 'undefined') {
    return rawHtml
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/\son[a-z]+\s*=\s*(['"])[\s\S]*?\1/gi, '')
      .replace(/\s(?:href|src)\s*=\s*(['"])\s*(?:javascript|vbscript|data):[\s\S]*?\1/gi, '')
  }

  const allowedTags = new Set([
    'a', 'abbr', 'b', 'blockquote', 'br', 'code', 'del', 'div', 'em',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'input', 'li',
    'ol', 'p', 'pre', 'span', 'strong', 'sub', 'sup', 'table', 'tbody',
    'td', 'tfoot', 'th', 'thead', 'tr', 'ul'
  ])
  const allowedAttributes = new Set([
    'alt', 'checked', 'class', 'disabled', 'href', 'id', 'rel', 'src',
    'target', 'title', 'type'
  ])
  const isSafeUrl = (value, tagName) => {
    const normalized = String(value || '').trim()
    if (normalized.startsWith('#') || normalized.startsWith('/')) return true
    if (tagName === 'a' && /^mailto:/i.test(normalized)) return true
    return /^https?:\/\//i.test(normalized)
  }

  const template = document.createElement('template')
  template.innerHTML = rawHtml
  template.content.querySelectorAll('*').forEach(node => {
    const tagName = node.tagName.toLowerCase()
    if (!allowedTags.has(tagName)) {
      node.remove()
      return
    }
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase()
      if (!allowedAttributes.has(name) || /^on/i.test(name)) {
        node.removeAttribute(attribute.name)
        continue
      }
      if ((name === 'href' || name === 'src') && !isSafeUrl(attribute.value, tagName)) {
        node.removeAttribute(attribute.name)
      }
    }
  })
  return template.innerHTML
}

const renderedContent = computed(() => {
  if (!detail.value?.content) return ''
  try {
    return sanitizeMarkdownHtml(marked(detail.value.content, {
      breaks: true,
      gfm: true
    }))
  } catch {
    return sanitizeMarkdownHtml(detail.value.content)
  }
})

const sourceLocation = computed(() => detail.value ? getSkillSourceLocation(detail.value) : '')
const sourceLink = computed(() => detail.value ? getSkillSourceLink(detail.value) : '')
const sourceLinkLabel = computed(() => detail.value ? getSkillSourceLinkLabel(detail.value) : '')
const skillPath = computed(() => detail.value?.installPath || detail.value?.path || detail.value?.fullPath || '')

const scopeOptions = computed(() => ({
  ...(props.projectPath ? { cwd: props.projectPath } : {}),
  ...(props.scope && props.scope !== 'user' ? { scope: props.scope } : {})
}))

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

  const requestId = ++loadRequestId.value
  loading.value = true
  error.value = ''

  try {
    const result = await getSkillDetail(
      props.skill.directory,
      props.platform,
      buildSkillRepoContext(props.skill),
      props.skill.fullDirectory || null,
      scopeOptions.value
    )
    if (requestId !== loadRequestId.value) return

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
    if (requestId !== loadRequestId.value) return
    error.value = err.response?.data?.message || err.message || '加载失败'
  } finally {
    if (requestId === loadRequestId.value) {
      loading.value = false
    }
  }
}

async function handleToggle() {
  if (
    toggling.value
    || !detail.value
    || !detail.value.controlKey
    || detail.value.protected
    || detail.value.readonly
    || detail.value.managed === false
    || detail.value.trust !== 'approved'
    || detail.value.projection?.state === 'unsupported'
    || !detail.value.cached
    || (props.scope === 'project' && detail.value.sourceScope !== 'project')
  ) return
  toggling.value = true
  try {
    const result = props.scope === 'project'
      ? await setProjectSkillEnabled(props.projectPath, props.platform, detail.value.controlKey, !detail.value.enabled)
      : await toggleSkill(
        detail.value.controlKey,
        !detail.value.enabled,
        props.platform,
        scopeOptions.value
      )
    if (result.status === 'needs_approval') {
      message.warning('该技能需要先审批')
      return
    }
    if (result.status === 'unsupported') {
      message.error('当前平台不支持安全投影')
      return
    }
    if (result.status === 'conflict') {
      message.warning('目标 Skill 目录已被其他来源占用')
      return
    }
    if (result.status === 'projection_failed') {
      message.error(result.lastError || 'Skill 投影失败')
      return
    }
    detail.value.enabled = result.enabled
    detail.value.projection = result.projection || detail.value.projection
    message.success(result.enabled ? '技能已启用' : '技能已关闭')
    emit('updated')
  } catch (err) {
    message.error('切换失败: ' + (err.response?.data?.message || err.message))
  } finally {
    toggling.value = false
  }
}

async function handleApprove() {
  if (!detail.value?.controlKey || !['pending', 'needs_review'].includes(detail.value.trust)) return
  toggling.value = true
  try {
    const result = await setSkillTrust(
      detail.value.controlKey,
      'approved',
      props.platform,
      scopeOptions.value
    )
    detail.value.trust = result.trust
    message.success('技能已批准，当前仍保持关闭')
    emit('updated')
  } catch (err) {
    message.error('审批失败: ' + (err.response?.data?.message || err.message))
  } finally {
    toggling.value = false
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

watch(() => [props.visible, props.skill], ([val, skill]) => {
  if (val && skill) {
    loadDetail()
  } else {
    loadRequestId.value += 1
    loading.value = false
    detail.value = null
    error.value = ''
  }
})
</script>
