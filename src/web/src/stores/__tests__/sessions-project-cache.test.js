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

  it('ignores a late empty response from an older project request', async () => {
    let resolveOld
    let resolveCurrent
    projectApi.getProjects
      .mockImplementationOnce(() => new Promise(resolve => {
        resolveOld = resolve
      }))
      .mockImplementationOnce(() => new Promise(resolve => {
        resolveCurrent = resolve
      }))

    const store = useSessionsStore()
    store.setChannel('late-empty')
    const oldRequest = store.fetchProjects({ force: true })
    const currentRequest = store.fetchProjects({ force: true })

    resolveCurrent(projectResponse('current-project'))
    await currentRequest
    expect(store.projects[0].name).toBe('current-project')

    resolveOld({ projects: [], currentProject: null, meta: {} })
    await oldRequest
    expect(store.projects[0].name).toBe('current-project')
  })

  it('does not expose projects whose name and path are unknown', async () => {
    projectApi.getProjects.mockResolvedValue({
      projects: [
        { name: 'unknown', displayName: 'unknown', fullPath: '', sessionCount: 9 },
        { name: 'known-project', displayName: 'Known project', fullPath: '/tmp/known-project', sessionCount: 1 }
      ],
      currentProject: 'unknown',
      meta: { refreshing: false, fallback: false, stale: false }
    })

    const store = useSessionsStore()
    store.setChannel('codex')
    await store.fetchProjects()

    expect(store.projects.map(project => project.name)).toEqual(['known-project'])
    expect(store.currentProject).toBe('known-project')
  })

})

describe('session alias hydration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('derives aliases from session rows when the response has no aliases map', async () => {
    projectApi.getProjects.mockResolvedValue(projectResponse('alias-project'))
    sessionsApi.getSessions.mockResolvedValue({
      sessions: [{ sessionId: 'sess-1', projectName: 'alias-project', alias: 'Cached alias' }],
      totalSize: 1,
      projectInfo: { sessionCount: 1 },
      meta: { refreshing: false, fallback: false, stale: false },
      pagination: { page: 1, limit: 20, total: 1, hasMore: false }
    })

    const store = useSessionsStore()
    store.setChannel('codex')
    await store.fetchProjects()
    await store.fetchSessions('alias-project')

    expect(store.aliases['sess-1']).toBe('Cached alias')
    expect(store.sessionsWithAlias[0].alias).toBe('Cached alias')
  })

  it('prefers an explicit aliases map when present', async () => {
    projectApi.getProjects.mockResolvedValue(projectResponse('alias-map-project'))
    sessionsApi.getSessions.mockResolvedValue({
      sessions: [{ sessionId: 'sess-2', projectName: 'alias-map-project', alias: 'row alias' }],
      aliases: { 'sess-2': 'map alias' },
      totalSize: 1,
      projectInfo: { sessionCount: 1 },
      meta: { refreshing: false, fallback: false, stale: false },
      pagination: { page: 1, limit: 20, total: 1, hasMore: false }
    })

    const store = useSessionsStore()
    store.setChannel('codex')
    await store.fetchProjects()
    await store.fetchSessions('alias-map-project')

    expect(store.aliases['sess-2']).toBe('map alias')
  })
})

