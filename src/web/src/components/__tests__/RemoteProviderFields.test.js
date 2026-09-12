import { shallowMount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import RemoteProviderFields from '../RemoteProviderFields.vue'

describe('RemoteProviderFields', () => {
  it('renders descriptor fields and applies visibleWhen conditions', async () => {
    const provider = {
      type: 'dingtalkBot',
      config: {
        mode: 'webhook',
        clientId: '',
        clientSecret: '',
        targetType: 'group',
        targetId: '',
        webhookUrl: ''
      }
    }
    const definition = {
      type: 'dingtalkBot',
      fields: [
        { key: 'mode', label: 'Mode', type: 'select', options: [{ label: 'Webhook', value: 'webhook' }, { label: 'App', value: 'app' }] },
        { key: 'clientSecret', label: 'Secret', type: 'secret', visibleWhen: { key: 'mode', equals: 'app' } },
        { key: 'webhookUrl', label: 'Webhook', type: 'input', wide: true, visibleWhen: { key: 'mode', equals: 'webhook' } }
      ]
    }
    const wrapper = shallowMount(RemoteProviderFields, {
      props: { provider, definition }
    })

    expect(wrapper.findAll('.remote-field')).toHaveLength(3)
    expect(wrapper.findAll('select-stub')).toHaveLength(1)
    expect(wrapper.findAll('input-stub')).toHaveLength(2)
    expect(wrapper.findAll('.remote-field')[1].attributes('style')).toContain('display: none')

    await wrapper.setProps({
      provider: { ...provider, config: { ...provider.config, mode: 'app' } }
    })
    expect(wrapper.findAll('.remote-field')[1].attributes('style')).not.toContain('display: none')
    expect(wrapper.findAll('.remote-field')[2].attributes('style')).toContain('display: none')
  })
})
