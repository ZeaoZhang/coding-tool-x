<template>
  <div>
    <div v-if="loading" class="loading-container">
      <n-spin size="small" />
    </div>
    <div v-else>
      <div v-if="channels.length === 0" class="empty-state">
        <n-empty description="暂无渠道" />
      </div>
      <draggable
        v-else
        v-model="channels"
        item-key="id"
        class="channels-list"
        ghost-class="ghost"
        chosen-class="chosen"
        drag-class="drag"
        animation="200"
        @end="handleDragEnd"
      >
        <template #item="{ element }">
          <div
            :key="element.id"
            class="channel-card"
            :class="{
              collapsed: collapsed[element.id],
              disabled: element.enabled === false,
              'status-frozen': element.health?.status === 'frozen',
              'status-checking': element.health?.status === 'checking'
            }"
          >
            <div class="channel-header">
              <div class="channel-title">
                <n-button
                  text
                  size="tiny"
                  @click.stop="toggleCollapse(element.id)"
                  class="collapse-btn"
                >
                  <n-icon size="16" :class="{ 'collapsed': collapsed[element.id] }">
                    <ChevronDownOutline />
                  </n-icon>
                </n-button>
                <span class="channel-name">{{ element.name }}</span>
                <n-tag
                  v-if="element.health?.status === 'frozen'"
                  size="tiny"
                  type="error"
                  :bordered="false"
                >
                  冻结 {{ formatFreezeTime(element.health.freezeRemaining) }}
                </n-tag>
                <n-tag
                  v-else-if="element.health?.status === 'checking'"
                  size="tiny"
                  type="warning"
                  :bordered="false"
                >
                  检测中
                </n-tag>
                <n-tag
                  v-if="element.enabled === false"
                  size="tiny"
                  :bordered="false"
                >
                  未启用
                </n-tag>
              </div>
              <div class="channel-actions">
                <n-button
                  size="tiny"
                  type="primary"
                  class="apply-btn"
                  @click="handleApplyToSettings(element)"
                >
                  写入配置
                </n-button>
                <n-button size="tiny" @click="handleEdit(element)">
                  编辑
                </n-button>
                <n-button
                  size="tiny"
                  type="error"
                  @click="handleDelete(element.id)"
                >
                  删除
                </n-button>
                <n-switch
                  size="small"
                  :value="element.enabled !== false"
                  @update:value="value => toggleChannelEnabled(element, value)"
                />
              </div>
            </div>

            <div v-show="!collapsed[element.id]" class="channel-info">
              <div class="info-main">
                <div class="info-row">
                  <n-text depth="3" class="label">URL:</n-text>
                  <n-text depth="2" class="value">{{ element.baseUrl }}</n-text>
                </div>
                <div class="info-row">
                  <n-text depth="3" class="label">Key:</n-text>
                  <n-text depth="2" class="value mono">{{ maskApiKey(element.apiKey) }}</n-text>
                  <n-button
                    v-if="element.health?.status !== 'healthy'"
                    size="tiny"
                    text
                    type="primary"
                    @click="handleResetHealth(element)"
                  >
                    重置状态
                  </n-button>
                </div>
              </div>
              <div class="info-footer">
                <n-button v-if="element.websiteUrl" text size="tiny" @click="emit('open-website', element.websiteUrl)">
                  <template #icon>
                    <n-icon size="14"><OpenOutline /></n-icon>
                  </template>
                  前往官网
                </n-button>
                <div class="footer-spacer"></div>
                <div class="channel-meta">
                  <span class="meta-item">权重: <span class="meta-value">{{ element.weight || 1 }}</span></span>
                  <span class="meta-item" v-if="element.maxConcurrency">
                    并发: <span class="meta-value" :class="{ 'meta-active': getChannelInflight(element.id) > 0 }">{{ getChannelInflight(element.id) }}/{{ element.maxConcurrency }}</span>
                  </span>
                  <span class="meta-item" v-else>
                    并发: <span class="meta-value" :class="{ 'meta-active': getChannelInflight(element.id) > 0 }">{{ getChannelInflight(element.id) > 0 ? getChannelInflight(element.id) : '不限' }}</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </template>
      </draggable>
    </div>

    <n-modal v-model:show="showAddDialog" preset="card" :title="dialogTitle" style="width: 520px;" class="channel-dialog">
      <n-form label-placement="left" label-width="80px" class="channel-form">
        <div class="form-section">
          <div class="section-title">基本信息</div>
          <n-form-item label="渠道名称" required>
            <n-input v-model:value="formData.name" placeholder="输入渠道名称" />
          </n-form-item>
          <n-form-item label="接口地址" required>
            <n-input v-model:value="formData.baseUrl" placeholder="https://api.example.com" />
          </n-form-item>
          <n-form-item label="接口密钥" required>
            <n-input v-model:value="formData.apiKey" placeholder="sk-..." type="password" show-password-on="click" />
          </n-form-item>
          <n-form-item label="官网链接">
            <n-input v-model:value="formData.websiteUrl" placeholder="https://（选填）" />
          </n-form-item>
        </div>

        <div class="form-section">
          <div class="section-title">调度配置</div>
          <n-form-item label="最大并发">
            <n-input-number
              v-model:value="formData.maxConcurrency"
              :min="1"
              :max="100"
              :step="1"
              placeholder="1-100，留空不限制"
              clearable
              style="width: 100%;"
            />
          </n-form-item>
          <n-form-item label="调度权重">
            <n-input-number
              v-model:value="formData.weight"
              :min="1"
              :max="100"
              :step="1"
              placeholder="1-100"
              style="width: 100%;"
            />
            <template #feedback>
              权重越高，被选中概率越大
            </template>
          </n-form-item>
          <n-form-item label="渠道状态">
            <n-switch v-model:value="formData.enabled">
              <template #checked>启用</template>
              <template #unchecked>停用</template>
            </n-switch>
          </n-form-item>
        </div>
      </n-form>
      <template #footer>
        <div class="dialog-footer">
          <n-button @click="showAddDialog = false">取消</n-button>
          <n-button type="primary" @click="handleSave">{{ editingChannel ? '保存修改' : '添加渠道' }}</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  NButton,
  NIcon,
  NTag,
  NText,
  NEmpty,
  NSpin,
  NModal,
  NForm,
  NFormItem,
  NInput,
  NSwitch,
  NInputNumber
} from 'naive-ui'
import { ChevronDownOutline, OpenOutline } from '@vicons/ionicons5'
import draggable from 'vuedraggable'
import message, { dialog } from '../../utils/message'
import {
  getChannels,
  createChannel,
  updateChannel,
  deleteChannel
} from '../../api/channels'
import { client } from '../../api/client'
import { getUIConfig, updateNestedUIConfig } from '../../api/ui-config'
import { useGlobalStore } from '../../stores/global'

