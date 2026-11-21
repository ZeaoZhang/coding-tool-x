import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../composables/useResponsiveDrawer', () => ({
  useResponsiveDrawer: () => ({ drawerWidth: 720 })
}))

import SkillsDrawer from '../SkillsDrawer.vue'
import CommandsDrawer from '../CommandsDrawer.vue'
import AgentsDrawer from '../AgentsDrawer.vue'

const drawerStubs = {
  drawer: { template: '<div><slot /></div>' },
  'drawer-content': { template: '<div><slot name="header" /><slot /></div>' },
  SkillsPanel: { name: 'SkillsPanel', props: ['platform'], template: '<div class="skills-panel-stub" />' },
  CommandsPanel: { name: 'CommandsPanel', props: ['platform'], template: '<div class="commands-panel-stub" />' },
  AgentsPanel: { name: 'AgentsPanel', props: ['platform'], template: '<div class="agents-panel-stub" />' },
  DshAgentPresetsPanel: { name: 'DshAgentPresetsPanel', template: '<div class="dsh-presets-stub" />' }
}

function mountDrawer(component, props = {}) {
  return mount(component, {
    props: { visible: true, ...props },
    global: {
      renderStubDefaultSlot: true,
      stubs: drawerStubs
    }
  })
}

function headerText(wrapper) {
  return wrapper.find('.drawer-header').text()
}

describe('resource drawer platform header', () => {
  it('shows the source platform pill in the Skills drawer header', () => {
    const wrapper = mountDrawer(SkillsDrawer, { platform: 'claude' })

    expect(headerText(wrapper)).toContain('技能管理')
    expect(headerText(wrapper)).toContain('Claude Code')
    expect(wrapper.find('.drawer-header .asset-platform-pill').exists()).toBe(true)
    // 抽屉仍然把平台传给资源面板
    expect(wrapper.findComponent({ name: 'SkillsPanel' }).props('platform')).toBe('claude')
  })

  it('shows the source platform pill in the Commands drawer header', () => {
    const wrapper = mountDrawer(CommandsDrawer, { platform: 'codex' })

    expect(headerText(wrapper)).toContain('命令管理')
    expect(headerText(wrapper)).toContain('Codex')
    expect(wrapper.findComponent({ name: 'CommandsPanel' }).props('platform')).toBe('codex')
  })

  it('shows the source platform pill in the Agents drawer header, including DSH presets', () => {
    const wrapper = mountDrawer(AgentsDrawer, { platform: 'dsh' })
    expect(wrapper.find('.drawer-header .asset-platform-pill').exists()).toBe(true)

    expect(headerText(wrapper)).toContain('Agent 预设管理')
    // 平台目录未加载时回退到平台 key，加载后显示目录标签
    expect(headerText(wrapper).toLowerCase()).toContain('dsh')
  })

  it('falls back to the platform key for unknown platforms and hides the pill without a platform', () => {
    const custom = mountDrawer(SkillsDrawer, { platform: 'acme-cli' })
    expect(headerText(custom)).toContain('acme-cli')

    const empty = mountDrawer(SkillsDrawer)
    expect(headerText(empty)).toContain('技能管理')
    expect(empty.find('.drawer-header .asset-platform-pill').exists()).toBe(false)
  })
})
