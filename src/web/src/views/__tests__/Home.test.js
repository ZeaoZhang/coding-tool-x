import { nextTick } from 'vue'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { enabledKeys, uiConfig, loadUIConfig, updateConfig, platformStore } = vi.hoisted(() => ({
  enabledKeys: { value: ['alpha-cli', 'beta-cli', 'gamma-cli', 'delta-cli', 'epsilon-cli'] },
  uiConfig: { value: { enabledCliPlatforms: [] } },
  loadUIConfig: vi.fn(),
  updateConfig: vi.fn(),
  platformStore: { load: vi.fn() }
}))

vi.mock('../../composables/useUIConfig', () => ({
  useUIConfig: () => ({ uiConfig, loadUIConfig, updateConfig })
}))
vi.mock('../../composables/useEnabledCliPlatforms', () => ({
  useEnabledCliPlatforms: () => ({ enabledKeys })
}))
vi.mock('../../stores/platforms', () => ({
  usePlatformStore: () => platformStore
}))

import Home from '../Home.vue'

function mountHome() {
  return shallowMount(Home, {
    global: {
      stubs: {
        draggable: {
          props: ['modelValue'],
          template: '<div><div v-for="element in modelValue" :key="element.type"><slot name="item" :element="element" /></div></div>'
        },
        ChannelColumn: {
          props: ['channelType'],
          template: '<div class="channel-column-stub">{{ channelType }}</div>'
        }
      }
    }
  })
}
describe('Home dynamic columns', () => {
  beforeEach(() => {
    enabledKeys.value = ['alpha-cli', 'beta-cli', 'gamma-cli', 'delta-cli', 'epsilon-cli']
    uiConfig.value = { enabledCliPlatforms: enabledKeys.value }
    loadUIConfig.mockReset()
    updateConfig.mockReset()
    platformStore.load.mockReset()
    loadUIConfig.mockResolvedValue(uiConfig.value)
    platformStore.load.mockResolvedValue([])
    updateConfig.mockResolvedValue(true)
  })

  it('renders one ChannelColumn for every enabled key without a four-column cap', async () => {
    const wrapper = mountHome()
    await flushPromises()
    await nextTick()

    expect(wrapper.findAll('.channel-column-stub')).toHaveLength(5)
    expect(wrapper.findAll('.channel-column-stub').map(node => node.text())).toEqual([
      'alpha-cli', 'beta-cli', 'gamma-cli', 'delta-cli', 'epsilon-cli'
    ])
  })
})
