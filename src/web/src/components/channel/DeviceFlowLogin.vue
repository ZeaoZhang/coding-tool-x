<template>
  <div class="device-flow-login">
    <n-button
      :type="isConnected ? 'default' : 'primary'"
      :size="size"
      :loading="loading"
      :disabled="disabled || loading"
      @click="handleClick"
    >
      <template #icon>
        <n-icon><PhonePortraitOutline /></n-icon>
      </template>
      {{ buttonText }}
    </n-button>

    <n-modal
      v-model:show="showModal"
      preset="card"
      :title="'Device Flow 授权 - ' + providerName"
      style="width: 480px;"
      :mask-closable="false"
      @close="handleCancel"
    >
      <div class="device-flow-content">
        <!-- 用户代码显示 -->
        <div class="code-section">
          <n-text depth="3" class="section-label">请在 GitHub 设备页面输入以下代码:</n-text>
          <div class="user-code-container">
            <div class="user-code">{{ userCode }}</div>
            <n-button
              type="primary"
              size="small"
              class="copy-button"
              @click="handleCopyCode"
            >
              <template #icon>
                <n-icon><CopyOutline /></n-icon>
              </template>
              复制代码
            </n-button>
          </div>
        </div>

        <!-- 验证链接 -->
        <div class="verification-section">
          <n-text depth="3" class="section-label">
            请访问以下链接并输入上方代码完成授权:
          </n-text>
          <div class="verification-url">
            <n-input
              :value="verificationUri"
              readonly
              class="url-input"
            />
            <n-button
              type="primary"
              tag="a"
              :href="verificationUri"
              target="_blank"
              size="small"
            >
              <template #icon>
                <n-icon><OpenOutline /></n-icon>
              </template>
              打开链接
            </n-button>
          </div>
        </div>

        <!-- 等待状态 -->
        <div class="waiting-section">
          <n-spin v-if="polling" size="small" />
          <n-text v-if="polling" class="waiting-text">等待授权完成...</n-text>
          <n-text v-if="statusMessage" :type="statusType" class="status-message">
            {{ statusMessage }}
          </n-text>
        </div>

        <!-- 提示信息 -->
        <div v-if="polling" class="progress-hint">
          <n-text depth="3">
            授权完成后此窗口将自动关闭，代码有效期约 {{ expiresInMinutes }} 分钟
          </n-text>
        </div>
      </div>

      <template #footer>
        <div class="modal-footer">
          <n-button @click="handleCancel">
            {{ polling ? '取消授权' : '关闭' }}
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
import { PhonePortraitOutline, CopyOutline, OpenOutline } from '@vicons/ionicons5'
import { startDeviceFlow, pollDeviceFlowStatus, cancelDeviceFlow } from '../../api/oauth'

const props = defineProps({
  provider: {
    type: String,
    required: true
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
const userCode = ref('')
const verificationUri = ref('')
const stateId = ref('')
const polling = ref(false)
const statusMessage = ref('')
const statusType = ref('default')
const isConnected = ref(false)
const pollTimer = ref(null)
const expiresIn = ref(900) // 默认 15 分钟

// 计算属性
const providerName = computed(() => {
  const names = {
    github_copilot: 'GitHub Copilot',
    github: 'GitHub',
    claude: 'Claude',
    codex: 'Codex',
    gemini: 'Gemini'
  }
  return names[props.provider] || props.provider
})

const buttonText = computed(() => {
  if (loading.value) return '正在启动...'
  if (isConnected.value) return '已授权'
  return 'Device Flow 登录'
})

const expiresInMinutes = computed(() => {
  return Math.ceil(expiresIn.value / 60)
})

// 点击按钮
async function handleClick() {
  if (loading.value || props.disabled) return

  loading.value = true
  statusMessage.value = ''
  statusType.value = 'default'

  try {
    const result = await startDeviceFlow(props.provider, props.channelId)

    if (result.success && result.user_code) {
      userCode.value = result.user_code
      verificationUri.value = result.verification_uri
      stateId.value = result.stateId
      expiresIn.value = result.expires_in || 900
      showModal.value = true
      startPolling(result.interval || 5)
    } else {
      throw new Error(result.error || '启动 Device Flow 失败')
    }
  } catch (error) {
    message.error(error.message || '启动 Device Flow 失败')
    emit('error', error)
  } finally {
    loading.value = false
  }
}

// 开始轮询状态
function startPolling(interval = 5) {
  polling.value = true
  statusMessage.value = ''

  const pollInterval = interval * 1000 // 转换为毫秒

  const poll = async () => {
    if (!polling.value || !stateId.value) return

    try {
      const result = await pollDeviceFlowStatus(stateId.value)

      if (result.status === 'completed') {
        polling.value = false
        isConnected.value = true
        statusMessage.value = '授权成功!'
        statusType.value = 'success'
        message.success('Device Flow 授权成功')
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

      // authorization_pending 或其他状态，继续轮询
      pollTimer.value = setTimeout(poll, pollInterval)
    } catch (error) {
      console.error('轮询状态失败:', error)
      // 网络错误时继续轮询，但延长间隔
      pollTimer.value = setTimeout(poll, pollInterval + 2000)
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
      await cancelDeviceFlow(stateId.value)
    } catch (error) {
      console.error('取消授权失败:', error)
    }
  }

  showModal.value = false
  resetState()
}

// 复制代码
async function handleCopyCode() {
  if (!userCode.value) return

  try {
    await navigator.clipboard.writeText(userCode.value)
    message.success('代码已复制到剪贴板')
  } catch (error) {
    // 降级方案
    const textarea = document.createElement('textarea')
    textarea.value = userCode.value
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    message.success('代码已复制到剪贴板')
  }
}

// 重置状态
function resetState() {
  userCode.value = ''
  verificationUri.value = ''
  stateId.value = ''
  statusMessage.value = ''
  statusType.value = 'default'
  expiresIn.value = 900
}

// 组件卸载时清理
onUnmounted(() => {
  stopPolling()
})
</script>

<style scoped>
.device-flow-login {
  display: inline-block;
}

.device-flow-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.section-label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
}

.code-section {
  text-align: center;
}

.user-code-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.user-code {
  font-family: 'Courier New', monospace;
  font-size: 32px;
  font-weight: bold;
  letter-spacing: 4px;
  padding: 16px 24px;
  background: var(--bg-secondary, #f5f5f5);
  border: 2px dashed var(--border-color, #e0e0e0);
  border-radius: 8px;
  color: var(--primary-color, #18a058);
  user-select: all;
}

.copy-button {
  margin-top: 4px;
}

.verification-section {
  border-top: 1px solid var(--border-color, #e0e0e0);
  padding-top: 16px;
}

.verification-url {
  display: flex;
  gap: 8px;
  align-items: center;
}

.url-input {
  flex: 1;
  font-family: monospace;
  font-size: 12px;
}

.waiting-section {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 24px;
}

.waiting-text {
  color: var(--text-secondary);
  font-size: 13px;
}

.status-message {
  font-size: 14px;
  font-weight: 500;
}

.progress-hint {
  padding: 8px 12px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 4px;
  font-size: 12px;
  text-align: center;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
