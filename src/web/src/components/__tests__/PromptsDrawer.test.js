import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const alpha = { key: 'alpha-cli', label: 'Alpha CLI', promptLabel: 'Alpha', capabilities: { prompts: true } }
const hidden = { key: 'hidden-cli', label: 'Hidden CLI', capabilities: { prompts: true } }
const {
  getAllPresets,
  activatePreset,
  deletePreset,
  importFromPlatform,
  deactivatePrompt,
  byCapability,
  message
} = vi.hoisted(() => ({
  getAllPresets: vi.fn(),
  activatePreset: vi.fn(),
  deletePreset: vi.fn(),
  importFromPlatform: vi.fn(),
  deactivatePrompt: vi.fn(),
  byCapability: vi.fn(),
  message: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
}))

vi.mock('../../api/prompts', () => ({
  getAllPresets,
  activatePreset,
  deletePreset,
  importFromPlatform,
  deactivatePrompt
}))
vi.mock('../../utils/message', () => ({ default: message, dialog: { warning: vi.fn() } }))
vi.mock('../../composables/useResponsiveDrawer', () => ({
  useResponsiveDrawer: () => ({ drawerWidth: 720 })
}))
vi.mock('../../composables/useEnabledCliPlatforms', () => ({
  useEnabledCliPlatforms: () => ({ byCapability })
}))

import PromptsDrawer from '../PromptsDrawer.vue'

const FormStub = {
  name: 'PromptsFormDrawer',
  props: ['platforms'],
  template: '<div class="prompts-form-stub">{{ platforms.map(platform => platform.label).join(",") }}</div>'
}

describe('PromptsDrawer capability filtering', () => {
  beforeEach(() => {
    byCapability.mockImplementation(capability => capability === 'prompts' ? [alpha] : [])
    getAllPresets.mockResolvedValue({
      success: true,
      presets: {
        review: {
          id: 'review',
          name: 'Review',
          content: '# review',
          apps: { 'alpha-cli': true, 'hidden-cli': true }
        }
      },
      activePresetId: null
    })
  })

  it('shows only enabled prompt platforms in cards, imports, and forms', async () => {
    const wrapper = shallowMount(PromptsDrawer, {
      props: { visible: false },
      global: {
        stubs: {
          drawer: { template: '<div><slot /></div>' },
          'drawer-content': { template: '<div><slot name="header" /><slot /><slot name="footer" /></div>' },
          dropdown: { template: '<div><slot /></div>' },
          PromptsFormDrawer: FormStub
        }
      }
    })

    await wrapper.setProps({ visible: true })
    await flushPromises()

    expect(wrapper.text()).toContain('Alpha')
    expect(wrapper.text()).not.toContain('Hidden CLI')
    expect(wrapper.findComponent(FormStub).props('platforms')).toEqual([alpha])
  })
})
