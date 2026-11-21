import { beforeEach, describe, expect, test, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const hoisted = vi.hoisted(() => ({
  messages: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
  api: {
    getDshProfiles: vi.fn(),
    getDshAgentPresets: vi.fn(),
    saveDshAgentPreset: vi.fn(),
    deleteDshAgentPreset: vi.fn()
  }
}))

const { messages, api } = hoisted

vi.mock('../../api/dsh-agent-presets', () => ({
  getDshProfiles: api.getDshProfiles,
  getDshAgentPresets: api.getDshAgentPresets,
  saveDshAgentPreset: api.saveDshAgentPreset,
  deleteDshAgentPreset: api.deleteDshAgentPreset
}))
vi.mock('naive-ui', () => {
  const simple = { template: '<div><slot /></div>' }
  return {
    NButton: { emits: ['click'], template: '<button class="n-button" @click="$emit(\'click\')"><slot /></button>' },
    NInput: {
      props: ['value', 'disabled', 'placeholder', 'type'],
      emits: ['update:value'],
      inheritAttrs: false,
      template: '<input class="preset-input" :value="value" :placeholder="placeholder" @input="$emit(\'update:value\', $event.target.value)" />'
    },
    NInputNumber: {
      props: ['value'],
      emits: ['update:value'],
      template: '<input class="preset-order" :value="value" />'
    },
    NSelect: simple,
    NSpin: simple,
    NAlert: simple,
    useMessage: () => messages
  }
})

let DshAgentPresetsPanel

function mountPanel() {
  return mount(DshAgentPresetsPanel)
}

function buttonByText(wrapper, text) {
  return wrapper.findAll('.n-button').find(button => button.text().includes(text))
}

beforeEach(async () => {
  vi.clearAllMocks()
  api.getDshProfiles.mockResolvedValue([{ name: 'default' }])
  api.getDshAgentPresets.mockResolvedValue({ presets: [], revision: 7 })
  api.saveDshAgentPreset.mockResolvedValue({})
  DshAgentPresetsPanel = (await import('../DshAgentPresetsPanel.vue')).default
})

describe('DshAgentPresetsPanel preset validation', () => {
  test('requires a preset id and never calls the save API when it is empty', async () => {
    const wrapper = mountPanel()
    await flushPromises()

    await buttonByText(wrapper, '新建预设').trigger('click')
    await flushPromises()

    await buttonByText(wrapper, '保存预设').trigger('click')
    await flushPromises()

    expect(api.saveDshAgentPreset).not.toHaveBeenCalled()
    expect(messages.error).toHaveBeenCalledWith(expect.stringContaining('预设 ID'))
  })

  test('saves a trimmed preset id when provided', async () => {
    const wrapper = mountPanel()
    await flushPromises()

    await buttonByText(wrapper, '新建预设').trigger('click')
    await flushPromises()

    await wrapper.find('.preset-input').setValue('  review  ')
    await buttonByText(wrapper, '保存预设').trigger('click')
    await flushPromises()

    expect(api.saveDshAgentPreset).toHaveBeenCalledWith(
      'default',
      expect.objectContaining({ id: 'review' }),
      7
    )
  })
})
