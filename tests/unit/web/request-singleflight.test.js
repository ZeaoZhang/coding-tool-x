import { describe, expect, it, vi } from 'vitest'
import {
  clearResourceRequests,
  requestKey,
  requestSingleflight
} from '../../../src/web/src/api/request-singleflight.js'

describe('requestSingleflight', () => {
  it('shares the promise for an identical resource query key', async () => {
    const key = requestKey('skills', 'claude', 'user', '/tmp/project')
    const request = vi.fn(async () => ({ success: true }))

    const first = requestSingleflight(key, request, 'skills', 'skills:claude')
    const second = requestSingleflight(key, request, 'skills', 'skills:claude')

    expect(second).toBe(first)
    await expect(first).resolves.toEqual({ success: true })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('does not abort a different platform query for the same resource', async () => {
    const pending = []
    const makeRequest = vi.fn((signal) => new Promise((resolve, reject) => {
      const entry = { resolve, reject, aborted: false }
      pending.push(entry)
      signal.addEventListener('abort', () => {
        entry.aborted = true
        reject(new DOMException('aborted', 'AbortError'))
      }, { once: true })
    }))

    const claude = requestSingleflight(
      requestKey('channels', 'claude'),
      signal => makeRequest(signal),
      'channels',
      'channels:claude'
    )
    const codex = requestSingleflight(
      requestKey('channels', 'codex'),
      signal => makeRequest(signal),
      'channels',
      'channels:codex'
    )

    await Promise.resolve()
    expect(pending).toHaveLength(2)
    expect(pending[0].aborted).toBe(false)

    pending[0].resolve({ platform: 'claude' })
    pending[1].resolve({ platform: 'codex' })
    await expect(claude).resolves.toEqual({ platform: 'claude' })
    await expect(codex).resolves.toEqual({ platform: 'codex' })
    clearResourceRequests('channels')
  })

  it('removes rejected requests so a later call can retry', async () => {
    const key = requestKey('plugins', 'claude')
    const request = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({ success: true })

    await expect(requestSingleflight(key, request, 'plugins', 'plugins:claude')).rejects.toThrow('temporary failure')
    await expect(requestSingleflight(key, request, 'plugins', 'plugins:claude')).resolves.toEqual({ success: true })
    expect(request).toHaveBeenCalledTimes(2)
  })
})
