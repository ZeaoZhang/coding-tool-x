import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const api = vi.hoisted(() => ({
  getSkills: vi.fn(),
  getDshProfiles: vi.fn(),
  refreshSkills: vi.fn(),
  getSkillRefreshTask: vi.fn(),
  toggleSkill: vi.fn(),
  importFromClaude: vi.fn(),
  byCapability: vi.fn()
}))

vi.mock('../../api/skills', () => ({
  getSkills: api.getSkills,
  refreshSkills: api.refreshSkills,
  getSkillRefreshTask: api.getSkillRefreshTask,
  toggleSkill: api.toggleSkill,
  invalidateSkillSessionCache: vi.fn()
}))
vi.mock('../../api/dsh-agent-presets', () => ({ getDshProfiles: api.getDshProfiles }))
vi.mock('../../api/config-registry', () => ({ importFromClaude: api.importFromClaude }))
vi.mock('../../api/project-config', () => ({
  getProjectSkills: vi.fn(),
  setProjectSkillEnabled: vi.fn()
}))
vi.mock('../../composables/useEnabledCliPlatforms', () => ({
  useEnabledCliPlatforms: () => ({ byCapability: api.byCapability })
}))
vi.mock('../../stores/platforms', () => {
  const dsh = {
    key: 'dsh',
    label: 'DSH',
    capabilities: { skills: true },
    resourceActions: { skills: { create: false, repositories: true, import: false, refresh: true, toggle: false } }
  }
  return { usePlatformStore: () => ({ get: () => dsh, all: [dsh] }) }
})
vi.mock('vue-router', () => ({ useRoute: () => ({ meta: {} }) }))
vi.mock('naive-ui', () => {
  const simple = { template: '<div><slot /></div>' }
  const noop = vi.fn()
  return {
    NButton: { emits: ['click'], template: '<button @click="$emit(\'click\')"><slot /></button>' },
    NIcon: simple,
    NInput: simple,
    NSelect: {
      props: ['value', 'options'],
      emits: ['update:value'],
      template: '<select :value="value" @change="$emit(\'update:value\', $event.target.value)"><option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option></select>'
    },
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

describe('SkillsPanel DSH profile scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.byCapability.mockReturnValue([{ key: 'dsh' }])
    api.getDshProfiles.mockResolvedValue([{ name: 'desktop' }, { name: 'web-test' }])
    api.getSkills.mockResolvedValue({
      success: true,
      skills: [{
        key: 'dsh:desktop:demo',
        name: 'Demo',
        directory: 'demo',
        enabled: true,
        cached: true,
        trust: 'approved',
        projection: { state: 'unsupported' }
      }],
      refresh: { state: 'never_fetched', taskId: null, fetchedAt: null, error: null }
    })
  })

  it('lists skills for the selected DSH profile and hides unsupported toggles', async () => {
    const { default: SkillsPanel } = await import('../SkillsPanel.vue')
    const wrapper = mount(SkillsPanel, {
      props: { platform: 'dsh' },
      global: {
        stubs: {
          SkillCard: {
            props: ['skill', 'toggling', 'panelScope', 'canToggle'],
            template: '<div class="skill-card" :data-can-toggle="String(canToggle)">{{ skill.name }}</div>'
          },
          SkillRepoManager: { template: '<div />' },
          SkillCreateModal: { template: '<div />' },
          SkillDetailDrawer: {
            props: ['visible', 'skill', 'platform', 'scope', 'projectPath', 'profile'],
            template: '<div class="detail-profile">{{ profile }}</div>'
          },
          OmpSkillSettingsModal: { template: '<div />' }
        }
      }
    })
    await flushPromises()

    expect(api.getDshProfiles).toHaveBeenCalledTimes(1)
    expect(api.getSkills).toHaveBeenLastCalledWith('dsh', { profile: 'desktop' })
    expect(wrapper.find('.skill-card').attributes('data-can-toggle')).toBe('false')
    expect(wrapper.find('.detail-profile').text()).toBe('desktop')

    const profileSelect = wrapper.findAll('select')[0]
    await profileSelect.setValue('web-test')
    await flushPromises()

    expect(api.getSkills).toHaveBeenLastCalledWith('dsh', { profile: 'web-test' })
    expect(wrapper.find('.detail-profile').text()).toBe('web-test')
    wrapper.unmount()
  })
})
