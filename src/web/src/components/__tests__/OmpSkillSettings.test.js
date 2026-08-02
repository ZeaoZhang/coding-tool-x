import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import SkillsPanel from '../SkillsPanel.vue'
import OmpSkillSettingsModal from '../OmpSkillSettingsModal.vue'
import SkillManager from '../../views/SkillManager.vue'

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
const mountedWrappers = new Set()
const pendingPromises = new Set()

function mountTracked(component, options) {
  const wrapper = mount(component, options)
  mountedWrappers.add(wrapper)
  return wrapper
}

function deferred() {
  let resolvePromise
  let rejectPromise
  let settled = false
  const pending = {
    resolve(value) {
      if (settled) return
      settled = true
      pendingPromises.delete(pending)
      resolvePromise(value)
    },
    reject(error) {
      if (settled) return
      settled = true
      pendingPromises.delete(pending)
      rejectPromise(error)
    }
  }
  pending.promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  pendingPromises.add(pending)
  return pending
}

vi.mock('../../api/skills', () => api)
vi.mock('../../api/config-registry', () => ({ importFromClaude: vi.fn() }))
const route = reactive({ meta: { channel: 'claude' }, query: {} })
vi.mock('vue-router', () => ({ useRoute: () => route }))
vi.mock('../SkillCard.vue', () => ({ default: { name: 'SkillCard', props: ['skill'], template: '<div class="skill-card-test">{{ skill.name }}</div>' } }))
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
        ...(props.disabled || props.loading ? { disabled: true } : {}),
        loading: props.loading,
        onClick: event => emit('click', event)
      }, [slots.icon?.(), slots.default?.()])
    }
  })

  const NSpin = defineComponent({
    name: 'NSpin',
    props: { show: Boolean },
    setup(props, { slots }) {
      return () => h('div', { 'data-spin-show': String(props.show) }, slots.default?.())
    }
  })

  const NModal = defineComponent({
    name: 'NModal',
    props: { show: Boolean, closable: Boolean, maskClosable: Boolean, closeOnEsc: Boolean },
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
    NCard: shell('NCard'),
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
  const wrapper = mountTracked(OmpSkillSettingsModal, { props: { visible: true } })
  await flushPromises()
  return wrapper
}


function mountControlledSettingsModal({ installDefaultGet = true } = {}) {
  if (installDefaultGet) {
    api.getOmpSkillSettings.mockResolvedValue({ success: true, settings: { ...validSettings } })
  }
  const Host = defineComponent({
    setup(_, { expose }) {
      const visible = ref(true)
      const operationToken = ref(0)
      const refreshCount = ref(0)

      expose({
        close: () => { visible.value = false },
        open: () => {
          operationToken.value += 1
          visible.value = true
        },
        refreshCount
      })

      return () => h(OmpSkillSettingsModal, {
        visible: visible.value,
        operationToken: operationToken.value,
        'onUpdate:visible': value => { visible.value = value },
        onSaved: () => {
          visible.value = false
          refreshCount.value += 1
        }
      })
    }
  })

  return mountTracked(Host)
}

afterEach(async () => {
  for (const pending of [...pendingPromises]) pending.resolve({ success: true, skills: [] })
  await flushPromises()
  for (const wrapper of mountedWrappers) wrapper.unmount()
  mountedWrappers.clear()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})
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
  vi.resetAllMocks()
  api.getSkills.mockResolvedValue({ success: true, skills: [] })
})
describe('SkillsPanel OMP settings entry', () => {
  test.each([
    ['standalone', false],
    ['drawer', true]
  ])('shows a bound settings entry for OMP in %s mode', async (_, inDrawer) => {
    const wrapper = mountTracked(SkillsPanel, {
      props: { platform: 'omp', inDrawer },
      global: { stubs: irrelevantStubs }
    })
    const settingsButton = findSettingsButton(wrapper)
    expect(settingsButton.exists()).toBe(true)
    expect(settingsButton.text().trim()).toBe('设置')
    await settingsButton.trigger('click')
    expect(wrapper.findComponent(OmpSkillSettingsModal).props('visible')).toBe(true)

  })

  test('closes the real settings modal when switching away from OMP', async () => {
    api.getOmpSkillSettings.mockResolvedValue({ success: true, settings: { ...validSettings } })
    const wrapper = mountTracked(SkillsPanel, {
      props: { platform: 'omp' },
      global: { stubs: irrelevantStubs }
    })
    await findSettingsButton(wrapper).trigger('click')
    await flushPromises()
    const modal = wrapper.findComponent(OmpSkillSettingsModal)
    expect(modal.props('visible')).toBe(true)

    await wrapper.setProps({ platform: 'claude' })
    await flushPromises()
    await nextTick()

    expect(modal.props('visible')).toBe(false)
    expect(findSettingsButton(wrapper).exists()).toBe(false)
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
    const wrapper = mountTracked(SkillsPanel, {
      props: { platform, inDrawer },
      global: { stubs: irrelevantStubs }
    })
    expect(findSettingsButton(wrapper).exists()).toBe(false)
  })
})

