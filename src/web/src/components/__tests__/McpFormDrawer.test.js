import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const alpha = { key: 'alpha-cli', label: 'Alpha CLI', capabilities: { mcp: true } }
const hidden = { key: 'hidden-cli', label: 'Hidden CLI', capabilities: { mcp: true } }
const { getPresets, saveServer, byCapability, message } = vi.hoisted(() => ({
  getPresets: vi.fn(),
  saveServer: vi.fn(),
  byCapability: vi.fn(),
  message: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
}))

vi.mock('../../api/mcp', () => ({ getPresets, saveServer }))
vi.mock('../../utils/message', () => ({ default: message }))
vi.mock('../../composables/useResponsiveDrawer', () => ({
  useResponsiveDrawer: () => ({ drawerWidth: 520 })
}))
vi.mock('../../composables/useEnabledCliPlatforms', () => ({
  useEnabledCliPlatforms: () => ({ byCapability })
}))

import McpFormDrawer from '../McpFormDrawer.vue'

describe('McpFormDrawer capability filtering', () => {
  beforeEach(() => {
    byCapability.mockReturnValue([alpha, hidden])
    getPresets.mockResolvedValue({ success: true, presets: [] })
    saveServer.mockResolvedValue({ success: true })
  })

  it('renders only the capability platforms passed from the drawer', async () => {
    const wrapper = shallowMount(McpFormDrawer, {
      props: {
        visible: true,
        platforms: [alpha]
      },
      global: {
        stubs: {
          drawer: { template: '<div><slot /></div>' },
          'drawer-content': { template: '<div><slot name="header" /><slot /><slot name="footer" /></div>' },
          spin: { template: '<div><slot /></div>' }
        }
      }
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Alpha CLI')
    expect(wrapper.text()).not.toContain('Hidden CLI')
    expect(wrapper.findAll('.platform-item')).toHaveLength(1)
  })
})
