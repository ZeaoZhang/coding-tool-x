import { beforeEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const api = vi.hoisted(() => ({
  getProjectInstruction: vi.fn(),
  saveProjectInstruction: vi.fn(),
  deleteProjectInstruction: vi.fn()
}))


vi.mock('naive-ui', async () => {
  const actual = await vi.importActual('naive-ui')
  return {
    ...actual,
    useMessage: () => ({ success: vi.fn(), error: vi.fn() }),
    useDialog: () => ({ warning: vi.fn() })
  }
})
vi.mock('../../api/project-config', () => api)

import ProjectInstructionPanel from '../ProjectInstructionPanel.vue'

beforeEach(() => {
  api.getProjectInstruction.mockReset()
  api.saveProjectInstruction.mockReset()
  api.deleteProjectInstruction.mockReset()
  api.saveProjectInstruction.mockResolvedValue({
    supported: true,
    path: 'AGENTS.md',
    exists: true,
    content: '# Saved'
  })
})

it('saves instruction content for the exact project path and platform', async () => {
  const wrapper = mount(ProjectInstructionPanel, {
    props: {
      projectPath: '/tmp/project',
      platform: 'codex',
      instruction: {
        supported: true,
        path: 'AGENTS.md',
        exists: true,
        content: '# Initial'
      }
    }
  })

  const input = wrapper.find('textarea')
  await input.setValue('# Saved')
  await wrapper.get('button[data-action="save-instruction"]').trigger('click')

  expect(api.saveProjectInstruction).toHaveBeenCalledWith('/tmp/project', 'codex', '# Saved')
})

it('does not render save controls for unsupported instructions', () => {
  const wrapper = mount(ProjectInstructionPanel, {
    props: {
      projectPath: '/tmp/project',
      platform: 'omp',
      instruction: { supported: false, path: null, exists: false, content: '' }
    }
  })

  expect(wrapper.text()).toContain('当前平台不提供项目指令文件')
  expect(wrapper.find('button[data-action="save-instruction"]').exists()).toBe(false)
})
