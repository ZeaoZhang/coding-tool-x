<template>
  <div class="right-panel">
    <!-- 上半部分：API 渠道管理 -->
    <div v-if="showChannels" class="channels-section" :class="{ 'full-height': !showLogs || !proxyRunning }">
      <!-- 固定的标题栏 -->
      <div class="panel-header">
        <div class="header-title">
          <h3>API 渠道管理</h3>
          <n-text depth="3" style="font-size: 12px; margin-left: 8px;">拖拽可调整顺序</n-text>
        </div>
        <n-button type="primary" size="small" @click="handleAdd">
          <template #icon>
            <n-icon><AddOutline /></n-icon>
          </template>
          添加渠道
        </n-button>
      </div>

      <!-- 可滚动的渠道列表区域 -->
      <div class="channels-scroll-area">
        <!-- Loading -->
        <div v-if="loading" class="loading-container">
          <n-spin size="small" />
        </div>

        <!-- Channels List -->
        <div v-else>
          <!-- Empty State -->
          <n-empty v-if="channels.length === 0" description="暂无渠道" />

          <!-- Draggable List -->
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
            :class="{ active: element.isActive, collapsed: collapsedChannels[element.id] }"
          >
            <div class="channel-header">
              <div class="channel-title">
                <n-button
                  text
                  size="tiny"
                  @click="toggleCollapse(element.id)"
                  class="collapse-btn"
                >
                  <n-icon size="18" :class="{ 'collapsed': collapsedChannels[element.id] }">
                    <ChevronDownOutline />
                  </n-icon>
                </n-button>
                <n-text strong>{{ element.name }}</n-text>
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
                <n-button
                  size="tiny"
                  @click="handleEdit(element)"
                >
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

            <div v-show="!collapsedChannels[element.id]" class="channel-info">
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
                  @click="openWebsite(element.websiteUrl)"
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
      </div>
    </div>

    <!-- 下半部分：实时日志（始终挂载，但仅在代理开启且用户开启日志显示时显示） -->
    <!-- 使用 v-show 而不是 v-if，保持组件挂载状态和日志数据 -->
    <div
      v-show="showLogs && proxyRunning"
      class="logs-section"
      :class="{ 'full-height': !showChannels }"
    >
      <ProxyLogs />
    </div>

    <!-- Add/Edit Dialog -->
    <n-modal v-model:show="showAddDialog" preset="dialog" :title="editingChannel ? '编辑渠道' : '添加渠道'">
      <n-form :model="formData">
        <n-form-item label="渠道名称">
          <n-input v-model:value="formData.name" placeholder="例如：官方API / 中转平台A" />
        </n-form-item>
        <n-form-item label="Base URL">
          <n-input
            v-model:value="formData.baseUrl"
            placeholder="https://api.anthropic.com"
            :disabled="editingActiveChannel"
          />
        </n-form-item>
        <n-form-item label="API Key">
          <n-input
            v-model:value="formData.apiKey"
            type="password"
            show-password-on="click"
            placeholder="sk-ant-xxx"
            :disabled="editingActiveChannel"
          />
        </n-form-item>
        <n-form-item label="官网地址（可选）">
          <n-input v-model:value="formData.websiteUrl" placeholder="https://example.com" />
        </n-form-item>
        <n-text v-if="editingActiveChannel" depth="3" style="font-size: 12px;">
          提示：使用中的渠道只能修改名称和官网地址
        </n-text>
      </n-form>
      <template #action>
        <n-space>
          <n-button @click="showAddDialog = false">取消</n-button>
          <n-button type="primary" @click="handleSave">保存</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import {
  NButton, NIcon, NText, NTag, NSpin, NEmpty, NModal, NForm, NFormItem, NInput, NSpace
} from 'naive-ui'
import { AddOutline, OpenOutline, ChevronDownOutline } from '@vicons/ionicons5'
import draggable from 'vuedraggable'
import api from '../api'
import message, { dialog } from '../utils/message'
import ProxyLogs from './ProxyLogs.vue'

// Props for panel visibility
const props = defineProps({
  showChannels: {
    type: Boolean,
    default: true
  },
  showLogs: {
    type: Boolean,
    default: true
  }
})

