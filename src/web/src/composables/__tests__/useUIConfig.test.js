import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getUIConfig } = vi.hoisted(() => ({ getUIConfig: vi.fn() }))
vi.mock('../../api/ui-config', () => ({
  getUIConfig,
  saveUIConfig: vi.fn(),
  updateUIConfigKey: vi.fn(),
  updateNestedUIConfig: vi.fn()
}))

import { useUIConfig } from '../useUIConfig'

describe('useUIConfig', () => {
  beforeEach(() => {
    getUIConfig.mockReset()
  })

  it('settles a failed initial load and retries only when forced', async () => {
    getUIConfig.mockRejectedValueOnce(new Error('offline'))
    const { loadUIConfig } = useUIConfig()

    await loadUIConfig()
    await loadUIConfig()
    expect(getUIConfig).toHaveBeenCalledTimes(1)

    getUIConfig.mockResolvedValueOnce({ success: true, config: { enabledCliPlatforms: ['omp'] } })
    await loadUIConfig({ force: true })
    expect(getUIConfig).toHaveBeenCalledTimes(2)
  })
})
