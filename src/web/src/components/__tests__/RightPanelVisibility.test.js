import { computed, ref, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const route = { name: 'cli-projects', path: '/cli/omp', params: { platform: 'omp' }, meta: { requiresCli: true } }
const enabledPlatforms = ref([
  { key: 'omp', label: 'OMP', capabilities: { channels: true, proxy: true, sessions: true, nativeLogs: true }, resourceTypes: { skills: true } }
])

vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ push: vi.fn() })
}))
vi.mock('../../composables/useEnabledCliPlatforms', () => ({
  useEnabledCliPlatforms: () => ({
    enabledPlatforms: computed(() => enabledPlatforms.value),
    getPlatform: key => enabledPlatforms.value.find(platform => platform.key === key) || null
  })
}))
vi.mock('../../composables/useTheme', () => ({
  useTheme: () => ({ isDark: ref(false), toggleTheme: vi.fn(), loadTheme: vi.fn() })
}))
vi.mock('../../composables/useGlobalState', () => ({
  useGlobalState: () => ({
    getProxyState: () => ref({ running: false, loading: false }),
    startProxy: vi.fn(),
    stopProxy: vi.fn()
  })
}))
vi.mock('../../composables/useFavorites', () => ({
  useFavorites: () => ({ totalFavorites: ref(0) })
}))
vi.mock('../../composables/useDashboard', () => ({
  useDashboard: () => ({ dashboardData: ref({}), isLoading: ref(false), loadDashboard: vi.fn() })
}))
vi.mock('../../api/skills', () => ({ getSkills: vi.fn(async () => ({ success: true, skills: [] })) }))
vi.mock('../../api/ui-config', () => ({ updateNestedUIConfig: vi.fn() }))
vi.mock('../../api/env', () => ({ checkEnvConflicts: vi.fn(async () => ({ success: true, conflicts: [] })) }))
vi.mock('../../api/security', () => ({ getSecurityStatus: vi.fn(), verifySecurityPassword: vi.fn() }))
vi.mock('../../utils/message', () => ({ default: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import RightPanel from '../RightPanel.vue'

describe('RightPanel visibility', () => {
  beforeEach(() => {
    route.name = 'cli-projects'
    route.path = '/cli/omp'
    route.params = { platform: 'omp' }
    route.meta = { requiresCli: true }
    enabledPlatforms.value = [
      { key: 'omp', label: 'OMP', capabilities: { channels: true, proxy: true, sessions: true, nativeLogs: true }, resourceTypes: { skills: true } }
    ]
  })

  it('renders the channel management section for the active CLI route', async () => {
    const wrapper = mount(RightPanel, {
      global: {
        stubs: {
          ProxyLogs: true,
          OmpChannelPanel: { template: '<div data-test="omp-channel-panel" />' }
        }
      }
    })
    await flushPromises()
    await nextTick()

    expect(wrapper.find('.channels-section:not(.channels-unsupported)').exists()).toBe(true)
    expect(wrapper.find('[data-test="omp-channel-panel"]').exists()).toBe(true)
  })

  it('reuses the generic channel panel for DSH', async () => {
    enabledPlatforms.value = [
      { key: 'dsh', label: 'DSH', capabilities: { channels: true, proxy: true, sessions: true } }
    ]
    route.path = '/cli/dsh'
    route.params = { platform: 'dsh' }

    const wrapper = mount(RightPanel, {
      global: {
        stubs: {
          ProxyLogs: true,
          BaseChannelPanel: { template: '<div data-test="generic-channel-panel" />' }
        }
      }
    })
    await flushPromises()
    await nextTick()

    expect(wrapper.find('[data-test="generic-channel-panel"]').exists()).toBe(true)
  })
})
