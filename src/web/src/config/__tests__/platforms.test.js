import { describe, expect, it } from 'vitest'
import {
  buildCliPlatformOptions,
  getPlatformConfig,
  normalizeHomeCliColumns,
  normalizePublicPlatform,
  normalizePublicPlatforms
} from '../platforms'

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

  it('filters duplicate home columns and fills legacy defaults', () => {
    expect(normalizeHomeCliColumns(
      ['demo-cli', 'demo-cli', 'unknown'],
      [publicPlatform()]
    )).toEqual(['demo-cli', 'claude', 'codex', 'gemini'])
  })

  it('builds options from catalog metadata and resolves unknown platforms safely', () => {
    expect(buildCliPlatformOptions([publicPlatform()])).toEqual([
      { label: 'Demo CLI', value: 'demo-cli' }
    ])
    expect(getPlatformConfig('missing-cli', [])).toEqual(expect.objectContaining({
      key: 'missing-cli',
      supportsProxy: false
    }))
  })
})
