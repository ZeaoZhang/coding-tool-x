import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const { getPlatforms, uiConfig } = vi.hoisted(() => ({ getPlatforms: vi.fn(), uiConfig: { value: { enabledCliPlatforms: [] } } }))
vi.mock('../../api/platforms', () => ({ getPlatforms }))
vi.mock('../../composables/useUIConfig', () => ({ useUIConfig: () => ({ uiConfig }) }))

import { usePlatformStore } from '../platforms'

describe('platform store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    uiConfig.value = { enabledCliPlatforms: [] }
    getPlatforms.mockReset()
  })

  it('loads and exposes public platform metadata', async () => {
    const store = usePlatformStore()
    store.fetchPlatforms = async () => ([{
      key: 'demo-cli',
      label: 'Demo CLI',
      iconToken: 'terminal',
      capabilities: { channels: true }
    }])

    await store.load()

    expect(store.get('demo-cli').label).toBe('Demo CLI')
    expect(store.hasCapability('demo-cli', 'channels')).toBe(true)
  })
  it('returns selected catalog platforms in configured order including default-hidden entries', () => {
    const store = usePlatformStore()
    store.platforms = [
      { key: 'claude', label: 'Claude', defaultVisible: true },
      { key: 'omp', label: 'OMP', defaultVisible: false },
      { key: 'codex', label: 'Codex', defaultVisible: true }
    ]
    uiConfig.value = { enabledCliPlatforms: ['unknown', 'OMP', 'omp', 'codex'] }

    expect(store.enabled.map(platform => platform.key)).toEqual(['omp', 'codex'])
  })

  it('keeps an explicitly empty selection empty', () => {
    const store = usePlatformStore()
    store.platforms = [{ key: 'claude', label: 'Claude', defaultVisible: true }]
    uiConfig.value = { enabledCliPlatforms: [] }

    expect(store.enabled).toEqual([])
  })

  it('deduplicates concurrent loads and retains the last success on failure', async () => {
    const store = usePlatformStore()
    getPlatforms.mockResolvedValue([{ key: 'demo-cli', label: 'Demo CLI', capabilities: {} }])

    const first = store.load()
    const second = store.load()
    await Promise.all([first, second])
    expect(getPlatforms).toHaveBeenCalledTimes(1)

    getPlatforms.mockRejectedValue(new Error('offline'))
    await store.load({ force: true })
    expect(store.get('demo-cli').label).toBe('Demo CLI')
    expect(store.error).toBeInstanceOf(Error)
  })
  it('settles failed initial loads without refetching until forced', async () => {
    const store = usePlatformStore()
    getPlatforms.mockRejectedValue(new Error('offline'))

    await store.load()
    await store.load()
    expect(getPlatforms).toHaveBeenCalledTimes(1)
    expect(store.loaded).toBe(true)

    getPlatforms.mockResolvedValue([{ key: 'demo-cli', label: 'Demo CLI', capabilities: {} }])
    await store.load({ force: true })
    expect(getPlatforms).toHaveBeenCalledTimes(2)
    expect(store.get('demo-cli').label).toBe('Demo CLI')
  })
  it('does not expose Gemini from the fallback catalog after an initial load failure', async () => {
    const store = usePlatformStore()
    getPlatforms.mockRejectedValue(new Error('offline'))
    uiConfig.value = { enabledCliPlatforms: ['gemini'] }

    await store.load()

    expect(store.enabled.map(platform => platform.key)).toEqual([])
  })
})
