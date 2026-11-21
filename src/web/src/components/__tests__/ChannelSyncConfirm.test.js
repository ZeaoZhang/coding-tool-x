import { defineComponent, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  dialogWarning: vi.fn(),
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
  dialog: {
    warning: mocks.dialogWarning,
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('../../api/ui-config', () => ({
  getUIConfig: mocks.getUIConfig,
  updateNestedUIConfig: mocks.updateNestedUIConfig
}))

vi.mock('../../api/channels', () => ({
  getChannelBalances: mocks.getChannelBalances,
  refreshChannelBalance: mocks.refreshChannelBalance
}))

import useChannelManager from '../../composables/useChannelManager'

function createConfig(syncCurrent) {
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
      create: vi.fn(),
      update: vi.fn(),
      toggle: vi.fn(),
      remove: vi.fn(),
      syncCurrent
    }
  }
}

async function createManager(syncCurrent) {
  const config = createConfig(syncCurrent)
  let manager = null
  const Wrapper = defineComponent({
    setup() {
      manager = useChannelManager(config)
      return () => h('div')
    }
  })
  setActivePinia(createPinia())
  const wrapper = mount(Wrapper)
  await manager.actions.loadChannels()
  return { manager, config, wrapper }
}

function confirmDialogOptions() {
  return mocks.dialogWarning.mock.calls.at(-1)?.[0]
}

describe('useChannelManager sync confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUIConfig.mockResolvedValue({ channelCollapse: { demo: {} } })
    mocks.getChannelBalances.mockResolvedValue({ enabled: false, balances: {} })
  })

  it('asks for confirmation before writing channels and only calls the API after approval', async () => {
    const syncCurrent = vi.fn().mockResolvedValue({ added: 1, updated: 0 })
    const { manager } = await createManager(syncCurrent)

    const pending = manager.actions.handleSyncCurrentChannels()
    await Promise.resolve()

    expect(syncCurrent).not.toHaveBeenCalled()
    expect(mocks.dialogWarning).toHaveBeenCalledTimes(1)
    const options = confirmDialogOptions()
    expect(options.title).toContain('Demo')
    expect(options.content).toContain('原生配置')
    expect(options.content).toContain('渠道列表')
    expect(manager.state.syncing).toBe(false)

    options.onPositiveClick()
    const result = await pending

    expect(syncCurrent).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ added: 1, updated: 0 })
    expect(mocks.success).toHaveBeenCalledTimes(1)
    expect(manager.state.syncing).toBe(false)
  })

  it('does not call the API or show a success message when the user cancels', async () => {
    const syncCurrent = vi.fn().mockResolvedValue({ added: 1 })
    const { manager } = await createManager(syncCurrent)

    const pending = manager.actions.handleSyncCurrentChannels()
    await Promise.resolve()
    confirmDialogOptions().onNegativeClick()

    await expect(pending).resolves.toBeNull()
    expect(syncCurrent).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
    expect(manager.state.syncing).toBe(false)
  })

  it('reports sync failures after confirmation', async () => {
    const syncCurrent = vi.fn().mockRejectedValue(new Error('写入失败'))
    const { manager } = await createManager(syncCurrent)

    const pending = manager.actions.handleSyncCurrentChannels()
    await Promise.resolve()
    confirmDialogOptions().onPositiveClick()

    await expect(pending).resolves.toBeNull()
    expect(syncCurrent).toHaveBeenCalledTimes(1)
    expect(mocks.error).toHaveBeenCalledTimes(1)
    expect(mocks.error.mock.calls[0][0]).toContain('写入失败')
    expect(manager.state.syncing).toBe(false)
  })

  it('opens only one confirmation dialog for repeated clicks', async () => {
    const syncCurrent = vi.fn().mockResolvedValue({ added: 1 })
    const { manager } = await createManager(syncCurrent)

    const first = manager.actions.handleSyncCurrentChannels()
    await Promise.resolve()
    await expect(manager.actions.handleSyncCurrentChannels()).resolves.toBeNull()

    expect(mocks.dialogWarning).toHaveBeenCalledTimes(1)
    confirmDialogOptions().onPositiveClick()
    await first
    expect(syncCurrent).toHaveBeenCalledTimes(1)
  })
})
