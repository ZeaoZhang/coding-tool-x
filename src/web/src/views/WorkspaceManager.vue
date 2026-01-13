<template>
  <div class="workspace-manager">
    <n-card title="工作区管理" :bordered="false">
      <template #header-extra>
        <n-button type="primary" @click="showCreateModal = true">
          <template #icon>
            <n-icon><Add /></n-icon>
          </template>
          创建工作区
        </n-button>
      </template>

      <!-- 工作区列表 -->
      <n-spin :show="loading">
        <n-empty v-if="!loading && workspaces.length === 0" description="暂无工作区" />

        <n-space vertical :size="16" v-else>
          <n-card
            v-for="workspace in workspaces"
            :key="workspace.id"
            :title="workspace.name"
            size="small"
            hoverable
          >
            <template #header-extra>
              <n-space>
                <n-tag :type="workspace.exists ? 'success' : 'error'" size="small">
                  {{ workspace.exists ? '存在' : '不存在' }}
                </n-tag>
                <n-button
                  size="small"
                  @click="viewWorkspace(workspace)"
                >
                  查看
                </n-button>
                <n-button
                  size="small"
                  type="error"
                  @click="confirmDelete(workspace)"
                >
                  删除
                </n-button>
              </n-space>
            </template>

            <n-descriptions :column="2" size="small">
              <n-descriptions-item label="描述">
                {{ workspace.description || '-' }}
              </n-descriptions-item>
              <n-descriptions-item label="项目数">
                {{ workspace.projectCount }}
              </n-descriptions-item>
              <n-descriptions-item label="路径" :span="2">
                <n-ellipsis style="max-width: 500px">
                  {{ workspace.path }}
                </n-ellipsis>
              </n-descriptions-item>
              <n-descriptions-item label="最后使用" :span="2">
                {{ formatDate(workspace.lastUsed) }}
              </n-descriptions-item>
            </n-descriptions>
          </n-card>
        </n-space>
      </n-spin>
    </n-card>

    <!-- 创建工作区模态框 -->
    <n-modal
      v-model:show="showCreateModal"
      preset="card"
      title="创建工作区"
      style="width: 700px"
      :mask-closable="false"
    >
      <n-form ref="formRef" :model="formData" :rules="formRules">
        <n-form-item label="工作区名称" path="name">
          <n-input
            v-model:value="formData.name"
            placeholder="输入工作区名称"
            @keydown.enter.prevent
          />
        </n-form-item>

        <n-form-item label="描述（可选）" path="description">
          <n-input
            v-model:value="formData.description"
            placeholder="输入工作区描述"
            type="textarea"
            :rows="2"
          />
        </n-form-item>

        <n-form-item label="基础目录（可选）" path="baseDir">
          <n-input
            v-model:value="formData.baseDir"
            placeholder="留空则使用第一个项目的父目录"
          />
        </n-form-item>

        <n-form-item label="配置模板（可选）" path="configTemplateId">
          <n-select
            v-model:value="formData.configTemplateId"
            :options="templateOptions"
            placeholder="选择配置模板"
            clearable
          >
            <template #empty>
              <n-empty description="暂无模板" />
            </template>
          </n-select>
          <template #feedback v-if="selectedTemplate">
            <n-text depth="3" style="font-size: 12px">
              {{ selectedTemplate.description }}
            </n-text>
          </template>
        </n-form-item>

        <n-form-item label="选择项目" path="projects">
          <n-space vertical style="width: 100%">
            <n-space>
              <n-button class="add-project-btn" @click="addProject" type="dashed">
                添加项目
              </n-button>
              <n-button class="add-project-btn" @click="addExistingProject" type="dashed">
                添加已有项目
              </n-button>
            </n-space>

            <n-card
              v-for="(proj, index) in formData.projects"
              :key="index"
              size="small"
              :title="`项目 ${index + 1}`"
            >
              <template #header-extra>
                <n-button
                  size="tiny"
                  type="error"
                  @click="removeProject(index)"
                >
                  移除
                </n-button>
              </template>

              <n-space vertical>
                <template v-if="proj.fromExisting">
                  <n-select
                    v-model:value="proj.selectedKey"
                    :options="existingProjectOptions"
                    placeholder="选择已有项目"
                    filterable
                    :loading="loadingExistingProjects"
                    @update:value="value => handleExistingProjectSelect(proj, value)"
                  />
                  <n-input
                    :value="proj.sourcePath"
                    placeholder="将使用所选项目路径"
                    disabled
                  />
                  <n-text depth="3" v-if="proj.selectedKey" style="font-size: 12px">
                    软链接名称：{{ proj.name || '未选择' }}
                  </n-text>
                </template>
                <template v-else>
                  <n-input
                    v-model:value="proj.sourcePath"
                    placeholder="项目源路径"
                    @blur="handleSourcePathBlur(proj)"
                  />

                  <n-input
                    v-if="!proj.autoName"
                    v-model:value="proj.name"
                    placeholder="软链接名称（可选）"
                  />
                  <n-input
                    v-else
                    :value="proj.name"
                    placeholder="输入路径后将自动使用目录名"
                    disabled
                  />
                </template>

                <n-space v-if="proj.isGitRepo">
                  <n-checkbox v-model:checked="proj.createWorktree">
                    创建 Git Worktree
                  </n-checkbox>

                  <n-input
                    v-if="proj.createWorktree"
                    v-model:value="proj.branch"
                    placeholder="分支名"
                    style="width: 200px"
                  />
                </n-space>

                <n-text v-if="proj.isGitRepo" depth="3" style="font-size: 12px">
                  ✓ Git 仓库
                </n-text>
              </n-space>
            </n-card>
          </n-space>
        </n-form-item>
      </n-form>

      <template #footer>
        <n-space justify="end">
          <n-button @click="showCreateModal = false">取消</n-button>
          <n-button type="primary" @click="handleCreate" :loading="creating">
            创建
          </n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 查看工作区详情模态框 -->
    <n-modal
      v-model:show="showDetailModal"
      preset="card"
      title="工作区详情"
      style="width: 800px"
    >
      <div v-if="currentWorkspace">
        <n-descriptions :column="1" bordered>
          <n-descriptions-item label="名称">
            {{ currentWorkspace.name }}
          </n-descriptions-item>
          <n-descriptions-item label="描述">
            {{ currentWorkspace.description || '-' }}
          </n-descriptions-item>
          <n-descriptions-item label="路径">
            {{ currentWorkspace.path }}
          </n-descriptions-item>
          <n-descriptions-item label="状态">
            <n-tag :type="currentWorkspace.exists ? 'success' : 'error'">
              {{ currentWorkspace.exists ? '存在' : '不存在' }}
            </n-tag>
          </n-descriptions-item>
          <n-descriptions-item label="创建时间">
            {{ formatDate(currentWorkspace.createdAt) }}
          </n-descriptions-item>
          <n-descriptions-item label="最后使用">
            {{ formatDate(currentWorkspace.lastUsed) }}
          </n-descriptions-item>
          <n-descriptions-item label="配置模板" v-if="currentWorkspace.configTemplate">
            <n-tag type="info" size="small">
              {{ currentWorkspace.configTemplate.templateName }}
            </n-tag>
            <n-text depth="3" style="margin-left: 8px; font-size: 12px">
              应用于 {{ formatDate(currentWorkspace.configTemplate.appliedAt) }}
            </n-text>
          </n-descriptions-item>
        </n-descriptions>

        <!-- 启动 CLI 工具 -->
        <n-divider />
        <n-h3>启动 CLI 工具</n-h3>
        <n-space>
          <n-button
            type="primary"
            @click="handleLaunchCLI('claude')"
            :disabled="!currentWorkspace.exists"
          >
            Claude Code
          </n-button>
          <n-button
            type="info"
            @click="handleLaunchCLI('codex')"
            :disabled="!currentWorkspace.exists"
          >
            Codex
          </n-button>
          <n-button
            type="success"
            @click="handleLaunchCLI('gemini')"
            :disabled="!currentWorkspace.exists"
          >
            Gemini CLI
          </n-button>
        </n-space>
        <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
          点击按钮将复制启动命令到剪贴板，请在终端中粘贴执行
        </n-text>

        <n-divider />

        <n-h3>包含项目 ({{ currentWorkspace.projects.length }})</n-h3>

        <n-space vertical>
          <n-card
            v-for="(proj, index) in currentWorkspace.projects"
            :key="index"
            size="small"
            :title="proj.name"
          >
            <n-descriptions :column="1" size="small">
              <n-descriptions-item label="源路径">
                <n-space align="center">
                  <n-tag
                    :type="proj.sourceExists ? 'success' : 'error'"
                    size="small"
                  >
                    {{ proj.sourceExists ? '✓' : '✗' }}
                  </n-tag>
                  <n-text>{{ proj.sourcePath }}</n-text>
                </n-space>
              </n-descriptions-item>

              <n-descriptions-item
                v-if="proj.worktrees && proj.worktrees.length > 0"
                label="Worktrees"
              >
                <n-ul>
                  <n-li v-for="(wt, wtIndex) in proj.worktrees" :key="wtIndex">
                    {{ wt.branch || 'detached' }}: {{ wt.path }}
                  </n-li>
                </n-ul>
              </n-descriptions-item>
            </n-descriptions>
          </n-card>
        </n-space>

        <!-- CLAUDE.md 预览 -->
        <template v-if="claudeMdContent">
          <n-divider />
          <n-h3>CLAUDE.md 配置预览</n-h3>
          <n-card size="small">
            <MarkdownViewer :content="claudeMdContent" />
          </n-card>
        </template>
      </div>
    </n-modal>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import {
  useMessage,
  useDialog,
  NCard,
  NButton,
  NIcon,
  NSpace,
  NSpin,
  NEmpty,
  NTag,
  NDescriptions,
  NDescriptionsItem,
  NEllipsis,
  NModal,
  NForm,
  NFormItem,
  NInput,
  NSelect,
  NText,
  NCheckbox,
  NDivider,
  NH3,
  NUl,
  NLi
} from 'naive-ui';
import { Add } from '@vicons/ionicons5';
import MarkdownViewer from '../components/MarkdownViewer.vue';
import {
  getWorkspaces,
  getWorkspace,
  createWorkspace,
  deleteWorkspace,
  checkGitRepo,
  getAvailableProjects,
  getLaunchCommand
} from '../api/workspaces';
import {
  getAllTemplates
} from '../api/config-templates';

