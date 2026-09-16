import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const projectApi = vi.hoisted(() => ({
  getProjects: vi.fn(),
  saveProjectOrder: vi.fn(),
  deleteProject: vi.fn()
}))

const sessionsApi = vi.hoisted(() => ({
  getSessions: vi.fn(),
  setAlias: vi.fn(),
  deleteAlias: vi.fn(),
  deleteSession: vi.fn(),
  deleteSessions: vi.fn(),
  forkSession: vi.fn(),
  saveSessionOrder: vi.fn()
}))

vi.mock('../../api/projects', () => projectApi)
vi.mock('../../api/sessions', () => sessionsApi)

import { useSessionsStore } from '../sessions'

function projectResponse(name) {
  return {
    projects: [{ name, displayName: name, fullPath: `/tmp/${name}` }],
    currentProject: name,
    meta: { refreshing: false, fallback: false, stale: false }
  }
}

describe('sessions project cache', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('restores a recently loaded channel without refetching its project list', async () => {
    projectApi.getProjects
      .mockResolvedValueOnce(projectResponse('cache-a-project'))
      .mockResolvedValueOnce(projectResponse('cache-b-project'))

    const store = useSessionsStore()
    store.setChannel('cache-a')
    await store.fetchProjects()
    store.setChannel('cache-b')
    await store.fetchProjects()

    store.setChannel('cache-a')
    await store.fetchProjects()

    expect(projectApi.getProjects).toHaveBeenCalledTimes(2)
    expect(store.projects[0].name).toBe('cache-a-project')
  })

  it('shares an in-flight project request between overlapping route watchers', async () => {
    let resolveRequest
    projectApi.getProjects.mockReturnValue(new Promise(resolve => {
      resolveRequest = resolve
    }))

    const store = useSessionsStore()
    store.setChannel('dedupe')
    const first = store.fetchProjects()
    const second = store.fetchProjects()

    await Promise.resolve()
    expect(projectApi.getProjects).toHaveBeenCalledTimes(1)

    resolveRequest(projectResponse('deduped-project'))
    await Promise.all([first, second])
    expect(store.projects[0].name).toBe('deduped-project')
  })
})
