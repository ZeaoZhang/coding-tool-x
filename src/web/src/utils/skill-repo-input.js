function normalizeDirectory(directory = '') {
  return String(directory || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
}

export function isLikelyLocalPath(input = '') {
  return /^(\/|~\/|\.\/|\.\.\/|[a-zA-Z]:[\\/]|file:\/\/)/.test(String(input || '').trim())
}

function parseGitHubUrl(parsed) {
  const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').split('/').filter(Boolean)
  if (parts.length < 2) return null

  const repo = {
    provider: 'github',
    host: `${parsed.protocol}//${parsed.host}`,
    owner: parts[0],
    name: parts[1]
  }

  if ((parts[2] === 'tree' || parts[2] === 'blob') && parts[3]) {
    repo.branch = parts[3]
    const repoPath = parts.slice(4)
    if (parts[2] === 'blob' && repoPath.length > 0) {
      repo.directory = normalizeDirectory(repoPath.slice(0, -1).join('/'))
    } else {
      repo.directory = normalizeDirectory(repoPath.join('/'))
    }
  }

  return repo
}

function parseGitLabUrl(parsed) {
  const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').split('/').filter(Boolean)
  if (parts.length === 0) return null

  const treeIndex = parts.findIndex((part, index) => part === '-' && (parts[index + 1] === 'tree' || parts[index + 1] === 'blob'))
  const projectParts = treeIndex >= 0 ? parts.slice(0, treeIndex) : parts
  if (projectParts.length === 0) return null

  const repo = {
    provider: 'gitlab',
    host: `${parsed.protocol}//${parsed.host}`,
    projectPath: projectParts.join('/')
  }

  if (treeIndex >= 0 && parts[treeIndex + 2]) {
    repo.branch = parts[treeIndex + 2]
    const repoPath = parts.slice(treeIndex + 3)
    if (parts[treeIndex + 1] === 'blob' && repoPath.length > 0) {
      repo.directory = normalizeDirectory(repoPath.slice(0, -1).join('/'))
    } else {
      repo.directory = normalizeDirectory(repoPath.join('/'))
    }
  }

  return repo
}

export function parseRepoInput(input = '') {
  const value = String(input || '').trim()
  if (!value) return null

  if (isLikelyLocalPath(value)) {
    return {
      provider: 'local',
      localPath: value
    }
  }

  const sshMatch = value.match(/^git@([^:]+):(.+?)(?:\.git)?$/i)
  if (sshMatch) {
    const host = `https://${sshMatch[1]}`
    const projectPath = sshMatch[2].replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '')
    const provider = sshMatch[1].includes('github') ? 'github' : 'gitlab'
    if (provider === 'gitlab') {
      return { provider, host, projectPath }
    }
    const parts = projectPath.split('/')
    if (parts.length >= 2) {
      return { provider, host, owner: parts[0], name: parts[1] }
    }
  }

  try {
    const parsed = new URL(value)
    if (parsed.hostname.includes('github')) {
      return parseGitHubUrl(parsed)
    }
    return parseGitLabUrl(parsed)
  } catch {
    // noop
  }

  const parts = value.split('/').filter(Boolean)
  if (parts.length === 2) {
    return { provider: 'github', owner: parts[0], name: parts[1] }
  }

  return null
}

export { normalizeDirectory }