const channels = ref([])
const loading = ref(false)
const showAddDialog = ref(false)
const editingChannel = ref(null)
const editingActiveChannel = ref(false) // 是否正在编辑使用中的渠道
const proxyRunning = ref(false) // 代理是否运行中
const collapsedChannels = ref({}) // 折叠状态：{ channelId: true/false }
const formData = ref({
  name: '',
  baseUrl: '',
  apiKey: '',
  websiteUrl: ''
})

let statusCheckInterval = null

async function loadChannels() {
  loading.value = true
  try {
    const data = await api.getChannels()
    channels.value = data.channels
    // 加载保存的排序
    loadChannelOrder()
  } catch (err) {
    message.error('加载失败: ' + err.message)
  } finally {
    loading.value = false
  }
}

function maskApiKey(key) {
  if (!key) return '(未设置)'
  if (key.length <= 12) return '******'
  return key.substring(0, 8) + '******' + key.substring(key.length - 4)
}

function handleAdd() {
  // 清空表单数据和编辑状态
  editingChannel.value = null
  editingActiveChannel.value = false
  formData.value = {
    name: '',
    baseUrl: '',
    apiKey: '',
    websiteUrl: ''
  }
  showAddDialog.value = true
}

function handleEdit(channel) {
  editingChannel.value = channel
  editingActiveChannel.value = channel.isActive // 记录是否为使用中的渠道
  formData.value = {
    name: channel.name,
    baseUrl: channel.baseUrl,
    apiKey: channel.apiKey,
    websiteUrl: channel.websiteUrl || ''
  }
  showAddDialog.value = true
}

function openWebsite(url) {
  window.open(url, '_blank')
}

// 折叠状态管理
function toggleCollapse(channelId) {
  collapsedChannels.value[channelId] = !collapsedChannels.value[channelId]
  saveCollapseSettings()
}

function loadCollapseSettings() {
  try {
    const saved = localStorage.getItem('cc-channel-collapse')
    if (saved) {
      collapsedChannels.value = JSON.parse(saved)
    }
  } catch (err) {
    console.error('Failed to load collapse settings:', err)
  }
}

function saveCollapseSettings() {
  try {
    localStorage.setItem('cc-channel-collapse', JSON.stringify(collapsedChannels.value))
  } catch (err) {
    console.error('Failed to save collapse settings:', err)
  }
}

// 拖拽排序
function handleDragEnd() {
  saveChannelOrder()
}

function saveChannelOrder() {
  try {
    const order = channels.value.map(c => c.id)
    localStorage.setItem('cc-channel-order', JSON.stringify(order))
  } catch (err) {
    console.error('Failed to save channel order:', err)
  }
}

function loadChannelOrder() {
  try {
    const saved = localStorage.getItem('cc-channel-order')
    if (saved && channels.value.length > 0) {
      const order = JSON.parse(saved)
      // 按照保存的顺序重新排列
      const orderedChannels = []
      order.forEach(id => {
        const channel = channels.value.find(c => c.id === id)
        if (channel) {
          orderedChannels.push(channel)
        }
      })
      // 添加新增的渠道（可能不在保存的顺序中）
      channels.value.forEach(channel => {
        if (!orderedChannels.find(c => c.id === channel.id)) {
          orderedChannels.push(channel)
        }
      })
      channels.value = orderedChannels
    }
  } catch (err) {
    console.error('Failed to load channel order:', err)
  }
}

async function handleSave() {
  if (!formData.value.name || !formData.value.baseUrl || !formData.value.apiKey) {
    message.error('请填写所有字段')
    return
  }

  try {
    if (editingChannel.value) {
      await api.updateChannel(editingChannel.value.id, formData.value)
      message.success('渠道已更新')
    } else {
      await api.createChannel(formData.value.name, formData.value.baseUrl, formData.value.apiKey, formData.value.websiteUrl)
      message.success('渠道已添加')
    }

    showAddDialog.value = false
    editingChannel.value = null
    editingActiveChannel.value = false
    formData.value = { name: '', baseUrl: '', apiKey: '', websiteUrl: '' }
    await loadChannels()
  } catch (err) {
    message.error('操作失败: ' + err.message)
  }
}

