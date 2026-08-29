import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const { getPlatforms } = vi.hoisted(() => ({ getPlatforms: vi.fn() }))
vi.mock('../../api/platforms', () => ({ getPlatforms }))

import { usePlatformStore } from '../platforms'

describe('platform store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
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
})
