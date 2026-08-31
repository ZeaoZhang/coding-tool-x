import { flushPromises, shallowMount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  updateNestedUIConfig,
  checkEnvConflicts,
  getSecurityStatus,
  verifySecurityPassword,
  useEnabled,
  globalState,
  favorites,
  dashboard
} = vi.hoisted(() => ({
  updateNestedUIConfig: vi.fn(),
  checkEnvConflicts: vi.fn(),
  getSecurityStatus: vi.fn(),
  verifySecurityPassword: vi.fn(),
  useEnabled: () => ({
    enabledPlatforms: { value: [
      { key: 'alpha-cli', label: 'Alpha CLI', iconToken: 'terminal', capabilities: {} },
      { key: 'beta-cli', label: 'Beta CLI', iconToken: 'terminal', capabilities: {} }
    ] }
  }),
  globalState: {
    getProxyState: () => ({ value: { running: false, loading: false } }),
    startProxy: vi.fn(),
    stopProxy: vi.fn()
  },
  favorites: { totalFavorites: { value: 0 } },
  dashboard: {
    dashboardData: { value: { uiConfig: null } },
    isLoading: { value: false },
    loadDashboard: vi.fn()
  }
}))

vi.mock('../../api/ui-config', () => ({ updateNestedUIConfig }))
vi.mock('../../api/env', () => ({ checkEnvConflicts }))
vi.mock('../../api/security', () => ({ getSecurityStatus, verifySecurityPassword }))
vi.mock('../ConfigTemplatesDrawer.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../../utils/message', () => ({
  default: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
}))
vi.mock('../../composables/useTheme', () => ({
  useTheme: () => ({ isDark: { value: false }, toggleTheme: vi.fn() })
}))
vi.mock('../../composables/useGlobalState', () => ({ useGlobalState: () => globalState }))
vi.mock('../../composables/useFavorites', () => ({ useFavorites: () => favorites }))
vi.mock('../../composables/useDashboard', () => ({ useDashboard: () => dashboard }))
vi.mock('../../composables/useEnabledCliPlatforms', () => ({ useEnabledCliPlatforms: useEnabled }))

import Layout from '../Layout.vue'

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/cli/:platform', name: 'cli-projects', component: { template: '<div />' } },
      { path: '/analytics', name: 'analytics', component: { template: '<div />' } }
    ]
  })
}

describe('Layout dynamic navigation', () => {
  beforeEach(() => {
    checkEnvConflicts.mockResolvedValue({ success: true, conflicts: [] })
    getSecurityStatus.mockResolvedValue({ success: true, hasPassword: false })
    verifySecurityPassword.mockResolvedValue({ success: true })
    updateNestedUIConfig.mockResolvedValue({ success: true })
    dashboard.loadDashboard.mockResolvedValue({ uiConfig: null })
  })

  it('renders enabled platforms in order and omits hidden catalog entries', async () => {
    const router = createTestRouter()
    await router.push('/')
    await router.isReady()
    const wrapper = shallowMount(Layout, {
      global: { plugins: [router] }
    })
    await flushPromises()

    const navTabs = wrapper.findAll('.nav-tab')
    expect(navTabs.map(tab => tab.text())).toEqual(['Home', 'Alpha CLI', 'Beta CLI', 'Analytics'])
    expect(wrapper.text()).not.toContain('Gemini')

    await navTabs[1].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('cli-projects')
    expect(router.currentRoute.value.params.platform).toBe('alpha-cli')
  })
})
