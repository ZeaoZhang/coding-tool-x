import { nextTick } from 'vue'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { applyTemplate, previewTemplate, getAvailableProjects, messageApi } = vi.hoisted(() => ({
  applyTemplate: vi.fn(),
  previewTemplate: vi.fn(),
  getAvailableProjects: vi.fn(),
  messageApi: { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}))

vi.mock('../../api/config-templates', () => ({ applyTemplate, previewTemplate }))
vi.mock('../../api/workspaces', () => ({ getAvailableProjects }))
vi.mock('naive-ui', async () => {
  const actual = await vi.importActual('naive-ui')
  return {
    ...actual,
    useMessage: () => messageApi
  }
})

import ConfigApplyModal from '../ConfigApplyModal.vue'

const FormStub = {
  name: 'NForm',
  methods: {
    validate() {
      return Promise.resolve()
    }
  },
  template: '<form><slot /></form>'
}

const ButtonStub = {
  name: 'NButton',
  props: ['disabled', 'loading', 'type'],
  emits: ['click'],
  template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
}

const ModalStub = {
  name: 'NModal',
  template: '<div><slot /><slot name="footer" /></div>'
}

const SpaceStub = {
  name: 'NSpace',
  props: ['justify', 'align', 'vertical', 'size', 'wrap'],
  template: '<div><slot /></div>'
}

const TextStub = {
  name: 'NText',
  props: ['depth', 'type', 'code', 'strong'],
  template: '<span><slot /></span>'
}

function mountModal(template) {
  return shallowMount(ConfigApplyModal, {
    props: { show: false, template },
    global: {
      stubs: {
        Form: FormStub,
        Button: ButtonStub,
        Modal: ModalStub,
        Space: SpaceStub,
        Text: TextStub
      }
    }
  })
}

function findButton(wrapper, label) {
  const button = wrapper.findAll('button').find(node => node.text() === label)
  return button || null
}

describe('ConfigApplyModal resource-only templates', () => {
  beforeEach(() => {
    applyTemplate.mockReset()
    previewTemplate.mockReset()
    getAvailableProjects.mockReset()
    messageApi.success.mockReset()
    messageApi.error.mockReset()

    getAvailableProjects.mockResolvedValue({ success: true, data: [] })
    previewTemplate.mockResolvedValue({ success: true, data: { summary: {} } })
    applyTemplate.mockResolvedValue({ success: true, data: { results: { skipped: [] } } })
  })

  it('allows applying a template that only contains Skills/Agents/Commands', async () => {
    const wrapper = mountModal({
      id: 'tpl-resources',
      name: '资源模版',
      aiConfigs: {},
      claudeMd: null,
      skills: ['skill-a'],
      agents: ['agent-a'],
      commands: ['command-a']
    })

    wrapper.vm.formData.targetPath = '/tmp/project'
    await nextTick()

    const applyButton = findButton(wrapper, '确认应用')
    expect(applyButton).not.toBeNull()
    expect(applyButton.element.disabled).toBe(false)
    expect(findButton(wrapper, '预览应用效果').element.disabled).toBe(false)

    await applyButton.trigger('click')
    await flushPromises()

    expect(applyTemplate).toHaveBeenCalledWith('tpl-resources', '/tmp/project', [])
    expect(messageApi.success).toHaveBeenCalled()
  })

  it('keeps apply disabled with a Chinese hint when there is nothing to apply', async () => {
    const wrapper = mountModal({
      id: 'tpl-empty',
      name: '空模版',
      aiConfigs: {},
      claudeMd: null,
      skills: [],
      agents: [],
      commands: []
    })

    wrapper.vm.formData.targetPath = '/tmp/project'
    await nextTick()

    const applyButton = findButton(wrapper, '确认应用')
    expect(applyButton.element.disabled).toBe(true)
    expect(wrapper.text()).toContain('当前模版没有可应用的配置或资源')
  })

  it('still requires a target path', async () => {
    const wrapper = mountModal({
      id: 'tpl-resources',
      name: '资源模版',
      aiConfigs: {},
      skills: ['skill-a']
    })

    const applyButton = findButton(wrapper, '确认应用')
    expect(applyButton.element.disabled).toBe(true)
    expect(wrapper.text()).toContain('请先填写目标项目路径')
  })
})
