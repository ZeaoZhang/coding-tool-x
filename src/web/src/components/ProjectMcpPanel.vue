<template>
  <div class="project-mcp-panel">
    <div class="panel-toolbar">
      <span class="resource-path">目标文件：{{ mcp?.path || '当前平台未声明' }}</span>
      <n-button size="small" type="primary" @click="openCreate">
        添加 MCP
      </n-button>
    </div>

    <n-alert v-if="hasStaticSecret" type="warning" :bordered="false" style="margin-bottom: 12px">
      项目 MCP 配置中的静态密钥可能随项目进入 Git，请优先使用环境变量引用。
    </n-alert>

    <n-empty v-if="servers.length === 0" description="暂无项目 MCP 服务器" />
    <div v-else class="server-list">
      <div v-for="server in servers" :key="server.id" class="server-row">
        <div class="server-info">
          <div class="server-title">{{ server.id }}</div>
          <div class="server-spec">{{ describeServer(server) }}</div>
        </div>
        <n-space size="small">
          <n-button size="tiny" :loading="testingId === server.id" @click="handleTest(server)">测试</n-button>
          <n-button size="tiny" @click="openEdit(server)">编辑</n-button>
          <n-button size="tiny" type="error" secondary @click="handleRemove(server)">移除</n-button>
        </n-space>
      </div>
    </div>

    <McpFormDrawer
      v-model:visible="showForm"
      :editing-server="editingServer"
      :existing-ids="servers.map(server => server.id)"
      scope="project"
      :project-path="projectPath"
      :platform="platform"
      @saved="handleSaved"
    />
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { NAlert, NButton, NEmpty, NSpace, useDialog, useMessage } from 'naive-ui'
import { deleteProjectMcp, getProjectMcp, testProjectMcp } from '../api/project-config'
import McpFormDrawer from './McpFormDrawer.vue'

const props = defineProps({
  projectPath: { type: String, required: true },
  platform: { type: String, required: true },
  mcp: { type: Object, default: () => ({ supported: true, servers: [] }) }
})

const emit = defineEmits(['updated'])
const message = useMessage()
const dialog = useDialog()
const showForm = ref(false)
const editingServer = ref(null)
const testingId = ref('')
const localMcp = ref(props.mcp)

const mcp = computed(() => localMcp.value || props.mcp || { servers: [] })
const servers = computed(() => Array.isArray(mcp.value?.servers) ? mcp.value.servers : [])
const hasStaticSecret = computed(() => servers.value.some(server => {
  const spec = server.server || {}
  return Object.keys(spec.env || {}).length > 0 || Object.keys(spec.headers || {}).length > 0
}))

watch(() => props.mcp, value => {
  localMcp.value = value
}, { deep: true })

function describeServer(server) {
  const spec = server.server || {}
  if (spec.type === 'stdio') return `${spec.command || ''} ${(spec.args || []).join(' ')}`.trim()
  return spec.url || spec.type || 'MCP'
}

function openCreate() {
  editingServer.value = null
  showForm.value = true
}

function openEdit(server) {
  editingServer.value = { id: server.id, ...server }
  showForm.value = true
}

async function handleSaved() {
  showForm.value = false
  editingServer.value = null
  await reload()
  emit('updated')
}

async function reload() {
  const result = await getProjectMcp(props.projectPath, props.platform)
  localMcp.value = result
}

async function handleTest(server) {
  testingId.value = server.id
  try {
    const result = await testProjectMcp(props.projectPath, props.platform, server.id)
    if (result.success) message.success(`${server.id} 连接成功`)
    else message.error(result.message || `${server.id} 连接失败`)
  } catch (error) {
    message.error(`测试失败：${error.message}`)
  } finally {
    testingId.value = ''
  }
}

function handleRemove(server) {
  dialog.warning({
    title: '移除项目 MCP',
    content: `确定从当前项目移除 ${server.id} 吗？用户级配置不会被删除。`,
    positiveText: '移除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await deleteProjectMcp(props.projectPath, props.platform, server.id)
        await reload()
        emit('updated')
        message.success('项目 MCP 已移除')
      } catch (error) {
        message.error(`移除失败：${error.message}`)
      }
    }
  })
}

watch([() => props.projectPath, () => props.platform], () => {
  if (props.projectPath && props.platform) reload().catch(error => message.error(`加载项目 MCP 失败：${error.message}`))
})
</script>

<style scoped>
.project-mcp-panel { display: flex; flex-direction: column; min-height: 220px; }
.panel-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.resource-path { color: var(--text-tertiary); font-family: monospace; font-size: 11px; }
.server-list { display: flex; flex-direction: column; gap: 8px; }
.server-row { display: flex; align-items: center; gap: 12px; padding: 10px; border: 1px solid var(--border-primary); border-radius: 6px; }
.server-info { min-width: 0; flex: 1; }
.server-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.server-spec { margin-top: 3px; overflow: hidden; color: var(--text-tertiary); font-family: monospace; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
</style>
