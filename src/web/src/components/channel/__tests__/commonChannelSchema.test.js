import { describe, expect, it, vi } from 'vitest'
import { commonChannelSchema, createGenericChannelPanel, validateCommonChannel } from '../commonChannelSchema'

describe('common channel schema', () => {
  it('contains shared endpoint, auth, and schedule fields', () => {
    expect(commonChannelSchema.endpoint.map(field => field.key)).toEqual(['baseUrl', 'websiteUrl'])
    expect(commonChannelSchema.auth.map(field => field.key)).toEqual(['authMode', 'apiKey'])
    expect(commonChannelSchema.schedule.map(field => field.key)).toEqual(['maxConcurrency', 'weight', 'enabled'])
  })

  it('creates a generic panel using manifest metadata and injected API', () => {
    const api = { fetch: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() }
    const panel = createGenericChannelPanel({ key: 'demo-cli', label: 'Demo CLI' }, api)

    expect(panel).toEqual(expect.objectContaining({
      type: 'demo-cli',
      displayName: 'Demo CLI',
      schedulerSource: 'demo-cli',
      api
    }))
    expect(panel.getInitialForm()).toEqual(expect.objectContaining({ enabled: true, weight: 1 }))
    expect(panel.mapChannelToForm({ id: 'demo-1', name: 'Demo', baseUrl: 'https://demo.test', enabled: false }))
      .toEqual(expect.objectContaining({ id: 'demo-1', name: 'Demo', baseUrl: 'https://demo.test', enabled: false }))
    expect(panel.formSections).toHaveLength(3)
    expect(panel.getHeaderTags({ health: { status: 'checking' } })).toEqual([
      { text: '检测中', type: 'warning' }
    ])
    expect(panel.buildInfoRows({ baseUrl: 'https://demo.test', authMode: 'none' })[1].value).toBe('无需认证')
  })

  it('validates the required endpoint field', () => {
    expect(validateCommonChannel({})).toEqual({ baseUrl: 'Base URL 不能为空' })
    expect(validateCommonChannel({ baseUrl: 'https://demo.test' })).toEqual({})
  })
})
