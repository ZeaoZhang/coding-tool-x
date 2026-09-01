import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn()
}))

vi.mock('../client', () => ({
  client: mocks
}))

import { saveUIConfig } from '../ui-config'

beforeEach(() => {
  mocks.get.mockReset()
  mocks.post.mockReset()
})

it('posts partial config without a preflight read', async () => {
  const config = { enabledCliPlatforms: [] }
  mocks.post.mockResolvedValue({ data: { success: true, config } })

  await expect(saveUIConfig(config)).resolves.toEqual({ success: true, config })

  expect(mocks.get).not.toHaveBeenCalled()
  expect(mocks.post).toHaveBeenCalledWith('/ui-config', { config })
})
