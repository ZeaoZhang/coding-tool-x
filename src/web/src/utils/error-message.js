function stringifyError(value, seen = new Set()) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Error) return String(value.message || '').trim()
  if (typeof value !== 'object') return ''
  if (seen.has(value)) return ''
  seen.add(value)

  for (const key of ['message', 'error', 'detail', 'reason']) {
    const nested = stringifyError(value[key], seen)
    if (nested) return nested
  }

  if (value.status === 'unsupported') return '当前 CLI 暂不支持该操作'
  if (value.status === 'invalid') return '渠道参数无效'
  if (value.status === 'failed') return '渠道操作失败'
  if (value.code) return String(value.code)

  try {
    const serialized = JSON.stringify(value)
    return serialized && serialized !== '{}' ? serialized : ''
  } catch {
    return ''
  }
}

export function resolveErrorMessage(error, fallback = '操作失败') {
  const candidates = [
    error?.response?.data?.error,
    error?.response?.data?.message,
    error?.data?.error,
    error?.data?.message,
    error?.message,
    error
  ]

  for (const candidate of candidates) {
    const message = stringifyError(candidate)
    if (message && message !== '[object Object]') return message
  }
  return fallback
}
