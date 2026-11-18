import { createPinia } from 'pinia'
import { mount, shallowMount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchChannels: vi.fn(),
  getUIConfig: vi.fn(),
  updateNestedUIConfig: vi.fn(),
  getChannelBalances: vi.fn(),
  refreshChannelBalance: vi.fn(),
  fetchCatalogMetadata: vi.fn()
}))

vi.mock('../../../api/channels', async () => {
  const actual = await vi.importActual('../../../api/channels')
  return {
    ...actual,
    getChannels: mocks.fetchChannels,
    getOpenCodeChannels: mocks.fetchChannels,
    getDshChannels: mocks.fetchChannels,
    fetchChannelCatalogMetadata: mocks.fetchCatalogMetadata,
    getChannelBalances: mocks.getChannelBalances,
    refreshChannelBalance: mocks.refreshChannelBalance
  }
})

// 表单里的模型编辑器会预取默认模型；jsdom 没有后端，返回空结果避免噪声日志。
vi.mock('../../../composables/useDefaultModels', () => ({
  useDefaultModels: () => ({
    defaultModels: { value: {} },
    allModels: { value: {} },
    loading: { value: false },
    loadDefaultModels: async () => ({}),
    getDefaultModels: () => [],
    getAllModelsByToolType: () => []
  }),
  loadDefaultModels: async () => ({})
}))

import BaseChannelPanel from '../BaseChannelPanel.vue'

describe('BaseChannelPanel', () => {
  it('renders channels returned by the platform API after initialization', async () => {
    mocks.fetchChannels.mockResolvedValue({
      channels: [{ id: 'channel-1', name: '恢复渠道', enabled: true }]
    })
    mocks.getUIConfig.mockResolvedValue({ channelCollapse: { claude: {} } })
    mocks.getChannelBalances.mockResolvedValue({ enabled: false, balances: {} })

    const wrapper = shallowMount(BaseChannelPanel, {
      props: { type: 'claude' },
      global: {
        plugins: [createPinia()],
        stubs: {
          ChannelCard: {
            props: ['channel'],
            template: '<div data-test="channel-card">{{ channel.name }}</div>'
          }
        }
      }
    })

    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="channel-card"]').text()).toBe('恢复渠道')
    })


    expect(mocks.fetchChannels).toHaveBeenCalledTimes(1)
  })
})

describe('BaseChannelPanel model metadata', () => {
  it('offers offline metadata autofill for OpenCode', async () => {
    mocks.fetchChannels.mockResolvedValue({ channels: [] })
    mocks.getUIConfig.mockResolvedValue({ channelCollapse: { opencode: {} } })
    mocks.getChannelBalances.mockResolvedValue({ enabled: false, balances: {} })
    mocks.fetchCatalogMetadata.mockResolvedValue({
      models: [{
        id: 'deepseek/deepseek-v4-pro',
        limit: { context: 1000000, output: 384000 },
        reasoning: true
      }],
      warnings: [],
      source: { name: 'models.dev' }
    })

    const wrapper = mount(BaseChannelPanel, {
      props: { type: 'opencode' },
      attachTo: document.body,
      global: {
        plugins: [createPinia()],
        stubs: { ChannelCard: true }
      }
    })

    await vi.waitFor(() => {
      expect(mocks.fetchChannels).toHaveBeenCalled()
    })

    wrapper.vm.actions.openAddDialog()
    await vi.waitFor(() => {
      expect(document.querySelector('.model-definitions-editor textarea')).not.toBeNull()
    })

    const editor = document.querySelector('.model-definitions-editor')
    expect(editor.textContent).toContain('留空的字段写入时回退 Models.dev 离线快照')
    const button = editor.querySelector('.model-definitions-toolbar button')
    expect(button).not.toBeNull()
    expect(button.textContent).toContain('自动获取 Metadata')

    button.click()
    await vi.waitFor(() => {
      expect(editor.querySelector('.model-catalog-status').textContent)
        .toContain('已读取 1 个模型（Models.dev 离线快照）')
    })
    expect(editor.querySelector('textarea').value).toContain('deepseek/deepseek-v4-pro')
    expect(mocks.fetchCatalogMetadata).toHaveBeenCalledWith('opencode', expect.objectContaining({
      providerKey: expect.any(String)
    }))

    wrapper.unmount()
  })
})

describe('BaseChannelPanel save guard', () => {
  it('disables the add-channel button while a channel save is in flight', async () => {
    mocks.fetchChannels.mockResolvedValue({ channels: [] })
    mocks.getUIConfig.mockResolvedValue({ channelCollapse: { claude: {} } })
    mocks.getChannelBalances.mockResolvedValue({ enabled: false, balances: {} })

    const wrapper = mount(BaseChannelPanel, {
      props: { type: 'claude' },
      // Naive UI 的弹窗需要挂到 document 上才能断言按钮状态
      attachTo: document.body,
      global: {
        plugins: [createPinia()],
        stubs: { ChannelCard: true }
      }
    })

    await vi.waitFor(() => {
      expect(mocks.fetchChannels).toHaveBeenCalledTimes(1)
    })

    wrapper.vm.actions.openAddDialog()
    await vi.waitFor(() => {
      expect(document.querySelector('[data-test="channel-save"]')).not.toBeNull()
    })

    const initialButton = document.querySelector('[data-test="channel-save"]')
    expect(initialButton.disabled).toBe(false)
    expect(initialButton.textContent).toContain('添加渠道')

    wrapper.vm.state.saving = true
    await vi.waitFor(() => {
      const savingButton = document.querySelector('[data-test="channel-save"]')
      expect(savingButton.disabled).toBe(true)
      expect(savingButton.textContent).toContain('提交中')
    })
    // 取消按钮同样被禁用，避免提交中重置表单
    expect(document.querySelector('.dialog-footer button').disabled).toBe(true)

    wrapper.unmount()
  })
})
