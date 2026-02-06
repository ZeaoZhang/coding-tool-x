<template>
  <div class="oauth-login-button">
    <n-button
      :type="isConnected ? 'default' : 'primary'"
      :size="size"
      :loading="loading"
      :disabled="disabled || loading"
      @click="handleClick"
    >
      <template #icon>
        <n-icon><LogInOutline /></n-icon>
      </template>
      {{ buttonText }}
    </n-button>

    <n-modal
      v-model:show="showModal"
      preset="card"
      :title="'OAuth 授权 - ' + providerName"
      style="width: 500px;"
      :mask-closable="false"
      @close="handleCancel"
    >
      <div class="oauth-modal-content">
        <!-- 授权 URL -->
        <div class="auth-url-section">
          <n-text depth="3" class="section-label">请在浏览器中打开以下链接完成授权:</n-text>
          <div class="url-container">
            <n-input
              :value="authUrl"
              readonly
              type="textarea"
              :autosize="{ minRows: 2, maxRows: 4 }"
              class="url-input"
            />
            <n-button
              type="primary"
              size="small"
              class="copy-button"
              @click="handleCopyUrl"
            >
              <template #icon>
                <n-icon><CopyOutline /></n-icon>
              </template>
              复制链接
            </n-button>
          </div>
        </div>

        <!-- 等待状态指示 -->
        <div class="waiting-section">
          <n-spin v-if="polling" size="small" />
          <n-text v-if="polling" class="waiting-text">等待授权完成...</n-text>
          <n-text v-if="statusMessage" :type="statusType" class="status-message">
            {{ statusMessage }}
          </n-text>
        </div>

        <!-- 进度提示 -->
        <div v-if="polling" class="progress-hint">
          <n-text depth="3">
            授权完成后此窗口将自动关闭，或您可以手动取消
          </n-text>
        </div>
      </div>

      <template #footer>
        <div class="modal-footer">
          <n-button @click="handleCancel">
            {{ polling ? '取消授权' : '关闭' }}
          </n-button>
          <n-button
            v-if="authUrl"
            type="primary"
            tag="a"
            :href="authUrl"
            target="_blank"
          >
            <template #icon>
              <n-icon><OpenOutline /></n-icon>
            </template>
            打开授权页面
          </n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<script setup>
import { ref, computed, onUnmounted } from 'vue'
import {
  NButton,
  NIcon,
  NModal,
  NInput,
  NText,
  NSpin,
  useMessage
} from 'naive-ui'
import { LogInOutline, CopyOutline, OpenOutline } from '@vicons/ionicons5'
import { startOAuthFlow, pollOAuthStatus, cancelOAuthFlow } from '../../api/oauth'

const props = defineProps({
  provider: {
    type: String,
    required: true,
    validator: (value) => typeof value === 'string' && value.length > 0
  },
  disabled: {
    type: Boolean,
    default: false
  },
  size: {
    type: String,
    default: 'medium'
  },
  channelId: {
    type: String,
    default: null
  }
})

const emit = defineEmits(['success', 'error'])

const message = useMessage()

// 状态
const loading = ref(false)
const showModal = ref(false)
const authUrl = ref('')
const stateId = ref('')
const polling = ref(false)
const statusMessage = ref('')
const statusType = ref('default')
const isConnected = ref(false)
const pollTimer = ref(null)

// 计算属性
const providerName = computed(() => {
  const names = {
    claude: 'Claude',
    codex: 'Codex',
    gemini: 'Gemini'
  }
  return names[props.provider] || props.provider
})

const buttonText = computed(() => {
  if (loading.value) return '正在启动...'
  if (isConnected.value) return '已授权'
  return 'OAuth 登录'
})

// 点击按钮
async function handleClick() {
  if (loading.value || props.disabled) return

  loading.value = true
  statusMessage.value = ''
  statusType.value = 'default'

  try {
    const result = await startOAuthFlow(props.provider, props.channelId, 'manual')

    if (result.success && result.authUrl) {
      authUrl.value = result.authUrl
      stateId.value = result.stateId
      showModal.value = true
      startPolling()
    } else {
      throw new Error(result.error || '启动 OAuth 流程失败')
    }
  } catch (error) {
    message.error(error.message || '启动 OAuth 流程失败')
    emit('error', error)
  } finally {
    loading.value = false
  }
}

// 开始轮询状态
function startPolling() {
  polling.value = true
  statusMessage.value = ''

  const poll = async () => {
    if (!polling.value || !stateId.value) return

    try {
      const result = await pollOAuthStatus(stateId.value)

      if (result.status === 'completed') {
        polling.value = false
        isConnected.value = true
        statusMessage.value = '授权成功!'
        statusType.value = 'success'
        message.success('OAuth 授权成功')
        emit('success', result.tokenId)

        // 延迟关闭模态框
        setTimeout(() => {
          showModal.value = false
          resetState()
        }, 1500)
        return
      }

      if (result.status === 'failed') {
        polling.value = false
        statusMessage.value = result.error || '授权失败'
        statusType.value = 'error'
        message.error(result.error || '授权失败')
        emit('error', new Error(result.error || '授权失败'))
        return
      }

      if (result.status === 'expired') {
        polling.value = false
        statusMessage.value = '授权已超时，请重试'
        statusType.value = 'warning'
        message.warning('授权已超时')
        return
      }

      // 继续轮询
      pollTimer.value = setTimeout(poll, 2000)
    } catch (error) {
      console.error('轮询状态失败:', error)
      // 网络错误时继续轮询
      pollTimer.value = setTimeout(poll, 3000)
    }
  }

  poll()
}

// 停止轮询
function stopPolling() {
  polling.value = false
  if (pollTimer.value) {
    clearTimeout(pollTimer.value)
    pollTimer.value = null
  }
}

// 取消授权
async function handleCancel() {
  stopPolling()

  if (stateId.value) {
    try {
      await cancelOAuthFlow(stateId.value)
    } catch (error) {
      console.error('取消授权失败:', error)
    }
  }

  showModal.value = false
  resetState()
}

// 复制 URL
async function handleCopyUrl() {
  if (!authUrl.value) return

  try {
    await navigator.clipboard.writeText(authUrl.value)
    message.success('链接已复制到剪贴板')
  } catch (error) {
    // 降级方案：创建临时输入框
    const textarea = document.createElement('textarea')
    textarea.value = authUrl.value
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    message.success('链接已复制到剪贴板')
  }
}

// 重置状态
function resetState() {
  authUrl.value = ''
  stateId.value = ''
  statusMessage.value = ''
  statusType.value = 'default'
}

// 组件卸载时清理
onUnmounted(() => {
  stopPolling()
})
</script>

<style scoped>
.oauth-login-button {
  display: inline-block;
}

.oauth-modal-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
}

.url-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.url-input {
  font-family: monospace;
  font-size: 12px;
}

.copy-button {
  align-self: flex-end;
}

.waiting-section {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
}

.waiting-text {
  color: var(--text-secondary);
  font-size: 13px;
}

.status-message {
  font-size: 13px;
}

.progress-hint {
  padding: 8px 12px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 4px;
  font-size: 12px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