const message = useMessage();
const dialog = useDialog();

const loading = ref(false);
const workspaces = ref([]);
const showCreateModal = ref(false);
const showDetailModal = ref(false);
const currentWorkspace = ref(null);
const creating = ref(false);

// 配置模板相关
const configTemplates = ref([]);
const loadingTemplates = ref(false);
const claudeMdContent = ref('');
const existingProjects = ref([]);
const loadingExistingProjects = ref(false);

const formRef = ref(null);
const formData = ref({
  name: '',
  description: '',
  baseDir: '',
  configTemplateId: null,
  projects: []
});

const formRules = {
  name: [
    { required: true, message: '请输入工作区名称', trigger: 'blur' },
    {
      pattern: /^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$/,
      message: '名称只能包含字母、数字、下划线、中划线和中文',
      trigger: 'blur'
    }
  ],
  projects: [
    {
      type: 'array',
      required: true,
      min: 1,
      message: '至少需要添加一个项目',
      trigger: 'blur'
    }
  ]
};

// 格式化日期
function formatDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('zh-CN');
}

// 计算属性：模板选项
const templateOptions = computed(() => {
  return configTemplates.value.map(t => ({
    label: t.name + (t.isBuiltin ? ' (内置)' : ''),
    value: t.id,
    disabled: false
  }));
});

