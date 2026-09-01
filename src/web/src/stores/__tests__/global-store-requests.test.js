import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const { axiosGet, axiosPost, axiosCreate, enabledKeys, catalog } = vi.hoisted(() => ({
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
      capabilities: { proxy: true, channels: true }
    },
    {
      key: 'beta-cli',
      capabilities: { proxy: true, channels: true }
    },
    {
      key: 'no-proxy-cli',
      capabilities: { channels: true }
    }
  ] }
}))

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
