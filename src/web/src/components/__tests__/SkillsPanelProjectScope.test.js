import { beforeEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const api = vi.hoisted(() => ({
  getSkills: vi.fn(),
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
  api.getSkills.mockResolvedValue({
    success: true,
    skills: [],
    refresh: { state: 'never_fetched', taskId: null, fetchedAt: null, error: null }
  })
})

it('loads Skills with project scope and cwd', async () => {
  mount(SkillsPanel, {
    props: {
      inDrawer: true,
      drawerVisible: true,
      platform: 'codex',
      projectPath: '/tmp/project',
      scope: 'project'
    },
    global: {
      stubs: {
        SkillRepoManager: true,
        SkillCreateModal: true,
        SkillDetailDrawer: true,
        OmpSkillSettingsModal: true
      }
    }
  })

  await vi.waitFor(() => expect(api.getSkills).toHaveBeenCalledWith('codex', {
    cwd: '/tmp/project',
    scope: 'project'
  }))
})
