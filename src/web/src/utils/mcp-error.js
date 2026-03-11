function pickMessage(input) {
  if (!input) return ''
  if (typeof input === 'string') return input

  return (
    input.message
    || input.error
    || input.result?.message
    || input.result?.error
    || input.response?.data?.message
    || input.response?.data?.error
    || input.response?.data?.result?.message
    || input.response?.data?.result?.error
    || input.data?.message
    || input.data?.error
    || ''
  )
}

function pickHint(input) {
  return (
    input?.hint
    || input?.data?.hint
    || input?.result?.hint
    || input?.result?.data?.hint
    || input?.response?.data?.hint
    || input?.response?.data?.result?.hint
    || input?.response?.data?.result?.data?.hint
    || null
  )
}

export function resolveMcpErrorMessage(input, fallback = '操作失败') {
  const text = String(pickMessage(input) || '').trim()
  return text || fallback
}

export function showMcpError(message, input, fallback = '操作失败', prefix = '') {
  const text = resolveMcpErrorMessage(input, fallback)
  const hint = pickHint(input)
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  const hintLines = [
    hint?.title,
    ...(Array.isArray(hint?.details) ? hint.details : [])
  ]
    .map(line => String(line || '').trim())
    .filter(Boolean)
    .filter(line => !lines.includes(line))
  const mergedLines = [...lines, ...hintLines]

  const summary = mergedLines[0] || fallback
  const details = mergedLines.slice(1)
  const finalSummary = prefix ? `${prefix}${summary}` : summary

  message.error(finalSummary, { duration: details.length > 0 ? 8000 : 5000 })
  if (details.length > 0) {
    message.warning(details.join('\n'), {
      duration: 12000,
      closable: true
    })
  }

  return text
}
