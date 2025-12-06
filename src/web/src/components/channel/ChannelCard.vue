<template>
  <div
    class="channel-card"
    :class="{
      collapsed,
      disabled: channel.enabled === false,
      'status-frozen': channel.health?.status === 'frozen',
      'status-checking': channel.health?.status === 'checking'
    }"
  >
    <div class="channel-header">
      <div class="channel-title">
        <n-button
          text
          size="tiny"
          class="collapse-btn"
          @click.stop="$emit('toggle-collapse')"
        >
          <n-icon size="16" :class="{ collapsed }">
            <ChevronDownOutline />
          </n-icon>
        </n-button>
        <span class="channel-name">{{ channel.name }}</span>
        <template v-for="tag in headerTags" :key="tag.text">
          <n-tag size="tiny" :type="tag.type || 'default'" :bordered="false">
            {{ tag.text }}
          </n-tag>
        </template>
      </div>
      <div class="channel-actions">
        <n-button
          v-if="showApplyButton"
          size="tiny"
          type="primary"
          class="apply-btn"
          @click="$emit('apply')"
        >
          写入配置
        </n-button>
        <n-button
          size="tiny"
          :loading="testing"
          @click="runTest"
        >
          <template #icon>
            <n-icon><SpeedometerOutline /></n-icon>
          </template>
          测速
        </n-button>
        <n-button size="tiny" @click="$emit('edit')">
          编辑
        </n-button>
        <n-button size="tiny" type="error" @click="$emit('delete')">
          删除
        </n-button>
        <n-switch
          size="small"
          :value="channel.enabled !== false"
          @update:value="$emit('toggle-enabled', $event)"
        />
      </div>
    </div>

    <!-- 测试结果展示 -->
    <div v-if="testResult" class="test-result" :class="testResult.success ? 'success' : 'failed'">
      <div class="test-result-header">
        <span class="test-result-status">
          <n-icon v-if="testResult.success" color="#18a058"><CheckmarkCircleOutline /></n-icon>
          <n-icon v-else color="#f56c6c"><CloseCircleOutline /></n-icon>
          {{ testResult.success ? '测试成功' : '测试失败' }}
        </span>
        <div class="test-result-info">
          <span v-if="testResult.latency" class="latency">{{ testResult.latency }}ms</span>
          <span v-if="testResult.statusCode" class="status-code">HTTP {{ testResult.statusCode }}</span>
        </div>
        <n-button text size="tiny" @click="testResult = null">
          <n-icon><CloseOutline /></n-icon>
        </n-button>
      </div>
      <div v-if="testResult.error" class="test-result-error">
        {{ testResult.error }}
      </div>
    </div>

    <div v-show="!collapsed" class="channel-info">
      <div class="info-main">
        <div v-for="row in infoRows" :key="row.label" class="info-row">
          <n-text depth="3" class="label">{{ row.label }}:</n-text>
          <n-text depth="2" class="value" :class="{ mono: row.mono }">
            {{ row.value || '—' }}
          </n-text>
          <n-button
            v-if="typeof row.action === 'function'"
            size="tiny"
            text
            type="primary"
            @click="row.action()"
          >
            {{ row.actionLabel || '操作' }}
          </n-button>
        </div>
      </div>
      <div class="info-footer">
        <n-button
          v-if="channel.websiteUrl"
          text
          size="tiny"
          @click="$emit('open-website', channel.websiteUrl)"
        >
          <template #icon>
            <n-icon size="14"><OpenOutline /></n-icon>
          </template>
          前往官网
        </n-button>
        <div class="footer-spacer"></div>
        <div class="channel-meta">
          <span class="meta-item">
            权重: <span class="meta-value">{{ meta.weight }}</span>
          </span>
          <span class="meta-item">
            并发:
            <span class="meta-value" :class="{ 'meta-active': meta.concurrencyActive }">
              {{ meta.concurrencyText }}
            </span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { NButton, NIcon, NTag, NText, NSwitch } from 'naive-ui'
import { ChevronDownOutline, OpenOutline, SpeedometerOutline, CheckmarkCircleOutline, CloseCircleOutline, CloseOutline } from '@vicons/ionicons5'

const props = defineProps({
  channel: {
    type: Object,
    required: true
  },
  collapsed: {
    type: Boolean,
    default: false
  },
  headerTags: {
    type: Array,
    default: () => []
  },
  infoRows: {
    type: Array,
    default: () => []
  },
  meta: {
    type: Object,
    default: () => ({ weight: 1, concurrencyText: '不限', concurrencyActive: false })
  },
  showApplyButton: {
    type: Boolean,
    default: false
  },
  channelType: {
    type: String,
    default: 'claude'
  },
  testFn: {
    type: Function,
    default: null
  }
})

defineEmits(['toggle-collapse', 'apply', 'edit', 'delete', 'toggle-enabled', 'open-website'])

const testing = ref(false)
const testResult = ref(null)

