import { describe, expect, test } from 'vitest'
import { mount } from '@vue/test-utils'
import SkillCard from '../SkillCard.vue'

const stubs = {
  'n-tag': { template: '<span class="tag"><slot /></span>' },
  'n-button': { template: '<button><slot /></button>' },
  'n-switch': { template: '<span class="switch" />' }
}

function baseSkill(usage, overrides = {}) {
  return {
    name: 'demo',
    directory: 'skills/demo',
    description: 'demo skill',
    enabled: true,
    cached: true,
    trust: 'approved',
    artifact: { state: 'ready' },
    ...overrides,
    usage
  }
}

function mountCard(skill, props = {}) {
  return mount(SkillCard, {
    props: { skill, staleDays: 30, ...props },
    global: { stubs }
  })
}

describe('SkillCard usage', () => {
  test('renders the stale tag with the configured window', () => {
    const wrapper = mountCard(baseSkill({ state: 'stale', count: 0 }))
    expect(wrapper.text()).toContain('近 30 天未使用')
  })

  test('renders the turn count for a used skill', () => {
    const wrapper = mountCard(baseSkill({
      state: 'used',
      count: 3,
      lastUsedAt: Date.UTC(2026, 10, 27, 8, 0, 0)
    }))
    expect(wrapper.text()).toContain('涉及 3 轮使用')
  })

  test('hides usage claims on a disabled skill', () => {
    const wrapper = mountCard(baseSkill({ state: 'stale', count: 0 }, { enabled: false }))
    expect(wrapper.text()).not.toContain('未使用')
  })

  test('shows the unverified copy instead of a zero', () => {
    const wrapper = mountCard(baseSkill({ state: 'unverified', count: 0 }))
    expect(wrapper.text()).toContain('该平台尚未观察到技能调用')
    expect(wrapper.text()).not.toContain('0 轮使用')
  })
})
