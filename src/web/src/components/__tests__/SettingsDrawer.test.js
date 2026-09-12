import { nextTick } from 'vue'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getUIConfig,
  saveUIConfig,
  updateNestedUIConfig,
  getSecurityStatus,
  setSecurityPassword,
  getAutoStartStatus,
  enableAutoStart,
  disableAutoStart,
  client,
  uiConfig,
  platformStore
} = vi.hoisted(() => ({
  getUIConfig: vi.fn(),
  saveUIConfig: vi.fn(),
  updateNestedUIConfig: vi.fn(),
  getSecurityStatus: vi.fn(),
  setSecurityPassword: vi.fn(),
  getAutoStartStatus: vi.fn(),
  enableAutoStart: vi.fn(),
  disableAutoStart: vi.fn(),
  client: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  uiConfig: { value: { enabledCliPlatforms: ['demo-cli'] } },
  platformStore: {
    all: [{ key: 'demo-cli', label: 'Demo CLI', title: 'Demo CLI', capabilities: {} }]
  }
}))

vi.mock('../../api/ui-config', () => ({ getUIConfig, saveUIConfig, updateNestedUIConfig }))
vi.mock('../../api/security', () => ({ getSecurityStatus, setSecurityPassword }))
vi.mock('../../api/pm2', () => ({ getAutoStartStatus, enableAutoStart, disableAutoStart }))
vi.mock('../../api/client', () => ({ client }))
vi.mock('../../stores/platforms', () => ({ usePlatformStore: () => platformStore }))
vi.mock('../../composables/useUIConfig', () => ({ useUIConfig: () => ({ uiConfig }) }))
vi.mock('../../composables/useTheme', () => ({
  useTheme: () => ({ isDark: { value: false }, toggleTheme: vi.fn() })
}))
vi.mock('../../composables/useResponsiveDrawer', () => ({
  useResponsiveDrawer: () => ({ drawerWidth: 720, isMobile: false })
}))
vi.mock('../../utils/message', () => ({
  default: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
}))

