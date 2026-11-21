import { describe, expect, it } from 'vitest'
import { formatErrorMessage } from '../error-message'

describe('formatErrorMessage', () => {
  it('returns plain strings unchanged', () => {
    expect(formatErrorMessage('端口被占用')).toBe('端口被占用')
  })

  it('flattens driver error objects', () => {
    expect(formatErrorMessage({
      error: { status: 'failed', platform: 'dsh', error: 'DSH 代理启动失败' }
    })).toBe('DSH 代理启动失败')
  })

  it('prefers message fields', () => {
    expect(formatErrorMessage({ message: '网络错误' })).toBe('网络错误')
  })

  it('falls back for unknown payloads', () => {
    expect(formatErrorMessage({}, '操作失败')).toBe('操作失败')
    expect(formatErrorMessage(null, '操作失败')).toBe('操作失败')
  })
})
