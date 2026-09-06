import { beforeEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const api = vi.hoisted(() => ({
  getSkills: vi.fn(),
  getProjectSkills: vi.fn(),
  refreshSkills: vi.fn(),
  getSkillRefreshTask: vi.fn(),
  toggleSkill: vi.fn()
}))

vi.mock('../../api/skills', () => ({
  getSkills: api.getSkills,
  refreshSkills: api.refreshSkills,
  getSkillRefreshTask: api.getSkillRefreshTask,
  toggleSkill: api.toggleSkill
}))

vi.mock('../../api/project-config', () => ({
  getProjectSkills: api.getProjectSkills,
  setProjectSkillEnabled: vi.fn()
}))

vi.mock('naive-ui', async () => {
  const actual = await vi.importActual('naive-ui')
  return {
    ...actual,
    useMessage: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() })
  }
})

vi.mock('vue-router', () => ({
  useRoute: () => ({ meta: { channel: 'codex' } })
}))

import SkillsPanel from '../SkillsPanel.vue'

beforeEach(() => {
  api.getSkills.mockReset()
  api.getProjectSkills.mockReset()
  api.getSkills.mockResolvedValue({
    success: true,
    skills: [],
    refresh: { state: 'never_fetched', taskId: null, fetchedAt: null, error: null }
  })
  api.getProjectSkills.mockResolvedValue({
    supported: true,
    project: [{ name: 'project-skill', sourceScope: 'project', scope: 'project' }],
    inherited: [{ name: 'user-skill', sourceScope: 'user', scope: 'user' }],
    path: '.omp/skills'
  })
})

it('loads project Skills through project config without a generic cwd scan', async () => {
  const wrapper = mount(SkillsPanel, {
    props: {
      inDrawer: true,
      drawerVisible: true,
      platform: 'codex',
      projectPath: '/tmp/project',
      scope: 'project'
    },
    global: {
      stubs: {
        SkillCard: {
          props: ['skill'],
          template: '<div>{{ skill.name }}</div>'
        },
        SkillRepoManager: true,
        SkillCreateModal: true,
        SkillDetailDrawer: true,
        OmpSkillSettingsModal: true
      }
    }
  })

  await vi.waitFor(() => expect(api.getProjectSkills).toHaveBeenCalledWith('/tmp/project', 'codex'))
  expect(api.getSkills).not.toHaveBeenCalled()
  await vi.waitFor(() => expect(wrapper.text()).toContain('project-skill'))
  expect(wrapper.text()).toContain('user-skill')
})
