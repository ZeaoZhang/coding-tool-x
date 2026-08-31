import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn()
}))

vi.mock('../client', () => ({
  client: mocks
}))

import { getSkills, installSkill, installLocalSkill } from '../skills'

beforeEach(() => {
  mocks.get.mockReset()
  mocks.post.mockReset()
  mocks.get.mockResolvedValue({ data: { success: true, skills: [] } })
  mocks.post.mockResolvedValue({ data: { success: true } })
})

it('sends project scope and cwd when installing a remote Skill', async () => {
  await installSkill(
    'project-skill',
    { owner: 'owner', name: 'skills' },
    null,
    'codex',
    { scope: 'project', cwd: '/tmp/project' }
  )

  expect(mocks.post).toHaveBeenCalledWith('/skills/install', {
    directory: 'project-skill',
    repo: { owner: 'owner', name: 'skills' },
    fullDirectory: null,
    platform: 'codex',
    scope: 'project',
    cwd: '/tmp/project'
  })
})

it('sends project scope and cwd when installing a local Skill', async () => {
  await installLocalSkill('project-skill', 'codex', {
    scope: 'project',
    cwd: '/tmp/project'
  })

  expect(mocks.post).toHaveBeenCalledWith('/skills/install-local', {
    directory: 'project-skill',
    platform: 'codex',
    scope: 'project',
    cwd: '/tmp/project'
  })
})

it('includes project scope in Skill list parameters', async () => {
  await getSkills(false, 'codex', { scope: 'project', cwd: '/tmp/project' })

  expect(mocks.get).toHaveBeenCalledWith('/skills', expect.objectContaining({
    params: expect.objectContaining({
      platform: 'codex',
      scope: 'project',
      cwd: '/tmp/project'
    })
  }))
})