import SettingsDrawer from '../SettingsDrawer.vue'
const fetchMock = vi.fn()
afterEach(() => {
  vi.unstubAllGlobals()
})
describe('SettingsDrawer platform catalog', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
    getUIConfig.mockResolvedValue({
      success: true,
      config: { enabledCliPlatforms: ['demo-cli'] }
    })
    saveUIConfig.mockResolvedValue({
      success: true,
      config: { enabledCliPlatforms: ['demo-cli'] }
    })
    updateNestedUIConfig.mockResolvedValue({ success: true })
    getSecurityStatus.mockResolvedValue({ success: true, hasPassword: false })
    setSecurityPassword.mockResolvedValue({ success: true })
    getAutoStartStatus.mockResolvedValue({ success: true, data: { enabled: false } })
    enableAutoStart.mockResolvedValue({ success: true })
    disableAutoStart.mockResolvedValue({ success: true })
    client.get.mockResolvedValue({ data: { models: {}, overrides: {}, builtinModelIds: [] } })
  })

  it('lists manifest platforms and exposes no custom CLI metadata inputs', async () => {
    const wrapper = shallowMount(SettingsDrawer, {
      props: { visible: true },
      global: {
        stubs: {
          drawer: { template: '<div><slot /></div>' },
          'drawer-content': { template: '<div><slot name="header" /><slot /><slot name="footer" /></div>' },
          checkbox: { template: '<label><slot /></label>' }
        }
      }
    })
    await flushPromises()
    const bodyText = wrapper.text()
    expect(bodyText).toContain('Demo CLI')
    expect(bodyText).not.toContain('自定义 CLI')
    expect(bodyText).not.toContain('平台 key')
    expect(bodyText).not.toContain('配置目录')
    expect(bodyText).not.toContain('图标 token')
    expect(wrapper.findAll('.platform-catalog-item')).toHaveLength(1)
  })
  it('renders and saves a non-built-in hook platform from the API descriptor', async () => {
    const hooksData = {
      success: true,
      platform: 'darwin',
      platforms: {
        'demo-hook': { enabled: true, external: false, type: 'dialog', method: 'Demo Hook' }
      },
      platformDefinitions: [{
        key: 'demo-hook',
        label: 'Demo Hooks',
        description: 'A dynamically registered hook',
        implementation: 'A test adapter',
        externalMessage: '',
        hints: []
      }],
      remoteNotifications: {
        providers: [{
          id: 'provider-1',
          type: 'testProvider',
          name: 'Legacy Test Provider',
          enabled: false,
          config: { token: '' }
        }]
      },
      remoteProviderTypes: [{
        type: 'testProvider',
        label: 'Test Provider',
        description: 'A dynamic provider',
        hint: 'Configure the test provider',
        defaults: { token: '' },
        fields: [{ key: 'token', label: 'Token', type: 'secret' }]
      }]
    }
    fetchMock.mockImplementation(async (url) => {
      if (url === '/api/hooks') {
        return { ok: true, json: async () => hooksData }
      }
      return {
        ok: true,
        json: async () => ({
          ports: {},
          maxLogs: 100,
          statsInterval: 30,
          enableSessionBinding: true
        })
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = shallowMount(SettingsDrawer, {
      props: { visible: false },
      global: {
        stubs: {
          drawer: { template: '<div><slot /></div>' },
          'drawer-content': { template: '<div><slot name=\"header\" /><slot /><slot name=\"footer\" /></div>' },
          checkbox: { template: '<label><slot /></label>' },
          text: { template: '<span><slot /></span>' }
        }
      }
    })
    await wrapper.setProps({ visible: true })
    await flushPromises()
    await nextTick()
    expect(fetchMock.mock.calls.map(([url]) => url)).toContain('/api/hooks')
    expect(wrapper.vm.notificationPlatformDefinitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'demo-hook', label: 'Demo Hooks' })
    ]))
    const notificationPanel = wrapper.findAll('.settings-panel').find(panel => panel.html().includes('远程通知渠道'))
    expect(notificationPanel).toBeTruthy()
    expect(notificationPanel.html()).toContain('Demo Hooks')
    expect(wrapper.text()).not.toContain('Claude Code')
    expect(wrapper.text()).toContain('Legacy Test Provider')
    expect(wrapper.find('remote-provider-fields-stub').exists()).toBe(true)

    await wrapper.vm.handleSaveNotification()
    const saveCall = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')
    expect(saveCall).toBeTruthy()
    expect(JSON.parse(saveCall[1].body).platforms).toEqual({
      'demo-hook': { enabled: true, type: 'dialog' }
    })
  })
  it('keeps legacy hook and provider keys when descriptor metadata is absent', async () => {
    const legacyData = {
      success: true,
      platform: 'linux',
      platforms: {
        'legacy-hook': { enabled: false, type: 'notification' }
      },
      remoteNotifications: {
        providers: [{
          id: 'legacy-provider-1',
          type: 'legacyProvider',
          name: 'Legacy Provider',
          enabled: false,
          config: { legacyField: 'preserve-me' }
        }]
      }
    }
    fetchMock.mockImplementation(async (url) => {
      if (url === '/api/hooks') {
        return { ok: true, json: async () => legacyData }
      }
      return {
        ok: true,
        json: async () => ({
          ports: {},
          maxLogs: 100,
          statsInterval: 30,
          enableSessionBinding: true
        })
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = shallowMount(SettingsDrawer, {
      props: { visible: false },
      global: {
        stubs: {
          drawer: { template: '<div><slot /></div>' },
          'drawer-content': { template: '<div><slot name=\"header\" /><slot /><slot name=\"footer\" /></div>' },
          checkbox: { template: '<label><slot /></label>' },
          text: { template: '<span><slot /></span>' }
        }
      }
    })
    await wrapper.setProps({ visible: true })
    await flushPromises()
    await nextTick()

    expect(wrapper.vm.notificationPlatformDefinitions).toEqual([
      expect.objectContaining({ key: 'legacy-hook', label: 'legacy-hook' })
    ])
    expect(wrapper.vm.remoteProviderTypes).toEqual([
      expect.objectContaining({ type: 'legacyProvider', label: 'legacyProvider' })
    ])
    expect(wrapper.vm.notificationSettings.platforms).toEqual({
      'legacy-hook': { enabled: false, type: 'notification', external: false }
    })
    expect(wrapper.vm.notificationSettings.remoteNotifications.providers[0].config).toEqual({
      legacyField: 'preserve-me'
    })
  })
  it('hydrates model overrides, builtin IDs, and speed test selections before saving', async () => {
    const modelData = {
      metadataSource: { name: 'Models.dev', url: '/models', lastUpdated: '2026-09-11' },
      models: {
        'claude-built-in': {
          limit: { context: 200000, output: 8192 },
          pricing: { input: 3, output: 15 },
          toolTypes: ['claude']
        },
        'claude-custom': {
          limit: { context: 8192, output: 1024 },
          pricing: { input: 0.5, output: 1.5 },
          toolTypes: ['claude']
        }
      },
      overrides: {
        'claude-built-in': { limit: { context: 100000 } }
      },
      builtinModelIds: ['claude-built-in'],
      defaultSpeedTestModels: { claude: 'claude-custom' }
    }
    client.get.mockResolvedValue({ data: modelData })
    client.post.mockResolvedValue({ data: { success: true } })

    const wrapper = shallowMount(SettingsDrawer, {
      props: { visible: true },
      global: {
        stubs: {
          drawer: { template: '<div><slot /></div>' },
          'drawer-content': { template: '<div><slot name="header" /><slot /><slot name="footer" /></div>' },
          checkbox: { template: '<label><slot /></label>' }
        }
      }
    })
    await flushPromises()

    expect(wrapper.vm.modelMetaOverrides).toEqual(modelData.overrides)
    expect(wrapper.vm.builtInModelIds).toEqual(new Set(modelData.builtinModelIds))
    expect(wrapper.vm.isBuiltInModel('claude-built-in')).toBe(true)
    expect(wrapper.vm.isCustomModel('claude-custom')).toBe(true)
    expect(wrapper.vm.defaultSpeedTestModels).toEqual(modelData.defaultSpeedTestModels)

    await wrapper.vm.handleSaveModelMeta()

    expect(client.post).toHaveBeenCalledWith('/settings/model-settings', {
      overrides: modelData.overrides,
      defaultSpeedTestModels: modelData.defaultSpeedTestModels
    })
    expect(wrapper.vm.modelMetaOverrides).toEqual(modelData.overrides)
    expect(wrapper.vm.defaultSpeedTestModels).toEqual(modelData.defaultSpeedTestModels)
  })
})
