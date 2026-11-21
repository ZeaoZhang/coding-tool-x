import { flushPromises, shallowMount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

const { getFavorites, removeFavorite, message } = vi.hoisted(() => ({
  getFavorites: vi.fn(() => []),
  removeFavorite: vi.fn(),
  message: { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}))

vi.mock('../../composables/useFavorites', () => ({
  useFavorites: () => ({
    getFavorites,
    removeFavorite,
    getAllFavorites: () => ({})
  })
}))

vi.mock('../../stores/sessions', () => ({
  useSessionsStore: () => ({ setChannel: vi.fn(), setAlias: vi.fn(), deleteAlias: vi.fn() })
}))

vi.mock('../../composables/useResponsiveDrawer', () => ({
  useResponsiveDrawer: () => ({ drawerWidth: 720 })
}))

vi.mock('../../utils/message', () => ({ default: message }))

import FavoritesDrawer from '../FavoritesDrawer.vue'

const passthrough = { template: '<div><slot /></div>' }

describe('FavoritesDrawer empty state', () => {
  it('renders the empty state when there are no favorites', async () => {
    const wrapper = shallowMount(FavoritesDrawer, {
      props: { visible: true },
      global: {
        stubs: {
          NDrawer: passthrough,
          'n-drawer': passthrough,
          drawer: passthrough,
          'drawer-content': passthrough,
          NDrawerContent: passthrough,
          'n-drawer-content': passthrough,
          Empty: {
            props: ['description'],
            template: '<div class="empty-state">{{ description }}</div>'
          },
          empty: {
            props: ['description'],
            template: '<div class="empty-state">{{ description }}</div>'
          },
          'n-empty': {
            props: ['description'],
            template: '<div class="empty-state">{{ description }}</div>'
          },
          NModal: true,
          'n-modal': true,
          SessionCard: true
        }
      }
    })

    await flushPromises()

    expect(wrapper.find('.empty-state').exists()).toBe(true)
    expect(wrapper.text()).toContain('暂无收藏')
  })
})
