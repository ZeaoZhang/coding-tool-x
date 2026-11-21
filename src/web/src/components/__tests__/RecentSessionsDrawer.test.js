import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRecentSessions: vi.fn(),
  setAlias: vi.fn(),
  deleteAlias: vi.fn(),
  copySessionLaunchCommand: vi.fn(),
  message: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
}))

vi.mock('../../api/sessions', () => ({
  getRecentSessions: mocks.getRecentSessions,
  setAlias: mocks.setAlias,
  deleteAlias: mocks.deleteAlias,
  copySessionLaunchCommand: mocks.copySessionLaunchCommand
}))

vi.mock('../../utils/message', () => ({
  default: mocks.message,
  dialog: { create: vi.fn(), warning: vi.fn() }
}))

vi.mock('../../composables/useResponsiveDrawer', () => ({
  useResponsiveDrawer: () => ({ drawerWidth: 720 })
}))

import RecentSessionsDrawer from '../RecentSessionsDrawer.vue'

const SessionCardStub = {
  name: 'SessionCard',
  props: ['session', 'channel', 'showProject', 'hideFork', 'hideDelete'],
  emits: ['set-alias', 'launch'],
  template: `
    <div class="session-item">
      <div class="session-body">会话正文</div>
      <div class="session-actions">
        <button class="alias-btn" @click="$emit('set-alias', session)">别名</button>
        <button class="launch-btn" @click="$emit('launch', session)">使用对话</button>
      </div>
    </div>
  `
}

const ChatHistoryStub = {
  name: 'ChatHistoryDrawer',
  props: ['show', 'projectName', 'sessionId', 'sessionAlias', 'channel'],
  template: '<div class="chat-history-stub" />'
}

const sessions = [
  {
    sessionId: 'sess-1',
    projectName: 'demo-project',
    projectDisplayName: 'demo-project',
    alias: '演示会话',
    mtime: Date.now(),
    size: 1024,
    firstMessage: '你好'
  }
]

async function mountDrawer() {
  const wrapper = shallowMount(RecentSessionsDrawer, {
    props: { visible: true, channel: 'claude' },
    global: {
      renderStubDefaultSlot: true,
      stubs: {
        drawer: { template: '<div><slot /></div>' },
        'drawer-content': { template: '<div><slot /></div>' },
        SessionCard: SessionCardStub,
        ChatHistoryDrawer: ChatHistoryStub
      }
    }
  })
  await flushPromises()
  return wrapper
}

describe('RecentSessionsDrawer row interaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRecentSessions.mockResolvedValue({ sessions })
    mocks.copySessionLaunchCommand.mockResolvedValue({ copyResult: { method: 'auto' } })
  })

  it('opens the chat history drawer when the session row body is clicked', async () => {
    const wrapper = await mountDrawer()

    expect(mocks.getRecentSessions).toHaveBeenCalledWith(10, 'claude')
    expect(wrapper.findComponent(ChatHistoryStub).exists()).toBe(false)

    await wrapper.find('.session-body').trigger('click')

    const history = wrapper.findComponent(ChatHistoryStub)
    expect(history.exists()).toBe(true)
    expect(history.props('show')).toBe(true)
    expect(history.props('projectName')).toBe('demo-project')
    expect(history.props('sessionId')).toBe('sess-1')
    expect(history.props('sessionAlias')).toBe('演示会话')
    expect(history.props('channel')).toBe('claude')
  })

  it('keeps action buttons working without opening chat history', async () => {
    const wrapper = await mountDrawer()

    await wrapper.find('.launch-btn').trigger('click')
    await flushPromises()

    expect(mocks.copySessionLaunchCommand).toHaveBeenCalledTimes(1)
    expect(mocks.message.success).toHaveBeenCalled()
    expect(wrapper.findComponent(ChatHistoryStub).exists()).toBe(false)

    // 点击操作区空白处同样不应打开聊天记录
    await wrapper.find('.session-actions').trigger('click')
    expect(wrapper.findComponent(ChatHistoryStub).exists()).toBe(false)
  })
})
