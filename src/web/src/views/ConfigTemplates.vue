<template>
  <div class="config-templates">
    <n-card title="配置模版管理" :bordered="false">
      <template #header-extra>
        <n-button type="primary" @click="handleCreate">
          <template #icon>
            <n-icon><Add /></n-icon>
          </template>
          创建模版
        </n-button>
      </template>

      <!-- 搜索和筛选 -->
      <div class="filter-bar">
        <n-input
          v-model:value="searchQuery"
          placeholder="搜索模版..."
          clearable
          style="width: 300px"
        >
          <template #prefix>
            <n-icon><SearchOutline /></n-icon>
          </template>
        </n-input>
        <n-radio-group v-model:value="filterType" size="small">
          <n-radio-button value="all">全部</n-radio-button>
          <n-radio-button value="builtin">内置</n-radio-button>
          <n-radio-button value="custom">自定义</n-radio-button>
        </n-radio-group>
      </div>

      <!-- 模版列表 -->
      <n-spin :show="loading">
        <n-empty v-if="!loading && filteredTemplates.length === 0" description="暂无配置模版" />

        <div class="templates-grid" v-else>
          <ConfigTemplateCard
            v-for="template in filteredTemplates"
            :key="template.id"
            :template="template"
            :deleting="deletingId === template.id"
            @click="handlePreview(template)"
            @preview="handlePreview"
            @edit="handleEdit"
            @delete="handleDelete"
            @apply="handleApply"
          />
        </div>
      </n-spin>
    </n-card>

    <!-- 创建/编辑模版弹窗 -->
    <ConfigTemplateFormModal
      v-model:show="showFormModal"
      :template="editingTemplate"
      :available-configs="availableConfigs"
      @success="handleFormSuccess"
    />

    <!-- 应用模版弹窗 -->
    <ConfigApplyModal
      v-model:show="showApplyModal"
      :template="applyingTemplate"
      @success="handleApplySuccess"
    />

    <!-- 预览模版弹窗 -->
    <n-modal
      v-model:show="showPreviewModal"
      preset="card"
      :title="`模版预览: ${previewTemplate?.name || ''}`"
      style="width: 700px; max-height: 80vh"
      :mask-closable="true"
    >
      <n-scrollbar style="max-height: 60vh">
        <div class="preview-content" v-if="previewTemplate">
          <n-descriptions :column="1" label-placement="left" bordered>
            <n-descriptions-item label="名称">
              {{ previewTemplate.name }}
            </n-descriptions-item>
            <n-descriptions-item label="描述">
              {{ previewTemplate.description || '-' }}
            </n-descriptions-item>
            <n-descriptions-item label="类型">
              <n-tag :type="previewTemplate.isBuiltin ? 'default' : 'success'" size="small">
                {{ previewTemplate.isBuiltin ? '内置' : '自定义' }}
              </n-tag>
            </n-descriptions-item>
          </n-descriptions>

          <n-divider>配置内容</n-divider>

          <n-collapse>
            <n-collapse-item title="CLAUDE.md" name="claudeMd" v-if="previewTemplate.claudeMd?.enabled">
              <n-code :code="previewTemplate.claudeMd.content" language="markdown" />
            </n-collapse-item>

            <n-collapse-item :title="`Agents (${previewTemplate.agents?.length || 0})`" name="agents" v-if="previewTemplate.agents?.length">
              <n-space vertical>
                <n-tag v-for="agent in previewTemplate.agents" :key="agent.fileName">
                  {{ agent.name || agent.fileName }}
                </n-tag>
              </n-space>
            </n-collapse-item>
            <n-collapse-item :title="`Skills (${previewTemplate.skills?.length || 0})`" name="skills" v-if="previewTemplate.skills?.length">
              <n-space vertical>
                <n-tag v-for="skill in previewTemplate.skills" :key="skill.directory">
                  {{ skill.name || skill.directory }}
                </n-tag>
              </n-space>
            </n-collapse-item>

            <n-collapse-item :title="`Commands (${previewTemplate.commands?.length || 0})`" name="commands" v-if="previewTemplate.commands?.length">
              <n-space vertical>
                <n-tag v-for="cmd in previewTemplate.commands" :key="cmd.name">
                  {{ cmd.namespace ? `${cmd.namespace}/` : '' }}{{ cmd.name }}
                </n-tag>
              </n-space>
            </n-collapse-item>

            <n-collapse-item :title="`Rules (${previewTemplate.rules?.length || 0})`" name="rules" v-if="previewTemplate.rules?.length">
              <n-space vertical>
                <n-tag v-for="rule in previewTemplate.rules" :key="rule.fileName">
                  {{ rule.directory ? `${rule.directory}/` : '' }}{{ rule.fileName }}
                </n-tag>
              </n-space>
            </n-collapse-item>

            <n-collapse-item :title="`MCP Servers (${previewTemplate.mcpServers?.length || 0})`" name="mcp" v-if="previewTemplate.mcpServers?.length">
              <n-space>
                <n-tag v-for="mcp in previewTemplate.mcpServers" :key="mcp" type="info">
                  {{ mcp }}
                </n-tag>
              </n-space>
            </n-collapse-item>
          </n-collapse>
        </div>
      </n-scrollbar>

      <template #footer>
        <n-space justify="end">
          <n-button @click="showPreviewModal = false">关闭</n-button>
          <n-button type="primary" @click="handleApply(previewTemplate)">应用此模版</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  NCard, NButton, NIcon, NInput, NRadioGroup, NRadioButton,
  NSpin, NEmpty, NModal, NScrollbar, NDescriptions, NDescriptionsItem,
  NDivider, NCollapse, NCollapseItem, NCode, NSpace, NTag,
  useMessage, useDialog
} from 'naive-ui'
import { Add, SearchOutline } from '@vicons/ionicons5'
import ConfigTemplateCard from '@/components/ConfigTemplateCard.vue'
import ConfigTemplateFormModal from '@/components/ConfigTemplateFormModal.vue'
import ConfigApplyModal from '@/components/ConfigApplyModal.vue'
import {
  getAllTemplates,
  getAvailableConfigs,
  deleteTemplate
} from '@/api/config-templates'

