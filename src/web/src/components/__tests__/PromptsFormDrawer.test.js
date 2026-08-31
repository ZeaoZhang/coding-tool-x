import { shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const alpha = { key: 'alpha-cli', label: 'Alpha CLI', promptLabel: 'Alpha', capabilities: { prompts: true } }
const hidden = { key: 'hidden-cli', label: 'Hidden CLI', promptLabel: 'Hidden', capabilities: { prompts: true } }
const { savePreset, byCapability, message } = vi.hoisted(() => ({
  savePreset: vi.fn(),
  byCapability: vi.fn(),
  message: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
}))

vi.mock('../../api/prompts', () => ({ savePreset }))
vi.mock('../../utils/message', () => ({ default: message }))
vi.mock('../../composables/useResponsiveDrawer', () => ({
  useResponsiveDrawer: () => ({ drawerWidth: 600 })
}))
vi.mock('../../composables/useEnabledCliPlatforms', () => ({
  useEnabledCliPlatforms: () => ({ byCapability })
}))

import PromptsFormDrawer from '../PromptsFormDrawer.vue'

describe('PromptsFormDrawer capability filtering', () => {
  beforeEach(() => {
    byCapability.mockReturnValue([alpha, hidden])
    savePreset.mockResolvedValue({ success: true })
  })

  it('renders only enabled manifest prompt platforms', () => {
    const wrapper = shallowMount(PromptsFormDrawer, {
      props: {
        visible: true,
        platforms: [alpha]
      },
      global: {
        stubs: {
          drawer: { template: '<div><slot /></div>' },
          'drawer-content': { template: '<div><slot name="header" /><slot /><slot name="footer" /></div>' }
        }
      }
    })

    expect(wrapper.text()).toContain('Alpha')
    expect(wrapper.text()).not.toContain('Hidden')
    expect(wrapper.findAll('.app-toggle')).toHaveLength(1)
  })
})
