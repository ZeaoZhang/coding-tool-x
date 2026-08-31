import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('SettingsDrawer platform catalog', () => {
  beforeEach(() => {
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
})
