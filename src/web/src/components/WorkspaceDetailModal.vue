<template>
  <n-modal v-model:show="visible" preset="card" title="工作区详情" style="width: 700px">
    <template v-if="workspace">
      <n-descriptions :column="1" bordered size="small">
        <n-descriptions-item label="名称">{{ workspace.name }}</n-descriptions-item>
        <n-descriptions-item label="描述">{{ workspace.description || '-' }}</n-descriptions-item>
        <n-descriptions-item label="路径">{{ workspace.path }}</n-descriptions-item>
        <n-descriptions-item label="状态">
          <n-tag :type="workspace.exists ? 'success' : 'error'" size="small">
            {{ workspace.exists ? '存在' : '不存在' }}
          </n-tag>
        </n-descriptions-item>
        <n-descriptions-item label="创建时间">{{ formatDate(workspace.createdAt) }}</n-descriptions-item>
        <n-descriptions-item label="最后使用">{{ formatDate(workspace.lastUsed) }}</n-descriptions-item>
      </n-descriptions>

      <!-- CLI 启动 -->
      <n-divider />
      <div class="section-title">启动 CLI 工具</div>
      <n-space>
        <n-button type="primary" size="small" @click="launchCLI('claude')" :disabled="!workspace.exists">
          Claude Code
        </n-button>
        <n-button type="info" size="small" @click="launchCLI('codex')" :disabled="!workspace.exists">
          Codex
        </n-button>
        <n-button type="success" size="small" @click="launchCLI('gemini')" :disabled="!workspace.exists">
          Gemini CLI
        </n-button>
      </n-space>
      <n-text depth="3" style="display: block; margin-top: 6px; font-size: 11px">
        点击按钮将复制启动命令到剪贴板
      </n-text>

      <!-- 项目列表 -->
      <n-divider />
      <div class="section-header">
        <div class="section-title">包含项目 ({{ detailData?.projects?.length || 0 }})</div>
        <n-button size="small" type="primary" ghost :disabled="!detailData?.exists" @click="showAddProjectModal = true">
          添加仓库
        </n-button>
      </div>
      <div class="projects-list" v-if="detailData?.projects?.length">
        <div class="project-row" v-for="(proj, idx) in detailData.projects" :key="idx">
          <n-tag :type="proj.sourceExists ? 'success' : 'error'" size="small">
            {{ proj.sourceExists ? '[v]' : '[x]' }}
          </n-tag>
          <span class="proj-name">{{ proj.name }}</span>
          <span class="proj-path">{{ proj.sourcePath }}</span>
          <n-tag v-if="proj.useWorktree" type="info" size="small">worktree</n-tag>
          <n-button text size="small" type="error" @click="handleRemoveProject(proj)">
            移除
          </n-button>
        </div>
      </div>
      <n-empty v-else description="暂无项目" size="small" />
    </template>

    <WorkspaceProjectFormModal
      v-model:show="showAddProjectModal"
      :workspace-id="props.workspace?.id || ''"
      @success="handleProjectChanged"
    />
  </n-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { NModal, NDescriptions, NDescriptionsItem, NTag, NDivider, NSpace, NButton, NText, NEmpty, useMessage, useDialog } from 'naive-ui'
import { getWorkspace, getLaunchCommand, removeProjectFromWorkspace } from '../api/workspaces'
import { copyTextToClipboard } from '../utils/clipboard'
import WorkspaceProjectFormModal from './WorkspaceProjectFormModal.vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  workspace: { type: Object, default: null }
})

const emit = defineEmits(['update:show', 'updated'])
const message = useMessage()
const dialog = useDialog()

const visible = computed({
  get: () => props.show,
  set: (val) => emit('update:show', val)
})

const detailData = ref(null)
const showAddProjectModal = ref(false)

function formatDate(dateStr) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('zh-CN')
}

async function loadDetail() {
  if (!props.workspace?.id) return
  try {
    const res = await getWorkspace(props.workspace.id)
    if (res.success) detailData.value = res.data
  } catch (err) {
    console.error('加载详情失败:', err)
  }
}

function handleProjectChanged() {
  loadDetail()
  emit('updated')
}

function handleRemoveProject(project) {
  if (!props.workspace?.id) return

  dialog.warning({
    title: '确认移除仓库',
    content: `确定要从工作区移除 "${project.name}" 吗？`,
    positiveText: '移除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const res = await removeProjectFromWorkspace(props.workspace.id, project.name)
        if (res.success) {
          message.success('仓库已移除')
          handleProjectChanged()
          return
        }
        message.error(res.message || '移除失败')
      } catch (err) {
        message.error(`移除失败: ${err.message}`)
      }
    }
  })
}

async function launchCLI(tool) {
  if (!props.workspace?.id) return
  try {
    const res = await getLaunchCommand(props.workspace.id, tool)
    if (res.success) {
      const cmd = `cd "${res.data.cwd}" && ${res.data.command}`
      const copyResult = await copyTextToClipboard(cmd)
      if (copyResult?.method === 'manual') {
        message.warning('自动复制失败，已弹出手动复制框')
        return
      }
      message.success('启动命令已复制到剪贴板')
    } else {
      message.error(res.message || '获取命令失败')
    }
  } catch (err) {
    message.error('获取命令失败: ' + err.message)
  }
}

watch(visible, (val) => {
  if (val && props.workspace) loadDetail()
})
</script>

<style scoped>
.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 10px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.section-header .section-title {
  margin-bottom: 0;
}

.projects-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.project-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.proj-name {
  font-weight: 500;
  color: var(--text-primary);
}
.proj-path {
  color: var(--text-tertiary);
  font-family: monospace;
  font-size: 12px;
  flex: 1;
}
</style>
