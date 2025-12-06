<template>
  <n-drawer v-model:show="drawerVisible" :width="drawerWidth" placement="right">
    <n-drawer-content title="我的收藏" closable>
      <div class="favorites-container">
        <!-- Claude 收藏 -->
        <div v-if="claudeFavorites.length > 0" class="favorites-section">
          <div class="section-header claude-header">
            <n-icon :size="20">
              <ChatboxEllipsesOutline />
            </n-icon>
            <h3 class="section-title">Claude</h3>
            <n-tag size="small" :bordered="false" type="success">
              {{ claudeFavorites.length }}
            </n-tag>
          </div>
          <div class="sessions-list">
            <SessionCard
              v-for="session in claudeFavorites"
              :key="`claude-${session.projectName}-${session.sessionId}`"
              :session="session"
              :show-project="true"
              hide-fork
              hide-delete
              @set-alias="handleSetAlias"
              @launch="handleLaunch('claude', session)"
            >
              <template #actions-extra>
                <n-button
                  size="small"
                  type="error"
                  @click.stop="handleRemoveFavorite('claude', session)"
                >
                  <template #icon>
                    <n-icon><TrashOutline /></n-icon>
                  </template>
                  移除
                </n-button>
              </template>
            </SessionCard>
          </div>
        </div>

        <!-- Codex 收藏 -->
        <div v-if="codexFavorites.length > 0" class="favorites-section">
          <div class="section-header codex-header">
            <n-icon :size="20">
              <CodeSlashOutline />
            </n-icon>
            <h3 class="section-title">Codex</h3>
            <n-tag size="small" :bordered="false" type="info">
              {{ codexFavorites.length }}
            </n-tag>
          </div>
          <div class="sessions-list">
            <SessionCard
              v-for="session in codexFavorites"
              :key="`codex-${session.projectName}-${session.sessionId}`"
              :session="session"
              :show-project="true"
              hide-fork
              hide-delete
              @set-alias="handleSetAlias"
              @launch="handleLaunch('codex', session)"
            >
              <template #actions-extra>
                <n-button
                  size="small"
                  type="error"
                  @click.stop="handleRemoveFavorite('codex', session)"
                >
                  <template #icon>
                    <n-icon><TrashOutline /></n-icon>
                  </template>
                  移除
                </n-button>
              </template>
            </SessionCard>
          </div>
        </div>

        <!-- Gemini 收藏 -->
        <div v-if="geminiFavorites.length > 0" class="favorites-section">
          <div class="section-header gemini-header">
            <n-icon :size="20">
              <SparklesOutline />
            </n-icon>
            <h3 class="section-title">Gemini</h3>
            <n-tag size="small" :bordered="false" type="warning">
              {{ geminiFavorites.length }}
            </n-tag>
          </div>
          <div class="sessions-list">
            <SessionCard
              v-for="session in geminiFavorites"
              :key="`gemini-${session.projectName}-${session.sessionId}`"
              :session="session"
              :show-project="true"
              hide-fork
              hide-delete
              @set-alias="handleSetAlias"
              @launch="handleLaunch('gemini', session)"
            >
              <template #actions-extra>
                <n-button
                  size="small"
                  type="error"
                  @click.stop="handleRemoveFavorite('gemini', session)"
                >
                  <template #icon>
                    <n-icon><TrashOutline /></n-icon>
                  </template>
                  移除
                </n-button>
              </template>
            </SessionCard>
          </div>
        </div>

        <!-- 空状态 -->
        <n-empty
          v-if="totalCount === 0"
          description="暂无收藏"
          style="margin-top: 80px;"
        >
          <template #icon>
            <n-icon :size="48"><StarOutline /></n-icon>
          </template>
          <template #extra>
            <n-text depth="3" style="font-size: 13px;">
              在会话列表中点击"收藏"按钮添加收藏
            </n-text>
          </template>
        </n-empty>
      </div>

      <!-- 别名设置对话框 -->
      <n-modal v-model:show="showAliasDialog" preset="dialog" title="设置别名">
        <n-input
          v-model:value="editingAlias"
          placeholder="输入别名（留空删除）"
          @keyup.enter="confirmAlias"
        />
        <template #action>
          <n-space>
            <n-button @click="showAliasDialog = false">取消</n-button>
            <n-button type="primary" @click="confirmAlias">确定</n-button>
          </n-space>
        </template>
      </n-modal>
    </n-drawer-content>
  </n-drawer>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import {
  NDrawer, NDrawerContent, NEmpty, NIcon, NTag, NText,
  NButton, NSpace, NModal, NInput
} from 'naive-ui'
import {
  StarOutline, ChatboxEllipsesOutline, CodeSlashOutline,
  SparklesOutline, TrashOutline
} from '@vicons/ionicons5'
import SessionCard from './SessionCard.vue'
import { useFavorites } from '../composables/useFavorites'
import { useSessionsStore } from '../stores/sessions'
import { launchTerminal } from '../api/sessions'
import message from '../utils/message'
import { useResponsiveDrawer } from '../composables/useResponsiveDrawer'

