export function createEmptyWorkspaceProject({ fromExisting = false } = {}) {
  return {
    sourcePath: '',
    name: '',
    createWorktree: false,
    branchMode: 'existing',
    branch: '',
    baseBranch: '',
    isGitRepo: false,
    fromExisting,
    selectedKey: ''
  }
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeWorkspaceProjectForSubmit(project = {}) {
  const normalized = {
    sourcePath: trimString(project.sourcePath),
    name: trimString(project.name),
    createWorktree: project.createWorktree !== false && !!project.isGitRepo
  }

  if (!normalized.name) {
    delete normalized.name
  }

  if (!normalized.createWorktree) {
    return normalized
  }

  normalized.branchMode = project.branchMode === 'new' ? 'new' : 'existing'

  const branch = trimString(project.branch)
  if (branch) {
    normalized.branch = branch
  }

  if (normalized.branchMode === 'new') {
    const baseBranch = trimString(project.baseBranch)
    if (baseBranch) {
      normalized.baseBranch = baseBranch
    }
  }

  return normalized
}
