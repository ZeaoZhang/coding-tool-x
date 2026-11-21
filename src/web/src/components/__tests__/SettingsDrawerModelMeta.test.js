import { nextTick } from 'vue'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getUIConfig, saveUIConfig, updateNestedUIConfig, getSecurityStatus, setSecurityPassword, client, uiConfig, platformStore } = vi.hoisted(() => ({
  getUIConfig: vi.fn(),
  saveUIConfig: vi.fn(),
  updateNestedUIConfig: vi.fn(),
  getSecurityStatus: vi.fn(),
  setSecurityPassword: vi.fn(),
  client: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  uiConfig: { value: { enabledCliPlatforms: ['demo-cli'] } },
  platformStore: {
    all: [{ key: 'demo-cli', label: 'Demo CLI', title: 'Demo CLI', capabilities: {} }],
    load: vi.fn()
  }
}))

vi.mock('../../api/ui-config', () => ({ getUIConfig, saveUIConfig, updateNestedUIConfig }))
vi.mock('../../api/security', () => ({ getSecurityStatus, setSecurityPassword }))
vi.mock('../../api/pm2', () => ({
  getAutoStartStatus: vi.fn(),
  enableAutoStart: vi.fn(),
  disableAutoStart: vi.fn()
}))
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

const modelSettingsPayload = {
  models: {
    'demo-model': {
      limit: { context: 128000, output: 8192 },
      pricing: { input: 1, output: 2, cacheCreation: null, cacheRead: null },
      toolTypes: ['claude']
    }
  },
  overrides: {},
  builtinModelIds: ['demo-model'],
  modelPlatforms: [],
  defaultSpeedTestModels: {}
}

function mountSettings() {
  return shallowMount(SettingsDrawer, {
    props: { visible: false },
    global: {
      stubs: {
        'n-drawer': { template: '<div><slot /></div>' },
        'n-drawer-content': { template: '<div><slot /></div>' }
      }
    }
  })
}

describe('SettingsDrawer model metadata dirty state', () => {
  beforeEach(() => {
    getUIConfig.mockReset()
    getSecurityStatus.mockReset()
    client.get.mockReset()
    client.post.mockReset()
    client.delete.mockReset()

    getUIConfig.mockResolvedValue({ success: true, config: { enabledCliPlatforms: ['demo-cli'] } })
    saveUIConfig.mockResolvedValue({ success: true, config: { enabledCliPlatforms: ['demo-cli'] } })
    updateNestedUIConfig.mockResolvedValue({ success: true })
    getSecurityStatus.mockResolvedValue({ success: true, hasPassword: false })
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    client.get.mockImplementation(url => {
      if (url === '/settings/model-settings') {
        return Promise.resolve({ data: modelSettingsPayload })
      }
      return Promise.resolve({ data: {} })
    })
  })

  it('starts disabled and becomes disabled again when an edited value is restored', async () => {
    const wrapper = mountSettings()
    await flushPromises()

    expect(wrapper.vm.modelMetaTable['demo-model']).toBeTruthy()
    expect(wrapper.vm.modelSettingsDirty).toBe(false)

    wrapper.vm.setModelMetaField('demo-model', 'pricing', 'input', 5)
    await nextTick()
    expect(wrapper.vm.modelSettingsDirty).toBe(true)

    wrapper.vm.setModelMetaField('demo-model', 'pricing', 'input', 1)
    await nextTick()
    expect(wrapper.vm.modelSettingsDirty).toBe(false)

    wrapper.vm.setModelMetaField('demo-model', 'limit', 'context', 64000)
    await nextTick()
    expect(wrapper.vm.modelSettingsDirty).toBe(true)

    wrapper.vm.setModelMetaField('demo-model', 'limit', 'context', 128000)
    await nextTick()
    expect(wrapper.vm.modelSettingsDirty).toBe(false)
  })

  it('treats a locally added model as dirty until it is saved', async () => {
    const wrapper = mountSettings()
    await flushPromises()

    expect(wrapper.vm.modelSettingsDirty).toBe(false)

    wrapper.vm.newModelMetaForm.modelId = 'brand-new-model'
    wrapper.vm.handleAddModelMeta()
    await nextTick()

    expect(wrapper.vm.modelSettingsDirty).toBe(true)
  })
})