describe('SkillManager standalone platform query', () => {
  beforeEach(() => {
    route.query = {}
  })

  test.each([
    ['omp', 'omp', true],
    ['claude', 'claude', false],
    [['omp'], 'omp', true],

    [['omp', 'claude'], 'omp', true],
    [['unknown', 'omp'], 'claude', false],
    [null, 'claude', false],
    [[], 'claude', false],
    [undefined, 'claude', false],
    ['unknown', 'claude', false]
  ])('query platform %s resolves to %s and controls the OMP settings entry', async (platform, resolvedPlatform, showsSettings) => {
    route.query = platform === undefined ? {} : { platform }
    const wrapper = mountTracked(SkillManager, {
      global: { stubs: irrelevantStubs }
    })
    expect(api.getSkills).toHaveBeenLastCalledWith(false, resolvedPlatform, {})
    const settingsButton = findSettingsButton(wrapper)
    expect(settingsButton.exists()).toBe(showsSettings)

    if (showsSettings) {
      await settingsButton.trigger('click')
      expect(wrapper.findComponent(OmpSkillSettingsModal).props('visible')).toBe(true)
    }
  })

  test('reactive query changes update the panel and close the OMP settings modal', async () => {
    route.query = { platform: 'omp' }
    const wrapper = mountTracked(SkillManager, {
      global: { stubs: irrelevantStubs }
    })
    await findSettingsButton(wrapper).trigger('click')
    expect(wrapper.findComponent(OmpSkillSettingsModal).props('visible')).toBe(true)

    route.query = { platform: 'claude' }
    await nextTick()

    expect(findSettingsButton(wrapper).exists()).toBe(false)
    expect(wrapper.findComponent(OmpSkillSettingsModal).props('visible')).toBe(false)
    expect(api.getSkills).toHaveBeenLastCalledWith(false, 'claude', {})
  })
})
describe('SkillsPanel skill refresh validation', () => {
  test.each([
    ['null response', null, '技能列表响应必须是普通对象'],
    ['success false', { success: false, message: '服务暂不可用' }, '服务暂不可用'],
    ['missing skills array', { success: true }, '技能列表响应 skills 必须是数组']
  ])('reports %s without replacing the existing list', async (_, response, errorText) => {
    api.getSkills.mockResolvedValueOnce({ success: true, skills: [{ key: 'old', name: '旧技能', installed: true }] })
    const wrapper = mountTracked(SkillsPanel, { props: { platform: 'omp' }, global: { stubs: irrelevantStubs } })
    await flushPromises()
    api.getSkills.mockResolvedValueOnce(response)
    await findButton(wrapper, '刷新').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('旧技能')
    expect(message.error).toHaveBeenCalledWith(`加载技能失败: ${errorText}`)
  })

  test('ignores a stale refresh rejection without toast or list replacement', async () => {
    const first = deferred()
    const second = deferred()
    api.getSkills.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const wrapper = mountTracked(SkillsPanel, { props: { platform: 'omp' }, global: { stubs: irrelevantStubs } })
    await findButton(wrapper, '刷新').trigger('click')
    expect(message.error).not.toHaveBeenCalled()
    second.resolve({ success: true, skills: [{ key: 'new', name: '新技能', installed: false }] })
    await flushPromises()
    expect(wrapper.text()).toContain('新技能')
    first.reject(new Error('stale refresh failed'))
    await flushPromises()
    expect(wrapper.text()).toContain('新技能')
    expect(message.error).not.toHaveBeenCalled()
  })
})

