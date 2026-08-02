const fs = require('fs');
const path = require('path');
const workspaceService = require('./workspace-service');

function realDirectory(candidate) {
  if (!candidate || !path.isAbsolute(candidate)) return '';
  try {
    const stat = fs.statSync(candidate);
    return stat.isDirectory() ? fs.realpathSync(candidate) : '';
  } catch {
    return '';
  }
}

async function getKnownProjectPaths() {
  const known = new Set();
  const add = candidate => {
    const resolved = realDirectory(candidate);
    if (resolved) known.add(resolved);
  };

  add(process.cwd());
  for (const workspace of workspaceService.listWorkspaces()) {
    add(workspace.path);
    for (const project of workspace.projects || []) {
      add(project.sourcePath);
      if (workspace.path && project.name) {
        add(path.join(workspace.path, project.name));
      }
    }
  }

  try {
    const projects = await workspaceService.getAllAvailableProjects();
    for (const project of projects || []) {
      add(project.fullPath || project.path);
    }
  } catch {
    // Workspace configuration remains a valid authoritative fallback.
  }

  return known;
}

async function validateKnownProjectCwd(rawCwd) {
  if (rawCwd == null || String(rawCwd).trim() === '') return null;
  const input = String(rawCwd).trim();
  if (!path.isAbsolute(input)) {
    throw new Error('Invalid cwd: expected an absolute project or workspace path');
  }
  const resolved = realDirectory(input);
  if (!resolved) {
    throw new Error('Invalid cwd: path does not exist or is not a directory');
  }
  const known = await getKnownProjectPaths();
  if (!known.has(resolved)) {
    throw new Error('Invalid cwd: path is not a known project or workspace');
  }
  return resolved;
}

module.exports = {
  getKnownProjectPaths,
  validateKnownProjectCwd
};
