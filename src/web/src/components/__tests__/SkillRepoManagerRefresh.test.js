import { beforeEach, describe, expect, test, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const api = vi.hoisted(() => ({
  getSkillRepos: vi.fn(),
  addSkillRepo: vi.fn(),
  removeSkillRepo: vi.fn(),
  toggleSkillRepo: vi.fn(),
  updateSkillRepoAuth: vi.fn()
}))

vi.mock('../../api/skills', () => api)
vi.mock('../../utils/message', () => ({
  default: { success: vi.fn(), warning: vi.fn(), error: vi.fn() }
}))
vi.mock('naive-ui', () => {
  const shell = { template: '<div><slot /></div>' }
  return {
    NModal: shell,
    NButton: { emits: ['click'], template: '<button @click="$emit(\'click\')"><slot /></button>' },
    NInput: {
      inheritAttrs: false,
      props: ['value'],
      emits: ['update:value'],
      template: '<input :value="value" @input="$emit(\'update:value\', $event.target.value)" />'
    },
    NSwitch: { props: ['value'], template: '<button><slot /></button>' },
    NTag: shell,
    NIcon: shell,
    NAlert: shell,
    NSpin: shell
  }
})

describe('SkillRepoManager refresh boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.getSkillRepos.mockResolvedValue({ success: true, repos: [] })
    api.addSkillRepo.mockResolvedValue({
      success: true,
      repos: [{ id: 'github:owner/repo', owner: 'owner', name: 'repo', enabled: true }]
    })
    api.removeSkillRepo.mockResolvedValue({ success: true, repos: [] })
    api.toggleSkillRepo.mockResolvedValue({ success: true, repos: [] })
    api.updateSkillRepoAuth.mockResolvedValue({ success: true, repos: [] })
  })

  test('saving a repository only emits local state update and does not start refresh', async () => {
    const { default: SkillRepoManager } = await import('../SkillRepoManager.vue')
    const wrapper = mount(SkillRepoManager, {
      props: { visible: true, platform: 'claude' }
    })
    await flushPromises()

    const inputs = wrapper.findAll('input')
    await inputs[0].setValue('owner/repo')
    await wrapper.findAll('button').find(button => button.text() === '添加').trigger('click')
    await flushPromises()

    expect(api.addSkillRepo).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'github',
      owner: 'owner',
      name: 'repo',
      enabled: true
    }), 'claude')
    expect(wrapper.emitted('updated')).toHaveLength(1)
  })
})
