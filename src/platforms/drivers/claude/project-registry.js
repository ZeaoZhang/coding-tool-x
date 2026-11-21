'use strict';

/**
 * Registry for projects initialized through POST /api/{platform}/projects/create.
 *
 * Claude's project list is derived from session files under ~/.claude/projects,
 * while createProject initializes <projectPath>/.claude. Without this registry
 * the two APIs cannot be paired (deleteProject looked only at the session dir
 * and returned "Project not found" for freshly initialized projects).
 */

const fs = require('fs');
const path = require('path');
const { PATHS } = require('../../../config/paths');

function getRegistryPath() {
  const configDir = PATHS.config || path.join(PATHS.base || '', 'config');
  return path.join(configDir, 'claude-project-registry.json');
}

function loadRegistry() {
  try {
    const filePath = getRegistryPath();
    if (!fs.existsSync(filePath)) return {};
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (error) {
    console.error('Failed to load Claude project registry:', error.message);
    return {};
  }
}

function saveRegistry(registry) {
  const filePath = getRegistryPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(registry, null, 2), 'utf8');
}

function registerProject(projectName, info = {}) {
  if (!projectName || !info.projectPath) return null;
  const registry = loadRegistry();
  registry[projectName] = {
    projectName,
    projectPath: info.projectPath,
    claudeDir: info.claudeDir || path.join(info.projectPath, '.claude'),
    createdAt: info.createdAt || new Date().toISOString()
  };
  saveRegistry(registry);
  return registry[projectName];
}

function getRegisteredProject(projectName) {
  if (!projectName) return null;
  return loadRegistry()[projectName] || null;
}

function unregisterProject(projectName) {
  const registry = loadRegistry();
  if (!registry[projectName]) return false;
  delete registry[projectName];
  saveRegistry(registry);
  return true;
}

/**
 * Remove the `.claude` directory created by createProject and drop the entry.
 * Returns the removed registry record, or null when the project is unknown.
 */
function removeRegisteredProject(projectName) {
  const entry = getRegisteredProject(projectName);
  if (!entry) return null;

  const claudeDir = entry.claudeDir || path.join(entry.projectPath, '.claude');
  // Safety: only remove a `.claude` directory that sits directly inside the
  // registered project path. Never follow an arbitrary stored path.
  if (path.basename(claudeDir) === '.claude' && fs.existsSync(claudeDir)) {
    fs.rmSync(claudeDir, { recursive: true, force: true });
  }
  unregisterProject(projectName);
  return entry;
}

module.exports = {
  getRegistryPath,
  loadRegistry,
  registerProject,
  getRegisteredProject,
  unregisterProject,
  removeRegisteredProject
};
