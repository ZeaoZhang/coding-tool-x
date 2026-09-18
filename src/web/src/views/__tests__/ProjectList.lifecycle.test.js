import { nextTick, reactive } from 'vue'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const route = reactive({
  params: { platform: 'old-channel' },
  name: 'cli-projects',
  path: '/cli/old-channel'
})

const router = {
  push: vi.fn(),
  replace: vi.fn()
}

const store = {
  projects: [],
  currentProject: null,
  projectsPagination: { page: 1, limit: 20, total: 0, hasMore: false },
  loading: false,
  error: null,
  setChannel: vi.fn(),
  fetchProjects: vi.fn().mockResolvedValue(undefined),
  pauseProjectRefresh: vi.fn()
}

vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => router
}))

vi.mock('../../stores/sessions', () => ({
  useSessionsStore: () => store
}))

vi.mock('../../stores/platforms', () => ({
  usePlatformStore: () => ({ get: vi.fn() })
}))

vi.mock('../../api/projects', () => ({
  getProjects: vi.fn()
}))

vi.mock('../../api/sessions', () => ({
  searchSessionsGlobally: vi.fn(),
  copySessionLaunchCommand: vi.fn()
}))

vi.mock('../../utils/clipboard', () => ({
  copyTextToClipboard: vi.fn()
}))

vi.mock('../../utils/message', () => ({
  default: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
  dialog: { warning: vi.fn() }
}))

const passthrough = { template: '<div><slot /></div>' }
const buttonStub = { emits: ['click'], template: '<button @click="$emit(\'click\')"><slot /></button>' }

describe('ProjectList route lifecycle', () => {
  beforeEach(() => {
    route.params.platform = 'old-channel'
    route.name = 'cli-projects'
    route.path = '/cli/old-channel'
    store.setChannel.mockReset()
    store.fetchProjects.mockReset().mockResolvedValue(undefined)
    store.pauseProjectRefresh.mockReset()
    router.push.mockReset()
    router.replace.mockReset()
  })

  it('pauses the channel that was mounted, not the channel from the next route', async () => {
    const { default: ProjectList } = await import('../ProjectList.vue')
    const wrapper = shallowMount(ProjectList, {
      global: {
        stubs: {
          NH2: passthrough,
          NText: passthrough,
          NSpin: passthrough,
          NAlert: passthrough,
          NEmpty: passthrough,
          NIcon: passthrough,
          NInput: passthrough,
          NModal: passthrough,
          NButton: buttonStub,
          NTag: passthrough,
          NSpace: passthrough,
          NPagination: passthrough,
          NSelect: passthrough,
          ProjectCard: passthrough
        }
      }
    })

    route.params.platform = 'next-channel'
    await nextTick()
    await flushPromises()
    wrapper.unmount()

    expect(store.pauseProjectRefresh).toHaveBeenCalledWith('old-channel')
  })
})