describe('OmpSkillSettingsModal load failures', () => {
  test('renders the exact GET rejection, disables save, and retries cleanly after close and reopen', async () => {
    const nextLoad = deferred()
    api.getOmpSkillSettings
      .mockRejectedValueOnce(new Error('read failed'))
      .mockReturnValueOnce(nextLoad.promise)
    const wrapper = mountControlledSettingsModal({ installDefaultGet: false })
    await flushPromises()
    const modal = wrapper.findComponent(OmpSkillSettingsModal)
    const errorText = '加载技能扫描设置失败: read failed'

    expect(message.error).toHaveBeenCalledTimes(1)
    expect(message.error).toHaveBeenCalledWith(errorText)
    const alert = modal.findComponent({ name: 'NAlert' })
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toBe(`${errorText} 重试`)
    expect(findButton(modal, '保存').attributes('disabled')).toBeDefined()
    expect(api.updateOmpSkillSettings).not.toHaveBeenCalled()
    expect(modal.emitted('saved')).toBeUndefined()
    expect(wrapper.vm.refreshCount).toBe(0)

    wrapper.vm.close()
    await nextTick()
    wrapper.vm.open()
    await nextTick()

    expect(api.getOmpSkillSettings).toHaveBeenCalledTimes(2)
    expect(modal.findAll('[role="switch"]').map(toggle => toggle.attributes('aria-checked'))).toEqual([
      'true', 'true', 'true', 'true'
    ])
    expect(findButton(modal, '保存').attributes('disabled')).toBeDefined()

    nextLoad.resolve({ success: true, settings: { ...validSettings } })
    await flushPromises()

    expect(modal.findComponent({ name: 'NAlert' }).exists()).toBe(false)
    expect(modal.findAll('[role="switch"]').map(toggle => toggle.attributes('aria-checked'))).toEqual([
      'false', 'true', 'false', 'true'
    ])
    expect(findButton(modal, '保存').attributes('disabled')).toBeUndefined()
    expect(message.error).toHaveBeenCalledTimes(1)
    expect(modal.emitted('saved')).toBeUndefined()
    expect(wrapper.vm.refreshCount).toBe(0)
  })

  test('treats a malformed GET as a load error without partially applying its fields', async () => {
    const nextLoad = deferred()
    api.getOmpSkillSettings
      .mockResolvedValueOnce({
        success: true,
        settings: {
          enableCodexUser: false,
          enableClaudeUser: false,
          enablePiUser: 'false',
          enablePiProject: false
        }
      })
      .mockReturnValueOnce(nextLoad.promise)
    const wrapper = mountControlledSettingsModal({ installDefaultGet: false })
    await flushPromises()
    const modal = wrapper.findComponent(OmpSkillSettingsModal)
    const errorText = '加载技能扫描设置失败: 响应 settings 必须包含四个布尔字段'

    expect(message.error).toHaveBeenCalledTimes(1)
    expect(message.error).toHaveBeenCalledWith(errorText)
    expect(modal.findComponent({ name: 'NAlert' }).text()).toBe(`${errorText} 重试`)
    expect(findButton(modal, '保存').attributes('disabled')).toBeDefined()
    expect(api.updateOmpSkillSettings).not.toHaveBeenCalled()
    expect(modal.emitted('saved')).toBeUndefined()
    expect(wrapper.vm.refreshCount).toBe(0)

    wrapper.vm.close()
    await nextTick()
    wrapper.vm.open()
    await nextTick()

    expect(modal.findAll('[role="switch"]').map(toggle => toggle.attributes('aria-checked'))).toEqual([
      'true', 'true', 'true', 'true'
    ])

    nextLoad.resolve({ success: true, settings: { ...validSettings } })
    await flushPromises()

    expect(modal.findAll('[role="switch"]').map(toggle => toggle.attributes('aria-checked'))).toEqual([
      'false', 'true', 'false', 'true'
    ])
    expect(findButton(modal, '保存').attributes('disabled')).toBeUndefined()
    expect(modal.emitted('saved')).toBeUndefined()
    expect(wrapper.vm.refreshCount).toBe(0)
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
    expect(message.error).toHaveBeenCalledWith('保存技能扫描设置失败: write failed')
    expect(message.error).toHaveBeenCalledTimes(1)
    expect(message.success).toHaveBeenCalledTimes(0)
    expect(wrapper.emitted('update:visible')).toBeUndefined()
    expect(wrapper.find('[data-testid="modal-shell"]').exists()).toBe(true)
    expect(wrapper.props('visible')).toBe(true)
    expect(switches.map(toggle => toggle.attributes('aria-checked'))).toEqual([
      'true', 'true', 'false', 'false'
    ])
  })

  test.each([
    ['success is false', submitted => ({ success: false, settings: submitted }), '响应未明确标记成功'],
    ['one of four fields is invalid', submitted => ({ success: true, settings: { ...submitted, enablePiProject: 'false' } }), '响应 settings 必须包含四个布尔字段'],
    ['echo differs from submitted settings', submitted => ({ success: true, settings: { ...submitted, enablePiProject: !submitted.enablePiProject } }), '响应 settings 与提交值不一致']
  ])('reports the complete validation error when PUT resolves with %s', async (_, responseFor, errorText) => {
    api.updateOmpSkillSettings.mockImplementation(submitted => Promise.resolve(responseFor(submitted)))
    const wrapper = await mountSettingsModal()

    await wrapper.findAll('[role="switch"]')[0].trigger('click')
    await wrapper.findAll('[role="switch"]')[3].trigger('click')
    await findButton(wrapper, '保存').trigger('click')
    await flushPromises()

    expect(api.updateOmpSkillSettings).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('saved')).toBeUndefined()
    expect(message.error).toHaveBeenCalledWith(`保存技能扫描设置失败: ${errorText}`)
    expect(message.error).toHaveBeenCalledTimes(1)
    expect(message.success).toHaveBeenCalledTimes(0)
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
      { ...validSettings, enablePiProject: false },
      0
    ]])
    expect(message.success).toHaveBeenCalledTimes(0)
    expect(message.error).not.toHaveBeenCalled()
  })
  test('locks modal controls during a pending PUT and restores them afterward', async () => {
    const pendingSave = deferred()
    api.updateOmpSkillSettings.mockReturnValue(pendingSave.promise)
    const wrapper = await mountSettingsModal()
    const saveButton = findButton(wrapper, '保存')

    await saveButton.trigger('click')
    await nextTick()

    expect(wrapper.findComponent({ name: 'NModal' }).props()).toMatchObject({
      closable: false,
      maskClosable: false,
      closeOnEsc: false
    })
    expect(wrapper.findAll('[role="switch"]').every(toggle => toggle.attributes('disabled') !== undefined)).toBe(true)
    expect(findButton(wrapper, '取消').attributes('disabled')).toBeDefined()
    expect(saveButton.attributes('loading')).toBeDefined()
    expect(message.success).toHaveBeenCalledTimes(0)

    pendingSave.resolve({ success: true, settings: { ...validSettings } })
    await flushPromises()
    await nextTick()

    expect(wrapper.findComponent({ name: 'NModal' }).props()).toMatchObject({
      closable: true,
      maskClosable: true,
      closeOnEsc: true
    })
    expect(wrapper.findAll('[role="switch"]').every(toggle => toggle.attributes('disabled') === undefined)).toBe(true)
    expect(findButton(wrapper, '取消').attributes('disabled')).toBeUndefined()
    expect(saveButton.attributes('loading')).toBe('false')
    expect(saveButton.attributes('disabled')).toBeUndefined()
    expect(message.success).toHaveBeenCalledTimes(0)
    expect(message.error).toHaveBeenCalledTimes(0)
  })

  test('does not show a success toast in the modal after PUT succeeds', async () => {
    api.updateOmpSkillSettings.mockImplementation(submitted => Promise.resolve({ success: true, settings: { ...submitted } }))
    const wrapper = await mountSettingsModal()
    await findButton(wrapper, '保存').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('saved')).toHaveLength(1)
    expect(message.success).not.toHaveBeenCalled()
  })

  test('reports refresh success only after saved closes and refreshes', async () => {
    api.getOmpSkillSettings.mockResolvedValue({ success: true, settings: { ...validSettings } })
    api.updateOmpSkillSettings.mockImplementation(submitted => Promise.resolve({ success: true, settings: { ...submitted } }))
    api.getSkills.mockResolvedValueOnce({ success: true, skills: [{ key: 'old', name: '旧技能', installed: true }] })
      .mockResolvedValueOnce({ success: true, skills: [{ key: 'new', name: '新技能', installed: false }] })
    const wrapper = mountTracked(SkillsPanel, { props: { platform: 'omp' }, global: { stubs: irrelevantStubs } })
    await flushPromises()
    await findButton(wrapper, '设置').trigger('click')
    await flushPromises()
    const modal = wrapper.findComponent(OmpSkillSettingsModal)
    await findButton(modal, '保存').trigger('click')
    await flushPromises()

    expect(modal.props('visible')).toBe(false)
    expect(wrapper.text()).toContain('新技能')
    expect(message.success).toHaveBeenCalledWith('技能扫描设置已保存')
    expect(message.error).not.toHaveBeenCalled()
  })

  test('keeps the existing list and reports refresh failure after saved', async () => {
    api.getOmpSkillSettings.mockResolvedValue({ success: true, settings: { ...validSettings } })
    api.updateOmpSkillSettings.mockImplementation(submitted => Promise.resolve({ success: true, settings: { ...submitted } }))
    api.getSkills.mockResolvedValueOnce({ success: true, skills: [{ key: 'old', name: '旧技能', installed: true }] })
      .mockRejectedValueOnce(new Error('refresh failed'))
    const wrapper = mountTracked(SkillsPanel, { props: { platform: 'omp' }, global: { stubs: irrelevantStubs } })
    await flushPromises()
    await findButton(wrapper, '设置').trigger('click')
    await flushPromises()
    const modal = wrapper.findComponent(OmpSkillSettingsModal)
    await findButton(modal, '保存').trigger('click')
    await flushPromises()

    expect(modal.props('visible')).toBe(false)
    expect(wrapper.text()).toContain('旧技能')
    expect(message.success).not.toHaveBeenCalled()
    expect(message.error).toHaveBeenCalledWith('设置已保存，但技能列表刷新失败')
  })

  test('keeps settings buttons focusable and keyboard reachable', async () => {
    const wrapper = mountTracked(SkillsPanel, { props: { platform: 'omp' }, global: { stubs: irrelevantStubs } })
    await flushPromises()
    const button = findSettingsButton(wrapper)
    expect(button.attributes('tabindex')).not.toBe('-1')
    expect(button.element.disabled).toBe(false)
    expect(button.element.tabIndex).toBeGreaterThanOrEqual(0)
  })

  test('keeps a reopened modal intact when the earlier PUT resolves', async () => {
    const oldSave = deferred()
    api.updateOmpSkillSettings.mockReturnValueOnce(oldSave.promise)
    const wrapper = mountControlledSettingsModal()
    await flushPromises()
    const modal = wrapper.findComponent(OmpSkillSettingsModal)
    await modal.findAll('[role="switch"]')[0].trigger('click')
    await findButton(modal, '保存').trigger('click')
    await nextTick()

    wrapper.vm.close()
    await nextTick()
    wrapper.vm.open()
    await flushPromises()
    await modal.findAll('[role="switch"]')[1].trigger('click')

    oldSave.resolve({ success: true, settings: { ...validSettings } })
    await flushPromises()
    await nextTick()

    expect(modal.props('visible')).toBe(true)
    expect(modal.findAll('[role="switch"]')[1].attributes('aria-checked')).toBe('false')
    expect(findButton(modal, '保存').attributes('disabled')).toBeUndefined()
    expect(modal.emitted('saved')).toBeUndefined()
    expect(wrapper.vm.refreshCount).toBe(0)
    expect(message.success).toHaveBeenCalledTimes(0)
    expect(message.error).toHaveBeenCalledTimes(0)
  })

  test('keeps a reopened modal intact when the earlier PUT rejects', async () => {
    const oldSave = deferred()
    api.updateOmpSkillSettings.mockReturnValueOnce(oldSave.promise)
    const wrapper = mountControlledSettingsModal()
    await flushPromises()
    const modal = wrapper.findComponent(OmpSkillSettingsModal)
    await modal.findAll('[role="switch"]')[0].trigger('click')
    await findButton(modal, '保存').trigger('click')
    await nextTick()

    wrapper.vm.close()
    await nextTick()
    wrapper.vm.open()
    await flushPromises()
    await modal.findAll('[role="switch"]')[1].trigger('click')

    oldSave.reject(new Error('stale write failed'))
    await flushPromises()
    await nextTick()

    expect(modal.props('visible')).toBe(true)
    expect(modal.findAll('[role="switch"]')[1].attributes('aria-checked')).toBe('false')
    expect(findButton(modal, '保存').attributes('disabled')).toBeUndefined()
    expect(modal.emitted('saved')).toBeUndefined()
    expect(wrapper.vm.refreshCount).toBe(0)
    expect(message.success).not.toHaveBeenCalled()
    expect(message.error).not.toHaveBeenCalled()
  })
})

