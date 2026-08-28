import { createPinia } from 'pinia'
import { shallowMount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchChannels: vi.fn(),
  getUIConfig: vi.fn(),
  updateNestedUIConfig: vi.fn(),
  getChannelBalances: vi.fn(),
  refreshChannelBalance: vi.fn()
}))

vi.mock('../../../api/channels', async () => {
  const actual = await vi.importActual('../../../api/channels')
  return {
    ...actual,
    getChannels: mocks.fetchChannels,
    getChannelBalances: mocks.getChannelBalances,
    refreshChannelBalance: mocks.refreshChannelBalance
  }
})

vi.mock('../../../api/ui-config', async () => {
  const actual = await vi.importActual('../../../api/ui-config')
  return {
    ...actual,
    getUIConfig: mocks.getUIConfig,
    updateNestedUIConfig: mocks.updateNestedUIConfig
  }
})

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
