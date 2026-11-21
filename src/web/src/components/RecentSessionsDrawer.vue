<template>
  <n-drawer v-model:show="show" :width="drawerWidth" placement="right" :show-close="true">
    <n-drawer-content :title="getChannelTitle()" :native-scrollbar="false" closable>
      <div v-if="loading" class="loading-container">
        <n-spin size="medium">
          <template #description>加载中...</template>
        </n-spin>
      </div>

      <div v-else-if="generating" class="loading-container">
        <n-spin size="medium">
          <template #description>正在生成最近会话…</template>
        </n-spin>
      </div>

      <div v-else-if="sessions.length > 0" class="sessions-list">
        <SessionCard
          v-for="session in sessions"
          :key="session.sessionId"
          :session="session"
          :channel="channel"
          :show-project="true"
          :hide-fork="true"
          :hide-delete="true"
          class="session-row"
          @click="handleRowClick(session, $event)"
          @set-alias="handleSetAlias"
          @launch="handleLaunchSession"
        />
      </div>

      <n-empty
        v-else
        description="暂无最近使用的会话"
        style="margin-top: 60px;"
      >
        <template #icon>
          <n-icon size="48"><ChatbubblesOutline /></n-icon>
        </template>
      </n-empty>

      <!-- 点击会话行打开聊天记录，和收藏抽屉复用同一个历史记录抽屉 -->
      <ChatHistoryDrawer
        v-if="historyTarget"
        v-model:show="showChatHistory"
        :project-name="historyTarget.projectName"
        :session-id="historyTarget.sessionId"
        :session-alias="historyTarget.alias"
        :channel="channel"
      />
    </n-drawer-content>
  </n-drawer>
</template>

<script setup>
import { ref, computed, watch, h, onUnmounted } from 'vue'
import { NDrawer, NDrawerContent, NSpin, NEmpty, NIcon, NInput } from 'naive-ui'
import { ChatbubblesOutline } from '@vicons/ionicons5'
import SessionCard from './SessionCard.vue'
import ChatHistoryDrawer from './ChatHistoryDrawer.vue'
import {
  getRecentSessions,
  setAlias as setAliasApi,
  deleteAlias as deleteAliasApi,
  copySessionLaunchCommand
} from '../api/sessions'
import message, { dialog } from '../utils/message'
import { useResponsiveDrawer } from '../composables/useResponsiveDrawer'
import { filterDisplayableSessions } from '../utils/session-visibility'

const { drawerWidth } = useResponsiveDrawer(720)

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  channel: {
    type: String,
    default: 'claude'
  }
})

const emit = defineEmits(['update:visible'])

const show = ref(false)
const sessions = ref([])
const loading = ref(false)
// An empty answer on a cold index usually means the backend is still scanning.
// Retry a bounded number of times instead of claiming there are no sessions.
const generating = ref(false)
const MAX_GENERATING_RETRIES = 3
let generatingRetries = 0
let retryTimer = null

// 点击会话行时打开聊天记录（与收藏抽屉一致），行内操作按钮保持独立行为。
const historyTarget = ref(null)
const showChatHistory = ref(false)

function handleRowClick(session, event) {
  const target = event?.target
  // 别名/启动等按钮自己消费点击，不打开聊天记录。
  if (target?.closest?.('.session-actions, button, a, input, textarea')) return
  if (!session?.sessionId || !session?.projectName) return
  historyTarget.value = {
    projectName: session.projectName,
    sessionId: session.sessionId,
    alias: session.alias || ''
  }
  showChatHistory.value = true
}

// 为了在 template 中使用
const channel = computed(() => props.channel)

// 获取渠道标题
function getChannelTitle() {
  if (props.channel === 'claude') return 'Claude 最新对话'
  if (props.channel === 'codex') return 'Codex 最新对话'
  if (props.channel === 'gemini') return 'Gemini 最新对话'
  if (props.channel === 'opencode') return 'OpenCode 最新对话'
  if (props.channel === 'omp') return 'OMP 最新对话'
  if (props.channel === 'dsh') return 'DSH 最新对话'
  return '最新对话'
}

// Sync with props
watch(() => props.visible, (val) => {
  show.value = val
  if (val) {
    generatingRetries = 0
    generating.value = false
    loadSessions()
  }
}, { immediate: true })

// Sync with show
watch(show, (val) => {
  if (!val) clearRetryTimer()
  emit('update:visible', val)
})

onUnmounted(clearRetryTimer)

function clearRetryTimer() {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
}

async function loadSessions({ retry = true } = {}) {
  clearRetryTimer()
  loading.value = true
  try {
    const data = await getRecentSessions(10, props.channel)
    const nextSessions = filterDisplayableSessions(data.sessions)
    sessions.value = nextSessions
    if (nextSessions.length > 0 || !retry) {
      generating.value = false
      generatingRetries = 0
      return
    }
    if (generatingRetries >= MAX_GENERATING_RETRIES) {
      generating.value = false
      return
    }
    // Empty while the index may still be warming: keep the spinner honest.
    generatingRetries += 1
    generating.value = true
    retryTimer = setTimeout(() => {
      retryTimer = null
      if (show.value) loadSessions()
    }, 1500)
  } catch (err) {
    console.error('Failed to load recent sessions:', err)
    generating.value = false
    message.error('加载失败: ' + err.message)
  } finally {
    loading.value = false
  }
}

// 监听 channel 变化，重新加载会话
watch(() => props.channel, () => {
  if (show.value) {
    loadSessions()
  }
})

async function handleSetAlias(session) {
  const currentAlias = session.alias || ''
  let inputValue = currentAlias

  // Create a simple prompt dialog
  const newAlias = await new Promise((resolve) => {
    const d = dialog.create({
      title: '设置别名',
      content: () => h(NInput, {
        defaultValue: currentAlias,
        placeholder: '请输入会话别名',
        'onUpdate:value': (v) => { inputValue = v },
        onKeyup: (e) => {
          if (e.key === 'Enter') {
            d.destroy()
            resolve(inputValue.trim())
          }
        }
      }),
      positiveText: '确定',
      negativeText: '取消',
      onPositiveClick: () => {
        resolve(inputValue.trim())
      },
      onNegativeClick: () => {
        resolve(null)
      }
    })
  })

  if (newAlias === null) return

  try {
    if (newAlias) {
      await setAliasApi(session.sessionId, newAlias)
      message.success('别名设置成功')
    } else {
      await deleteAliasApi(session.sessionId)
      message.success('别名已删除')
    }
    await loadSessions()
  } catch (err) {
    message.error('操作失败: ' + err.message)
  }
}

async function handleLaunchSession(session) {
  try {
    const { copyResult } = await copySessionLaunchCommand(session.projectName, session.sessionId, props.channel)
    if (copyResult?.method === 'manual') {
      message.warning('自动复制失败，已弹出手动复制框')
      return
    }
    message.success('启动命令已复制到剪贴板')
  } catch (err) {
    message.error('复制失败: ' + err.message)
  }
}
</script>

<style scoped>
.loading-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 200px;
}

.sessions-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.session-row {
  cursor: pointer;
}
</style>
