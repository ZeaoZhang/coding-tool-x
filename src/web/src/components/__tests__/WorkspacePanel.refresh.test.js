import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  getWorkspaces: vi.fn(),
  deleteWorkspace: vi.fn(),
  messages: { success: vi.fn(), warning: vi.fn(), error: vi.fn() }
}))

vi.mock('../../api/workspaces', () => ({
  getWorkspaces: hoisted.getWorkspaces,
  deleteWorkspace: hoisted.deleteWorkspace
}))

vi.mock('naive-ui', () => {
  const simple = { template: '<div><slot /></div>' }
  return {
    NButton: { emits: ['click'], template: '<button class="n-button-stub" @click="$emit(\'click\')"><slot /></button>' },
    NIcon: simple,
    NInput: {
      props: ['value'],
      emits: ['update:value'],
      template: '<input class="search-input" :value="value" @input="$emit(\'update:value\', $event.target.value)" />'
    },
    NSpin: { props: ['show'], template: '<div><slot /></div>' },
    NEmpty: { props: ['description'], template: '<div class="empty-state"><slot name="extra" /></div>' },
    useMessage: () => hoisted.messages,
    useDialog: () => ({ warning: vi.fn() })
  }
})

const WorkspaceCardStub = {
  props: ['workspace'],
  emits: ['click', 'view', 'delete'],
  template: '<div class="workspace-card">{{ workspace.name }}</div>'
}

const WorkspaceFormModalStub = {
  props: ['show'],
  emits: ['update:show', 'success'],
  template: '<div class="create-modal" />'
}

let WorkspacePanel

function mountPanel() {
  return mount(WorkspacePanel, {
    props: { inDrawer: true },
    global: {
      stubs: {
        WorkspaceCard: WorkspaceCardStub,
        WorkspaceFormModal: WorkspaceFormModalStub,
        WorkspaceDetailModal: { template: '<div />' }
      }
    }
  })
}

beforeEach(async () => {
  vi.clearAllMocks()
  WorkspacePanel = (await import('../WorkspacePanel.vue')).default
})

describe('WorkspacePanel refresh ordering', () => {
  test('a stale in-flight list cannot override the post-create list', async () => {
    let resolveStale
    hoisted.getWorkspaces
      .mockResolvedValueOnce({ success: true, data: [{ id: 'a', name: 'workspace-a' }] })
      .mockImplementationOnce(() => new Promise(resolve => {
        resolveStale = resolve
      }))
      .mockResolvedValueOnce({
        success: true,
        data: [{ id: 'a', name: 'workspace-a' }, { id: 'b', name: 'workspace-b' }]
      })

    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.findAll('.workspace-card').map(card => card.text())).toEqual(['workspace-a'])

    // Background refresh starts and stays in flight (second header button).
    await wrapper.findAll('.action-btn')[1].trigger('click')
    await flushPromises()

    // Creating a workspace triggers a newer read that already includes it.
    await wrapper.findComponent(WorkspaceFormModalStub).vm.$emit('success')
    await flushPromises()
    expect(wrapper.findAll('.workspace-card').map(card => card.text()))
      .toEqual(['workspace-a', 'workspace-b'])

    // The older read resolves last with the pre-create list.
    resolveStale({ success: true, data: [{ id: 'a', name: 'workspace-a' }] })
    await flushPromises()

    expect(wrapper.findAll('.workspace-card').map(card => card.text()))
      .toEqual(['workspace-a', 'workspace-b'])
  })

  test('notifies listeners only after the refreshed list is applied', async () => {
    hoisted.getWorkspaces.mockResolvedValue({ success: true, data: [{ id: 'a', name: 'workspace-a' }] })
    const wrapper = mountPanel()
    await flushPromises()

    const emittedAt = []
    wrapper.vm.$.emit = ((original) => (...args) => {
      emittedAt.push(hoisted.getWorkspaces.mock.calls.length)
      return original(...args)
    })(wrapper.vm.$.emit)

    await wrapper.findComponent(WorkspaceFormModalStub).vm.$emit('success')
    await flushPromises()

    expect(wrapper.emitted('updated')).toHaveLength(1)
    // The reload happened before the event (two reads total: mount + refresh).
    expect(hoisted.getWorkspaces).toHaveBeenCalledTimes(2)
  })
})
