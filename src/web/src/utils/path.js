export function getPathBaseName(input = '') {
  const value = String(input || '').trim()
  if (!value) {
    return ''
  }

  const normalized = value.replace(/[\\/]+$/, '')
  if (!normalized) {
    return ''
  }

  const parts = normalized.split(/[\\/]+/)
  return parts[parts.length - 1] || ''
}
