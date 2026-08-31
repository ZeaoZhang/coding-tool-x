import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ENABLED_CLI_PLATFORMS,
  MINIMAL_PLATFORM_FALLBACK,
  normalizePublicPlatform,
  normalizePublicPlatforms
} from '../platforms'
import {
  buildPlatformNavigation,
  getPlatformsByCapability,
  isPlatformEnabled,
  resolveEnabledCliPlatforms
} from '../platformCatalog'

function publicPlatform(overrides = {}) {
  return {
    key: 'demo-cli',
    label: 'Demo CLI',
    title: 'Demo CLI',
    command: 'demo',
    iconToken: 'unknown-token',
    capabilities: { channels: true, sessions: false },
    ...overrides
  }
}

describe('public platform normalization', () => {
  it('normalizes safe fields and falls back for unknown icon tokens', () => {
    const platform = normalizePublicPlatform(publicPlatform())
    expect(platform).toEqual(expect.objectContaining({
      key: 'demo-cli',
      label: 'Demo CLI',
      iconToken: 'unknown-token',
      capabilities: { channels: true, sessions: false },
      supportsProxy: false
    }))
    expect(platform.icon).toBeTruthy()
  })

  it('deduplicates platform keys and keeps the first definition', () => {
    expect(normalizePublicPlatforms([
      publicPlatform(),
      publicPlatform({ label: 'Replacement' }),
      publicPlatform({ key: 'other-cli', label: 'Other' })
    ]).map(platform => platform.label)).toEqual(['Demo CLI', 'Other'])
  })
})

describe('platform catalog selection', () => {
  const catalog = normalizePublicPlatforms([
    ...MINIMAL_PLATFORM_FALLBACK,
    publicPlatform({ capabilities: { mcp: true, prompts: false } })
  ])

  it('uses the four new defaults in canonical order', () => {
    expect(resolveEnabledCliPlatforms({ catalog })).toEqual(DEFAULT_ENABLED_CLI_PLATFORMS)
  })

  it('preserves explicit order beyond four entries', () => {
    expect(resolveEnabledCliPlatforms({
      catalog,
      enabledCliPlatforms: [' demo-cli ', 'OMP', 'claude', 'codex', 'opencode']
    })).toEqual(['demo-cli', 'omp', 'claude', 'codex', 'opencode'])
  })

  it('preserves an explicitly empty selection', () => {
    expect(resolveEnabledCliPlatforms({ catalog, enabledCliPlatforms: [] })).toEqual([])
    expect(isPlatformEnabled('claude', [])).toBe(false)
  })

  it('uses only the four safe defaults when catalog loading fails', () => {
    expect(resolveEnabledCliPlatforms({ catalog: null })).toEqual(DEFAULT_ENABLED_CLI_PLATFORMS)
    expect(buildPlatformNavigation(undefined).map(platform => platform.key)).toEqual(DEFAULT_ENABLED_CLI_PLATFORMS)
  })
  it('uses the four safe defaults for capability queries when catalog loading fails', () => {
    expect(getPlatformsByCapability(undefined, 'sessions').map(platform => platform.key)).toEqual([
      'claude', 'codex', 'opencode', 'omp'
    ])
  })
  it('filters unknown keys and supports formal manifest catalog entries', () => {
    expect(resolveEnabledCliPlatforms({
      catalog,
      enabledCliPlatforms: ['missing', 'DEMO-CLI', 'demo-cli']
    })).toEqual(['demo-cli'])
    expect(isPlatformEnabled(' DEMO-cli ', ['demo-cli'])).toBe(true)
  })

  it('filters capabilities in received catalog order', () => {
    expect(getPlatformsByCapability(catalog, 'mcp').map(platform => platform.key)).toEqual(['demo-cli'])
    expect(getPlatformsByCapability(catalog, 'sessions').map(platform => platform.key)).toEqual([
      'claude', 'codex', 'gemini', 'opencode', 'omp'
    ])
  })

  it('builds safe navigation metadata with a terminal fallback icon', () => {
    const [navigation] = buildPlatformNavigation([publicPlatform()])
    expect(navigation).toEqual(expect.objectContaining({
      key: 'demo-cli',
      label: 'Demo CLI',
      iconToken: 'terminal',
      color: '#64748b'
    }))
    expect(navigation.icon).toBeTruthy()
  })
})
