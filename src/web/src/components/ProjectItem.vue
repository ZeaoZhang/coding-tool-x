<template>
  <div class="project-item">
    <div class="item-header">
      <span class="item-title">项目 {{ index + 1 }}</span>
      <n-button v-if="showRemoveButton" text size="tiny" type="error" @click="$emit('remove')">
        <template #icon><n-icon><CloseOutline /></n-icon></template>
      </n-button>
    </div>

    <div class="item-body">
      <template v-if="project.fromExisting">
        <n-select
          v-model:value="project.selectedKey"
          :options="existingOptions"
          placeholder="选择已有项目"
          filterable
          size="small"
          @update:value="val => $emit('select-existing', index, val)"
        />
        <n-input :value="project.sourcePath" placeholder="项目路径" disabled size="small" />
      </template>
      <template v-else>
        <n-input v-model:value="project.sourcePath" placeholder="项目源路径" size="small" @blur="checkGit" />
        <n-input v-model:value="project.name" placeholder="软链接名称（可选）" size="small" />
      </template>

      <div class="git-options" v-if="project.isGitRepo">
        <n-checkbox v-model:checked="project.createWorktree" size="small">
          创建 Git Worktree
        </n-checkbox>

        <div v-if="project.createWorktree" class="branch-inputs">
          <n-radio-group v-model:value="project.branchMode" size="small" class="branch-mode-group">
            <n-radio value="existing">使用已有分支</n-radio>
            <n-radio value="new">新建分支</n-radio>
          </n-radio-group>
        </div>

        <div v-if="project.createWorktree && (project.branchMode || 'existing') === 'existing'" class="branch-inputs">
          <n-input
            v-model:value="project.branch"
            placeholder="已有分支名（留空使用当前分支）"
            size="small"
            style="flex: 1"
          />
        </div>

        <div v-if="project.createWorktree && (project.branchMode || 'existing') === 'new'" class="branch-inputs">
          <n-input
            v-model:value="project.branch"
            placeholder="新分支名"
            size="small"
            style="flex: 1"
          />
          <n-input
            v-model:value="project.baseBranch"
            placeholder="基于分支（可选，如 main）"
            size="small"
            style="flex: 1"
          />
        </div>

        <n-text v-if="project.createWorktree" depth="3" style="font-size: 11px; margin-top: 4px">
          <template v-if="(project.branchMode || 'existing') === 'existing'">
            [INFO] 填已有分支名时优先直接检出；留空则使用当前分支
          </template>
          <template v-else-if="project.branch && project.baseBranch">
            [INFO] 将新建分支 "{{ project.branch }}"，并基于 "{{ project.baseBranch }}" 创建
          </template>
          <template v-else-if="project.branch">
            [INFO] 将新建分支 "{{ project.branch }}"，并基于源仓库当前分支创建
          </template>
          <template v-else>
            [INFO] 请输入新分支名
          </template>
        </n-text>
      </div>
      <n-text v-if="project.isGitRepo" depth="3" style="font-size: 11px">[v] Git 仓库</n-text>
    </div>
  </div>
</template>

<script setup>
import { NSelect, NInput, NCheckbox, NButton, NIcon, NText, NRadioGroup, NRadio } from 'naive-ui'
import { CloseOutline } from '@vicons/ionicons5'
import { checkGitRepo } from '../api/workspaces'

const props = defineProps({
  project: { type: Object, required: true },
  index: { type: Number, required: true },
  existingOptions: { type: Array, default: () => [] },
  showRemoveButton: { type: Boolean, default: true }
})

defineEmits(['remove', 'select-existing'])

async function checkGit() {
  if (!props.project.sourcePath) return
  try {
    const res = await checkGitRepo(props.project.sourcePath)
    if (res.success) {
      props.project.isGitRepo = res.data.isGitRepo
      if (res.data.isGitRepo && !props.project.createWorktree) {
        props.project.createWorktree = true
      }
      if (res.data.isGitRepo && !props.project.branchMode) {
        props.project.branchMode = 'existing'
      }
    }
  } catch (err) {
    console.error('检查 Git 失败:', err)
  }
}
</script>

<style scoped>
.project-item {
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 6px;
  padding: 10px 12px;
}
.item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.item-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}
.item-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.git-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.branch-inputs {
  display: flex;
  gap: 8px;
  width: 100%;
}

.branch-mode-group {
  width: 100%;
}
</style>
