import { beforeEach, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const getProjectConfig = vi.hoisted(() => vi.fn())
vi.mock('../../api/project-config', () => ({ getProjectConfig }))
vi.mock('../ProjectInstructionPanel.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../ProjectMcpPanel.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../SkillsPanel.vue', () => ({ default: { template: '<div />' } }))
vi.mock('naive-ui', async () => {
  const actual = await vi.importActual('naive-ui')
  return {
    ...actual,
    useMessage: () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() })
  }
})

test('loads project configuration without issuing a remote Skill refresh', async () => {
  getProjectConfig.mockResolvedValue({
    success: true,
    projectPath: '/tmp/project',
    platform: 'codex',
    instruction: { supported: true },
    skills: { supported: true, project: [], inherited: [], refresh: { state: 'never_fetched' } },
    mcp: { supported: true, servers: [] },
    capabilities: { instruction: true, skills: true, mcp: true }
  })
  const { default: ProjectConfigDrawer } = await import('../ProjectConfigDrawer.vue')
  const wrapper = mount(ProjectConfigDrawer, {
    props: { show: true, projectPath: '/tmp/project', platform: 'codex' },
    global: { stubs: { SkillsPanel: true, ProjectMcpPanel: true, ProjectInstructionPanel: true } }
  })

  await vi.waitFor(() => expect(getProjectConfig).toHaveBeenCalledWith('/tmp/project', 'codex'))
  expect(wrapper.props('projectPath')).toBe('/tmp/project')
  expect(getProjectConfig).toHaveBeenCalledTimes(1)
})

beforeEach(() => {
  getProjectConfig.mockReset()
})
