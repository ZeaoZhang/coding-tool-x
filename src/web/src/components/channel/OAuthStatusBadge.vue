<template>
  <div v-if="token" class="oauth-status-badge">
    <n-space align="center" :size="8">
      <n-tag :type="statusType" size="small">
        <template #icon>
          <n-icon :component="statusIcon" />
        </template>
        {{ statusText }}
      </n-tag>
      <span v-if="token.userInfo?.email" class="user-email">
        {{ token.userInfo.email }}
      </span>
      <span v-if="expiresText" class="expires-text">
        {{ expiresText }}
      </span>
      <template v-if="showActions">
        <n-button text size="tiny" @click="handleRefresh" :loading="refreshing">
          刷新
        </n-button>
        <n-button text size="tiny" type="error" @click="handleDisconnect">
          断开
        </n-button>
      </template>
    </n-space>
  </div>
  <div v-else class="oauth-status-badge">
    <n-tag type="default" size="small">未连接</n-tag>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { NSpace, NTag, NIcon, NButton } from 'naive-ui'
import { CheckmarkCircleOutline, WarningOutline, CloseCircleOutline } from '@vicons/ionicons5'
import { getOAuthToken } from '../../api/oauth'

const props = defineProps({
  tokenId: {
    type: String,
    default: ''
  },
  showActions: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['refresh', 'disconnect'])

const refreshing = ref(false)
const token = ref(null)
const now = ref(Date.now())

// Update current time every minute
let timer = null
onMounted(() => {
  if (props.tokenId) {
    fetchTokenStatus()
  }
  timer = setInterval(() => {
    now.value = Date.now()
  }, 60000)
})

onUnmounted(() => {
  if (timer) {
    clearInterval(timer)
  }
})

async function fetchTokenStatus() {
  if (!props.tokenId) {
    token.value = null
    return
  }
  try {
    token.value = await getOAuthToken(props.tokenId)
  } catch (err) {
    console.error('Failed to fetch OAuth token status:', err)
    token.value = null
  }
}

// Compute token expiry status
const expiresAt = computed(() => {
  if (!token.value?.expiresAt) return null
  return new Date(token.value.expiresAt).getTime()
})

const isExpired = computed(() => {
  if (!expiresAt.value) return false
  return now.value > expiresAt.value
})

const isExpiringSoon = computed(() => {
  if (!expiresAt.value || isExpired.value) return false
  const oneHour = 60 * 60 * 1000
  return expiresAt.value - now.value < oneHour
})

const statusType = computed(() => {
  if (isExpired.value) return 'error'
  if (isExpiringSoon.value) return 'warning'
  return 'success'
})

const statusText = computed(() => {
  if (isExpired.value) return '已过期'
  if (isExpiringSoon.value) return '即将过期'
  return '已连接'
})

const statusIcon = computed(() => {
  if (isExpired.value) return CloseCircleOutline
  if (isExpiringSoon.value) return WarningOutline
  return CheckmarkCircleOutline
})

const expiresText = computed(() => {
  if (!expiresAt.value) return ''
  if (isExpired.value) {
    return '已过期'
  }
  const diff = expiresAt.value - now.value
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) {
    return `${days}天后过期`
  } else if (hours > 0) {
    return `${hours}小时后过期`
  } else if (minutes > 0) {
    return `${minutes}分钟后过期`
  } else {
    return '即将过期'
  }
})

async function handleRefresh() {
  refreshing.value = true
  try {
    emit('refresh')
    // Re-fetch token status after a short delay
    setTimeout(fetchTokenStatus, 1000)
  } finally {
    refreshing.value = false
  }
}

function handleDisconnect() {
  emit('disconnect')
}

// Watch for tokenId changes
watch(() => props.tokenId, (newVal) => {
  if (newVal) {
    fetchTokenStatus()
  } else {
    token.value = null
  }
})
</script>

<style scoped>
.oauth-status-badge {
  display: inline-flex;
  align-items: center;
}

.user-email {
  font-size: 12px;
  color: var(--text-secondary);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.expires-text {
  font-size: 11px;
  color: var(--text-tertiary);
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .user-email {
    max-width: 120px;
    font-size: 11px;
  }

  .expires-text {
    font-size: 10px;
  }
}

@media (max-width: 480px) {
  .oauth-status-badge :deep(.n-space) {
    flex-wrap: wrap;
    gap: 4px !important;
  }

  .user-email {
    max-width: 100px;
  }
}
</style>
