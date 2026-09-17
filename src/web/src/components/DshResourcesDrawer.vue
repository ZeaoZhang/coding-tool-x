<template>
  <n-drawer v-model:show="visible" :width="drawerWidth" placement="right" :show-mask="true">
    <n-drawer-content closable :native-scrollbar="false">
      <template #header>
        <div class="drawer-header">
          <div>
            <div class="drawer-title">DSH 资源</div>
            <n-text depth="3">由 ctx 托管 DSH 配置、插件和资源</n-text>
          </div>
          <div class="header-actions">
            <n-button size="small" @click="openEditor('plugin')">安装 Plugin</n-button>
            <n-button quaternary size="small" :loading="loading" @click="loadResources">刷新</n-button>
          </div>
        </div>
      </template>

      <n-spin :show="loading">
        <div class="resource-container">
          <n-alert v-if="error" type="error" :bordered="false" class="resource-error">
            {{ error }}
          </n-alert>

          <n-select
            v-if="profileOptions.length"
            v-model:value="selectedProfile"
            :options="profileOptions"
            placeholder="选择 DSH profile"
            class="profile-select"
          />

          <n-tabs type="line" animated>
            <n-tab-pane name="skills" :tab="`Skills (${skills.length})`">
              <div class="tab-toolbar">
                <n-button size="small" @click="openEditor('skill')">新增 Skill</n-button>
              </div>
              <n-list v-if="skills.length" hoverable>
                <n-list-item v-for="skill in skills" :key="skill.name">
                  <n-thing :title="skill.name">
                    <template #description>
                      <span>{{ skill.description }}</span>
                      <div class="resource-meta">
                        <n-tag size="tiny" :bordered="false">{{ skill.source }}</n-tag>
                        <n-tag v-if="!skill.invocation?.modelInvocable" size="tiny" type="warning" :bordered="false">模型不可调用</n-tag>
                        <n-tag v-if="!skill.invocation?.userInvocable" size="tiny" type="warning" :bordered="false">用户不可调用</n-tag>
                      </div>
                    </template>
                    <div class="resource-path">{{ skill.path }}</div>
                  </n-thing>
                  <template #suffix>
                    <n-button v-if="skill.source === 'user-dsh'" quaternary size="small" type="error" @click="removeSkill(skill)">卸载</n-button>
                  </template>
                </n-list-item>
              </n-list>
              <n-empty v-else description="没有发现 DSH skill" />
            </n-tab-pane>

            <n-tab-pane name="plugins" :tab="`Plugins (${plugins.length})`">
              <div class="tab-toolbar">
                <n-button size="small" @click="openEditor('plugin')">安装</n-button>
                <n-button size="small" @click="updatePlugins">更新</n-button>
              </div>
              <n-list v-if="plugins.length" hoverable>
                <n-list-item v-for="plugin in plugins" :key="plugin.name">
                  <n-thing :title="plugin.name">
                    <template #description>
                      <div class="resource-meta">
                        <n-tag size="tiny" :type="plugin.installed ? 'success' : 'warning'" :bordered="false">
                          {{ plugin.installed ? '已发现' : '仅声明' }}
                        </n-tag>
                        <n-tag v-if="plugin.version" size="tiny" :bordered="false">{{ plugin.version }}</n-tag>
                        <n-tag v-if="plugin.management" size="tiny" :bordered="false">{{ plugin.management }}</n-tag>
                      </div>
                    </template>
                    <div class="resource-path">{{ plugin.patchPath || '没有 bundle patch' }}</div>
                  </n-thing>
                  <template #suffix>
                    <n-popconfirm v-if="plugin.installed" @positive-click="removePlugin(plugin)">
                      <template #trigger>
                        <n-button quaternary size="small" type="error">卸载</n-button>
                      </template>
                      确定从当前 profile 卸载 {{ plugin.name }}？
                    </n-popconfirm>
                  </template>
                </n-list-item>
              </n-list>
              <n-empty v-else description="没有发现 DSH plugin" />
            </n-tab-pane>

            <n-tab-pane name="mcp" :tab="`MCP (${mcpServers.length})`">
              <div class="tab-toolbar">
                <n-button size="small" @click="openEditor('mcp')">新增 MCP</n-button>
              </div>
              <n-list v-if="mcpServers.length" hoverable>
                <n-list-item v-for="server in mcpServers" :key="`${server.source}:${server.id}`">
                  <n-thing :title="server.config?.serverName || server.id || '未命名 MCP'">
                    <template #description>
                      <div class="resource-meta">
                        <n-tag size="tiny" :bordered="false">{{ server.config?.transport || 'unknown' }}</n-tag>
                        <n-tag size="tiny" :type="server.enabled ? 'success' : 'warning'" :bordered="false">
                          {{ server.enabled ? '启用' : '禁用' }}
                        </n-tag>
                        <n-tag size="tiny" :bordered="false">{{ server.source }}</n-tag>
                      </div>
                    </template>
                    <n-code :code="formatConfig(server.config)" language="json" :word-wrap="true" />
                  </n-thing>
                  <template #suffix>
                    <n-button quaternary size="small" type="error" @click="removeMcp(server)">移除</n-button>
                  </template>
                </n-list-item>
              </n-list>
              <n-empty v-else description="当前 profile 没有 MCP patch" />
            </n-tab-pane>

            <n-tab-pane name="prompts" :tab="`Prompts (${prompts.length})`">
              <div class="tab-toolbar">
                <n-button size="small" @click="openEditor('prompt')">新增 Prompt</n-button>
              </div>
              <n-list v-if="prompts.length" hoverable>
                <n-list-item v-for="prompt in prompts" :key="`${prompt.source}:${prompt.id}`">
                  <n-thing :title="prompt.id || prompt.name || 'prompt section'">
                    <template #description>
                      <div class="resource-meta">
                        <n-tag size="tiny" :type="prompt.enabled ? 'success' : 'warning'" :bordered="false">
                          {{ prompt.enabled ? '启用' : '禁用' }}
                        </n-tag>
                        <n-tag size="tiny" :bordered="false">{{ prompt.source }}</n-tag>
                      </div>
                    </template>
                    <n-code :code="formatConfig(prompt.config)" language="json" :word-wrap="true" />
                  </n-thing>
                  <template #suffix>
                    <n-button quaternary size="small" type="error" @click="removePrompt(prompt)">移除</n-button>
                  </template>
                </n-list-item>
              </n-list>
              <n-empty v-else description="当前 profile 没有 prompt patch" />
            </n-tab-pane>
          </n-tabs>

          <n-text depth="3" class="resource-note">
            ctx 管理本地配置文件和 plugin 依赖；MCP 连接、插件加载及 profile 重启仍由 DSH 运行时负责。
          </n-text>
        </div>
      </n-spin>
    </n-drawer-content>
  </n-drawer>

  <n-modal v-model:show="editorVisible" preset="card" :title="editorTitle" style="width: 520px">
    <n-form label-placement="top">
      <n-form-item v-if="editorKind === 'plugin'" label="Plugin package spec">
        <n-input v-model:value="editor.profileName" placeholder="profile 名称，例如 web" style="margin-bottom: 10px" />
        <n-input v-model:value="editor.pluginSpec" placeholder="@scope/plugin 或 file:/path/to/plugin" />
      </n-form-item>
      <template v-else-if="editorKind === 'skill'">
        <n-form-item label="名称"><n-input v-model:value="editor.skillName" placeholder="review-check" /></n-form-item>
        <n-form-item label="描述"><n-input v-model:value="editor.skillDescription" placeholder="这个 skill 做什么" /></n-form-item>
        <n-form-item label="内容"><n-input v-model:value="editor.skillContent" type="textarea" :rows="8" placeholder="Skill 指令内容" /></n-form-item>
        <n-form-item label="范围">
          <n-select v-model:value="editor.skillScope" :options="[{ label: '用户级', value: 'user' }, { label: '项目级', value: 'project' }]" />
        </n-form-item>
      </template>
      <template v-else-if="editorKind === 'mcp'">
        <n-form-item label="serverName"><n-input v-model:value="editor.mcpServerName" placeholder="github" /></n-form-item>
        <n-form-item label="传输方式">
          <n-select v-model:value="editor.mcpTransport" :options="[{ label: 'stdio', value: 'stdio' }, { label: 'streamable-http', value: 'streamable-http' }]" />
        </n-form-item>
        <n-form-item v-if="editor.mcpTransport === 'stdio'" label="命令"><n-input v-model:value="editor.mcpCommand" placeholder="npx" /></n-form-item>
        <n-form-item v-if="editor.mcpTransport === 'stdio'" label="参数 JSON"><n-input v-model:value="editor.mcpArgs" placeholder='["-y", "server-package"]' /></n-form-item>
        <n-form-item v-if="editor.mcpTransport === 'streamable-http'" label="URL"><n-input v-model:value="editor.mcpUrl" placeholder="http://localhost:3000/mcp" /></n-form-item>
      </template>
      <template v-else>
        <n-form-item label="Prompt id"><n-input v-model:value="editor.promptId" placeholder="deployment-persona" /></n-form-item>
        <n-form-item label="personaPrefix"><n-input v-model:value="editor.promptPrefix" type="textarea" :rows="4" /></n-form-item>
        <n-form-item label="personaSuffix"><n-input v-model:value="editor.promptSuffix" type="textarea" :rows="4" /></n-form-item>
      </template>
    </n-form>
    <div class="modal-actions">
      <n-button @click="editorVisible = false">取消</n-button>
      <n-button type="primary" :loading="saving" @click="saveEditor">保存</n-button>
    </div>
  </n-modal>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NCode,
  NDrawer,
  NDrawerContent,
  NEmpty,
  NForm,
  NFormItem,
  NInput,
  NList,
  NListItem,
  NModal,
  NPopconfirm,
  NSelect,
  NSpin,
  NTabPane,
  NTabs,
  NTag,
  NText,
  NThing
} from 'naive-ui'
import {
  createDshSkill,
  deleteDshMcp,
  deleteDshPrompt,
  deleteDshSkill,
  getDshPlugins,
  getDshProfileMcp,
  getDshProfilePlugins,
  getDshProfilePrompts,
  getDshResources,
  getDshSkills,
  installDshPlugin,
  uninstallDshPlugin,
  updateDshPlugin,
  upsertDshMcp,
  upsertDshPrompt
} from '../api/platforms'
import { useResponsiveDrawer } from '../composables/useResponsiveDrawer'

