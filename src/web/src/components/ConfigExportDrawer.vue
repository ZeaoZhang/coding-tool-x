<template>
  <n-drawer
    v-model:show="visible"
    :width="drawerWidth"
    placement="right"
    :mask-closable="true"
  >
    <n-drawer-content closable :native-scrollbar="false">
      <template #header>
        <div class="drawer-header">
          <n-icon :size="20" color="#18a058">
            <CloudDownloadOutline />
          </n-icon>
          <span>配置导出/导入</span>
        </div>
      </template>

      <div class="export-import-container">
        <!-- 导出配置 -->
        <div class="section">
          <div class="section-header">
            <n-text strong>导出配置</n-text>
            <n-text depth="3" style="font-size: 12px;">
              导出权限模板、配置模板、频道配置到JSON文件
            </n-text>
          </div>
          <n-button
            type="primary"
            :loading="exporting"
            @click="handleExport"
          >
            <template #icon>
              <n-icon><DownloadOutline /></n-icon>
            </template>
            导出配置
          </n-button>
        </div>

        <n-divider />

        <!-- 导入配置 -->
        <div class="section">
          <div class="section-header">
            <n-text strong>导入配置</n-text>
            <n-text depth="3" style="font-size: 12px;">
              从JSON文件导入配置（支持覆盖已有配置）
            </n-text>
          </div>

          <n-upload
            :custom-request="handleFileUpload"
            :show-file-list="false"
            accept=".json"
          >
            <n-button>
              <template #icon>
                <n-icon><CloudUploadOutline /></n-icon>
              </template>
              选择配置文件
            </n-button>
          </n-upload>

          <!-- 预览导入内容 -->
          <div v-if="importPreview" class="import-preview">
            <n-text strong style="font-size: 14px;">导入预览</n-text>
            <div class="preview-stats">
              <div class="stat-item">
                <n-text depth="3">权限模板:</n-text>
                <n-text>{{ importPreview.counts.permissionTemplates }}</n-text>
              </div>
              <div class="stat-item">
                <n-text depth="3">配置模板:</n-text>
                <n-text>{{ importPreview.counts.configTemplates }}</n-text>
              </div>
              <div class="stat-item">
                <n-text depth="3">频道:</n-text>
                <n-text>{{ importPreview.counts.channels }}</n-text>
              </div>
            </div>

            <n-checkbox v-model:checked="overwriteExisting" style="margin-top: 12px;">
              覆盖已有配置
            </n-checkbox>

            <n-space style="margin-top: 16px;">
              <n-button
                type="primary"
                :loading="importing"
                @click="handleImport"
              >
                确认导入
              </n-button>
              <n-button @click="cancelImport">取消</n-button>
            </n-space>
          </div>
        </div>
      </div>
    </n-drawer-content>
  </n-drawer>
</template>

<script setup>
import { ref, computed } from 'vue'
import {
  NDrawer, NDrawerContent, NButton, NIcon, NText, NDivider,
  NUpload, NCheckbox, NSpace
} from 'naive-ui'
import {
  CloudDownloadOutline, DownloadOutline, CloudUploadOutline
} from '@vicons/ionicons5'
import { useResponsiveDrawer } from '../composables/useResponsiveDrawer'
import { exportConfigs, previewImport, importConfigs } from '../api/config-export'
import message from '../utils/message'

const props = defineProps({
  visible: { type: Boolean, default: false }
})

const emit = defineEmits(['update:visible'])

const { drawerWidth } = useResponsiveDrawer(520, 480)

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

const exporting = ref(false)
const importing = ref(false)
const importPreview = ref(null)
const importData = ref(null)
const overwriteExisting = ref(false)

// 导出配置
async function handleExport() {
  exporting.value = true
  try {
    const blob = await exportConfigs()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ctx-config-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)
    message.success('配置导出成功')
  } catch (err) {
    console.error('导出失败:', err)
    message.error('导出失败: ' + err.message)
  } finally {
    exporting.value = false
  }
}

// 处理文件上传
async function handleFileUpload({ file }) {
  try {
    const text = await file.file.text()
    const data = JSON.parse(text)

    // 预览导入内容
    const result = await previewImport(data)
    if (result.success) {
      importPreview.value = result.data
      importData.value = data
      message.success('配置文件解析成功')
    } else {
      message.error('配置文件格式错误: ' + result.message)
    }
  } catch (err) {
    console.error('文件解析失败:', err)
    message.error('文件解析失败: ' + err.message)
  }
}

// 确认导入
async function handleImport() {
  if (!importData.value) return

  importing.value = true
  try {
    const result = await importConfigs(importData.value, overwriteExisting.value)
    if (result.success) {
      message.success('配置导入成功: ' + result.message)
      cancelImport()
    } else {
      message.error('配置导入失败: ' + result.message)
    }
  } catch (err) {
    console.error('导入失败:', err)
    message.error('导入失败: ' + err.message)
  } finally {
    importing.value = false
  }
}

// 取消导入
function cancelImport() {
  importPreview.value = null
  importData.value = null
  overwriteExisting.value = false
}
</script>

<style scoped>
.drawer-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
}

.export-import-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 4px;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.import-preview {
  margin-top: 16px;
  padding: 16px;
  border-radius: 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
}

.preview-stats {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.stat-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
