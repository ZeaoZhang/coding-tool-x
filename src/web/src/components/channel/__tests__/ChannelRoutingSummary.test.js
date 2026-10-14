import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ChannelRoutingSummary from '../ChannelRoutingSummary.vue'

describe('ChannelRoutingSummary', () => {
  it('shows each model route with its channels and shared live concurrency', () => {
    const wrapper = mount(ChannelRoutingSummary, {
      props: {
        summary: {
          groups: [{
            routingGroup: 'main',
            providerKey: 'openai-main',
            providerApi: 'openai-responses',
            channels: [
              { id: 'fast', name: 'Fast' },
              { id: 'backup', name: 'Backup' },
              { id: 'any', name: 'Any model' }
            ],
            unrestrictedChannelIds: ['any'],
            models: [
              { id: 'gpt-5', channelIds: ['fast', 'backup'] },
              { id: 'gpt-5-mini', channelIds: ['fast'] }
            ]
          }]
        },
        channels: [
          { id: 'fast', name: 'Fast', maxConcurrency: 4 },
          { id: 'backup', name: 'Backup', maxConcurrency: null },
          { id: 'any', name: 'Any model', maxConcurrency: 2 }
        ],
        getChannelInflight: vi.fn(channelId => channelId === 'fast' ? 2 : 1)
      }
    })

    expect(wrapper.text()).toContain('gpt-5')
    expect(wrapper.text()).toContain('gpt-5-mini')
    expect(wrapper.text()).toContain('Fast')
    expect(wrapper.text()).toContain('Backup')
    expect(wrapper.text()).toContain('Any model')
    expect(wrapper.text()).toContain('并发 2/4')
    expect(wrapper.text()).toContain('并发 1/不限')
    expect(wrapper.text()).toContain('额度由其所有模型共享')
  })
})
