import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadUrl, openInNewTab } from '../open-url'

describe('open-url', () => {
  let clickSpy

  beforeEach(() => {
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns false for an empty url without touching the browser', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    expect(openInNewTab('')).toBe(false)
    expect(openInNewTab('   ')).toBe(false)
    expect(openInNewTab(undefined)).toBe(false)
    expect(openSpy).not.toHaveBeenCalled()
    expect(clickSpy).not.toHaveBeenCalled()
  })

  it('opens a tab and severs the opener reference', () => {
    const fakeWindow = { opener: {} }
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => fakeWindow)

    expect(openInNewTab('https://example.com/docs')).toBe(true)

    expect(openSpy).toHaveBeenCalledWith('https://example.com/docs', '_blank')
    expect(fakeWindow.opener).toBeNull()
    expect(clickSpy).not.toHaveBeenCalled()
  })

  it('falls back to an anchor when the popup is blocked', () => {
    vi.spyOn(window, 'open').mockImplementation(() => null)

    expect(openInNewTab('https://example.com/docs')).toBe(true)

    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(document.querySelectorAll('a[href="https://example.com/docs"]')).toHaveLength(0)
  })

  it('downloads through a temporary anchor', () => {
    expect(downloadUrl('https://example.com/export.csv')).toBe(true)

    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(downloadUrl('  ')).toBe(false)
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })
})
