import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../useUIConfig', () => ({
  useUIConfig: () => ({ uiConfig: ref({ enabledCliPlatforms: [] }) })
}))

import { useEnabledCliPlatforms } from '../useEnabledCliPlatforms'

function createStore(platforms) {
  return { all: platforms }
}

describe('useEnabledCliPlatforms', () => {
  it('preserves an empty selection and an arbitrary ordered selection', () => {
    const configRef = ref({ enabledCliPlatforms: [] })
    const platformStore = createStore([
      { key: 'alpha', label: 'Alpha' },
      { key: 'beta', label: 'Beta' },
      { key: 'gamma', label: 'Gamma' },
      { key: 'delta', label: 'Delta' },
      { key: 'epsilon', label: 'Epsilon' }
    ])
    const seam = useEnabledCliPlatforms({ platformStore, configRef })

    expect(seam.enabledKeys.value).toEqual([])
    configRef.value.enabledCliPlatforms = ['gamma', 'epsilon', 'alpha', 'beta', 'delta']
    expect(seam.enabledKeys.value).toEqual(['gamma', 'epsilon', 'alpha', 'beta', 'delta'])
    expect(seam.enabledPlatforms.value.map(platform => platform.key)).toEqual([
      'gamma', 'epsilon', 'alpha', 'beta', 'delta'
    ])
  })

  it('queries enabled resource capabilities from catalog metadata', () => {
    const seam = useEnabledCliPlatforms({
      platformStore: createStore([
        { key: 'generic', capabilities: { channels: true }, resourceTypes: { skills: true } },
        { key: 'hidden', capabilities: { channels: true }, resourceTypes: { skills: true } }
      ]),
      configRef: ref({ enabledCliPlatforms: ['generic'] })
    })

    expect(seam.byCapability('skills').map(platform => platform.key)).toEqual(['generic'])
    expect(seam.byCapability('channels').map(platform => platform.key)).toEqual(['generic'])
    expect(seam.getPlatform('unknown')).toBeNull()
  })
})
