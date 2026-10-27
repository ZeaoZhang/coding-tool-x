import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const api = vi.hoisted(() => ({
  getPlugins: vi.fn(),
  getMarketPlugins: vi.fn(),
  getPluginCapabilities: vi.fn(),
  installPlugin: vi.fn(),
  uninstallPlugin: vi.fn(),
  installDshPlugin: vi.fn(),
  uninstallDshPlugin: vi.fn(),
  refreshPlugins: vi.fn(),
  getPluginRefreshTask: vi.fn(),
  invalidatePluginSessionCache: vi.fn(),
  getDshProfiles: vi.fn()
}))

vi.mock('../../api/plugins', () => ({
  getPlugins: api.getPlugins,
  getMarketPlugins: api.getMarketPlugins,
  getPluginCapabilities: api.getPluginCapabilities,
  installPlugin: api.installPlugin,
  uninstallPlugin: api.uninstallPlugin,
  installDshPlugin: api.installDshPlugin,
  uninstallDshPlugin: api.uninstallDshPlugin,
  refreshPlugins: api.refreshPlugins,
  getPluginRefreshTask: api.getPluginRefreshTask,
  invalidatePluginSessionCache: api.invalidatePluginSessionCache
}))
vi.mock('../../api/dsh-agent-presets', () => ({ getDshProfiles: api.getDshProfiles }))
vi.mock('../../api/config-registry', () => ({ importFromClaude: vi.fn() }))
vi.mock('../../stores/platforms', () => ({
  usePlatformStore: () => ({
    all: [{
      key: 'dsh',
      label: 'DSH',
      title: 'DeepSeek Harness',
      defaultEnabled: false,
      cliSelectable: false,
      resourceTypes: { plugins: true },
      capabilities: {}
    }],
    get: () => ({ label: 'DSH', title: 'DeepSeek Harness' })
  })
}))
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { platform: 'dsh' }, query: {}, meta: {} }) }))
vi.mock('../../composables/useUIConfig', () => ({ useUIConfig: () => ({ uiConfig: { value: { enabledCliPlatforms: [] } } }) }))
vi.mock('naive-ui', () => {
  const noop = vi.fn()
  const simple = { template: '<div><slot name="icon" /><slot /><slot name="extra" /></div>' }
  return {
    NButton: { emits: ['click'], template: '<button @click="$emit(\'click\')"><slot name="icon" /><slot /></button>' },
    NIcon: simple,
    NInput: simple,
    NSelect: simple,
    NSpin: { props: ['show'], template: '<div><slot /></div>' },
    NEmpty: { props: ['description'], template: '<div>{{ description }}<slot name="extra" /></div>' },
    createDiscreteApi: () => ({
      message: { success: noop, warning: noop, error: noop, info: noop, loading: noop },
      dialog: { success: noop, warning: noop, error: noop, info: noop, create: noop }
    }),
    darkTheme: {},
    lightTheme: {},
    useMessage: () => ({ success: noop, warning: noop, error: noop, info: noop })
  }
})

import PluginsPanel from '../PluginsPanel.vue'

beforeEach(() => {
  vi.clearAllMocks()
  api.getPlugins.mockResolvedValue({ success: true, plugins: [{
    key: 'dsh:default:missing-package',
    name: 'missing-package',
    profile: 'default',
    installed: false,
    readonly: false,
    pluginType: 'dsh-profile'
  }] })
  api.getMarketPlugins.mockResolvedValue({ success: true, plugins: [] })
  api.getPluginCapabilities.mockResolvedValue({ success: true, capabilities: {
    platform: 'dsh',
    supportsPlugins: true,
    repositories: false,
    market: false,
    install: true,
    uninstall: true
  } })
  api.getDshProfiles.mockResolvedValue([{ name: 'default' }])
  api.installDshPlugin.mockResolvedValue({ success: true })
})

describe('DSH PluginsPanel', () => {
  it('loads plugins for a non-CLI platform and preserves detected install status', async () => {
    const wrapper = mount(PluginsPanel, {
      global: {
        stubs: {
          PluginCard: {
            props: ['plugin'],
            emits: ['install'],
            template: '<button class="plugin-card" @click="$emit(\'install\', plugin)">{{ plugin.name }}:{{ plugin.installed ? "installed" : "missing" }}</button>'
          },
          PluginRepoManager: true,
          PluginDetailDrawer: true
        }
      }
    })
    await flushPromises()

    expect(api.getPlugins).toHaveBeenCalledWith('dsh', { scope: 'user' })
    expect(wrapper.text()).toContain('missing-package:missing')
    expect(wrapper.text()).toContain('已安装0')
    expect(wrapper.text()).toContain('可安装1')
    expect(wrapper.text()).not.toContain('刷新')

    await wrapper.find('.plugin-card').trigger('click')
    await flushPromises()
    expect(api.installDshPlugin).toHaveBeenCalledWith('default', 'missing-package')
    wrapper.unmount()
  })
})
