import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import SkillsPanel from '../SkillsPanel.vue'
import OmpSkillSettingsModal from '../OmpSkillSettingsModal.vue'

const { api, message } = vi.hoisted(() => ({
  api: {
    getSkills: vi.fn(),
    getOmpSkillSettings: vi.fn(),
    updateOmpSkillSettings: vi.fn(),
    installSkill: vi.fn(),
    uninstallSkill: vi.fn(),
    installLocalSkill: vi.fn()
  },
  message: {
    success: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('../../api/skills', () => api)
vi.mock('../../api/config-registry', () => ({ importFromClaude: vi.fn() }))
vi.mock('vue-router', () => ({ useRoute: () => ({ meta: { channel: 'claude' } }) }))
vi.mock('../SkillCard.vue', () => ({ default: { name: 'SkillCard', template: '<div />' } }))
vi.mock('../SkillRepoManager.vue', () => ({ default: { name: 'SkillRepoManager', template: '<div />' } }))
vi.mock('../SkillCreateModal.vue', () => ({ default: { name: 'SkillCreateModal', template: '<div />' } }))
vi.mock('../SkillDetailDrawer.vue', () => ({ default: { name: 'SkillDetailDrawer', template: '<div />' } }))

vi.mock('naive-ui', async () => {
  const { defineComponent, h } = await import('vue')

  const shell = name => defineComponent({
    name,
    inheritAttrs: false,
    setup(_, { attrs, slots }) {
      return () => h('div', attrs, [slots.default?.(), slots.action?.(), slots.extra?.()])
    }
  })

  const NButton = defineComponent({
    name: 'NButton',
    inheritAttrs: false,
    props: {
      disabled: Boolean,
      loading: Boolean
    },
    emits: ['click'],
    setup(props, { attrs, emit, slots }) {
      return () => h('button', {
        ...attrs,
        disabled: props.disabled || props.loading,
        onClick: event => emit('click', event)
      }, [slots.icon?.(), slots.default?.()])
    }
  })

  const NModal = defineComponent({
    name: 'NModal',
    props: { show: Boolean },
    emits: ['update:show'],
    setup(props, { slots }) {
      return () => props.show
        ? h('section', { 'data-testid': 'modal-shell' }, [slots.default?.(), slots.footer?.()])
        : null
    }
  })

  const NSwitch = defineComponent({
    name: 'NSwitch',
    inheritAttrs: false,
    props: {
      value: Boolean,
      disabled: Boolean
    },
    emits: ['update:value'],
    setup(props, { attrs, emit }) {
      return () => h('button', {
        ...attrs,
        type: 'button',
        role: 'switch',
        disabled: props.disabled,
        'aria-checked': String(props.value),
        onClick: () => emit('update:value', !props.value)
      })
    }
  })

  const NInput = defineComponent({
    name: 'NInput',
    props: { value: String },
    emits: ['update:value'],
    setup(props, { emit, slots }) {
      return () => h('label', [
        slots.prefix?.(),
        h('input', {
          value: props.value,
          onInput: event => emit('update:value', event.target.value)
        })
      ])
    }
  })

  const NSelect = defineComponent({
    name: 'NSelect',
    inheritAttrs: false,
    props: {
      value: String,
      options: { type: Array, default: () => [] }
    },
    emits: ['update:value'],
    setup(props, { emit }) {
      return () => h('select', {
        value: props.value,
        onChange: event => emit('update:value', event.target.value)
      }, props.options.map(option => h('option', { value: option.value }, option.label)))
    }
  })

  return {
    NAlert: shell('NAlert'),
    NButton,
    NEmpty: shell('NEmpty'),
    NIcon: shell('NIcon'),
    NInput,
    NModal,
    NSelect,
    NSpin: shell('NSpin'),
    NSwitch,
    useMessage: () => message
  }
})

const validSettings = Object.freeze({
  enableCodexUser: false,
  enableClaudeUser: true,
  enablePiUser: false,
  enablePiProject: true
})

const irrelevantStubs = {
  SkillCard: true,
  SkillRepoManager: true,
  SkillCreateModal: true,
  SkillDetailDrawer: true
}

function findSettingsButton(wrapper) {
  return wrapper.find('[aria-label="OMP 技能设置"]')
}

function findButton(wrapper, label) {
  return wrapper.findAll('button').find(button => button.text().trim() === label)
}

async function mountSettingsModal() {
  api.getOmpSkillSettings.mockResolvedValue({ success: true, settings: { ...validSettings } })
  const wrapper = mount(OmpSkillSettingsModal, { props: { visible: true } })
  await flushPromises()
  return wrapper
}

beforeAll(() => {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  })))
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

afterAll(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.clearAllMocks()
  api.getSkills.mockResolvedValue({ success: true, skills: [] })
})

describe('SkillsPanel OMP settings entry', () => {
  test.each([
    ['standalone', false],
    ['drawer', true]
  ])('shows a bound settings entry for OMP in %s mode', async (_, inDrawer) => {
    const wrapper = mount(SkillsPanel, {
      props: { platform: 'omp', inDrawer },
      global: { stubs: irrelevantStubs }
    })
    await flushPromises()

    const settingsButton = findSettingsButton(wrapper)
    expect(settingsButton.exists()).toBe(true)
    expect(settingsButton.text().trim()).toBe('设置')
    await settingsButton.trigger('click')
    expect(wrapper.findComponent(OmpSkillSettingsModal).props('visible')).toBe(true)

    wrapper.unmount()
  })

  test('closes the real settings modal when switching away from OMP', async () => {
    api.getOmpSkillSettings.mockResolvedValue({ success: true, settings: { ...validSettings } })
    const wrapper = mount(SkillsPanel, {
      props: { platform: 'omp' },
      global: { stubs: irrelevantStubs }
    })
    await flushPromises()

    await findSettingsButton(wrapper).trigger('click')
    await flushPromises()
    const modal = wrapper.findComponent(OmpSkillSettingsModal)
    expect(modal.props('visible')).toBe(true)

    await wrapper.setProps({ platform: 'claude' })
    await flushPromises()
    await nextTick()

    expect(modal.props('visible')).toBe(false)
    expect(findSettingsButton(wrapper).exists()).toBe(false)
    wrapper.unmount()
  })

  test.each([
    ['claude', false],
    ['claude', true],
    ['codex', false],
    ['codex', true],
    ['gemini', false],
    ['gemini', true],
    ['opencode', false],
    ['opencode', true]
  ])('does not show settings for %s when inDrawer=%s', async (platform, inDrawer) => {
    const wrapper = mount(SkillsPanel, {
      props: { platform, inDrawer },
      global: { stubs: irrelevantStubs }
    })
    await flushPromises()

    expect(findSettingsButton(wrapper).exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('OmpSkillSettingsModal save behavior', () => {
  test('loads on open and preserves the user form state when PUT rejects', async () => {
    api.updateOmpSkillSettings.mockRejectedValue(new Error('write failed'))
    const wrapper = await mountSettingsModal()

    expect(api.getOmpSkillSettings).toHaveBeenCalledTimes(1)
    const switches = wrapper.findAll('[role="switch"]')
    expect(switches.map(toggle => toggle.attributes('aria-checked'))).toEqual([
      'false', 'true', 'false', 'true'
    ])
    await switches[0].trigger('click')
    await switches[3].trigger('click')
    expect(switches.map(toggle => toggle.attributes('aria-checked'))).toEqual([
      'true', 'true', 'false', 'false'
    ])

    await findButton(wrapper, '保存').trigger('click')
    await flushPromises()

    expect(api.updateOmpSkillSettings).toHaveBeenCalledWith({
      ...validSettings,
      enableCodexUser: true,
      enablePiProject: false
    })
    expect(wrapper.emitted('saved')).toBeUndefined()
    expect(wrapper.emitted('update:visible')).toBeUndefined()
    expect(wrapper.find('[data-testid="modal-shell"]').exists()).toBe(true)
    expect(wrapper.props('visible')).toBe(true)
    expect(switches.map(toggle => toggle.attributes('aria-checked'))).toEqual([
      'true', 'true', 'false', 'false'
    ])
  })

  test.each([
    ['success is false', submitted => ({ success: false, settings: submitted })],
    ['one of four fields is invalid', submitted => ({
      success: true,
      settings: { ...submitted, enablePiProject: 'false' }
    })],
    ['echo differs from submitted settings', submitted => ({
      success: true,
      settings: { ...submitted, enablePiProject: !submitted.enablePiProject }
    })]
  ])('does not emit saved when PUT resolves but %s', async (_, responseFor) => {
    api.updateOmpSkillSettings.mockImplementation(submitted => Promise.resolve(responseFor(submitted)))
    const wrapper = await mountSettingsModal()

    const switches = wrapper.findAll('[role="switch"]')
    await switches[0].trigger('click')
    await switches[3].trigger('click')
    await findButton(wrapper, '保存').trigger('click')
    await flushPromises()

    expect(api.updateOmpSkillSettings).toHaveBeenCalledTimes(1)
    expect(api.updateOmpSkillSettings).toHaveBeenCalledWith({
      ...validSettings,
      enableCodexUser: true,
      enablePiProject: false
    })
    expect(wrapper.emitted('saved')).toBeUndefined()
    expect(wrapper.emitted('update:visible')).toBeUndefined()
    expect(wrapper.find('[data-testid="modal-shell"]').exists()).toBe(true)
    expect(wrapper.props('visible')).toBe(true)
    expect(switches.map(toggle => toggle.attributes('aria-checked'))).toEqual([
      'true', 'true', 'false', 'false'
    ])
  })

  test('emits saved exactly once after a successful PUT', async () => {
    api.updateOmpSkillSettings.mockImplementation(submitted => Promise.resolve({
      success: true,
      settings: { ...submitted }
    }))
    const wrapper = await mountSettingsModal()

    await wrapper.findAll('[role="switch"]')[3].trigger('click')
    await findButton(wrapper, '保存').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('saved')).toEqual([[
      { ...validSettings, enablePiProject: false }
    ]])
  })
})

describe('SkillsPanel successful settings flow', () => {
  test('closes the real modal and forces one OMP refresh after saved', async () => {
    api.getOmpSkillSettings.mockResolvedValue({ success: true, settings: { ...validSettings } })
    api.updateOmpSkillSettings.mockImplementation(submitted => Promise.resolve({
      success: true,
      settings: { ...submitted }
    }))
    const wrapper = mount(SkillsPanel, {
      props: { platform: 'omp' },
      global: { stubs: irrelevantStubs }
    })
    await flushPromises()
    api.getSkills.mockClear()

    await findButton(wrapper, '设置').trigger('click')
    await flushPromises()
    const modal = wrapper.findComponent(OmpSkillSettingsModal)
    expect(modal.props('visible')).toBe(true)

    await findButton(modal, '保存').trigger('click')
    await flushPromises()

    expect(api.updateOmpSkillSettings).toHaveBeenCalledTimes(1)
    expect(modal.emitted('saved')).toHaveLength(1)
    expect(api.getSkills).toHaveBeenCalledTimes(1)
    expect(api.getSkills).toHaveBeenCalledWith(true, 'omp', {})
    expect(modal.props('visible')).toBe(false)
  })
})
