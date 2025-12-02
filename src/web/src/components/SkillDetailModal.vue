<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    :title="detail?.name || '技能详情'"
    :bordered="false"
    :closable="true"
    style="width: 700px; max-width: 90vw;"
    content-style="padding: 0; max-height: 60vh; overflow: hidden; display: flex; flex-direction: column;"
    footer-style="padding: 16px 20px;"
    @close="handleClose"
  >
    <div v-if="loading" class="loading-state">
      <n-spin size="medium" />
      <span>加载中...</span>
    </div>

    <div v-else-if="error" class="error-state">
      <n-icon size="48" color="#d03050"><AlertCircleOutline /></n-icon>
      <span>{{ error }}</span>
      <n-button size="small" @click="loadDetail">重试</n-button>
    </div>

    <div v-else-if="detail" class="detail-content">
      <!-- 元信息 -->
      <div class="detail-meta">
        <div class="meta-row">
          <n-tag v-if="detail.installed" type="success" size="small" :bordered="false">
            已安装
          </n-tag>
          <n-tag v-else type="default" size="small" :bordered="false">
            未安装
          </n-tag>
          <span class="meta-source">
            来源: {{ detail.source === 'local' ? '本地' : `${detail.repoOwner}/${detail.repoName}` }}
          </span>
        </div>
        <div v-if="detail.description" class="meta-desc">
          {{ detail.description }}
        </div>
        <div class="meta-dir">
          <n-icon size="14"><FolderOutline /></n-icon>
          <code>{{ detail.directory }}</code>
        </div>
      </div>

      <!-- 内容区域 -->
      <div class="content-wrapper">
        <div class="content-header">
          <span class="content-title">技能内容</span>
          <n-button text size="tiny" @click="copyContent">
            <template #icon>
              <n-icon><CopyOutline /></n-icon>
            </template>
            复制
          </n-button>
        </div>
        <div class="markdown-content" v-html="renderedContent"></div>
      </div>
    </div>

    <template #footer>
      <div class="modal-footer">
        <n-button @click="handleClose">关闭</n-button>
        <n-button
          v-if="detail && !detail.installed && skill?.repoOwner"
          type="primary"
          :loading="installing"
          @click="handleInstall"
        >
          安装此技能
        </n-button>
        <n-button
          v-if="detail?.installed"
          type="error"
          tertiary
          :loading="uninstalling"
          @click="handleUninstall"
        >
          卸载
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { NModal, NButton, NIcon, NTag, NSpin } from 'naive-ui'
import { AlertCircleOutline, FolderOutline, CopyOutline } from '@vicons/ionicons5'
import { getSkillDetail, installSkill, uninstallSkill } from '../api/skills'
import message from '../utils/message'
import { marked } from 'marked'

const props = defineProps({
  visible: Boolean,
  skill: Object // 传入的技能基本信息
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

// 渲染 Markdown
const renderedContent = computed(() => {
  if (!detail.value?.content) return ''
  try {
    return marked(detail.value.content, {
      breaks: true,
      gfm: true
    })
  } catch (e) {
    return detail.value.content
  }
})

async function loadDetail() {
  if (!props.skill?.directory) return

  loading.value = true
  error.value = ''

  try {
    const result = await getSkillDetail(props.skill.directory)
    if (result.success) {
      detail.value = result
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
  if (!props.skill) return

  installing.value = true
  try {
    const result = await installSkill(props.skill.directory, {
      owner: props.skill.repoOwner,
      name: props.skill.repoName,
      branch: props.skill.repoBranch || 'main'
    })

    if (result.success) {
      message.success('安装成功')
      // 安全地更新状态
      if (detail.value) {
        detail.value.installed = true
      }
      emit('updated')
    }
  } catch (err) {
    message.error('安装失败: ' + (err.response?.data?.message || err.message))
  } finally {
    installing.value = false
  }
}

async function handleUninstall() {
  if (!detail.value) return

  uninstalling.value = true
  try {
    const result = await uninstallSkill(detail.value.directory)

    if (result.success) {
      message.success('卸载成功')
      // 安全地更新状态
      if (detail.value) {
        detail.value.installed = false
      }
      emit('updated')
    }
  } catch (err) {
    message.error('卸载失败: ' + (err.response?.data?.message || err.message))
  } finally {
    uninstalling.value = false
  }
}

function copyContent() {
  if (!detail.value?.content) return

  navigator.clipboard.writeText(detail.value.content).then(() => {
    message.success('已复制到剪贴板')
  }).catch(() => {
    message.error('复制失败')
  })
}

function handleClose() {
  emit('update:visible', false)
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

<style scoped>
.loading-state,
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 60px 20px;
  color: var(--text-tertiary);
}

.detail-content {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.detail-meta {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-primary);
  background: var(--bg-secondary);
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.meta-source {
  font-size: 12px;
  color: var(--text-tertiary);
}

.meta-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 8px;
}

.meta-dir {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-tertiary);
}

.meta-dir code {
  background: var(--bg-tertiary);
  padding: 2px 8px;
  border-radius: 4px;
  font-family: 'SF Mono', Monaco, monospace;
}

.content-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.content-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border-primary);
}

.content-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.markdown-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-primary);
}

/* Markdown 样式 */
.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4) {
  margin: 16px 0 8px 0;
  font-weight: 600;
  color: var(--text-primary);
}

.markdown-content :deep(h1) { font-size: 20px; }
.markdown-content :deep(h2) { font-size: 17px; }
.markdown-content :deep(h3) { font-size: 15px; }

.markdown-content :deep(p) {
  margin: 8px 0;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin: 8px 0;
  padding-left: 24px;
}

.markdown-content :deep(li) {
  margin: 4px 0;
}

.markdown-content :deep(code) {
  background: var(--bg-tertiary);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 12px;
}

.markdown-content :deep(pre) {
  background: var(--bg-tertiary);
  padding: 12px 16px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 12px 0;
}

.markdown-content :deep(pre code) {
  background: none;
  padding: 0;
}

.markdown-content :deep(blockquote) {
  border-left: 3px solid #18a058;
  padding-left: 16px;
  margin: 12px 0;
  color: var(--text-secondary);
}

.markdown-content :deep(a) {
  color: #18a058;
  text-decoration: none;
}

.markdown-content :deep(a:hover) {
  text-decoration: underline;
}

.markdown-content :deep(hr) {
  border: none;
  border-top: 1px solid var(--border-primary);
  margin: 16px 0;
}

.markdown-content :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  border: 1px solid var(--border-primary);
  padding: 8px 12px;
  text-align: left;
}

.markdown-content :deep(th) {
  background: var(--bg-secondary);
  font-weight: 600;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
