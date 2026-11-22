import { describe, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('naive-ui', () => ({
  NTag: { template: '<span><slot /></span>' },
  NButton: { template: '<button><slot /></button>' },
  NSwitch: {
    props: ['value', 'disabled', 'loading'],
    emits: ['update:value'],
    template: '<button class="skill-switch" :disabled="disabled" :loading="loading" @click="$emit(\'update:value\', !value)"><slot /></button>'
  }
}))

vi.mock('../../utils/skill-source', () => ({
  getSkillSourceLink: () => '',
  getSkillSourceLinkLabel: () => '',
  getSkillSourceLocation: () => '',
  getSkillSourceTag: () => ''
}))

test('shows cached and enabled state without install or uninstall actions', async () => {
  const { default: SkillCard } = await import('../SkillCard.vue')
  const wrapper = mount(SkillCard, {
    props: {
      skill: {
        name: 'Demo',
        directory: 'demo',
        enabled: true,
        cached: true,
        trust: 'approved',
        projection: { state: 'enabled' }
      }
    }
  })

  expect(wrapper.text()).toContain('已启用')
  expect(wrapper.text()).toContain('已缓存')
  expect(wrapper.text()).not.toContain('安装')
  expect(wrapper.text()).not.toContain('卸载')
  await wrapper.find('.skill-switch').trigger('click')
  expect(wrapper.emitted('toggle')).toEqual([[expect.objectContaining({ name: 'Demo' }), false]])
})

vi.clearAllMocks()

test('hides the switch when the platform does not support skill toggling', async () => {
  const { default: SkillCard } = await import('../SkillCard.vue')
  const wrapper = mount(SkillCard, {
    props: {
      canToggle: false,
      skill: {
        name: 'Readonly',
        directory: 'readonly',
        enabled: true,
        cached: true,
        trust: 'approved',
        projection: { state: 'unsupported' }
      }
    }
  })

  expect(wrapper.find('.skill-switch').exists()).toBe(false)
  expect(wrapper.text()).toContain('不支持投影')
})

test('disables enabling when projection mode is unsupported', async () => {
  const { default: SkillCard } = await import('../SkillCard.vue')
  const wrapper = mount(SkillCard, {
    props: {
      skill: {
        name: 'Native',
        directory: 'native',
        enabled: false,
        cached: true,
        trust: 'approved',
        projection: { mode: 'unsupported' }
      }
    }
  })

  expect(wrapper.find('.skill-switch').attributes('disabled')).toBeDefined()
  expect(wrapper.text()).toContain('不支持投影')
})

test('still allows disabling an enabled skill with unsupported projection', async () => {
  const { default: SkillCard } = await import('../SkillCard.vue')
  const wrapper = mount(SkillCard, {
    props: {
      skill: {
        name: 'Native',
        directory: 'native',
        enabled: true,
        cached: true,
        trust: 'approved',
        projection: { mode: 'unsupported' }
      }
    }
  })

  const toggle = wrapper.find('.skill-switch')
  expect(toggle.attributes('disabled')).toBeUndefined()
  await toggle.trigger('click')
  expect(wrapper.emitted('toggle')).toEqual([[expect.objectContaining({ name: 'Native' }), false]])
})
