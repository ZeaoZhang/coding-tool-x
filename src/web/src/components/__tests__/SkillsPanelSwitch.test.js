import { beforeEach, describe, expect, test, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const api = vi.hoisted(() => ({
  getSkills: vi.fn(),
  refreshSkills: vi.fn(),
  getSkillRefreshTask: vi.fn(),
  toggleSkill: vi.fn(),
  importFromClaude: vi.fn()
}))

vi.mock('../../api/skills', () => ({
  getSkills: api.getSkills,
  refreshSkills: api.refreshSkills,
  getSkillRefreshTask: api.getSkillRefreshTask,
  toggleSkill: api.toggleSkill
}))
vi.mock('../../api/config-registry', () => ({ importFromClaude: api.importFromClaude }))
vi.mock('../../api/project-config', () => ({
  setProjectSkillEnabled: vi.fn()
}))
vi.mock('../../stores/platforms', () => ({
  usePlatformStore: () => ({
    all: [{ key: 'claude', label: 'Claude', capabilities: { skills: true } }],
    get: () => ({ label: 'Claude' })
  })
}))
vi.mock('vue-router', () => ({ useRoute: () => ({ meta: {} }) }))
vi.mock('naive-ui', () => {
  const simple = { template: '<div><slot /></div>' }
  const noop = vi.fn()
  return {
    NButton: { emits: ['click'], template: '<button @click="$emit(\'click\')"><slot /></button>' },
    NIcon: simple,
    NInput: simple,
    NSelect: simple,
    NSpin: simple,
    NEmpty: simple,
    lightTheme: {},
    darkTheme: {},
    createDiscreteApi: () => ({
      message: { success: noop, warning: noop, error: noop, info: noop, loading: noop },
      dialog: { success: noop, warning: noop, error: noop, info: noop, create: noop }
    }),
    useMessage: () => ({ success: noop, warning: noop, error: noop })
  }
})

describe('SkillsPanel switch lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.getSkills.mockResolvedValue({
      success: true,
      skills: [{
        key: 'demo',
        controlKey: 'skill:claude:user:user:demo',
        name: 'Demo',
        description: 'Demo skill',
        enabled: false,
        cached: true,
        managed: true,
        trust: 'approved',
        projection: { state: 'disabled' }
      }],
      refresh: { state: 'never_fetched', taskId: null, fetchedAt: null, error: null }
    })
    api.refreshSkills.mockResolvedValue({
      task: { id: 'task-1', status: 'succeeded' }
    })
    api.toggleSkill.mockResolvedValue({
      enabled: true,
      projection: { state: 'enabled' }
    })
    api.getSkillRefreshTask.mockResolvedValue({ task: { id: 'task-1', status: 'succeeded' } })
    api.importFromClaude.mockResolvedValue({ success: true, imported: 0 })
  })

  async function createWrapper() {
    const { default: SkillsPanel } = await import('../SkillsPanel.vue')
    return mount(SkillsPanel, {
      global: {
        stubs: {
          SkillCard: {
            props: ['skill', 'toggling'],
            emits: ['toggle', 'click'],
            template: '<button class="skill-toggle" @click="$emit(\'toggle\', skill, !skill.enabled)">{{ skill.name }} {{ skill.cached ? "已缓存" : "未缓存" }}</button>'
          },
          SkillRepoManager: { template: '<div />' },
          SkillCreateModal: { template: '<div />' },
          SkillDetailDrawer: { template: '<div />' },
          OmpSkillSettingsModal: { template: '<div />' }
        }
      }
    })
  }

  test('mount scans local state without refreshing remotely', async () => {
    const wrapper = await createWrapper()
    await flushPromises()

    expect(api.getSkills).toHaveBeenCalledWith('claude', {})
    expect(api.refreshSkills).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('已缓存')
  })

  test('refresh button starts a task and scans again only after completion', async () => {
    const wrapper = await createWrapper()
    await flushPromises()
    const refreshButton = wrapper.findAll('button').find(button => button.text().includes('刷新远端'))

    await refreshButton.trigger('click')
    await flushPromises()

    expect(api.refreshSkills).toHaveBeenCalledWith('claude', {})
    expect(api.getSkills).toHaveBeenCalledTimes(2)
  })

  test('Skill switch delegates enablement to the control endpoint', async () => {
    const wrapper = await createWrapper()
    await flushPromises()

    await wrapper.find('.skill-toggle').trigger('click')
    await flushPromises()

    expect(api.toggleSkill).toHaveBeenCalledWith(
      'skill:claude:user:user:demo',
      true,
      'claude',
      {}
    )
  })
})