async function runTest() {
  if (!props.testFn) return
  testing.value = true
  testResult.value = null
  try {
    const result = await props.testFn(props.channel.id, 20000)
    testResult.value = result
  } catch (err) {
    testResult.value = {
      success: false,
      error: err.message || '测试失败',
      latency: null,
      statusCode: null
    }
  } finally {
    testing.value = false
  }
}
</script>

<style scoped>
.channel-card {
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  background: var(--bg-primary);
  transition: all 0.2s;
}

.channel-card:hover {
  border-color: var(--border-secondary);
}

.channel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-primary);
}

.channel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.channel-name {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 14px;
}

.collapse-btn {
  flex-shrink: 0;
}

.collapse-btn .n-icon.collapsed {
  transform: rotate(-90deg);
}

.channel-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* 测试结果样式 */
.test-result {
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-primary);
  background: var(--bg-secondary);
}

.test-result.success {
  background: rgba(24, 160, 88, 0.06);
  border-left: 3px solid #18a058;
}

.test-result.failed {
  background: rgba(245, 108, 108, 0.06);
  border-left: 3px solid #f56c6c;
}

.test-result-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.test-result-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
}

.test-result.success .test-result-status {
  color: #18a058;
}

.test-result.failed .test-result-status {
  color: #f56c6c;
}

.test-result-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
}

.test-result-info .latency {
  font-size: 13px;
  font-family: 'SF Mono', Monaco, monospace;
  font-weight: 600;
  color: var(--text-primary);
  background: var(--bg-tertiary);
  padding: 2px 8px;
  border-radius: 4px;
}

.test-result-info .status-code {
  font-size: 11px;
  font-family: 'SF Mono', Monaco, monospace;
  color: var(--text-tertiary);
}

.test-result-error {
  margin-top: 8px;
  padding: 8px 10px;
  background: rgba(245, 108, 108, 0.08);
  border-radius: 4px;
  font-size: 12px;
  color: #f56c6c;
  line-height: 1.4;
  word-break: break-word;
}

.channel-info {
  padding: 12px 16px;
}

.info-main {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.info-row .label {
  min-width: 80px;
  font-size: 13px;
}

.info-row .value {
  flex: 1;
  font-size: 13px;
}

.info-row .value.mono {
  font-family: 'SF Mono', Monaco, monospace;
}

.info-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid var(--border-primary);
}

.footer-spacer {
  flex: 1;
}

.channel-meta {
  display: flex;
  gap: 16px;
  font-size: 12px;
}

.meta-item {
  color: var(--text-tertiary);
}

.meta-value {
  color: var(--text-secondary);
  font-weight: 500;
}

.meta-active {
  color: #18a058;
}

/* ========== 响应式样式 ========== */

/* 平板端 (768px - 1024px) */
@media (max-width: 1024px) {
  .channel-header {
    padding: 10px 12px;
  }

  .channel-info {
    padding: 10px 12px;
  }

  .channel-actions {
    gap: 6px;
  }

  .info-row {
    gap: 8px;
  }

  .info-row .label {
    min-width: 70px;
    font-size: 12px;
  }

  .info-row .value {
    font-size: 12px;
  }

  .channel-meta {
    gap: 12px;
  }
}

/* 小屏幕 (640px - 768px) */
@media (max-width: 768px) {
  .channel-header {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    padding: 8px 10px;
  }

  .channel-title {
    font-size: 13px;
  }

  .channel-actions {
    justify-content: space-between;
  }

  .channel-actions :deep(.n-button) {
    font-size: 12px;
    padding: 0 8px;
  }

  .channel-info {
    padding: 8px 10px;
  }

  .info-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  .info-row .label {
    min-width: auto;
  }

  .info-footer {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    margin-top: 8px;
  }

  .channel-meta {
    align-self: stretch;
    justify-content: space-between;
  }
}

/* 移动端 (< 640px) */
@media (max-width: 640px) {
  .channel-card {
    border-radius: 6px;
  }

  .channel-header {
    padding: 6px 8px;
  }

  .channel-name {
    font-size: 12px;
  }

  .channel-title :deep(.n-tag) {
    font-size: 10px;
  }

  .channel-info {
    padding: 6px 8px;
  }

  .info-row .label {
    font-size: 11px;
  }

  .info-row .value {
    font-size: 11px;
  }

  .channel-actions :deep(.n-button) {
    font-size: 11px;
    padding: 0 6px;
    height: 24px;
  }

  .channel-meta {
    font-size: 11px;
  }
}

/* 超小屏幕 (< 480px) */
@media (max-width: 480px) {
  .channel-header {
    padding: 4px 6px;
  }

  .channel-info {
    padding: 4px 6px;
  }

  .channel-actions {
    gap: 4px;
  }

  .channel-actions :deep(.n-button) {
    font-size: 10px;
    padding: 0 4px;
    height: 22px;
    min-width: 0;
  }
}
</style>