const globalStore = useGlobalStore()

const COLLAPSE_STORAGE_KEY = 'claudeChannelCollapse'

const channels = ref([])
const loading = ref(false)
const showAddDialog = ref(false)
const editingChannel = ref(null)
const editingActiveChannel = ref(false)

// 获取渠道的实时并发数
function getChannelInflight(channelId) {
  const scheduler = globalStore.schedulerState.claude
  if (!scheduler || !scheduler.channels) return 0
  const ch = scheduler.channels.find(c => c.id === channelId)
  return ch ? ch.inflight : 0
}

// 从 localStorage 获取初始折叠状态
function getCollapseFromStorage() {
  try {
    const stored = localStorage.getItem(COLLAPSE_STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (e) {}
  return {}
}

// 保存折叠状态到 localStorage
function saveCollapseToStorage(data) {
  try {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(data))
  } catch (e) {}
}

const collapsed = ref(getCollapseFromStorage())
const formData = ref({
  name: '',
  baseUrl: '',
  apiKey: '',
  websiteUrl: '',
  maxConcurrency: null, // 默认不限制
  weight: 1,
  enabled: true
})

const props = defineProps({ hideActions: Boolean })
const emit = defineEmits(['open-website'])

const dialogTitle = computed(() => editingChannel.value ? '编辑渠道' : '添加渠道')

function maskApiKey(key) {
  if (!key) return '(未设置)'
  if (key.length <= 12) return '******'
  return key.substring(0, 8) + '******' + key.substring(key.length - 4)
}

function formatFreezeTime(seconds) {
  if (seconds <= 0) return '0秒'
  if (seconds < 60) return `${seconds}秒`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}分${remainingSeconds}秒` : `${minutes}分钟`
  }
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}小时${remainingMinutes}分` : `${hours}小时`
}

async function handleResetHealth(channel) {
  try {
    await client.post(`/channels/${channel.id}/reset-health`)
    message.success('渠道健康状态已重置')
    await loadChannels()
  } catch (err) {
    message.error('重置失败: ' + err.message)
  }
}

function toggleCollapse(id) {
  collapsed.value[id] = !collapsed.value[id]
  saveCollapseToStorage(collapsed.value)
  saveCollapseSettings()
}

function handleDragEnd() {
  // 拖拽后，确保禁用的渠道在最后
  const enabled = channels.value.filter(ch => ch.enabled !== false)
  const disabled = channels.value.filter(ch => ch.enabled === false)

  // 确保禁用的渠道是折叠状态
  disabled.forEach(ch => {
    collapsed.value[ch.id] = true
  })

  channels.value = [...enabled, ...disabled]
  saveChannelOrder()
  saveCollapseSettings()
}

