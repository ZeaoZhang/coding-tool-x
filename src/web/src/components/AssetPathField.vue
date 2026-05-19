<template>
  <div class="asset-detail-info-section" v-if="pathText">
    <h3 class="asset-detail-section-title">{{ title }}</h3>
    <div class="asset-detail-box asset-detail-path-box">
      <n-icon :size="16" class="asset-detail-path-icon">
        <DocumentTextOutline />
      </n-icon>
      <code class="asset-detail-path-text">{{ pathText }}</code>
      <n-tooltip trigger="hover">
        <template #trigger>
          <n-button
            circle
            quaternary
            size="tiny"
            class="asset-detail-path-copy"
            aria-label="复制路径"
            @click.stop="copyPath"
          >
            <template #icon>
              <n-icon><CopyOutline /></n-icon>
            </template>
          </n-button>
        </template>
        复制路径
      </n-tooltip>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { NButton, NIcon, NTooltip } from 'naive-ui'
import { CopyOutline, DocumentTextOutline } from '@vicons/ionicons5'
import { copyTextToClipboard } from '../utils/clipboard'
import message from '../utils/message'

const props = defineProps({
  path: {
    type: String,
    default: ''
  },
  title: {
    type: String,
    default: '路径'
  }
})

const pathText = computed(() => String(props.path || '').trim())

async function copyPath() {
  if (!pathText.value) return

  try {
    const result = await copyTextToClipboard(pathText.value)
    if (result?.method === 'manual') {
      message.warning('自动复制失败，已弹出手动复制框')
      return
    }
    message.success('已复制路径')
  } catch {
    message.error('复制路径失败')
  }
}
</script>
