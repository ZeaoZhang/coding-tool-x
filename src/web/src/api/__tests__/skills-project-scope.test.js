import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn()
}))

vi.mock('../client', () => ({
  client: mocks
}))

import { getSkills, refreshSkills, getSkillRefreshTask, toggleSkill } from '../skills'

beforeEach(() => {
  mocks.get.mockReset()
  mocks.post.mockReset()
  mocks.put.mockReset()
  mocks.get.mockResolvedValue({ data: { success: true, skills: [] } })
  mocks.post.mockResolvedValue({ data: { success: true, task: { id: 'task-1', status: 'queued' } } })
  mocks.put.mockResolvedValue({ data: { success: true, enabled: false } })
})

it('sends project scope and cwd when scanning local Skills', async () => {
  await getSkills('codex', { scope: 'project', cwd: '/tmp/project' })

  expect(mocks.get).toHaveBeenCalledWith('/skills', expect.objectContaining({
    params: expect.objectContaining({
      platform: 'codex',
      scope: 'project',
      cwd: '/tmp/project'
    })
  }))
})

it('uses an explicit POST endpoint for manual refresh', async () => {
  await refreshSkills('codex', { scope: 'project', cwd: '/tmp/project' })

  expect(mocks.post).toHaveBeenCalledWith('/skills/refresh', {
    platform: 'codex',
    scope: 'project',
    cwd: '/tmp/project'
  })
})

it('sends platform and project context when polling a refresh task', async () => {
  await getSkillRefreshTask('task-1', {
    platform: 'codex',
    scope: 'project',
    cwd: '/tmp/project'
  })

  expect(mocks.get).toHaveBeenCalledWith('/skills/refresh/task-1', {
    params: {
      platform: 'codex',
      scope: 'project',
      cwd: '/tmp/project'
    }
  })
})

it('uses the control endpoint for project Skill toggles', async () => {
  await toggleSkill('skill:codex:project:/tmp/project:demo', false, 'codex', {
    scope: 'project',
    cwd: '/tmp/project'
  })

  expect(mocks.put).toHaveBeenCalledWith('/skills/toggle', {
    controlKey: 'skill:codex:project:/tmp/project:demo',
    enabled: false,
    platform: 'codex',
    scope: 'project',
    cwd: '/tmp/project'
  })
})
