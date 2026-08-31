import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const { getPlatforms, getUIConfig } = vi.hoisted(() => ({
  getPlatforms: vi.fn(),
  getUIConfig: vi.fn()
}))

vi.mock('../../api/platforms', () => ({ getPlatforms }))
vi.mock('../../api/ui-config', () => ({
  getUIConfig,
  saveUIConfig: vi.fn(),
  updateUIConfigKey: vi.fn(),
  updateNestedUIConfig: vi.fn()
}))

import router from '../index'

describe('CLI route guard', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    getPlatforms.mockReset()
    getUIConfig.mockReset()
    getPlatforms.mockResolvedValue([
      { key: 'alpha-cli', label: 'Alpha CLI', capabilities: { projects: true, sessions: true } },
      { key: 'beta-cli', label: 'Beta CLI', capabilities: { projects: true, sessions: true } }
    ])
    getUIConfig.mockResolvedValue({
      success: true,
      config: { enabledCliPlatforms: ['beta-cli'] }
    })
    if (router.currentRoute.value.name !== 'home') await router.push('/')
  })

  it('awaits catalog and UI selection before allowing an enabled generic platform', async () => {
    await router.push('/cli/beta-cli')

    expect(router.currentRoute.value.name).toBe('cli-projects')
    expect(router.currentRoute.value.params.platform).toBe('beta-cli')
    expect(getPlatforms).toHaveBeenCalledTimes(1)
    expect(getUIConfig).toHaveBeenCalledTimes(1)
  })

  it('redirects disabled and unknown CLI platforms before mounting the page', async () => {
    await router.push('/cli/alpha-cli')
    expect(router.currentRoute.value.name).toBe('home')

    await router.push('/cli/missing-cli')
    expect(router.currentRoute.value.name).toBe('home')
  })
})