async function handleActivate(id) {
  try {
    await api.activateChannel(id)
    message.success('渠道已切换')
    await loadChannels()
  } catch (err) {
    message.error('切换失败: ' + err.message)
  }
}

function handleDelete(id) {
  dialog.warning({
    title: '删除渠道',
    content: '确定要删除这个渠道吗？',
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await api.deleteChannel(id)
        message.success('渠道已删除')
        await loadChannels()
      } catch (err) {
        message.error('删除失败: ' + err.message)
      }
    }
  })
}

// 检查代理状态
async function checkProxyStatus() {
  try {
    const status = await api.getProxyStatus()
    proxyRunning.value = status.proxy.running
  } catch (err) {
    console.error('Failed to check proxy status:', err)
  }
}

onMounted(() => {
  loadCollapseSettings()
  loadChannels()
  checkProxyStatus()

  // 每30秒检查一次代理状态（降低请求频率）
  statusCheckInterval = setInterval(checkProxyStatus, 30000)
})

onUnmounted(() => {
  if (statusCheckInterval) {
    clearInterval(statusCheckInterval)
  }
})
</script>

<style scoped>
.right-panel {
  width: 480px;
  min-width: 480px;
  border-left: 1px solid #e5e7eb;
  background: #fafafa;
  height: 100vh;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

/* 上半部分：API 渠道管理 */
.channels-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: flex 0.3s ease-out, min-height 0.3s ease-out, max-height 0.3s ease-out;
}

/* 当渠道列表占据全部高度时（日志面板隐藏或代理未运行） */
.channels-section.full-height {
  flex: 1;
  min-height: 0;
  max-height: none;
}

/* 固定的标题栏 */
.panel-header {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 18px 16px 18px;
  background: #fafafa;
}

.header-title {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

/* 可滚动的渠道列表区域 */
.channels-scroll-area {
  flex: 1;
  min-height: 0;
  padding: 0 18px 18px 18px;
  overflow-y: auto;
  overflow-x: hidden;
}

/* 下半部分：实时日志 */
.logs-section {
  flex: 0 0 400px;
  min-height: 400px;
  max-height: 400px;
  overflow: hidden;
  transition: flex 0.3s ease-out, min-height 0.3s ease-out, max-height 0.3s ease-out;
}

/* 当日志面板占据全部高度时（渠道列表隐藏） */
.logs-section.full-height {
  flex: 1;
  min-height: 0;
  max-height: none;
}

.panel-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.loading-container {
  display: flex;
  justify-content: center;
  padding: 40px 0;
}

.channels-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.channel-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
  transition: all 0.2s;
  cursor: move;
}

/* 拖动时的半透明虚影 */
.ghost {
  opacity: 0.4;
}

/* 被选中开始拖动的元素 */
.chosen {
  transform: scale(1.02);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15) !important;
  cursor: grabbing !important;
}

/* 正在拖动中的元素 */
.drag {
  opacity: 0.8;
  transform: rotate(1deg);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2) !important;
}

.channel-card.active {
  border-color: #18a058;
  background: #f0fdf4;
  box-shadow: 0 2px 8px rgba(24, 160, 88, 0.1);
}

.channel-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
  transition: margin-bottom 0.3s ease;
}

.channel-card.collapsed .channel-header {
  margin-bottom: 0;
}

.channel-title {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
}

.collapse-btn {
  padding: 0 !important;
  margin: 0 !important;
  height: auto !important;
  min-width: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.collapse-btn .n-icon {
  transition: transform 0.3s ease;
  color: #666;
}

.collapse-btn .n-icon.collapsed {
  transform: rotate(-90deg);
}

.collapse-btn:hover .n-icon {
  color: #18a058;
}

.channel-actions {
  display: flex;
  gap: 6px;
}

.channel-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
  transition: all 0.3s ease;
}

.info-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.label {
  min-width: 40px;
  font-size: 13px;
}

.value {
  font-size: 13px;
  word-break: break-all;
  flex: 1;
}

.website-row {
  align-items: center;
}

.website-row .n-button {
  padding: 0;
  height: auto;
  font-size: 13px;
}
</style>
