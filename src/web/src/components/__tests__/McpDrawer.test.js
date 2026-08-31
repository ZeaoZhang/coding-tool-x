import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const alpha = { key: 'alpha-cli', label: 'Alpha CLI', capabilities: { mcp: true } }
const hidden = { key: 'hidden-cli', label: 'Hidden CLI', capabilities: { mcp: true } }
const {
  getAllServers,
  toggleServerApp,
  deleteServer,
  importFromPlatform,
  saveServer,
  testServer,
  updateServerOrder,
  exportServers,
  getExportDownloadUrl,
  message,
  byCapability
} = vi.hoisted(() => ({
  getAllServers: vi.fn(),
  toggleServerApp: vi.fn(),
  deleteServer: vi.fn(),
  importFromPlatform: vi.fn(),
  saveServer: vi.fn(),
  testServer: vi.fn(),
  updateServerOrder: vi.fn(),
  exportServers: vi.fn(),
  getExportDownloadUrl: vi.fn(),
  message: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  byCapability: vi.fn()
}))

vi.mock('../../api/mcp', () => ({
  getAllServers,
  toggleServerApp,
  deleteServer,
  importFromPlatform,
  saveServer,
  testServer,
  updateServerOrder,
  exportServers,
  getExportDownloadUrl
}))
vi.mock('../../api/client', () => ({
  isLegacyPlatformKey: key => ['claude', 'codex', 'gemini', 'opencode', 'omp'].includes(key)
}))
vi.mock('../../utils/message', () => ({ default: message, dialog: { warning: vi.fn() } }))
vi.mock('../../utils/mcp-error', () => ({ showMcpError: vi.fn() }))
vi.mock('../../utils/clipboard', () => ({ copyTextToClipboard: vi.fn() }))
vi.mock('../../composables/useResponsiveDrawer', () => ({
  useResponsiveDrawer: () => ({ drawerWidth: 720 })
}))
vi.mock('../../composables/useEnabledCliPlatforms', () => ({
  useEnabledCliPlatforms: () => ({ byCapability })
}))

import McpDrawer from '../McpDrawer.vue'

const McpFormStub = {
  name: 'McpFormDrawer',
  props: ['platforms'],
  template: '<div class="mcp-form-stub">{{ platforms.map(platform => platform.label).join(",") }}</div>'
}
const McpDetailStub = { name: 'McpServerDetailDrawer', template: '<div />' }

describe('McpDrawer capability filtering', () => {
  beforeEach(() => {
    byCapability.mockImplementation(capability => capability === 'mcp' ? [alpha] : [])
    getAllServers.mockResolvedValue({ success: true, servers: {} })
  })

  it('passes only enabled manifest MCP platforms to controls and forms', async () => {
    const wrapper = shallowMount(McpDrawer, {
      props: { visible: false },
      global: {
        stubs: {
          drawer: { template: '<div><slot /></div>' },
          'drawer-content': { template: '<div><slot name="header" /><slot /><slot name="footer" /></div>' },
          McpFormDrawer: McpFormStub,
          McpServerDetailDrawer: McpDetailStub,
          dropdown: { template: '<div><slot /></div>' }
        }
      }
    })

    await wrapper.setProps({ visible: true })
    await flushPromises()

    expect(wrapper.text()).toContain('Alpha CLI')
    expect(wrapper.text()).not.toContain('Hidden CLI')
    expect(wrapper.findComponent(McpFormStub).props('platforms')).toEqual([alpha])
  })
})
