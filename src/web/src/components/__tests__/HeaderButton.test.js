import { describe, expect, it } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import HeaderButton from '../HeaderButton.vue'

const icon = { name: 'TestIcon', template: '<svg />' }
const TooltipStub = {
  name: 'NTooltip',
  template: '<div><slot name="trigger" /></div>'
}

describe('HeaderButton accessibility', () => {
  it('exposes the tooltip as the button accessible name', () => {
    const wrapper = shallowMount(HeaderButton, {
      props: { icon, tooltip: '设置' },
      global: { stubs: { Tooltip: TooltipStub, tooltip: TooltipStub, 'n-tooltip': TooltipStub, Icon: { template: '<span><slot /></span>' }, icon: { template: '<span><slot /></span>' } } }
    })

    const button = wrapper.find('button')
    expect(button.attributes('aria-label')).toBe('设置')
    expect(button.attributes('type')).toBe('button')
  })

  it('falls back to a generic label when no tooltip is provided', () => {
    const wrapper = shallowMount(HeaderButton, {
      props: { icon },
      global: { stubs: { Tooltip: TooltipStub, tooltip: TooltipStub, 'n-tooltip': TooltipStub, Icon: { template: '<span><slot /></span>' }, icon: { template: '<span><slot /></span>' } } }
    })

    expect(wrapper.find('button').attributes('aria-label')).toBe('工具栏按钮')
  })
})
