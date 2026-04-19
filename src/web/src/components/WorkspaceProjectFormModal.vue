<template>
  <n-modal v-model:show="visible" preset="card" title="添加仓库到工作区" style="width: 620px" :mask-closable="false">
    <div class="form-section">
      <div class="actions-row">
        <n-button size="small" dashed :type="project.fromExisting ? 'default' : 'primary'" @click="useManualInput">
          手动填写路径
        </n-button>
        <n-button size="small" dashed :type="project.fromExisting ? 'primary' : 'default'" @click="useExistingProject">
          选择已有项目
        </n-button>
      </div>
      <ProjectItem
        :project="project"
        :index="0"
        :existing-options="existingProjectOptions"
        :show-remove-button="false"
        @select-existing="handleSelectExisting"
      />
    </div>

    <template #footer>
      <n-space justify="end">
        <n-button @click="visible = false">取消</n-button>
        <n-button type="primary" :loading="submitting" @click="handleSubmit">添加</n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { NModal, NSpace, NButton, useMessage } from 'naive-ui'
import { addProjectToWorkspace, getAvailableProjects } from '../api/workspaces'
import ProjectItem from './ProjectItem.vue'
import { getPathBaseName } from '../utils/path'
import { createEmptyWorkspaceProject, normalizeWorkspaceProjectForSubmit } from '../utils/workspace-projects'

const props = defineProps({
  show: { type: Boolean, default: false },
  workspaceId: { type: String, required: true }
})

const emit = defineEmits(['update:show', 'success'])

const message = useMessage()
const submitting = ref(false)
const existingProjects = ref([])
const project = ref(createEmptyWorkspaceProject())

const visible = computed({
  get: () => props.show,
  set: (val) => emit('update:show', val)
})

const existingProjectOptions = computed(() => existingProjects.value.map(p => ({
  label: `${p.displayName || p.name} (${p.channel})${p.isGitRepo ? ' [Git]' : ''}`,
  value: `${p.channel}::${p.name}`,
  path: p.fullPath || p.name,
  isGitRepo: p.isGitRepo
})))

function resetForm() {
  project.value = createEmptyWorkspaceProject()
}

function useManualInput() {
  project.value = createEmptyWorkspaceProject({ fromExisting: false })
}

function useExistingProject() {
  project.value = createEmptyWorkspaceProject({ fromExisting: true })
}

function handleSelectExisting(_idx, value) {
  const opt = existingProjectOptions.value.find(o => o.value === value)
  if (!opt) return
  project.value.selectedKey = value
  project.value.sourcePath = opt.path
  project.value.name = getPathBaseName(opt.path)
  project.value.isGitRepo = opt.isGitRepo
  project.value.createWorktree = opt.isGitRepo
  project.value.branchMode = 'existing'
  project.value.branch = ''
  project.value.baseBranch = ''
  project.value.fromExisting = true
}

async function loadExistingProjects() {
  try {
    const res = await getAvailableProjects()
    if (res.success) {
      existingProjects.value = Array.isArray(res.data) ? res.data : []
    }
  } catch (err) {
    console.error('加载已有项目失败:', err)
  }
}

async function handleSubmit() {
  const normalized = normalizeWorkspaceProjectForSubmit(project.value)
  if (!normalized.sourcePath) {
    message.error('请填写项目路径')
    return
  }

  if (project.value.createWorktree && project.value.branchMode === 'new' && !normalized.branch) {
    message.error('请输入新分支名')
    return
  }

  submitting.value = true
  try {
    const res = await addProjectToWorkspace(props.workspaceId, normalized)
    if (res.success) {
      message.success('仓库已添加到工作区')
      visible.value = false
      resetForm()
      emit('success')
      return
    }
    message.error(res.message || '添加失败')
  } catch (err) {
    message.error(`添加失败: ${err.message}`)
  } finally {
    submitting.value = false
  }
}

watch(visible, (val) => {
  if (val) {
    resetForm()
    loadExistingProjects()
  }
})
</script>

<style scoped>
.form-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.actions-row {
  display: flex;
  gap: 8px;
}
</style>