describe('SkillsPanel successful settings flow', () => {
  test('closes the real modal and forces one OMP refresh after saved', async () => {
    api.getOmpSkillSettings.mockResolvedValue({ success: true, settings: { ...validSettings } })
    api.updateOmpSkillSettings.mockImplementation(submitted => Promise.resolve({ success: true, settings: { ...submitted } }))
    const wrapper = mountTracked(SkillsPanel, { props: { platform: 'omp' }, global: { stubs: irrelevantStubs } })
    await flushPromises()
    api.getSkills.mockClear()

    await findButton(wrapper, '设置').trigger('click')
    await flushPromises()
    const modal = wrapper.findComponent(OmpSkillSettingsModal)
    await findButton(modal, '保存').trigger('click')
    await flushPromises()

    expect(api.updateOmpSkillSettings).toHaveBeenCalledTimes(1)
    expect(modal.emitted('saved')).toHaveLength(1)
    expect(api.getSkills).toHaveBeenCalledWith(true, 'omp', {})
    expect(modal.props('visible')).toBe(false)
  })

  test('ignores a pending OMP save after the panel switches to Claude', async () => {
    api.getOmpSkillSettings.mockResolvedValue({ success: true, settings: { ...validSettings } })
    let resolveUpdate
    api.updateOmpSkillSettings.mockImplementation(submitted => new Promise(resolve => {
      resolveUpdate = () => resolve({ success: true, settings: { ...submitted } })
    }))
    const wrapper = mountTracked(SkillsPanel, { props: { platform: 'omp' }, global: { stubs: irrelevantStubs } })
    await flushPromises()
    api.getSkills.mockClear()

    await findSettingsButton(wrapper).trigger('click')
    await flushPromises()
    const modal = wrapper.findComponent(OmpSkillSettingsModal)
    await findButton(modal, '保存').trigger('click')
    await nextTick()
    await wrapper.setProps({ platform: 'claude' })
    await flushPromises()
    resolveUpdate()
    await flushPromises()

    expect(modal.emitted('saved')).toBeUndefined()
    expect(message.success).not.toHaveBeenCalled()
    expect(message.error).not.toHaveBeenCalled()
    expect(modal.props('visible')).toBe(false)
  })

  test('ignores a saved event from an earlier modal opening', async () => {
    api.getOmpSkillSettings.mockResolvedValue({ success: true, settings: { ...validSettings } })
    const wrapper = mountTracked(SkillsPanel, { props: { platform: 'omp' }, global: { stubs: irrelevantStubs } })
    await flushPromises()
    api.getSkills.mockClear()
    await findSettingsButton(wrapper).trigger('click')
    await flushPromises()
    const modal = wrapper.findComponent(OmpSkillSettingsModal)
    const staleToken = modal.props('operationToken')
    modal.vm.$emit('update:visible', false)
    await nextTick()
    await findSettingsButton(wrapper).trigger('click')
    await flushPromises()
    modal.vm.$emit('saved', { ...validSettings }, staleToken)
    await flushPromises()

    expect(api.getSkills).not.toHaveBeenCalled()
    expect(modal.props('visible')).toBe(true)
  })

  test('ignores a saved event when the current platform is not OMP', async () => {
    const wrapper = mountTracked(SkillsPanel, { props: { platform: 'omp' }, global: { stubs: irrelevantStubs } })
    await flushPromises()
    const modal = wrapper.findComponent(OmpSkillSettingsModal)
    await wrapper.setProps({ platform: 'claude' })
    await flushPromises()
    api.getSkills.mockClear()
    modal.vm.$emit('saved', { ...validSettings }, modal.props('operationToken'))
    await flushPromises()

    expect(api.getSkills).not.toHaveBeenCalled()
  })
})
