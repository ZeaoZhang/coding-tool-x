import { flushPromises, mount, shallowMount } from '@vue/test-utils'
import { NRadio } from 'naive-ui'
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

describe('McpFormDrawer transport capabilities', () => {
  const dsh = {
    key: 'dsh',
    label: 'DSH',
    capabilities: { mcp: true },
    mcpTransports: ['stdio', 'streamable_http']
  }

  function mountForm(platforms, props = {}) {
    return mount(McpFormDrawer, {
      props: { visible: true, platforms, ...props },
      global: {
        stubs: {
          drawer: { template: '<div><slot /></div>' },
          'drawer-content': { template: '<div><slot name="header" /><slot /><slot name="footer" /></div>' },
          spin: { template: '<div><slot /></div>' }
        }
      }
    })
  }

  function radioByValue(wrapper, value) {
    return wrapper.findAllComponents(NRadio).find(radio => radio.props('value') === value)
  }

  it('disables transports the selected platforms do not support', async () => {
    const wrapper = mountForm([dsh])
    await flushPromises()

    expect(radioByValue(wrapper, 'stdio').props('disabled')).not.toBe(true)
    expect(radioByValue(wrapper, 'streamable_http').props('disabled')).toBe(false)
    expect(radioByValue(wrapper, 'sse').props('disabled')).toBe(true)
    expect(wrapper.text()).not.toContain('当前选中的平台不支持')
    wrapper.unmount()
  })

  it('warns when an existing server uses a transport the selected platform rejects', async () => {
    const wrapper = mountForm([dsh], {
      visible: false,
      editingServer: {
        id: 'sse-server',
        apps: { dsh: true },
        server: { type: 'sse', url: 'http://127.0.0.1:39999/mcp' }
      }
    })
    await flushPromises()
    await wrapper.setProps({ visible: true })
    await flushPromises()

    expect(wrapper.text()).toContain('当前选中的平台不支持 sse：DSH')
    expect(radioByValue(wrapper, 'sse').props('disabled')).toBe(true)
    wrapper.unmount()
  })

  it('validates project-scope transports against the project platform', async () => {
    const wrapper = mountForm([alpha, dsh], {
      visible: false,
      scope: 'project',
      projectPath: '/tmp/project',
      platform: 'dsh',
      editingServer: {
        id: 'project-sse',
        server: { type: 'sse', url: 'http://127.0.0.1:39999/mcp' }
      }
    })
    await flushPromises()
    await wrapper.setProps({ visible: true })
    await flushPromises()

    expect(wrapper.findAll('.platform-item')).toHaveLength(0)
    expect(wrapper.text()).toContain('当前选中的平台不支持 sse：DSH')
    expect(radioByValue(wrapper, 'sse').props('disabled')).toBe(true)
    wrapper.unmount()
  })

  it('keeps all transports when the platform declares no restriction', async () => {
    const wrapper = mountForm([alpha])
    await flushPromises()

    expect(radioByValue(wrapper, 'sse').props('disabled')).toBe(false)
    expect(wrapper.text()).not.toContain('当前选中的平台不支持')
    wrapper.unmount()
  })
})