// 计算属性：当前选中的模板
const selectedTemplate = computed(() => {
  if (!formData.value.configTemplateId) return null;
  return configTemplates.value.find(t => t.id === formData.value.configTemplateId);
});

// 计算属性：已有项目选项（从统一 API 获取，包含 isGitRepo 信息）
const existingProjectOptions = computed(() => {
  return existingProjects.value.map(p => ({
    label: `${p.displayName || p.name} (${p.channel})${p.isGitRepo ? ' [Git]' : ''}`,
    value: `${p.channel}::${p.name}`,
    path: p.fullPath || p.name,
    isGitRepo: p.isGitRepo
  }));
});

// 加载配置模板列表
async function loadConfigTemplates() {
  loadingTemplates.value = true;
  try {
    const response = await getAllTemplates();
    if (response.success) {
      configTemplates.value = response.data;
    }
  } catch (error) {
    console.error('加载配置模板失败:', error);
  } finally {
    loadingTemplates.value = false;
  }
}

// 加载已有项目（从统一 API 获取所有渠道项目并集）
async function loadExistingProjects() {
  loadingExistingProjects.value = true;
  try {
    const res = await getAvailableProjects();
    if (res.success && Array.isArray(res.data)) {
      existingProjects.value = res.data;
    }
  } catch (error) {
    console.error('加载可用项目失败:', error);
  } finally {
    loadingExistingProjects.value = false;
  }
}

// 加载工作区列表
async function loadWorkspaces() {
  loading.value = true;
  try {
    const response = await getWorkspaces();
    if (response.success) {
      workspaces.value = response.data;
    } else {
      message.error(response.message || '加载失败');
    }
  } catch (error) {
    message.error('加载工作区列表失败');
    console.error(error);
  } finally {
    loading.value = false;
  }
}

// 查看工作区详情
async function viewWorkspace(workspace) {
  try {
    const response = await getWorkspace(workspace.id);
    if (response.success) {
      currentWorkspace.value = response.data;

      // 尝试读取 CLAUDE.md 文件内容
      await loadClaudeMd(response.data.path);

      showDetailModal.value = true;
    } else {
      message.error(response.message || '加载详情失败');
    }
  } catch (error) {
    message.error('加载工作区详情失败');
    console.error(error);
  }
}

