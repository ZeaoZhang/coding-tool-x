import { beforeEach, describe, expect, test, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const hoisted = vi.hoisted(() => ({
  state: {
    byCapability: { skills: [] },
    platforms: [],
    route: { meta: {}, query: {} }
  },
  messages: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
  api: {
    getSkills: vi.fn(),
    refreshSkills: vi.fn(),
    getSkillRefreshTask: vi.fn(),
    toggleSkill: vi.fn(),
    setSkillTrust: vi.fn(),
    getProjectSkills: vi.fn(),
    setProjectSkillEnabled: vi.fn(),
    importFromClaude: vi.fn(),
    getDshProfiles: vi.fn()
  }
}))

const { state, messages, api } = hoisted

vi.mock('../../api/skills', () => ({
  getSkills: api.getSkills,
  refreshSkills: api.refreshSkills,
  getSkillRefreshTask: api.getSkillRefreshTask,
  toggleSkill: api.toggleSkill,
  setSkillTrust: api.setSkillTrust,
  invalidateSkillSessionCache: vi.fn()
}))
vi.mock('../../api/project-config', () => ({
  getProjectSkills: api.getProjectSkills,
  setProjectSkillEnabled: api.setProjectSkillEnabled
}))
vi.mock('../../api/config-registry', () => ({ importFromClaude: api.importFromClaude }))
vi.mock('../../api/dsh-agent-presets', () => ({ getDshProfiles: api.getDshProfiles }))
vi.mock('../../composables/useEnabledCliPlatforms', () => ({
  useEnabledCliPlatforms: () => ({
    byCapability: capability => state.byCapability[capability] || []
  })
}))
vi.mock('../../stores/platforms', () => ({
  usePlatformStore: () => ({
    all: state.platforms,
    get: key => state.platforms.find(platform => platform.key === key) || null
  })
}))
vi.mock('vue-router', () => ({ useRoute: () => state.route }))
vi.mock('naive-ui', () => {
  const simple = { template: '<div><slot /></div>' }
  return {
    NButton: { emits: ['click'], template: '<button @click="$emit(\'click\')"><slot name="icon" /><slot /></button>' },
    NIcon: simple,
    NInput: {
      props: ['value', 'placeholder'],
      emits: ['update:value'],
      template: '<input class="search-input" :value="value" @input="$emit(\'update:value\', $event.target.value)" />'
    },
    NSelect: simple,
    NSpin: simple,
    NEmpty: { props: ['description'], template: '<div><slot name="extra" /></div>' },
    NPagination: {
      props: ['page', 'pageCount'],
      emits: ['update:page'],
      template: '<div class="pagination">{{ page }}/{{ pageCount }}<button class="page-next" @click="$emit(\'update:page\', page + 1)">next</button></div>'
    },
    useMessage: () => messages,
    lightTheme: {},
    darkTheme: {},
    createDiscreteApi: () => ({
      message: messages,
      dialog: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn(), create: vi.fn() }
    })
  }
})

const SkillCardStub = {
  props: ['skill', 'toggling', 'panelScope', 'canToggle'],
  emits: ['click', 'toggle', 'approve'],
  template: '<div class="skill-card"><span>{{ skill.name }}</span><button class="skill-toggle" @click="$emit(\'toggle\', skill, !skill.enabled)">toggle</button></div>'
}

function skill(index, overrides = {}) {
  return {
    key: `skill-${index}`,
    controlKey: `skill:omp:user:user:skill-${index}`,
    name: `skill-${index}`,
    description: 'demo',
    enabled: false,
    cached: true,
    managed: true,
    trust: 'approved',
    projection: { state: 'disabled' },
    ...overrides
  }
}

function mountPanel(props = {}) {
  return mount(SkillsPanel, {
    props,
    global: {
      stubs: {
        SkillCard: SkillCardStub,
        SkillRepoManager: { template: '<div />' },
        SkillCreateModal: { template: '<div />' },
        SkillDetailDrawer: { template: '<div />' },
        OmpSkillSettingsModal: { template: '<div />' }
      }
    }
  })
}

let SkillsPanel

beforeEach(async () => {
  vi.clearAllMocks()
  state.byCapability = { skills: [{ key: 'omp' }] }
  state.platforms = [{
    key: 'omp',
    label: 'OMP',
    capabilities: { skills: true },
    resourceActions: { skills: { create: true, repositories: true, import: false, refresh: true, toggle: true } }
  }]
  state.route = { meta: {}, query: {} }
  api.getSkills.mockResolvedValue({
    success: true,
    skills: [skill(1)],
    refresh: { state: 'never_fetched', taskId: null, fetchedAt: null, error: null }
  })
  api.toggleSkill.mockResolvedValue({ enabled: true, projection: { state: 'enabled' } })
  api.importFromClaude.mockResolvedValue({ success: true, imported: 0 })
  api.getDshProfiles.mockResolvedValue([])
  SkillsPanel = (await import('../SkillsPanel.vue')).default
})

