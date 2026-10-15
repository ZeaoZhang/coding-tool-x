import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const { axiosGet, axiosPost, axiosCreate, enabledKeys, catalog, baseApiRoutes } = vi.hoisted(() => {
  const apiRoutes = [
    { capability: 'channels', operation: 'list', path: '/channels' },
    { capability: 'proxy', operation: 'status', path: '/proxy/status' },
    { capability: 'proxy', operation: 'start', path: '/proxy/start' },
    { capability: 'proxy', operation: 'stop', path: '/proxy/stop' }
  ]
  return {
    axiosGet: vi.fn(),
    axiosPost: vi.fn(),
    axiosCreate: vi.fn(() => ({
      get: vi.fn(),
      post: vi.fn(),
      interceptors: { response: { use: vi.fn() } }
    })),
    enabledKeys: { value: ['alpha-cli', 'beta-cli'] },
    catalog: { value: [
      {
        key: 'alpha-cli',
        capabilities: { proxy: true, channels: true },
        apiRoutes: apiRoutes.map(route => ({ ...route }))
      },
      {
        key: 'beta-cli',
        capabilities: { proxy: true, channels: true },
        apiRoutes: apiRoutes.map(route => ({ ...route }))
      },
      {
        key: 'no-proxy-cli',
        capabilities: { channels: true },
        apiRoutes: apiRoutes.map(route => ({ ...route }))
      }
    ] },
    baseApiRoutes: apiRoutes
  }
})

vi.mock('axios', () => ({
  default: { create: axiosCreate, get: axiosGet, post: axiosPost }
}))
vi.mock('../../composables/useEnabledCliPlatforms', () => ({
  useEnabledCliPlatforms: () => ({
    catalog,
    enabledKeys,
    getPlatform: key => catalog.value.find(platform => platform.key === key) || null
  })
}))
vi.mock('../../api/platforms', () => ({
  getPlatformRouteUrl: vi.fn(async (platform, capability, operation) => {
    const definition = catalog.value.find(item => item.key === platform)
    const route = definition?.apiRoutes?.find(item => (
      item.capability === capability && item.operation === operation
    ))
    if (!route) throw new Error(`Unsupported ${platform} ${capability} operation: ${operation}`)
    return `/platforms/${platform}${route.path}`
  })
}))

import { useGlobalStore } from '../global'

function responseFor(url) {
  if (url.endsWith('/proxy/status')) {
    return { data: { proxy: { running: url.includes('alpha') } } }
  }
  return { data: { channels: [{ name: `${url}-channel` }] } }
}

describe('global keyed platform requests', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    enabledKeys.value = ['alpha-cli', 'beta-cli']
    catalog.value.forEach(platform => {
      platform.apiRoutes = baseApiRoutes.map(route => ({ ...route }))
    })
    axiosGet.mockReset()
    axiosPost.mockReset()
    axiosGet.mockImplementation(async url => responseFor(url))
  })

  it('fans proxy and channel requests out to every enabled generic platform', async () => {
    const store = useGlobalStore()

    await store.initializeState()
    await store.loadChannels()

    expect(axiosGet.mock.calls.map(([url]) => url)).toEqual([
      '/api/platforms/alpha-cli/proxy/status',
      '/api/platforms/beta-cli/proxy/status',
      '/api/platforms/alpha-cli/channels',
      '/api/platforms/beta-cli/channels'
    ])
    expect(store.getProxyState('alpha-cli').value.running).toBe(true)
    expect(store.getChannels('beta-cli').value).toHaveLength(1)
  })

  it('does not request capabilities that an enabled platform does not declare', async () => {
    enabledKeys.value = ['alpha-cli', 'no-proxy-cli']
    const store = useGlobalStore()

    await store.initializeState()
    await store.loadChannels()

    expect(axiosGet.mock.calls.map(([url]) => url)).toEqual([
      '/api/platforms/alpha-cli/proxy/status',
      '/api/platforms/alpha-cli/channels',
      '/api/platforms/no-proxy-cli/channels'
    ])
  })

  it('loads scheduler state only when the platform manifest declares that route', async () => {
    catalog.value[0].apiRoutes.push({
      capability: 'channels',
      operation: 'poolStatus',
      path: '/channels/pool/status'
    })
    const store = useGlobalStore()

    await store.loadChannels()

    expect(axiosGet.mock.calls.map(([url]) => url)).toContain(
      '/api/platforms/alpha-cli/channels/pool/status'
    )
    expect(axiosGet.mock.calls.map(([url]) => url)).not.toContain(
      '/api/platforms/beta-cli/channels/pool/status'
    )
  })

  it('does not request or hydrate hidden platform state', async () => {
    enabledKeys.value = ['alpha-cli']
    const store = useGlobalStore()

    await store.initializeState()
    await store.loadChannels()

    expect(axiosGet.mock.calls.map(([url]) => url)).toEqual([
      '/api/platforms/alpha-cli/proxy/status',
      '/api/platforms/alpha-cli/channels'
    ])

    store.handleProxyStateUpdate({
      type: 'proxy-state',
      source: 'beta-cli',
      proxy: { running: true },
      channels: [{ id: 'hidden', name: 'Hidden' }]
    })
    store.handleProxyStateUpdate({
      type: 'proxy-state',
      source: 'missing-cli',
      proxy: { running: true }
    })

    expect(store.getProxyState('beta-cli').value.running).toBe(false)
    expect(store.getChannels('missing-cli')).toBeNull()
  })
})
