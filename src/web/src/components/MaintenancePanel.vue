<template>
  <div class="maintenance-panel">
    <n-spin :show="loading">
      <!-- 扫描结果 -->
      <div v-if="scanResult && scanResult.found" class="result-section">
        <n-alert type="warning" :bordered="false" style="margin-bottom: 20px;">
          <template #icon>
            <n-icon><WarningOutline /></n-icon>
          </template>
          <template #header>
            发现 {{ scanResult.projectCount }} 个项目的旧会话文件
          </template>
          这些文件位于旧的全局目录中。建议迁移到项目目录或直接清理。
        </n-alert>

        <!-- 项目列表 -->
        <div class="legacy-projects">
          <div
            v-for="project in scanResult.projects"
            :key="project.projectName"
            class="project-card"
          >
            <div class="project-header">
              <n-text strong>{{ project.projectName }}</n-text>
              <n-tag :bordered="false" size="small">
                {{ project.fileCount }} 个文件
              </n-tag>
            </div>
            <div class="project-info">
              <n-text depth="3" style="font-size: 12px;">
                大小: {{ formatSize(project.totalSize) }}
              </n-text>
              <n-text depth="3" style="font-size: 12px;">
                路径: {{ project.projectDir }}
              </n-text>
            </div>
          </div>
        </div>
      </div>

      <!-- 无旧文件 -->
      <n-empty
        v-else-if="scanResult && !scanResult.found"
        description="未发现旧文件"
        style="margin: 60px 0;"
      >
        <template #icon>
          <n-icon size="48" color="#18a058">
            <CheckmarkCircleOutline />
          </n-icon>
        </template>
        <template #extra>
          <n-text depth="3">系统状态良好，无需清理</n-text>
        </template>
      </n-empty>

      <!-- 操作按钮 -->
      <div class="action-buttons">
        <n-button @click="handleScan" :loading="scanning">
          <template #icon>
            <n-icon><RefreshOutline /></n-icon>
          </template>
          {{ scanResult ? '重新扫描' : '扫描旧文件' }}
        </n-button>

        <n-button
          v-if="scanResult && scanResult.found"
          type="primary"
          @click="handleMigrate"
          :loading="migrating"
        >
          <template #icon>
            <n-icon><ArrowForwardOutline /></n-icon>
          </template>
          迁移到项目目录
        </n-button>

        <n-button
          v-if="scanResult && scanResult.found"
          type="error"
          @click="handleClean"
          :loading="cleaning"
        >
          <template #icon>
            <n-icon><TrashOutline /></n-icon>
          </template>
          清理旧文件
        </n-button>
      </div>

      <!-- 操作说明 -->
      <n-alert v-if="scanResult && scanResult.found" type="info" :bordered="false" style="margin-top: 20px;">
        <template #header>操作说明</template>
        <div style="font-size: 13px; line-height: 1.6;">
          <p><strong>迁移到项目目录：</strong>将旧文件复制到对应项目的 .claude/sessions 目录，保留原文件</p>
          <p><strong>清理旧文件：</strong>直接删除全局目录中的旧文件（建议先迁移）</p>
        </div>
      </n-alert>

      <!-- 迁移/清理结果 -->
      <div v-if="operationResult" class="operation-result">
        <n-alert
          :type="operationResult.success ? 'success' : 'error'"
          :bordered="false"
          closable
          @close="operationResult = null"
        >
          <template #header>
            {{ operationResult.title }}
          </template>
          {{ operationResult.message }}
        </n-alert>
      </div>
    </n-spin>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  NSpin, NAlert, NIcon, NButton, NText, NTag, NEmpty
} from 'naive-ui'
import {
  WarningOutline, CheckmarkCircleOutline, RefreshOutline,
  ArrowForwardOutline, TrashOutline
} from '@vicons/ionicons5'
import {
  scanLegacyFiles,
  migrateLegacyFiles,
  cleanLegacyFiles
} from '../api/health-check'
import message, { dialog } from '../utils/message'

const loading = ref(false)
const scanning = ref(false)
const migrating = ref(false)
const cleaning = ref(false)
const scanResult = ref(null)
const operationResult = ref(null)

// 格式化文件大小
function formatSize(bytes) {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
}

// 扫描旧文件
async function handleScan() {
  scanning.value = true
  try {
    const result = await scanLegacyFiles()
    scanResult.value = result
    if (result.found && result.projectCount > 0) {
      message.warning(`发现 ${result.projectCount} 个项目的旧文件`)
    } else {
      message.success('未发现旧文件')
    }
  } catch (err) {
    message.error('扫描失败: ' + err.message)
  } finally {
    scanning.value = false
  }
}

// 迁移文件
async function handleMigrate() {
  dialog.warning({
    title: '确认迁移',
    content: `即将迁移 ${scanResult.value.projectCount} 个项目的旧文件到对应的项目目录。\n\n迁移后，旧文件仍会保留在原位置，您可以稍后手动清理。`,
    positiveText: '开始迁移',
    negativeText: '取消',
    onPositiveClick: async () => {
      migrating.value = true
      try {
        const result = await migrateLegacyFiles(false)

        if (result.success) {
          operationResult.value = {
            success: true,
            title: '迁移完成',
            message: `成功迁移 ${result.migratedCount} 个文件，跳过 ${result.skippedCount} 个文件${result.errorCount > 0 ? `，失败 ${result.errorCount} 个` : ''}`
          }
          message.success(`迁移完成！共迁移 ${result.migratedCount} 个文件`)

          // 重新扫描
          await handleScan()
        } else {
          throw new Error(result.error || '迁移失败')
        }
      } catch (err) {
        operationResult.value = {
          success: false,
          title: '迁移失败',
          message: err.message
        }
        message.error('迁移失败: ' + err.message)
      } finally {
        migrating.value = false
      }
    }
  })
}

// 清理文件
async function handleClean() {
  dialog.error({
    title: '确认删除',
    content: `⚠️ 警告：此操作将永久删除 ${scanResult.value.projectCount} 个项目的旧会话文件！\n\n删除后无法恢复，建议先使用"迁移到项目目录"功能。\n\n确定要继续吗？`,
    positiveText: '确定删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      cleaning.value = true
      try {
        const result = await cleanLegacyFiles(false)

        if (result.success) {
          operationResult.value = {
            success: true,
            title: '清理完成',
            message: `成功删除 ${result.deletedCount} 个文件，释放 ${formatSize(result.totalSize)} 空间`
          }
          message.success(`清理完成！共删除 ${result.deletedCount} 个文件`)

          // 重新扫描
          await handleScan()
        } else {
          throw new Error(result.error || '清理失败')
        }
      } catch (err) {
        operationResult.value = {
          success: false,
          title: '清理失败',
          message: err.message
        }
        message.error('清理失败: ' + err.message)
      } finally {
        cleaning.value = false
      }
    }
  })
}

// 页面加载时自动扫描
onMounted(() => {
  handleScan()
})

// 导出扫描结果数量（用于徽章显示）
defineExpose({
  legacyFileCount: computed(() => scanResult.value?.projectCount || 0)
})
</script>

<style scoped>
.maintenance-panel {
  padding: 20px 0;
}

.result-section {
  margin-bottom: 24px;
}

.legacy-projects {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 24px;
}

.project-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  padding: 16px;
  transition: all 0.2s;
}

.project-card:hover {
  border-color: #18a058;
  box-shadow: 0 2px 8px rgba(24, 160, 88, 0.1);
}

.project-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.project-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.action-buttons {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.operation-result {
  margin-top: 20px;
}
</style>
