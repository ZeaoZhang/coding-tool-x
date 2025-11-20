<template>
  <div class="right-panel">
    <div class="panel-header">
      <h3>API 渠道管理</h3>
      <n-button type="primary" size="small" @click="showAddDialog = true">
        <template #icon>
          <n-icon><AddOutline /></n-icon>
        </template>
        添加渠道
      </n-button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="loading-container">
      <n-spin size="small" />
    </div>

    <!-- Channels List -->
    <div v-else class="channels-list">
      <div
        v-for="channel in channels"
        :key="channel.id"
        class="channel-card"
        :class="{ active: channel.isActive }"
      >
        <div class="channel-header">
          <div class="channel-title">
            <n-text strong>{{ channel.name }}</n-text>
            <n-tag v-if="channel.isActive" size="tiny" type="success" :bordered="false">
              当前使用
            </n-tag>
          </div>
          <div class="channel-actions">
            <n-button
              v-if="!channel.isActive"
              size="tiny"
              type="primary"
              @click="handleActivate(channel.id)"
            >
              切换
            </n-button>
            <n-button
              size="tiny"
              @click="handleEdit(channel)"
            >
              编辑
            </n-button>
            <n-button
              size="tiny"
              type="error"
              :disabled="channel.isActive"
              @click="handleDelete(channel.id)"
            >
              删除
            </n-button>
          </div>
        </div>

        <div class="channel-info">
          <div class="info-row">
            <n-text depth="3" class="label">URL:</n-text>
            <n-text depth="2" class="value">{{ channel.baseUrl }}</n-text>
          </div>
          <div class="info-row">
            <n-text depth="3" class="label">Key:</n-text>
            <n-text depth="2" class="value" style="font-family: monospace;">
              {{ maskApiKey(channel.apiKey) }}
            </n-text>
          </div>
          <div v-if="channel.websiteUrl" class="info-row website-row">
            <n-text depth="3" class="label">官网:</n-text>
            <n-button
              text
              size="tiny"
              @click="openWebsite(channel.websiteUrl)"
            >
              <template #icon>
                <n-icon size="14"><OpenOutline /></n-icon>
              </template>
              前往官网
            </n-button>
          </div>
        </div>
      </div>

      <n-empty v-if="channels.length === 0" description="暂无渠道" />
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
import { ref, onMounted } from 'vue'
import {
  NButton, NIcon, NText, NTag, NSpin, NEmpty, NModal, NForm, NFormItem, NInput, NSpace
} from 'naive-ui'
import { AddOutline, OpenOutline } from '@vicons/ionicons5'
import api from '../api'
import message, { dialog } from '../utils/message'

const channels = ref([])
const loading = ref(false)
const showAddDialog = ref(false)
const editingChannel = ref(null)
const editingActiveChannel = ref(false) // 是否正在编辑使用中的渠道
const formData = ref({
  name: '',
  baseUrl: '',
  apiKey: '',
  websiteUrl: ''
})

async function loadChannels() {
  loading.value = true
  try {
    const data = await api.getChannels()
    channels.value = data.channels
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

onMounted(() => {
  loadChannels()
})
</script>

<style scoped>
.right-panel {
  width: 400px;
  min-width: 400px;
  padding: 24px;
  border-left: 1px solid #e5e7eb;
  background: #fafafa;
  height: 100vh;
  overflow-y: auto;
  box-sizing: border-box;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
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
}

.channel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.channel-actions {
  display: flex;
  gap: 6px;
}

.channel-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
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
