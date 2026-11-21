import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createWorkspace, getAvailableProjects, getAllTemplates, messageApi } = vi.hoisted(() => ({
  createWorkspace: vi.fn(),
  getAvailableProjects: vi.fn(),
  getAllTemplates: vi.fn(),
  messageApi: { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}))

vi.mock('../../api/workspaces', () => ({ createWorkspace, getAvailableProjects }))
vi.mock('../../api/config-templates', () => ({ getAllTemplates }))
vi.mock('naive-ui', async () => {
  const actual = await vi.importActual('naive-ui')
  return {
    ...actual,
    useMessage: () => messageApi
  }
})

import WorkspaceFormModal from '../WorkspaceFormModal.vue'

const FormStub = {
  name: 'NForm',
  methods: {
    validate() {
      return Promise.reject({ errors: [{ message: '请输入工作区名称' }] })
    }
  },
  template: '<form><slot /></form>'
}

const ModalStub = {
  name: 'NModal',
  template: '<div><slot /><slot name="footer" /></div>'
}

function mountModal() {
  return shallowMount(WorkspaceFormModal, {
    props: { show: false },
    global: {
      stubs: {
        Form: FormStub,
        Modal: ModalStub,
        ProjectItem: true
      }
    }
  })
}

describe('WorkspaceFormModal validation', () => {
  beforeEach(() => {
    createWorkspace.mockReset()
    getAvailableProjects.mockReset()
    getAllTemplates.mockReset()
    messageApi.success.mockReset()
    messageApi.error.mockReset()

    createWorkspace.mockResolvedValue({ success: true })
    getAvailableProjects.mockResolvedValue({ success: true, data: [] })
    getAllTemplates.mockResolvedValue({ success: true, data: [] })
  })

  it('does not surface an API error toast when validation rejects', async () => {
    const wrapper = mountModal()

    await wrapper.vm.handleSubmit()
    await flushPromises()

    expect(createWorkspace).not.toHaveBeenCalled()
    expect(messageApi.error).not.toHaveBeenCalled()
    expect(messageApi.warning).not.toHaveBeenCalled()
    expect(messageApi.success).not.toHaveBeenCalled()
  })
})
