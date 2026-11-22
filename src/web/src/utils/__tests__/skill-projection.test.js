import { describe, expect, test } from 'vitest'
import { isProjectionUnsupported } from '../skill-projection'

describe('isProjectionUnsupported', () => {
  test('detects unsupported projection mode and state', () => {
    expect(isProjectionUnsupported({ projection: { mode: 'unsupported' } })).toBe(true)
    expect(isProjectionUnsupported({ projection: { state: 'unsupported' } })).toBe(true)
    expect(isProjectionUnsupported({ projection: { mode: 'native-copy', state: 'disabled' } })).toBe(false)
    expect(isProjectionUnsupported({ projection: null })).toBe(false)
    expect(isProjectionUnsupported(null)).toBe(false)
  })
})
