const inflight = new Map()

function realProjectPath(value = '') {
  return value ? String(value) : ''
}

export function requestKey(resource, platform = '', scope = '', projectPath = '') {
  return `${resource}:${platform}:${scope}:${realProjectPath(projectPath)}`
}

export function requestSingleflight(key, request, resource = key.split(':', 1)[0], abortGroup = resource) {
  const existing = inflight.get(key)
  if (existing) return existing.promise

  for (const [otherKey, entry] of inflight) {
    if (entry.abortGroup === abortGroup && otherKey !== key) {
      entry.abortController.abort()
    }
  }

  const abortController = new AbortController()
  const entry = {
    promise: null,
    startedAt: Date.now(),
    abortController,
    resource,
    abortGroup
  }
  entry.promise = Promise.resolve()
    .then(() => request(abortController.signal))
    .finally(() => {
      if (inflight.get(key) === entry) inflight.delete(key)
    })
  inflight.set(key, entry)
  return entry.promise
}

export function clearRequest(key) {
  const entry = inflight.get(key)
  if (!entry) return false
  entry.abortController.abort()
  inflight.delete(key)
  return true
}

/**
 * Drop the in-flight entry for `key` without aborting the underlying request.
 *
 * Used when cached data is invalidated: the next read must start a fresh
 * request instead of joining a response that predates the mutation.
 */
export function forgetRequest(key) {
  return inflight.delete(key)
}

export function clearResourceRequests(resource) {
  for (const [key, entry] of inflight) {
    if (entry.resource !== resource) continue
    entry.abortController.abort()
    inflight.delete(key)
  }
}
