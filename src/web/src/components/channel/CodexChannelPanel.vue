<template>
  <div>
    <div v-if="loading" class="loading-container">
      <n-spin size="small" />
    </div>
    <div v-else>
      <div v-if="channels.length === 0" class="empty-state">
        <n-empty description="暂无渠道">
          <template #extra>
            <n-button type="primary" size="small" @click="handleAdd">
              <template #icon>
                <n-icon><AddOutline /></n-icon>
              </template>
              添加 Codex 渠道
            </n-button>
          </template>
        </n-empty>
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
            :class="{ active: element.isActive, collapsed: collapsed[element.id] }"
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
                <n-tag v-if="element.isActive" size="tiny" type="success" :bordered="false">
                  当前使用
                </n-tag>
              </div>
              <div class="channel-actions">
                <n-button
                  v-if="!element.isActive"
                  size="tiny"
                  type="primary"
                  @click="handleActivate(element.id)"
                >
                  切换
                </n-button>
                <n-button size="tiny" @click="handleEdit(element)">
                  编辑
                </n-button>
                <n-button
                  size="tiny"
                  type="error"
                  :disabled="element.isActive"
                  @click="handleDelete(element.id)"
                >
                  删除
                </n-button>
              </div>
            </div>

            <div v-show="!collapsed[element.id]" class="channel-info">
              <div class="info-row">
                <n-text depth="3" class="label">Provider:</n-text>
                <n-text depth="2" class="value" style="font-family: monospace;">{{ element.providerKey }}</n-text>
              </div>
              <div class="info-row">
                <n-text depth="3" class="label">URL:</n-text>
                <n-text depth="2" class="value">{{ element.baseUrl }}</n-text>
              </div>
              <div class="info-row">
                <n-text depth="3" class="label">Key:</n-text>
                <n-text depth="2" class="value" style="font-family: monospace;">
                  {{ maskApiKey(element.apiKey) }}
                </n-text>
              </div>
              <div v-if="element.websiteUrl" class="info-row website-row">
                <n-text depth="3" class="label">官网:</n-text>
                <n-button
                  text
                  size="tiny"
                  @click="$emit('open-website', element.websiteUrl)"
                >
                  <template #icon>
                    <n-icon size="14"><OpenOutline /></n-icon>
                  </template>
                  前往官网
                </n-button>
              </div>
            </div>
          </div>
        </template>
      </draggable>
    </div>

    <n-modal v-model:show="showDialog" preset="dialog" :title="editingChannel ? '编辑 Codex 渠道' : '添加 Codex 渠道'">
      <n-form :model="formData">
        <n-form-item label="渠道名称">
          <n-input v-model:value="formData.name" placeholder="显示名称，如：OpenAI 官方 / 我的中转" />
        </n-form-item>
        <n-form-item label="Provider Key">
          <n-input
            v-model:value="formData.providerKey"
            placeholder="英文标识，如：openai、my-api"
            :disabled="editingChannel !== null"
          />
          <template #feedback>
            <n-text depth="3" style="font-size: 11px;">小写字母和短横线组合</n-text>
          </template>
        </n-form-item>
        <n-form-item label="Base URL">
          <n-input v-model:value="formData.baseUrl" placeholder="https://api.example.com" />
        </n-form-item>
        <n-form-item label="API Key">
          <n-input v-model:value="formData.apiKey" type="password" placeholder="sk-..." />
        </n-form-item>
        <n-form-item label="官网链接">
          <n-input v-model:value="formData.websiteUrl" placeholder="https://" />
        </n-form-item>
      </n-form>
      <template #action>
        <n-space>
          <n-button @click="showDialog = false">取消</n-button>
          <n-button type="primary" @click="handleSave">保存</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { NButton, NIcon, NText, NTag, NEmpty, NSpin, NModal, NForm, NFormItem, NInput, NSpace } from 'naive-ui'
import { ChevronDownOutline, OpenOutline, AddOutline } from '@vicons/ionicons5'
import draggable from 'vuedraggable'
import message, { dialog } from '../../utils/message'
import {
  getCodexChannels,
  createCodexChannel,
  updateCodexChannel,
  deleteCodexChannel,
  activateCodexChannel
} from '../../api/channels'
import { getUIConfig, updateNestedUIConfig } from '../../api/ui-config'

const channels = ref([])
const loading = ref(false)
const showDialog = ref(false)
const editingChannel = ref(null)
const editingActiveChannel = ref(false)

const COLLAPSE_STORAGE_KEY = 'codexChannelCollapse'

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
  providerKey: '',
  baseUrl: '',
  apiKey: '',
  websiteUrl: ''
})

function maskApiKey(key) {
  if (!key) return '(未设置)'
  if (key.length <= 12) return '******'
  return key.substring(0, 8) + '******' + key.substring(key.length - 4)
}

function toggleCollapse(id) {
  collapsed.value[id] = !collapsed.value[id]
  saveCollapseToStorage(collapsed.value)
  saveCollapseSettings()
}

function handleDragEnd() {
  saveOrder()
}

