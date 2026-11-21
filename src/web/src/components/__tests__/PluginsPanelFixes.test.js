import { beforeEach, describe, expect, test, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const hoisted = vi.hoisted(() => ({
  state: {
    byCapability: { plugins: [] },
    platforms: [],
    route: { meta: {}, query: {} }
  },
  messages: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
  api: {
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
    importFromClaude: vi.fn(),
    getDshProfiles: vi.fn()
  }
}))

const { state, messages, api } = hoisted

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
vi.mock('../../api/config-registry', () => ({ importFromClaude: api.importFromClaude }))
vi.mock('../../api/dsh-agent-presets', () => ({ getDshProfiles: api.getDshProfiles }))
vi.mock('../../composables/useEnabledCliPlatforms', () => ({
  useEnabledCliPlatforms: () => ({
    catalog: { value: state.platforms },
    byCapability: capability => state.byCapability[capability] || []
  })
}))
vi.mock('../../stores/platforms', () => ({
  usePlatformStore: () => ({
    all: state.platforms,
    get: key => state.platforms.find(platform => platform.key === key) || null
  })
}))
vi.mock('vue-router', () => ({ useRoute: () => state.route }))
vi.mock('naive-ui', () => {
  const simple = { template: '<div><slot /></div>' }
  return {
    NButton: { emits: ['click'], template: '<button @click="$emit(\'click\')"><slot name="icon" /><slot /></button>' },
    NIcon: simple,
    NInput: {
      props: ['value', 'placeholder'],
      emits: ['update:value'],
      inheritAttrs: false,
      template: '<input class="search-input" :value="value" @input="$emit(\'update:value\', $event.target.value)" />'
    },
    NSelect: simple,
    NSpin: simple,
    NEmpty: { props: ['description'], template: '<div><slot name="extra" /></div>' },
    NPagination: {
      props: ['page', 'pageCount'],
      emits: ['update:page'],
      template: '<div class="pagination">{{ page }}/{{ pageCount }}<button class="page-next" @click="$emit(\'update:page\', page + 1)">next</button></div>'
    },
    useMessage: () => messages,
    lightTheme: {},
    darkTheme: {},
    createDiscreteApi: () => ({
      message: messages,
      dialog: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn(), create: vi.fn() }
    })
  }
})

const PluginCardStub = {
  props: ['plugin', 'readonly', 'canInstall', 'canUninstall', 'installing', 'uninstalling'],
  emits: ['install', 'uninstall', 'click'],
  template: '<button class="plugin-card" :data-installing="installing" :data-plugin="plugin.name">{{ plugin.name }}</button>'
}

function plugin(index) {
  return {
    key: `plugin-${index}`,
    name: `plugin-${index}`,
    description: 'demo',
    installed: true
  }
}

let PluginsPanel

function mountPanel(props = {}) {
  return mount(PluginsPanel, {
    props,
    global: {
      stubs: {
        PluginCard: PluginCardStub,
        PluginRepoManager: { template: '<div />' },
        PluginDetailDrawer: { template: '<div />' }
      }
    }
  })
}

beforeEach(async () => {
  vi.clearAllMocks()
  state.byCapability = { plugins: [{ key: 'omp' }] }
  state.platforms = [
    { key: 'omp', label: 'OMP', capabilities: { plugins: true } },
    { key: 'codex', label: 'Codex', capabilities: { plugins: true } }
  ]
  state.route = { meta: {}, query: {} }
  api.getPluginCapabilities.mockResolvedValue({
    success: true,
    capabilities: { supportsPlugins: true, repositories: true, market: false, install: true, uninstall: true }
  })
  api.getPlugins.mockResolvedValue({ success: true, plugins: [plugin(1)] })
  api.getMarketPlugins.mockResolvedValue({ success: true, plugins: [] })
  api.getDshProfiles.mockResolvedValue([])
  PluginsPanel = (await import('../PluginsPanel.vue')).default
})

describe('PluginsPanel platform defaults', () => {
  test('falls back to the first enabled platform with plugins capability', async () => {
    mountPanel()
    await flushPromises()

    expect(api.getPlugins).toHaveBeenCalledWith('omp', { scope: 'user' })
  })

  test('query platform still wins over the resolved default', async () => {
    state.route = { meta: {}, query: { platform: 'codex' } }
    mountPanel()
    await flushPromises()

    expect(api.getPlugins).toHaveBeenCalledWith('codex', { scope: 'user' })
  })
})

describe('PluginsPanel pagination', () => {
  beforeEach(() => {
    api.getPlugins.mockResolvedValue({
      success: true,
      plugins: Array.from({ length: 30 }, (_, index) => plugin(index + 1))
    })
  })

  test('pages the plugin list and resets to page 1 when the filter shrinks it', async () => {
    const wrapper = mountPanel({ platform: 'omp' })
    await flushPromises()

    expect(wrapper.findAll('.plugin-card')).toHaveLength(24)
    expect(wrapper.find('.pagination').text()).toContain('1/2')

    await wrapper.find('.page-next').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.plugin-card')).toHaveLength(6)
    expect(wrapper.find('.pagination').text()).toContain('2/2')

    await wrapper.find('.search-input').setValue('plugin-29')
    await flushPromises()

    expect(wrapper.findAll('.plugin-card')).toHaveLength(1)
    expect(wrapper.find('.pagination').exists()).toBe(false)
  })
})

describe('PluginsPanel install refresh', () => {
  const marketPlugin = {
    key: 'omp:team:pkg',
    name: 'pkg',
    pluginId: 'pkg',
    installSource: 'pkg',
    installed: false,
    description: 'demo'
  }

  test('reloads the list before the row leaves its installing state', async () => {
    let resolveReload
    api.getPlugins
      .mockResolvedValueOnce({ success: true, plugins: [marketPlugin] })
      .mockImplementationOnce(() => new Promise(resolve => {
        resolveReload = resolve
      }))
    api.installPlugin.mockResolvedValue({ success: true, plugin: { name: 'pkg' } })

    const wrapper = mountPanel({ platform: 'omp' })
    await flushPromises()
    expect(api.getPlugins).toHaveBeenCalledTimes(1)

    await wrapper.find('.plugin-card').trigger('click')
    await wrapper.findComponent(PluginCardStub).vm.$emit('install', marketPlugin)
    await flushPromises()

    // The reload is still pending, so the row must still show progress.
    expect(api.getPlugins).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.plugin-card').attributes('data-installing')).toBe('true')

    resolveReload({ success: true, plugins: [{ ...marketPlugin, installed: true, installPath: '/tmp/node_modules/pkg' }] })
    await flushPromises()

    expect(wrapper.find('.plugin-card').attributes('data-installing')).toBe('false')
    expect(messages.success).toHaveBeenCalledWith('插件 "pkg" 安装成功')
  })
})