function handleAdd() {
  editingChannel.value = null
  editingActiveChannel.value = false
  formData.value = { name: '', baseUrl: '', apiKey: '', websiteUrl: '', maxConcurrency: null, weight: 1, enabled: true }
  showAddDialog.value = true
}

function handleEdit(channel) {
  editingChannel.value = channel
  editingActiveChannel.value = false
  formData.value = {
    name: channel.name,
    baseUrl: channel.baseUrl,
    apiKey: channel.apiKey,
    websiteUrl: channel.websiteUrl || '',
    maxConcurrency: channel.maxConcurrency ?? null,
    weight: channel.weight || 1,
    enabled: channel.enabled !== false
  }
  showAddDialog.value = true
}

async function handleSave() {
  if (!formData.value.name || !formData.value.baseUrl || !formData.value.apiKey) {
    message.error('请填写所有必填字段')
    return
  }

  try {
    if (editingChannel.value) {
      const updates = {
        name: formData.value.name,
        baseUrl: formData.value.baseUrl,
        apiKey: formData.value.apiKey,
        websiteUrl: formData.value.websiteUrl,
        maxConcurrency: formData.value.maxConcurrency,
        weight: formData.value.weight,
        enabled: formData.value.enabled
      }
      await updateChannel(editingChannel.value.id, updates)
      message.success('渠道已更新')
    } else {
      await createChannel(
        formData.value.name,
        formData.value.baseUrl,
        formData.value.apiKey,
        formData.value.websiteUrl,
        {
          maxConcurrency: formData.value.maxConcurrency,
          weight: formData.value.weight,
          enabled: formData.value.enabled
        }
      )
      message.success('渠道已添加')
    }

    showAddDialog.value = false
    editingChannel.value = null
    editingActiveChannel.value = false
    formData.value = { name: '', baseUrl: '', apiKey: '', websiteUrl: '', maxConcurrency: null, weight: 1, enabled: true }
    await loadChannels()
  } catch (err) {
    message.error('操作失败: ' + err.message)
  }
}

async function toggleChannelEnabled(channel, enabled) {
  try {
    await updateChannel(channel.id, { enabled })
    message.success(enabled ? `渠道「${channel.name}」已启用` : `渠道「${channel.name}」已停用`)

    // 如果禁用渠道，自动折叠并移到最后
    if (!enabled) {
      // 设置折叠状态
      collapsed.value[channel.id] = true
      saveCollapseToStorage(collapsed.value)
      await saveCollapseSettings()
    }

    await loadChannels()
  } catch (err) {
    message.error('操作失败: ' + err.message)
  }
}

async function handleApplyToSettings(channel) {
  dialog.warning({
    title: '写入配置',
    content: '确定要将此渠道配置写入 settings.json 吗？\n\n写入配置后将关闭动态切换，默认使用当前渠道。',
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const response = await client.post(`/channels/${channel.id}/apply-to-settings`)
        message.success(response.data.message)
        await loadChannels()
      } catch (err) {
        message.error(err.response?.data?.error || err.message || '写入失败')
      }
    }
  })
}

function handleDelete(id) {
  dialog.warning({
    title: '删除渠道',
    content: '确定要删除这个渠道吗？',
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await deleteChannel(id)
        message.success('渠道已删除')
        await loadChannels()
      } catch (err) {
        message.error('删除失败: ' + err.message)
      }
    }
  })
}

async function loadChannels() {
  loading.value = true
  try {
    const data = await getChannels()
    channels.value = data.channels || []
    loadChannelOrder()
  } catch (err) {
    message.error('加载失败: ' + err.message)
  } finally {
    loading.value = false
  }
}

async function loadCollapseSettings() {
  try {
    const response = await getUIConfig()
    if (response.success && response.config) {
      const serverCollapse = response.config.channelCollapse?.claude || {}
      collapsed.value = serverCollapse
      saveCollapseToStorage(serverCollapse)
    }
  } catch (err) {
    console.error('Failed to load collapse settings:', err)
  }
}

async function saveCollapseSettings() {
  try {
    await updateNestedUIConfig('channelCollapse', 'claude', collapsed.value)
  } catch (err) {
    console.error('Failed to save collapse settings:', err)
  }
}

