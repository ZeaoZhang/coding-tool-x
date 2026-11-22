import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const api = vi.hoisted(() => ({
  getSkillDetail: vi.fn(),
  toggleSkill: vi.fn(),
  setSkillTrust: vi.fn()
}))

vi.mock('../../api/skills', () => api)
vi.mock('../../api/project-config', () => ({ setProjectSkillEnabled: vi.fn() }))
vi.mock('../../composables/useResponsiveDrawer', () => ({
  useResponsiveDrawer: () => ({ drawerWidth: 600 })
}))
vi.mock('../../utils/clipboard', () => ({ copyTextToClipboard: vi.fn() }))
vi.mock('../../utils/message', () => ({
  default: { success: vi.fn(), warning: vi.fn(), error: vi.fn() }
}))
vi.mock('@vicons/ionicons5', () => ({
  AlertCircleOutline: { template: '<i />' },
  CopyOutline: { template: '<i />' },
  DocumentTextOutline: { template: '<i />' },
  ExtensionPuzzleOutline: { template: '<i />' },
  GitBranchOutline: { template: '<i />' }
}))
vi.mock('naive-ui', () => ({
  NDrawer: { template: '<div><slot /></div>' },
  NDrawerContent: { template: '<div><slot name="header" /><slot /></div>' },
  NButton: {
    props: ['disabled'],
    template: '<button :disabled="disabled"><slot /></button>'
  },
  NIcon: { template: '<span><slot /></span>' },
  NTag: { template: '<span><slot /></span>' },
  NTabs: { template: '<div><slot /></div>' },
  NTabPane: { template: '<div><slot /></div>' },
  NSpin: { template: '<div />' }
}))

import SkillDetailDrawer from '../SkillDetailDrawer.vue'

const skill = {
  name: 'Native',
  directory: 'native',
  controlKey: 'skill:claude:user:user:native',
  trust: 'approved',
  cached: true,
  enabled: false,
  sourceScope: 'user',
  projection: { mode: 'unsupported', state: 'disabled' }
}

describe('SkillDetailDrawer projection capability', () => {
  beforeEach(() => {
    api.getSkillDetail.mockReset()
    api.toggleSkill.mockReset()
  })

  test('shows unsupported projection instead of an enabled toggle for mode-only capability', async () => {
    api.getSkillDetail.mockResolvedValue({
      success: true,
      ...skill
    })

    const wrapper = mount(SkillDetailDrawer, {
      props: { visible: false, skill, platform: 'claude' },
      global: { stubs: { AssetPathField: true } }
    })
    await wrapper.setProps({ visible: true })
    await flushPromises()

    const buttons = wrapper.findAll('button').map(button => button.text())
    expect(buttons).toContain('不支持投影')
    expect(buttons).not.toContain('启用此技能')
  })

  test('still allows disabling an enabled skill with unsupported projection', async () => {
    const enabledSkill = { ...skill, enabled: true }
    api.getSkillDetail.mockResolvedValue({
      success: true,
      ...enabledSkill
    })

    const wrapper = mount(SkillDetailDrawer, {
      props: { visible: false, skill: enabledSkill, platform: 'claude' },
      global: { stubs: { AssetPathField: true } }
    })
    await wrapper.setProps({ visible: true })
    await flushPromises()

    const buttons = wrapper.findAll('button').map(button => button.text())
    expect(buttons).toContain('关闭此技能')
    expect(buttons).not.toContain('不支持投影')
  })
})