// 读取 CLAUDE.md 文件内容
async function loadClaudeMd(workspacePath) {
  claudeMdContent.value = '';
  try {
    // 通过 API 读取文件内容
    const response = await fetch(`/api/workspaces/read-file?path=${encodeURIComponent(workspacePath + '/CLAUDE.md')}`);
    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        claudeMdContent.value = data.content;
      }
    }
  } catch (error) {
    // 文件可能不存在，静默失败
    console.debug('未找到 CLAUDE.md 文件');
  }
}

// 添加项目
function addProject() {
  formData.value.projects.push({
    sourcePath: '',
    name: '',
    createWorktree: false,
    branch: '',
    isGitRepo: false,
    autoName: false,
    fromExisting: false,
    selectedKey: ''
  });
}

// 添加已有项目：自动使用目录名作为软链接名
function addExistingProject() {
  formData.value.projects.push({
    sourcePath: '',
    name: '',
    createWorktree: false,
    branch: '',
    isGitRepo: false,
    autoName: true,
    fromExisting: true,
    selectedKey: ''
  });
}

// 移除项目
function removeProject(index) {
  formData.value.projects.splice(index, 1);
}

// 检查是否是 git 仓库
function getBaseNameFromPath(pathStr) {
  if (!pathStr) return '';
  const normalized = pathStr.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

// 项目路径失焦时自动填充名称并检查 git
async function handleSourcePathBlur(proj) {
  if (proj.autoName || !proj.name) {
    proj.name = getBaseNameFromPath(proj.sourcePath);
  }
  await checkGit(proj);
}

// 已有项目选择后填充路径和名称，Git 仓库默认创建 worktree
async function handleExistingProjectSelect(proj, value) {
  const option = existingProjectOptions.value.find(opt => opt.value === value);
  if (!option) return;
  proj.sourcePath = option.path;
  proj.name = getBaseNameFromPath(option.path);
  proj.isGitRepo = option.isGitRepo;
  // Git 仓库默认创建 worktree
  proj.createWorktree = option.isGitRepo;
}

async function checkGit(proj) {
  if (!proj.sourcePath) return;

  try {
    const response = await checkGitRepo(proj.sourcePath);
    if (response.success) {
      proj.isGitRepo = response.data.isGitRepo;
      // Git 仓库默认创建 worktree
      if (proj.createWorktree === undefined || proj.createWorktree === false) {
        proj.createWorktree = response.data.isGitRepo;
      }
    }
  } catch (error) {
    console.error('检查 git 仓库失败:', error);
  }
}

// 创建工作区
async function handleCreate() {
  try {
    await formRef.value?.validate();

    // 额外校验：每个项目必须选择或填写路径
    for (const proj of formData.value.projects) {
      if (!proj.sourcePath) {
        message.error('请选择或填写项目路径');
        return;
      }
    }

    creating.value = true;

    const response = await createWorkspace(formData.value);

    if (response.success) {
      message.success('工作区创建成功');
      showCreateModal.value = false;
      resetForm();
      await loadWorkspaces();
    } else {
      message.error(response.message || '创建失败');
    }
  } catch (error) {
    if (error.errors) {
      // 表单验证失败
      return;
    }
    message.error('创建工作区失败');
    console.error(error);
  } finally {
    creating.value = false;
  }
}

// 重置表单
function resetForm() {
  formData.value = {
    name: '',
    description: '',
    baseDir: '',
    configTemplateId: null,
    projects: []
  };
}

// 确认删除
function confirmDelete(workspace) {
  dialog.warning({
    title: '确认删除',
    content: `确定要删除工作区"${workspace.name}"吗？`,
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const response = await deleteWorkspace(workspace.id, false);
        if (response.success) {
          message.success('删除成功');
          await loadWorkspaces();
        } else {
          message.error(response.message || '删除失败');
        }
      } catch (error) {
        message.error('删除工作区失败');
        console.error(error);
      }
    }
  });
}

// 启动 CLI 工具
async function handleLaunchCLI(tool) {
  if (!currentWorkspace.value) return;

  try {
    const response = await getLaunchCommand(currentWorkspace.value.id, tool);
    if (response.success) {
      const launchInfo = response.data;
      // 生成启动命令
      const cmd = `cd "${launchInfo.cwd}" && ${launchInfo.command}`;

      // 复制到剪贴板
      await navigator.clipboard.writeText(cmd);
      message.success(`启动命令已复制到剪贴板: ${cmd}`);
    } else {
      message.error(response.message || '获取启动命令失败');
    }
  } catch (error) {
    message.error('获取启动命令失败');
    console.error(error);
  }
}

onMounted(() => {
  loadWorkspaces();
  loadConfigTemplates();
  loadExistingProjects();
});
</script>

<style scoped>
.workspace-manager {
  padding: 16px;
}

.add-project-btn {
  border: 1px dashed var(--border-primary);
}
</style>
