import { defineComponent, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  getUIConfig: vi.fn(),
  updateNestedUIConfig: vi.fn(),
  getChannelBalances: vi.fn(),
  refreshChannelBalance: vi.fn()
}))

vi.mock('../../utils/message', () => ({
  default: {
    success: mocks.success,
    error: mocks.error,
    warning: mocks.warning,
    info: mocks.info
  },
  dialog: { warning: vi.fn(), info: vi.fn(), success: vi.fn(), error: vi.fn() }
}))

vi.mock('../../api/ui-config', () => ({
  getUIConfig: mocks.getUIConfig,
  updateNestedUIConfig: mocks.updateNestedUIConfig
}))

vi.mock('../../api/channels', () => ({
  getChannelBalances: mocks.getChannelBalances,
  refreshChannelBalance: mocks.refreshChannelBalance
}))

import useChannelManager from '../useChannelManager'

function createConfig(create) {
  return {
    type: 'demo',
    displayName: 'Demo',
    schedulerSource: 'demo',
    storageKeys: {
      localCollapse: 'demoChannelCollapse',
      collapseConfigKey: 'demo',
      orderConfigKey: 'demo'
    },
    formSections: [
      { title: '基本信息', fields: [{ key: 'baseUrl', label: 'Base URL', required: true }] }
    ],
    getInitialForm: () => ({ baseUrl: '', name: '' }),
    mapChannelToForm: channel => ({ ...channel }),
    api: {
      fetch: vi.fn().mockResolvedValue({ channels: [] }),
      create,
      update: vi.fn(),
      toggle: vi.fn(),
      remove: vi.fn()
    }
  }
}

async function createManager(create) {
  // 组合式函数内部会注册 onUnmounted，需要在组件上下文里调用。
  let manager = null
  const Wrapper = defineComponent({
    setup() {
      manager = useChannelManager(config)
      return () => h('div')
    }
  })
  const config = createConfig(create)
  setActivePinia(createPinia())
  mount(Wrapper)
  await manager.actions.loadChannels()
  return { manager, config }
}

describe('useChannelManager handleSave', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUIConfig.mockResolvedValue({ channelCollapse: { demo: {} } })
    mocks.getChannelBalances.mockResolvedValue({ enabled: false, balances: {} })
  })

  it('ignores repeated submissions while the first create request is pending', async () => {
    let resolveCreate
    const create = vi.fn(() => new Promise(resolve => { resolveCreate = resolve }))
    const { manager, config } = await createManager(create)

    manager.actions.openAddDialog()
    manager.state.formData.baseUrl = 'https://api.example.com'
    manager.state.formData.name = '示例渠道'
    manager.state.loading = false

    const first = manager.actions.handleSave()
    // 请求卡住期间连续点击：只允许发出一次创建请求，也不会出现重复的渠道提示。
    const second = manager.actions.handleSave()
    const third = manager.actions.handleSave()

    expect(manager.state.saving).toBe(true)
    expect(create).toHaveBeenCalledTimes(1)
    await expect(second).resolves.toBe(false)
    await expect(third).resolves.toBe(false)

    // 提交中不允许关闭弹窗重置表单，避免用户以为失败后重新提交。
    manager.actions.closeDialog()
    expect(manager.state.showDialog).toBe(true)

    resolveCreate({ channel: { id: 'channel-1', baseUrl: 'https://api.example.com' } })
    await expect(first).resolves.toBe(true)

    expect(create).toHaveBeenCalledTimes(1)
    expect(mocks.success).toHaveBeenCalledTimes(1)
    expect(manager.state.saving).toBe(false)
    expect(manager.state.showDialog).toBe(false)
    expect(config.api.fetch).toHaveBeenCalled()
  })

  it('releases the saving guard after a failed request so users can retry', async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce({ channel: { id: 'channel-2', baseUrl: 'https://api.example.com' } })
    const { manager } = await createManager(create)

    manager.actions.openAddDialog()
    manager.state.formData.baseUrl = 'https://api.example.com'

    await expect(manager.actions.handleSave()).resolves.toBe(false)
    expect(manager.state.saving).toBe(false)
    expect(manager.state.showDialog).toBe(true)
    expect(mocks.error).toHaveBeenCalledTimes(1)

    await expect(manager.actions.handleSave()).resolves.toBe(true)
    expect(create).toHaveBeenCalledTimes(2)
    expect(manager.state.showDialog).toBe(false)
  })

  it('skips the create request when form validation fails', async () => {
    const create = vi.fn()
    const { manager } = await createManager(create)

    manager.actions.openAddDialog()
    manager.state.formData.baseUrl = ''

    await expect(manager.actions.handleSave()).resolves.toBe(false)
    expect(create).not.toHaveBeenCalled()
    expect(manager.state.saving).toBe(false)
  })
})
