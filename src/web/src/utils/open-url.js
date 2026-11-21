/**
 * Open an external URL in a new tab.
 *
 * `window.open` with a name returns `null` when the browser blocks the popup;
 * in that case the anchor fallback keeps the action working (Chrome allows a
 * user-initiated navigation), so the caller only ever sees a boolean failure
 * for an empty URL.
 *
 * @param {string} url
 * @returns {boolean} whether a navigation was attempted
 */
export function openInNewTab(url) {
  const href = String(url || '').trim()
  if (!href) return false

  const win = window.open(href, '_blank')
  if (win) {
    try {
      win.opener = null
    } catch {
      // Cross-origin windows reject the assignment; the tab is still open.
    }
    return true
  }

  const anchor = document.createElement('a')
  anchor.href = href
  anchor.target = '_blank'
  anchor.rel = 'noopener noreferrer'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  return true
}

/**
 * Trigger a download without navigating away from the page.
 *
 * @param {string} url
 * @returns {boolean} whether a download was requested
 */
export function downloadUrl(url) {
  const href = String(url || '').trim()
  if (!href) return false

  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = ''
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  return true
}