const message = useMessage()
const dialog = useDialog()

// 状态
const loading = ref(false)
const templates = ref([])
const availableConfigs = ref({})
const searchQuery = ref('')
const filterType = ref('all')
const deletingId = ref(null)

// 弹窗状态
const showFormModal = ref(false)
const showApplyModal = ref(false)
const showPreviewModal = ref(false)
const editingTemplate = ref(null)
const applyingTemplate = ref(null)
const previewTemplate = ref(null)

// 筛选后的模版列表
const filteredTemplates = computed(() => {
  let result = templates.value

  // 按类型筛选
  if (filterType.value === 'builtin') {
    result = result.filter(t => t.isBuiltin)
  } else if (filterType.value === 'custom') {
    result = result.filter(t => !t.isBuiltin)
  }

  // 按搜索词筛选
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase()
    result = result.filter(t =>
      t.name.toLowerCase().includes(query) ||
      (t.description && t.description.toLowerCase().includes(query))
    )
  }

  return result
})

// 加载数据
async function loadData() {
  loading.value = true
  try {
    const [templatesRes, configsRes] = await Promise.all([
      getAllTemplates(),
      getAvailableConfigs()
    ])
    if (templatesRes.success) {
      templates.value = templatesRes.data
    }
    if (configsRes.success) {
      availableConfigs.value = configsRes.data
    }
  } catch (error) {
    message.error('加载数据失败: ' + error.message)
  } finally {
    loading.value = false
  }
}

// 创建模版
function handleCreate() {
  editingTemplate.value = null
  showFormModal.value = true
}

// 编辑模版
function handleEdit(template) {
  editingTemplate.value = { ...template }
  showFormModal.value = true
}

// 删除模版
function handleDelete(template) {
  dialog.warning({
    title: '确认删除',
    content: `确定要删除模版 "${template.name}" 吗？此操作不可恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      deletingId.value = template.id
      try {
        const res = await deleteTemplate(template.id)
        if (res.success) {
          message.success('删除成功')
          loadData()
        } else {
          message.error(res.message || '删除失败')
        }
      } catch (error) {
        message.error('删除失败: ' + error.message)
      } finally {
        deletingId.value = null
      }
    }
  })
}

// 预览模版
function handlePreview(template) {
  previewTemplate.value = template
  showPreviewModal.value = true
}

// 应用模版
function handleApply(template) {
  applyingTemplate.value = template
  showPreviewModal.value = false
  showApplyModal.value = true
}

// 表单成功回调
function handleFormSuccess() {
  showFormModal.value = false
  loadData()
}

// 应用成功回调
function handleApplySuccess() {
  showApplyModal.value = false
  message.success('模版应用成功')
}

onMounted(() => {
  loadData()
})
</script>

<style scoped>
.config-templates {
  padding: 0;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}

.templates-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  gap: 16px;
}

.preview-content {
  padding: 8px 0;
}
</style>
