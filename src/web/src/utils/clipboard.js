function legacyCopyText(text) {
  if (typeof document === 'undefined') return false

  const textArea = document.createElement('textarea')
  textArea.value = text
  textArea.setAttribute('readonly', '')
  textArea.style.position = 'fixed'
  textArea.style.top = '-9999px'
  textArea.style.left = '-9999px'
  textArea.style.opacity = '0'

  document.body.appendChild(textArea)
  textArea.focus()
  textArea.select()
  textArea.setSelectionRange(0, text.length)

  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }

  document.body.removeChild(textArea)
  return copied
}

function showManualCopyPrompt(text) {
  if (typeof window === 'undefined' || typeof window.prompt !== 'function') {
    return false
  }
  window.prompt('自动复制失败，请手动复制以下内容：', text)
  return true
}

export async function copyTextToClipboard(text, options = {}) {
  const copyText = String(text || '')
  if (!copyText) {
    throw new Error('没有可复制的内容')
  }

  const { manualFallback = true } = options
  let clipboardError = null
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(copyText)
      return { copied: true, method: 'clipboard' }
    } catch (err) {
      clipboardError = err
    }
  }

  if (legacyCopyText(copyText)) {
    return { copied: true, method: 'execCommand' }
  }

  if (manualFallback && showManualCopyPrompt(copyText)) {
    return { copied: false, method: 'manual', error: clipboardError || null }
  }

  throw clipboardError || new Error('当前环境不支持自动复制，请手动复制命令')
}