const { drawerWidth } = useResponsiveDrawer(800, 700)

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:visible'])

const drawerVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

const { getFavorites, removeFavorite, getAllFavorites } = useFavorites()
const store = useSessionsStore()

// 获取各渠道的收藏列表
const claudeFavorites = computed(() => getFavorites('claude'))
const codexFavorites = computed(() => getFavorites('codex'))
const geminiFavorites = computed(() => getFavorites('gemini'))

// 别名编辑
const showAliasDialog = ref(false)
const editingSession = ref(null)
const editingAlias = ref('')
const editingChannel = ref('')

function handleSetAlias(session) {
  // 需要确定是哪个渠道的
  let channel = 'claude'
  if (codexFavorites.value.some(s => s.sessionId === session.sessionId && s.projectName === session.projectName)) {
    channel = 'codex'
  } else if (geminiFavorites.value.some(s => s.sessionId === session.sessionId && s.projectName === session.projectName)) {
    channel = 'gemini'
  }

  editingSession.value = session
  editingAlias.value = session.alias || ''
  editingChannel.value = channel
  showAliasDialog.value = true
}

async function confirmAlias() {
  if (!editingSession.value) return

  try {
    // 设置当前渠道
    store.setChannel(editingChannel.value)

    const sessionId = editingSession.value.sessionId
    if (editingAlias.value) {
      await store.setAlias(sessionId, editingAlias.value)
      message.success('别名设置成功')

      // 更新收藏列表中的别名
      const allFavs = getAllFavorites()
      const fav = allFavs[editingChannel.value]?.find(
        f => f.sessionId === sessionId && f.projectName === editingSession.value.projectName
      )
      if (fav) {
        fav.alias = editingAlias.value
      }
    } else {
      await store.deleteAlias(sessionId)
      message.success('别名已删除')

      // 更新收藏列表
      const allFavs = getAllFavorites()
      const fav = allFavs[editingChannel.value]?.find(
        f => f.sessionId === sessionId && f.projectName === editingSession.value.projectName
      )
      if (fav) {
        fav.alias = ''
      }
    }
    showAliasDialog.value = false
    editingSession.value = null
    editingAlias.value = ''
  } catch (err) {
    message.error('操作失败: ' + err.message)
  }
}

async function handleLaunch(channel, session) {
  try {
    await launchTerminal(session.projectName, session.sessionId, channel)
    message.success('已启动终端')
  } catch (err) {
    message.error('启动失败: ' + err.message)
  }
}

async function handleRemoveFavorite(channel, session) {
  try {
    await removeFavorite(channel, session.projectName, session.sessionId)
    message.success('已移除收藏')
  } catch (err) {
    message.error('移除失败: ' + err.message)
  }
}
</script>

<style scoped>
.favorites-container {
  padding: 4px 0;
}

.favorites-section {
  margin-bottom: 32px;
}

.favorites-section:last-child {
  margin-bottom: 0;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 12px 16px;
  border-radius: 10px;
  border-left: 4px solid;
}

.claude-header {
  background: linear-gradient(135deg, rgba(24, 160, 88, 0.1) 0%, transparent 100%);
  border-left-color: #18a058;
}

.codex-header {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, transparent 100%);
  border-left-color: #3b82f6;
}

.gemini-header {
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.1) 0%, transparent 100%);
  border-left-color: #a855f7;
}

.section-header .n-icon {
  flex-shrink: 0;
}

.claude-header .n-icon {
  color: #18a058;
}

.codex-header .n-icon {
  color: #3b82f6;
}

.gemini-header .n-icon {
  color: #a855f7;
}

.section-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  flex: 1;
}

.sessions-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