function handleAdd() {
  editingChannel.value = null
  editingActiveChannel.value = false
  formData.value = { name: '', providerKey: '', baseUrl: '', apiKey: '', websiteUrl: '' }
  showDialog.value = true
}

function handleEdit(channel) {
  editingChannel.value = channel
  editingActiveChannel.value = channel.isActive
  formData.value = {
    name: channel.name,
    providerKey: channel.providerKey,
    baseUrl: channel.baseUrl,
    apiKey: channel.apiKey,
    websiteUrl: channel.websiteUrl || ''
  }
  showDialog.value = true
}

async function handleSave() {
  if (editingActiveChannel.value) {
    if (!formData.value.name) {
      message.error('请填写渠道名称')
      return
    }
  } else {
    if (!formData.value.name || !formData.value.providerKey || !formData.value.baseUrl || !formData.value.apiKey) {
      message.error('请填写所有必填字段')
      return
    }
  }

  try {
    if (editingChannel.value) {
      const updates = {
        name: formData.value.name,
        websiteUrl: formData.value.websiteUrl
      }
      if (!editingActiveChannel.value) {
        updates.baseUrl = formData.value.baseUrl
        updates.apiKey = formData.value.apiKey
      }
      await updateCodexChannel(editingChannel.value.id, updates)
      message.success('Codex 渠道已更新')
    } else {
      await createCodexChannel(
        formData.value.name,
        formData.value.providerKey,
        formData.value.baseUrl,
        formData.value.apiKey,
        formData.value.websiteUrl
      )
      message.success('Codex 渠道已添加')
    }

    showDialog.value = false
    editingChannel.value = null
    editingActiveChannel.value = false
    formData.value = { name: '', providerKey: '', baseUrl: '', apiKey: '', websiteUrl: '' }
    await loadChannels()
  } catch (err) {
    message.error('操作失败: ' + err.message)
  }
}

async function handleActivate(id) {
  try {
    await activateCodexChannel(id)
    message.success('Codex 渠道已切换')
    await loadChannels()
  } catch (err) {
    message.error('切换失败: ' + err.message)
  }
}

function handleDelete(id) {
  dialog.warning({
    title: '删除 Codex 渠道',
    content: '确定要删除这个渠道吗？',
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await deleteCodexChannel(id)
        message.success('Codex 渠道已删除')
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
    const data = await getCodexChannels()
    channels.value = data.channels || []
    loadOrder()
  } catch (err) {
    message.error('加载 Codex 渠道失败: ' + err.message)
  } finally {
    loading.value = false
  }
}

async function loadCollapseSettings() {
  try {
    const response = await getUIConfig()
    if (response.success && response.config) {
      const serverCollapse = response.config.channelCollapse?.codex || {}
      collapsed.value = serverCollapse
      saveCollapseToStorage(serverCollapse)
    }
  } catch (err) {
    console.error('Failed to load Codex collapse settings:', err)
  }
}

async function saveCollapseSettings() {
  try {
    await updateNestedUIConfig('channelCollapse', 'codex', collapsed.value)
  } catch (err) {
    console.error('Failed to save Codex collapse settings:', err)
  }
}

async function loadOrder() {
  try {
    const response = await getUIConfig()
    if (response.success && response.config && channels.value.length > 0) {
      const order = response.config.channelOrder?.codex || []
      const ordered = []
      order.forEach(id => {
        const channel = channels.value.find(c => c.id === id)
        if (channel) ordered.push(channel)
      })
      channels.value.forEach(channel => {
        if (!ordered.find(c => c.id === channel.id)) ordered.push(channel)
      })
      channels.value = ordered
    }
  } catch (err) {
    console.error('Failed to load Codex channel order:', err)
  }
}

async function saveOrder() {
  try {
    const order = channels.value.map(c => c.id)
    await updateNestedUIConfig('channelOrder', 'codex', order)
  } catch (err) {
    console.error('Failed to save Codex channel order:', err)
  }
}

onMounted(() => {
  loadChannels()
  loadCollapseSettings()
})

defineExpose({
  openAddDialog: handleAdd,
  refresh: loadChannels
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
  gap: 12px;
}

.channel-card {
  border: 1px solid var(--n-divider-color);
  border-radius: 8px;
  padding: 12px;
  background: var(--bg-secondary);
  transition: all 0.2s ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.channel-card:hover {
  border-color: var(--n-border-color);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.channel-card.active {
  border-color: var(--n-primary-color);
  background: var(--n-primary-color-suppl, rgba(24, 160, 88, 0.08));
  box-shadow: 0 2px 8px rgba(24, 160, 88, 0.1);
}

.channel-card.collapsed .channel-info {
  display: none;
}

.channel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: grab;
}

.channel-header:active {
  cursor: grabbing;
}

.channel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.channel-name {
  font-weight: 600;
  color: var(--n-text-color);
}

.channel-actions {
  display: flex;
  gap: 8px;
}

.channel-info {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--n-border-color);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.label {
  font-size: 12px;
  color: var(--n-text-color-3);
}

.value {
  font-size: 12px;
  color: var(--n-text-color);
  word-break: break-all;
}

.website-row {
  margin-top: 8px;
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