async function loadChannelOrder() {
  try {
    const response = await getUIConfig()
    if (response.success && response.config && channels.value.length > 0) {
      const order = response.config.channelOrder?.claude || []
      const ordered = []

      // 先按保存的顺序排列
      order.forEach(id => {
        const channel = channels.value.find(c => c.id === id)
        if (channel) ordered.push(channel)
      })

      // 添加未排序的渠道
      channels.value.forEach(channel => {
        if (!ordered.find(c => c.id === channel.id)) {
          ordered.push(channel)
        }
      })

      // 自动将禁用的渠道移到最后，并保持折叠状态
      const enabled = ordered.filter(ch => ch.enabled !== false)
      const disabled = ordered.filter(ch => ch.enabled === false)

      // 确保禁用的渠道是折叠状态
      disabled.forEach(ch => {
        collapsed.value[ch.id] = true
      })

      channels.value = [...enabled, ...disabled]
    }
  } catch (err) {
    console.error('Failed to load channel order:', err)
  }
}

async function saveChannelOrder() {
  try {
    const order = channels.value.map(c => c.id)
    await updateNestedUIConfig('channelOrder', 'claude', order)
  } catch (err) {
    console.error('Failed to save channel order:', err)
  }
}

onMounted(() => {
  loadChannels()
  loadCollapseSettings()
})

// 计算渠道统计
const channelStats = computed(() => {
  const enabled = channels.value.filter(ch => ch.enabled !== false).length
  const disabled = channels.value.filter(ch => ch.enabled === false).length
  return { enabled, disabled, total: channels.value.length }
})

defineExpose({
  openAddDialog: handleAdd,
  refresh: loadChannels,
  channelStats
})
</script>

<style scoped>
.loading-container {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 80px 0;
}

.channels-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.channel-card {
  border: 1px solid var(--n-divider-color);
  border-radius: 6px;
  padding: 10px 12px;
  background: var(--bg-secondary);
  transition: all 0.2s ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  border-left: 3px solid #18a058;
}

.channel-card:hover {
  border-color: var(--n-border-color);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.channel-card.disabled {
  opacity: 0.6;
  border-left-color: #909399;
}

.channel-card.status-frozen {
  border-left-color: #d03050;
  background: linear-gradient(90deg, rgba(208, 48, 80, 0.08) 0%, transparent 100%);
}

.channel-card.status-checking {
  border-left-color: #f0a020;
  background: linear-gradient(90deg, rgba(240, 160, 32, 0.08) 0%, transparent 100%);
}

.channel-card.collapsed .channel-info {
  display: none;
}

.channel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: grab;
}

.channel-header:active {
  cursor: grabbing;
}

.channel-title {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.channel-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--n-text-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.info-footer {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--n-border-color);
  display: flex;
  align-items: center;
  gap: 8px;
}

.footer-spacer {
  flex: 1;
}

.channel-meta {
  display: flex;
  gap: 12px;
  flex-shrink: 0;
}

.meta-item {
  font-size: 11px;
  color: var(--n-text-color-3);
  white-space: nowrap;
}

.meta-value {
  color: #18a058;
  font-weight: 600;
}

.meta-value.meta-active {
  color: #f0a020;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.channel-actions {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-shrink: 0;
}

.channel-actions .apply-btn {
  opacity: 0;
  transition: opacity 0.2s ease;
}

.channel-card:hover .channel-actions .apply-btn {
  opacity: 1;
}

.channel-actions :deep(.n-switch) {
  margin-left: 2px;
}

.channel-info {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--n-border-color);
}

.info-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.label {
  font-size: 11px;
  color: var(--n-text-color-3);
  flex-shrink: 0;
  width: 32px;
}

.value {
  font-size: 12px;
  color: var(--n-text-color-2);
  word-break: break-all;
  flex: 1;
}

.value.mono {
  font-family: monospace;
}

.collapse-btn {
  padding: 0;
  display: flex;
  align-items: center;
}

.collapse-btn .n-icon {
  transition: transform 0.2s ease;
}

.collapse-btn .n-icon.collapsed {
  transform: rotate(-90deg);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* 添加渠道弹窗样式 */
.channel-form {
  padding: 0 4px;
}

.form-section {
  background: var(--n-color);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
  border: 1px solid var(--n-border-color);
}

.form-section:last-child {
  margin-bottom: 0;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--n-text-color);
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--n-border-color);
}

.channel-form :deep(.n-form-item) {
  margin-bottom: 16px;
}

.channel-form :deep(.n-form-item:last-child) {
  margin-bottom: 0;
}

.channel-form :deep(.n-form-item-label) {
  font-size: 13px;
}

:global(.ghost) {
  opacity: 0.4;
}

:global(.chosen) {
  transform: scale(1.02);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15) !important;
  cursor: grabbing !important;
}

:global(.drag) {
  opacity: 0.8;
  transform: rotate(1deg);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2) !important;
}
</style>