describe('session list first paint', () => {
  function sessionsResponse(overrides = {}) {
    return {
      sessions: [],
      totalSize: 0,
      projectInfo: { sessionCount: 0 },
      meta: { refreshing: false, fallback: false, stale: false },
      pagination: { page: 1, limit: 20, total: 0, hasMore: false },
      ...overrides
    }
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('waits for a session response even while the projects list is refreshing', async () => {
    let resolveSessions
    projectApi.getProjects.mockResolvedValue(projectResponse('poll-project'))
    sessionsApi.getSessions.mockImplementationOnce(() => new Promise(resolve => {
      resolveSessions = resolve
    }))

    const store = useSessionsStore()
    store.setChannel('poll-channel')
    await store.fetchProjects()

    const pending = store.fetchSessions('poll-project')

    // A silent project poll finishes while the session read is in flight.
    projectApi.getProjects.mockResolvedValue(projectResponse('poll-project'))
    await store.fetchProjects({ silent: true })

    resolveSessions(sessionsResponse({
      sessions: [{ sessionId: 'sess-poll', projectName: 'poll-project' }],
      totalSize: 12,
      pagination: { page: 1, limit: 20, total: 1, hasMore: false }
    }))
    await pending

    expect(store.sessions.map(session => session.sessionId)).toEqual(['sess-poll'])
    expect(store.currentProject).toBe('poll-project')
  })

  it('drops a session response superseded by a newer project selection', async () => {
    let resolveOld
    projectApi.getProjects.mockResolvedValue({
      projects: [
        { name: 'first-project', displayName: 'first-project', fullPath: '/tmp/first-project' },
        { name: 'second-project', displayName: 'second-project', fullPath: '/tmp/second-project' }
      ],
      currentProject: 'first-project',
      meta: { refreshing: false, fallback: false, stale: false }
    })
    sessionsApi.getSessions
      .mockImplementationOnce(() => new Promise(resolve => {
        resolveOld = resolve
      }))
      .mockResolvedValueOnce(sessionsResponse({
        sessions: [{ sessionId: 'sess-second', projectName: 'second-project' }]
      }))

    const store = useSessionsStore()
    store.setChannel('switch-channel')
    await store.fetchProjects()

    const oldRequest = store.fetchSessions('first-project')
    await store.fetchSessions('second-project')

    resolveOld(sessionsResponse({
      sessions: [{ sessionId: 'sess-first', projectName: 'first-project' }]
    }))
    await oldRequest

    expect(store.sessions.map(session => session.sessionId)).toEqual(['sess-second'])
    expect(store.currentProject).toBe('second-project')
  })

  it('drops a late response when a cached project replaced the selection', async () => {
    let resolveOld
    projectApi.getProjects.mockResolvedValue({
      projects: [
        { name: 'cached-first', displayName: 'cached-first', fullPath: '/tmp/cached-first' },
        { name: 'cached-second', displayName: 'cached-second', fullPath: '/tmp/cached-second' }
      ],
      currentProject: 'cached-first',
      meta: { refreshing: false, fallback: false, stale: false }
    })
    sessionsApi.getSessions
      .mockResolvedValueOnce(sessionsResponse({
        sessions: [{ sessionId: 'sess-second', projectName: 'cached-second' }]
      }))
      .mockImplementationOnce(() => new Promise(resolve => {
        resolveOld = resolve
      }))

    const store = useSessionsStore()
    store.setChannel('cached-switch')
    await store.fetchProjects()

    await store.fetchSessions('cached-second')
    const oldRequest = store.fetchSessions('cached-first')
    // The second visit is answered from cache, so no network guard runs; the
    // first project's in-flight response must still be dropped.
    await store.fetchSessions('cached-second')

    resolveOld(sessionsResponse({
      sessions: [{ sessionId: 'sess-first', projectName: 'cached-first' }]
    }))
    await oldRequest

    expect(store.currentProject).toBe('cached-second')
    expect(store.sessions.map(session => session.sessionId)).toEqual(['sess-second'])
  })

  it('reports pending while the list is empty and no meta has arrived', async () => {
    const store = useSessionsStore()
    store.setChannel('pending-channel')

    expect(store.sessions).toEqual([])
    expect(store.sessionsMeta).toBeNull()
    expect(store.sessionsPending).toBe(true)
  })

  it('keeps polling instead of serving a placeholder as final', async () => {
    projectApi.getProjects.mockResolvedValue(projectResponse('placeholder-project'))
    sessionsApi.getSessions
      .mockResolvedValueOnce(sessionsResponse({ meta: { refreshing: true } }))
      .mockResolvedValue(sessionsResponse({
        sessions: [{ sessionId: 'sess-ready', projectName: 'placeholder-project' }],
        meta: { refreshing: false, fallback: false, stale: false }
      }))

    const store = useSessionsStore()
    store.setChannel('placeholder-channel')
    await store.fetchProjects()
    await store.fetchSessions('placeholder-project')

    expect(store.sessionsMeta.refreshing).toBe(true)
    expect(store.sessionsPending).toBe(true)

    // A second visit reuses the cache but must keep polling the backend.
    await store.fetchSessions('placeholder-project')
    await vi.waitFor(() => {
      expect(sessionsApi.getSessions).toHaveBeenCalledTimes(2)
      expect(store.sessionsMeta?.refreshing).toBe(false)
    }, { timeout: 4000 })
    expect(store.sessions.map(session => session.sessionId)).toEqual(['sess-ready'])
  })
})
