import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('naive-ui', () => ({
  NTag: { inheritAttrs: true, template: '<span v-bind="$attrs"><slot /></span>' },
  NButton: { template: '<button><slot /></button>' },
  NIcon: { template: '<span><slot /></span>' },
  NText: { template: '<span><slot /></span>' },
  NSwitch: { template: '<button><slot /></button>' }
}))

import ChannelCard from '../ChannelCard.vue'

describe('ChannelCard OAuth balance', () => {
  it('renders the OAuth label, window details and refresh event', async () => {
    const wrapper = mount(ChannelCard, {
      props: {
        channel: { id: 'codex-oauth', name: 'Codex OAuth', enabled: true },
        balance: {
          visible: true,
          kind: 'oauth-quota',
          label: '5h 剩余 80% · 7d 剩余 60%',
          windows: [
            { id: 'primary', label: '5h', remainingPercent: 80, resetsAt: '2026-09-17T10:00:00.000Z' },
            { id: 'secondary', label: '7d', remainingPercent: 60, resetsAt: '2026-09-20T10:00:00.000Z' }
          ],
          updatedAt: '2026-09-17T09:00:00.000Z'
        }
      }
    })

    const balanceTags = wrapper.findAll('.balance-meta-tag')
    expect(balanceTags).toHaveLength(2)
    expect(balanceTags[0].text()).toBe('5h 剩余 80%')
    expect(balanceTags[1].text()).toBe('7d 剩余 60%')
    expect(balanceTags[0].attributes('title')).toContain('5h 剩余 80%')
    expect(balanceTags[1].attributes('title')).toContain('7d 剩余 60%')

    await balanceTags[0].trigger('click')
    expect(wrapper.emitted('refresh-balance')).toHaveLength(1)
  })
})