const props = defineProps({ visible: { type: Boolean, default: false } })
const emit = defineEmits(['update:visible'])
const visible = computed({
  get: () => props.visible,
  set: value => emit('update:visible', value)
})
const { drawerWidth } = useResponsiveDrawer(760)
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const resources = ref(null)
const pluginCatalog = ref([])
const skills = ref([])
const plugins = ref([])
const mcpServers = ref([])
const prompts = ref([])
const selectedProfile = ref(null)
const editorVisible = ref(false)
const editorKind = ref('plugin')
const editor = ref({
  profileName: '',
  pluginSpec: '',
  skillName: '',
  skillDescription: '',
  skillContent: '',
  skillScope: 'user',
  mcpServerName: '',
  mcpTransport: 'stdio',
  mcpCommand: '',
  mcpArgs: '[]',
  mcpUrl: '',
  promptId: '',
  promptPrefix: '',
  promptSuffix: ''
})

const editorTitle = computed(() => ({ plugin: '安装 DSH Plugin', skill: '新增 DSH Skill', mcp: '新增 DSH MCP', prompt: '新增 DSH Prompt' }[editorKind.value]))
const profileOptions = computed(() => (resources.value?.profiles || []).map(profile => ({ label: profile.name, value: profile.name })))

function formatConfig(value) {
  return JSON.stringify(value || {}, null, 2)
}

