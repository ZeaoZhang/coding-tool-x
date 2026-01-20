<template>
  <n-modal v-model:show="visible" preset="card" title="创建工作区" style="width: 650px" :mask-closable="false">
    <n-form ref="formRef" :model="formData" :rules="formRules" label-placement="left" label-width="100">
      <n-form-item label="工作区名称" path="name">
        <n-input v-model:value="formData.name" placeholder="输入工作区名称" @keydown.enter.prevent />
      </n-form-item>

      <n-form-item label="描述" path="description">
        <n-input v-model:value="formData.description" placeholder="可选描述" type="textarea" :rows="2" />
      </n-form-item>

      <n-form-item label="基础目录" path="baseDir">
        <n-input v-model:value="formData.baseDir" placeholder="留空则使用第一个项目的父目录" />
      </n-form-item>

      <n-form-item label="配置模板" path="configTemplateId">
        <n-select v-model:value="formData.configTemplateId" :options="templateOptions" placeholder="选择配置模板" clearable />
      </n-form-item>

      <n-form-item label="执行权限" path="permissionTemplate">
        <n-select v-model:value="formData.permissionTemplate" :options="permissionOptions" placeholder="选择命令执行权限模式" @update:value="handlePermissionTemplateChange">
          <template #action>
            <div class="permission-info">
              <n-text depth="3" style="font-size: 11px;">权限设置将应用到 .claude/settings.json</n-text>
            </div>
          </template>
        </n-select>
      </n-form-item>

      <n-form-item label="项目列表" path="projects">
        <div class="projects-section">
          <div class="projects-actions">
            <n-button size="small" dashed @click="addProject(false)">添加项目</n-button>
            <n-button size="small" dashed @click="addProject(true)">添加已有项目</n-button>
          </div>
          <div class="projects-list" v-if="formData.projects.length > 0">
            <ProjectItem
              v-for="(proj, idx) in formData.projects"
              :key="idx"
              :project="proj"
              :index="idx"
              :existing-options="existingProjectOptions"
              @remove="removeProject(idx)"
              @select-existing="handleSelectExisting"
            />
          </div>
          <n-text v-else depth="3" style="font-size: 12px">请添加至少一个项目</n-text>
        </div>
      </n-form-item>
    </n-form>

    <template #footer>
      <n-space justify="end">
        <n-button @click="visible = false">取消</n-button>
        <n-button type="primary" @click="handleSubmit" :loading="submitting">创建</n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { NModal, NForm, NFormItem, NInput, NSelect, NButton, NSpace, NText, useMessage } from 'naive-ui'
import { createWorkspace, getAvailableProjects, checkGitRepo } from '../api/workspaces'
import { getAllTemplates } from '../api/config-templates'
import { getPermissionTemplates } from '../api/permissions'
import ProjectItem from './ProjectItem.vue'

const props = defineProps({
  show: { type: Boolean, default: false }
})

const emit = defineEmits(['update:show', 'success'])

const message = useMessage()
const formRef = ref(null)
const submitting = ref(false)
const templates = ref([])
const permissionTemplates = ref([])
const existingProjects = ref([])

const visible = computed({
  get: () => props.show,
  set: (val) => emit('update:show', val)
})

const formData = ref({
  name: '',
  description: '',
  baseDir: '',
  configTemplateId: null,
  permissionTemplate: 'balanced',
  projects: []
})

const formRules = {
  name: [
    { required: true, message: '请输入工作区名称', trigger: 'blur' },
    { pattern: /^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$/, message: '名称只能包含字母、数字、下划线、中划线和中文', trigger: 'blur' }
  ],
  projects: [{ type: 'array', required: true, min: 1, message: '至少需要添加一个项目', trigger: 'blur' }]
}

const templateOptions = computed(() => templates.value.map(t => ({
  label: t.name,
  value: t.id
})))

const permissionOptions = computed(() => {
  // 从API加载的权限模板转换为下拉选项
  if (!permissionTemplates.value || !Array.isArray(permissionTemplates.value)) {
    return [];
  }
  return permissionTemplates.value.map(tpl => ({
    label: tpl.name,
    value: tpl.id
  }));
})

const existingProjectOptions = computed(() => existingProjects.value.map(p => ({
  label: `${p.displayName || p.name} (${p.channel})${p.isGitRepo ? ' [Git]' : ''}`,
  value: `${p.channel}::${p.name}`,
  path: p.fullPath || p.name,
  isGitRepo: p.isGitRepo
})))

function addProject(fromExisting) {
  formData.value.projects.push({
    sourcePath: '',
    name: '',
    createWorktree: false,
    branch: '',
    isGitRepo: false,
    fromExisting,
    selectedKey: ''
  })
}

function removeProject(idx) {
  formData.value.projects.splice(idx, 1)
}

function handleSelectExisting(idx, value) {
  const opt = existingProjectOptions.value.find(o => o.value === value)
  if (!opt) return
  const proj = formData.value.projects[idx]
  proj.sourcePath = opt.path
  proj.name = opt.path.split('/').pop()
  proj.isGitRepo = opt.isGitRepo
  proj.createWorktree = opt.isGitRepo
}

// 处理权限模板选择
function handlePermissionTemplateChange(value) {
  if (!value) return
  const template = permissionTemplates.value.find(t => t.id === value)
  if (template) {
    message.success(`已应用模板：${template.name}`)
  }
}

async function handleSubmit() {
  try {
    await formRef.value?.validate()
    for (const proj of formData.value.projects) {
      if (!proj.sourcePath) {
        message.error('请填写项目路径')
        return
      }
    }
    submitting.value = true
    const res = await createWorkspace(formData.value)
    if (res.success) {
      message.success('工作区创建成功')
      resetForm()
      emit('success')
    } else {
      message.error(res.message || '创建失败')
    }
  } catch (err) {
    if (!err.errors) message.error('创建失败: ' + err.message)
  } finally {
    submitting.value = false
  }
}

function resetForm() {
  formData.value = { name: '', description: '', baseDir: '', configTemplateId: null, permissionTemplate: 'balanced', projects: [] }
}

async function loadData() {
  try {
    const [tplRes, projRes, permRes] = await Promise.all([
      getAllTemplates(),
      getAvailableProjects(),
      getPermissionTemplates()
    ]);
    if (tplRes.success) templates.value = tplRes.data || [];
    if (projRes.success) existingProjects.value = projRes.data || [];
    if (permRes.success) permissionTemplates.value = permRes.data || [];
  } catch (err) {
    console.error('加载数据失败:', err);
  }
}

watch(visible, (val) => {
  if (val) loadData()
})
</script>

<style scoped>
.projects-section {
  width: 100%;
}
.projects-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.projects-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.permission-info {
  padding: 6px 10px;
  border-top: 1px solid var(--border-primary);
}
</style>