describe('SkillsPanel platform defaults', () => {
  test('falls back to the first enabled platform with skills capability instead of claude', async () => {
    mountPanel()
    await flushPromises()

    expect(api.getSkills).toHaveBeenCalledWith('omp', {})
  })

  test('query platform still wins over the resolved default', async () => {
    state.byCapability = { skills: [{ key: 'omp' }, { key: 'codex' }] }
    state.platforms = [
      ...state.platforms,
      { key: 'codex', label: 'Codex', resourceActions: { skills: { import: false } } }
    ]
    state.route = { meta: {}, query: { platform: 'codex' } }
    mountPanel()
    await flushPromises()

    expect(api.getSkills).toHaveBeenCalledWith('codex', {})
  })
})

describe('SkillsPanel unsupported projection', () => {
  test('allows toggling when the backend omits projection metadata', async () => {
    api.getSkills.mockResolvedValue({
      success: true,
      skills: [skill(1, { projection: null })],
      refresh: { state: 'never_fetched', taskId: null, fetchedAt: null, error: null }
    })
    const wrapper = mountPanel({ platform: 'omp' })
    await flushPromises()


    await wrapper.find('.skill-toggle').trigger('click')
    await flushPromises()

    expect(api.toggleSkill).toHaveBeenCalled()
  })

  test('does not send a toggle request when the projection is unsupported', async () => {
    api.getSkills.mockResolvedValue({
      success: true,
      skills: [skill(1, { projection: { state: 'unsupported' } })],
      refresh: { state: 'never_fetched', taskId: null, fetchedAt: null, error: null }
    })
    const wrapper = mountPanel({ platform: 'omp' })
    await flushPromises()


    await wrapper.find('.skill-toggle').trigger('click')
    await flushPromises()

    expect(api.toggleSkill).not.toHaveBeenCalled()
  })

  test('does not send a toggle request when projection mode is unsupported', async () => {
    api.getSkills.mockResolvedValue({
      success: true,
      skills: [skill(1, { projection: { mode: 'unsupported' } })],
      refresh: { state: 'never_fetched', taskId: null, fetchedAt: null, error: null }
    })
    const wrapper = mountPanel({ platform: 'omp' })
    await flushPromises()


    await wrapper.find('.skill-toggle').trigger('click')
    await flushPromises()

    expect(api.toggleSkill).not.toHaveBeenCalled()
  })

  test('allows disabling an enabled skill with unsupported projection', async () => {
    api.getSkills.mockResolvedValue({
      success: true,
      skills: [skill(1, { enabled: true, projection: { mode: 'unsupported' } })],
      refresh: { state: 'never_fetched', taskId: null, fetchedAt: null, error: null }
    })
    api.toggleSkill.mockResolvedValue({ enabled: false, projection: { mode: 'unsupported', state: 'disabled' } })
    const wrapper = mountPanel({ platform: 'omp' })
    await flushPromises()

    await wrapper.find('.skill-toggle').trigger('click')
    await flushPromises()

    expect(api.toggleSkill).toHaveBeenCalledWith(
      'skill:omp:user:user:skill-1',
      false,
      'omp',
      expect.any(Object)
    )
  })
})

describe('SkillsPanel import capability', () => {
  test('shows 导入 when resourceActions.skills.import is enabled', async () => {
    state.platforms = [{
      key: 'omp',
      label: 'OMP',
      resourceActions: { skills: { import: true } }
    }]
    const wrapper = mountPanel({ platform: 'omp' })
    await flushPromises()

    expect(wrapper.text()).toContain('导入')
  })

  test('hides 导入 when the platform cannot import', async () => {
    const wrapper = mountPanel({ platform: 'omp' })
    await flushPromises()

    expect(wrapper.text()).not.toContain('导入')
  })
})

describe('SkillsPanel pagination', () => {
  beforeEach(() => {
    api.getSkills.mockResolvedValue({
      success: true,
      skills: Array.from({ length: 30 }, (_, index) => skill(index + 1)),
      refresh: { state: 'never_fetched', taskId: null, fetchedAt: null, error: null }
    })
  })

  test('renders one page at a time and resets to page 1 when the search shrinks the list', async () => {
    const wrapper = mountPanel({ platform: 'omp' })
    await flushPromises()

    expect(wrapper.findAll('.skill-card')).toHaveLength(24)
    expect(wrapper.find('.pagination').text()).toContain('1/2')

    await wrapper.find('.page-next').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.skill-card')).toHaveLength(6)
    expect(wrapper.find('.pagination').text()).toContain('2/2')

    await wrapper.find('.search-input').setValue('skill-2')
    await flushPromises()

    expect(wrapper.findAll('.skill-card').length).toBe(11)
    expect(wrapper.find('.pagination').exists()).toBe(false)
  })

  test('returns to a usable page when the filtered list shrinks', async () => {
    const wrapper = mountPanel({ platform: 'omp' })
    await flushPromises()
    await wrapper.find('.page-next').trigger('click')
    await flushPromises()

    await wrapper.find('.search-input').setValue('skill-29')
    await flushPromises()

    expect(wrapper.findAll('.skill-card')).toHaveLength(1)
    expect(wrapper.find('.pagination').exists()).toBe(false)
  })
})
