const UNKNOWN_PROJECT_VALUES = new Set([
  'unknown',
  'unknow',
  'n/a',
  'na',
  'none',
  'null',
  'undefined',
  '未知',
  '未知项目'
])

function normalizeValue(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function isUnknownProjectValue(value) {
  const normalized = normalizeValue(value)
  return !normalized || UNKNOWN_PROJECT_VALUES.has(normalized.toLowerCase())
}

export function isDisplayableProject(project) {
  if (!project || typeof project !== 'object') return false

  return [project.name, project.displayName, project.fullPath, project.path]
    .some(value => !isUnknownProjectValue(value))
}

export function filterDisplayableProjects(projects) {
  return Array.isArray(projects) ? projects.filter(isDisplayableProject) : []
}

export function isDisplayableSession(session, fallbackProjectName = null) {
  if (!session || typeof session !== 'object') return false
  if (isUnknownProjectValue(session.sessionId)) return false

  const projectValues = [
    session.projectName,
    session.projectDisplayName,
    session.projectFullPath,
    session.projectPath
  ]
  const hasProjectValue = projectValues.some(value => normalizeValue(value))
  const hasKnownProjectValue = projectValues.some(value => !isUnknownProjectValue(value))

  // A session payload may omit project metadata when it is already scoped to a
  // known project. Explicitly unknown metadata must still stay hidden.
  if (hasProjectValue) return hasKnownProjectValue
  return !isUnknownProjectValue(fallbackProjectName)
}

export function filterDisplayableSessions(sessions, fallbackProjectName = null) {
  return Array.isArray(sessions)
    ? sessions.filter(session => isDisplayableSession(session, fallbackProjectName))
    : []
}