function openEditor(kind) {
  editorKind.value = kind
  editor.value = { ...editor.value, profileName: selectedProfile.value || '', pluginSpec: '', skillName: '', skillDescription: '', skillContent: '', mcpServerName: '', mcpCommand: '', mcpArgs: '[]', mcpUrl: '', promptId: '', promptPrefix: '', promptSuffix: '' }
  editorVisible.value = true
}

function notifyError(actionError) {
  error.value = actionError?.response?.data?.error?.error || actionError?.message || 'DSH 配置操作失败'
}

async function saveEditor() {
  saving.value = true
  error.value = ''
  try {
    const value = editor.value
    if (editorKind.value === 'plugin') {
      const profileName = selectedProfile.value || value.profileName
      if (!profileName) throw new Error('请先选择或输入 DSH profile')
      await installDshPlugin(profileName, { spec: value.pluginSpec })
    } else if (editorKind.value === 'skill') {
      await createDshSkill({ name: value.skillName, description: value.skillDescription, content: value.skillContent, scope: value.skillScope })
    } else if (editorKind.value === 'mcp') {
      if (!selectedProfile.value) throw new Error('请先选择 DSH profile')
      const config = { serverName: value.mcpServerName, transport: value.mcpTransport }
      if (value.mcpTransport === 'stdio') {
        config.command = value.mcpCommand
        config.args = JSON.parse(value.mcpArgs || '[]')
      } else {
        config.url = value.mcpUrl
      }
      await upsertDshMcp(selectedProfile.value, { config })
    } else {
      if (!selectedProfile.value) throw new Error('请先选择 DSH profile')
      await upsertDshPrompt(selectedProfile.value, { id: value.promptId, config: { personaPrefix: value.promptPrefix, personaSuffix: value.promptSuffix } })
    }
    editorVisible.value = false
    await loadResources()
  } catch (actionError) {
    notifyError(actionError)
  } finally {
    saving.value = false
  }
}

