import { describe, expect, it } from 'vitest'
import {
  filterDisplayableProjects,
  filterDisplayableSessions,
  isDisplayableSession
} from '../session-visibility'

describe('session visibility', () => {
  it('hides projects without a known name or directory', () => {
    expect(filterDisplayableProjects([
      { name: 'unknown', displayName: 'unknown', fullPath: '' },
      { name: 'known-project', displayName: 'Known project', fullPath: '/tmp/known-project' },
      { name: 'unknown', displayName: 'Known project', fullPath: '' }
    ])).toEqual([
      { name: 'known-project', displayName: 'Known project', fullPath: '/tmp/known-project' },
      { name: 'unknown', displayName: 'Known project', fullPath: '' }
    ])
  })

  it('hides sessions whose project metadata is explicitly unknown', () => {
    expect(filterDisplayableSessions([
      { sessionId: 'unknown-session', projectName: 'unknown', projectDisplayName: 'unknown' },
      { sessionId: 'known-session', projectName: 'known-project', projectFullPath: '/tmp/known-project' }
    ])).toEqual([
      { sessionId: 'known-session', projectName: 'known-project', projectFullPath: '/tmp/known-project' }
    ])
  })

  it('keeps scoped sessions when the payload omits project metadata', () => {
    expect(isDisplayableSession({ sessionId: 'scoped-session' }, 'known-project')).toBe(true)
    expect(isDisplayableSession({ sessionId: 'scoped-session' }, 'unknown')).toBe(false)
  })
})
