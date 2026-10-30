import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn()
}))

vi.mock('../client', () => ({
  client: mocks,
  normalizePlatformKey: value => String(value || '').trim().toLowerCase()
}))

import {
  callPlatformRoute,
  clearPlatformRouteCache,
  getPlatformRouteUrl,
  getPlatformChannels,
  syncCurrentDshChannel,
  fetchDshModelsFromConfig,
  updatePlatformChannel
} from '../channels'

const apiRoutes = [
  { method: 'GET', path: '/channels', capability: 'channels', operation: 'list' },
  { method: 'POST', path: '/channels/sync-now', capability: 'channels', operation: 'sync' },
  { method: 'POST', path: '/channels/models', capability: 'channels', operation: 'modelsFromConfig' },
  { method: 'PUT', path: '/channels/:channelId', capability: 'channels', operation: 'update' },
  { method: 'GET', path: '/channels/scheduler', capability: 'channels', operation: 'poolStatus' },
  { method: 'GET', path: '/projects', capability: 'projects', operation: 'listProjects' },
  { method: 'GET', path: '/sessions/:projectName', capability: 'sessions', operation: 'listSessions' },
  { method: 'GET', path: '/config/auth-providers', capability: 'api', operation: 'getConfigAuthProviders' }
]

beforeEach(() => {
  vi.clearAllMocks()
  clearPlatformRouteCache()
  mocks.get.mockImplementation(async url => {
    if (url === '/platforms') {
      return { data: { platforms: [{ key: 'dsh', apiRoutes }] } }
    }
    return { data: { ok: true } }
  })
  mocks.post.mockResolvedValue({ data: { ok: true } })
  mocks.put.mockResolvedValue({ data: { ok: true } })
})

it('dispatches channel listing through the route advertised by the platform catalog', async () => {
  await getPlatformChannels('DSH')

  expect(mocks.get).toHaveBeenNthCalledWith(1, '/platforms')
  expect(mocks.get).toHaveBeenNthCalledWith(2, '/platforms/dsh/channels', undefined)
})

it('uses the DSH manifest route to discover models before a channel is saved', async () => {
  await fetchDshModelsFromConfig({
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'secret',
    providerApi: 'openai-completions'
  }, { forceRefresh: true })

  expect(mocks.post).toHaveBeenCalledWith('/platforms/dsh/channels/models', {
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'secret',
    providerApi: 'openai-completions',
    forceRefresh: true
  }, undefined)
})

it('uses configured operation paths and safely encodes route parameters', async () => {
  await syncCurrentDshChannel()
  await updatePlatformChannel('dsh', 'id/with space', { enabled: false })

  expect(mocks.post).toHaveBeenCalledWith('/platforms/dsh/channels/sync-now', {}, undefined)
  expect(mocks.put).toHaveBeenCalledWith(
    '/platforms/dsh/channels/id%2Fwith%20space',
    { enabled: false },
    undefined
  )
})

it('resolves manifest routes for request lifecycles managed by callers', async () => {
  await expect(getPlatformRouteUrl('dsh', 'channels', 'poolStatus')).resolves.toBe(
    '/platforms/dsh/channels/scheduler'
  )
})

it('supports routes outside channels through the same manifest-backed adapter', async () => {
  await callPlatformRoute('dsh', 'api', 'getConfigAuthProviders', { query: { forceRefresh: 'true' } })

  expect(mocks.get).toHaveBeenLastCalledWith('/platforms/dsh/config/auth-providers', {
    params: { forceRefresh: 'true' }
  })
})

it('loads projects and sessions from each platform manifest route', async () => {
  const { getPlatformProjects, getPlatformSessions } = await import('../platforms')

  await getPlatformProjects('dsh', { page: 2, q: 'work', fresh: true })
  await getPlatformSessions('dsh', 'folder/project name', { limit: 10 })

  expect(mocks.get).toHaveBeenNthCalledWith(2, '/platforms/dsh/projects', {
    params: { page: 2, q: 'work', fresh: '1' }
  })
  expect(mocks.get).toHaveBeenNthCalledWith(3, '/platforms/dsh/sessions/folder%2Fproject%20name', {
    params: { limit: 10 }
  })
})

it('fails clearly when a platform does not declare the requested operation', async () => {
  await expect(callPlatformRoute('dsh', 'channels', 'resetHealth')).rejects.toThrow(
    'Unsupported dsh channels operation: resetHealth'
  )
})