async function updatePlugins() {
  if (!selectedProfile.value) return
  loading.value = true
  try {
    await updateDshPlugin(selectedProfile.value)
    await loadResources()
  } catch (actionError) {
    notifyError(actionError)
  } finally {
    loading.value = false
  }
}

async function removePlugin(plugin) {
  if (!selectedProfile.value) return
  loading.value = true
  try {
    await uninstallDshPlugin(selectedProfile.value, plugin.name)
    await loadResources()
  } catch (actionError) {
    notifyError(actionError)
  } finally {
    loading.value = false
  }
}

async function removeSkill(skill) {
  try {
    await deleteDshSkill(skill.name, { scope: 'user' })
    await loadResources()
  } catch (actionError) {
    notifyError(actionError)
  }
}

async function removeMcp(server) {
  if (!selectedProfile.value) return
  try {
    await deleteDshMcp(selectedProfile.value, server.id)
    await loadResources()
  } catch (actionError) {
    notifyError(actionError)
  }
}

async function removePrompt(prompt) {
  if (!selectedProfile.value) return
  try {
    await deleteDshPrompt(selectedProfile.value, prompt.id)
    await loadResources()
  } catch (actionError) {
    notifyError(actionError)
  }
}

async function loadDetails(profileName) {
  const [skillResult, pluginResult] = await Promise.all([
    getDshSkills({ profile: profileName || undefined }),
    getDshPlugins()
  ])
  skills.value = skillResult?.skills || []
  pluginCatalog.value = pluginResult?.profiles || []
  const selected = pluginCatalog.value.find(profile => profile?.profile === profileName)
  plugins.value = selected?.plugins || []
  if (!profileName) {
    mcpServers.value = []
    prompts.value = []
    return
  }
  const [profilePlugins, mcpResult, promptResult] = await Promise.all([
    getDshProfilePlugins(profileName),
    getDshProfileMcp(profileName),
    getDshProfilePrompts(profileName)
  ])
  plugins.value = profilePlugins?.plugins || plugins.value
  mcpServers.value = mcpResult?.servers || []
  prompts.value = promptResult?.prompts || []
}

async function loadResources() {
  loading.value = true
  error.value = ''
  try {
    resources.value = await getDshResources({ profile: selectedProfile.value || undefined })
    const firstProfile = profileOptions.value[0]?.value || null
    if (!selectedProfile.value || !profileOptions.value.some(option => option.value === selectedProfile.value)) selectedProfile.value = firstProfile
    await loadDetails(selectedProfile.value)
  } catch (loadError) {
    notifyError(loadError)
  } finally {
    loading.value = false
  }
}

watch(() => props.visible, value => {
  if (value) loadResources()
})

watch(selectedProfile, async value => {
  if (!props.visible || !resources.value) return
  loading.value = true
  try {
    await loadDetails(value)
  } catch (loadError) {
    notifyError(loadError)
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.drawer-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.header-actions, .tab-toolbar, .modal-actions { display: flex; align-items: center; gap: 8px; }
.tab-toolbar { justify-content: flex-end; margin-bottom: 10px; }
.modal-actions { justify-content: flex-end; margin-top: 16px; }
.drawer-title { font-size: 16px; font-weight: 600; color: var(--text-primary); }
.resource-container { display: flex; flex-direction: column; gap: 12px; }
.resource-error { margin-bottom: 4px; }
.profile-select { max-width: 320px; }
.resource-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.resource-path { margin-top: 8px; color: var(--text-tertiary); font-size: 11px; word-break: break-all; }
.resource-note { display: block; padding: 10px 2px 2px; font-size: 11px; line-height: 1.5; }
:deep(.n-code) { margin-top: 8px; max-height: 180px; overflow: auto; }
</style>
