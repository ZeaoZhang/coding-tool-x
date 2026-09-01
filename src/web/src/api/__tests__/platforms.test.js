import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn()
}))

function platformPrefix(platform = '') {
  const key = String(platform).trim().toLowerCase()
  return {
    claude: '',
    codex: '/codex',
    gemini: '/gemini',
    opencode: '/opencode',
    omp: '/omp'
  }[key] || `/platforms/${encodeURIComponent(key)}`
}

vi.mock('../client', () => ({
  client: mocks,
  getPlatformApiPrefix: platformPrefix,
  getChannelPrefix: platformPrefix,
  isLegacyPlatformKey: platform => ['claude', 'codex', 'gemini', 'opencode', 'omp']
    .includes(String(platform).trim().toLowerCase())
}))

import { getPlatformProjects, getPlatformSessions } from '../platforms'
import { getProjects } from '../projects'
import { getSessions } from '../sessions'

beforeEach(() => {
  mocks.get.mockReset()
  mocks.get.mockResolvedValue({ data: { success: true } })
})

it('uses the generic prefix for registered non-legacy platforms', async () => {
  await getPlatformProjects('demo-cli')
  await getPlatformSessions('demo-cli', 'project/name')
  await getProjects('demo-cli')
  await getSessions('project/name', 'demo-cli')

  expect(mocks.get).toHaveBeenNthCalledWith(1, '/platforms/demo-cli/projects', { params: undefined })
  expect(mocks.get).toHaveBeenNthCalledWith(2, '/platforms/demo-cli/sessions/project%2Fname', { params: undefined })
  expect(mocks.get).toHaveBeenNthCalledWith(3, '/platforms/demo-cli/projects', { params: undefined })
  expect(mocks.get).toHaveBeenNthCalledWith(4, '/platforms/demo-cli/sessions/project%2Fname', { params: undefined })
})

it('keeps legacy project and session prefixes unchanged', async () => {
  await getProjects('codex')
  await getSessions('project/name', 'codex')

  expect(mocks.get).toHaveBeenNthCalledWith(1, '/codex/projects', { params: undefined })
  expect(mocks.get).toHaveBeenNthCalledWith(2, '/codex/sessions/project/name', { params: {} })
})
