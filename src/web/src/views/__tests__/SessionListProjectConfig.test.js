import { beforeEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const store = vi.hoisted(() => ({
  projects: [{ name: 'project-display-name', displayName: 'Project', fullPath: '/tmp/project' }],
  currentProjectInfo: { displayName: 'Project', fullPath: '/tmp/project' },
  sessions: [],
  sessionsWithAlias: [],
  totalSize: 0,
  loading: false,
  error: null,
  sessionsPending: false,
  currentProject: 'project-display-name',
  fetchProjects: vi.fn(async () => {}),
  fetchSessions: vi.fn(async () => {}),
  setChannel: vi.fn(async () => {}),
  saveSessionOrder: vi.fn(async () => {}),
  deleteSession: vi.fn(async () => {}),
  deleteSessions: vi.fn(async () => {})
}))

vi.mock('../../stores/sessions', () => ({
  useSessionsStore: () => store
}))

vi.mock('../../composables/useFavorites', () => ({
  useFavorites: () => ({
    addFavorite: vi.fn(),
    removeFavorite: vi.fn(),
    isFavorite: vi.fn(() => false)
  })
}))

vi.mock('../../api/sessions', () => ({
  searchSessions: vi.fn(async () => ({ sessions: [] })),
  copySessionLaunchCommand: vi.fn(async () => ({ copyResult: { method: 'clipboard' } })),
  getSessionOutline: vi.fn(async () => ({ items: [] }))
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ meta: { channel: 'codex' } }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() })
}))

vi.mock('../../utils/message', () => ({
  default: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  dialog: { warning: vi.fn() }
}))

import SessionList from '../SessionList.vue'

beforeEach(() => {
  store.projects = [{ name: 'project-display-name', displayName: 'Project', fullPath: '/tmp/project' }]
  store.sessions = []
  store.sessionsWithAlias = []
  store.currentProjectInfo = { displayName: 'Project', fullPath: '/tmp/project' }
})

it('passes the full project path to the project configuration drawer', async () => {
  const drawerStub = {
    name: 'ProjectConfigDrawer',
    props: ['show', 'projectPath', 'platform'],
    template: '<div data-testid="project-config-drawer" />'
  }
  const wrapper = mount(SessionList, {
    props: { projectName: 'project-display-name' },
    global: {
      stubs: {
        draggable: { template: '<div><slot /></div>' },
        ChatHistoryDrawer: true,
        ProjectConfigDrawer: drawerStub
      }
    }
  })

  await wrapper.vm.$nextTick()
  const drawer = wrapper.findComponent(drawerStub)
  expect(drawer.props('projectPath')).toBe('/tmp/project')
  expect(drawer.props('projectPath')).not.toBe('project-display-name')
})

it('shows the project display name and full path when the session payload has no project info', async () => {
  store.currentProjectInfo = null
  store.projects = [{
    name: '----Users--zhangzeao--workspace--open-design--',
    displayName: 'open-design',
    fullPath: '/Users/zhangzeao/workspace/open-design'
  }]
  const drawerStub = {
    name: 'ProjectConfigDrawer',
    props: ['show', 'projectPath', 'platform'],
    template: '<div data-testid="project-config-drawer" />'
  }
  const wrapper = mount(SessionList, {
    props: { projectName: '----Users--zhangzeao--workspace--open-design--' },
    global: {
      stubs: {
        draggable: { template: '<div><slot /></div>' },
        ChatHistoryDrawer: true,
        ProjectConfigDrawer: drawerStub
      }
    }
  })

  await wrapper.vm.$nextTick()

  expect(wrapper.find('.title-section h2').text()).toBe('open-design')
  expect(wrapper.find('.project-path').text()).toBe('/Users/zhangzeao/workspace/open-design')
  expect(wrapper.findComponent(drawerStub).props('projectPath'))
    .toBe('/Users/zhangzeao/workspace/open-design')
})

it('does not pass a relative project name to project configuration', async () => {
  store.currentProjectInfo = null
  store.projects = [{ name: 'project-name', displayName: 'Project', fullPath: '' }]
  const drawerStub = {
    name: 'ProjectConfigDrawer',
    props: ['show', 'projectPath', 'platform'],
    template: '<div data-testid="project-config-drawer" />'
  }
  const wrapper = mount(SessionList, {
    props: { projectName: 'project-name' },
    global: {
      stubs: {
        draggable: { template: '<div><slot /></div>' },
        ChatHistoryDrawer: true,
        ProjectConfigDrawer: drawerStub
      }
    }
  })

  await wrapper.vm.$nextTick()

  expect(wrapper.findComponent(drawerStub).props('projectPath')).toBe('')
})
