'use strict';

const fs = require('fs');
const path = require('path');
const toml = require('@iarna/toml');
const {
  normalizeSafeRelativePath,
  resolveInsideRoot
} = require('../config-artifact-paths');

const SECRET_KEY_PATTERN = /(?:token|secret|password|api[-_]?key|authorization|headers?|env)/i;

function assertExistingProjectRoot(projectRoot, fsImpl = fs) {
  if (typeof projectRoot !== 'string' || !projectRoot.trim()) {
    throw new Error('Invalid project path');
  }

  const resolvedRoot = path.resolve(projectRoot.trim());
  if (!fsImpl.existsSync(resolvedRoot)) {
    throw new Error('Project path does not exist');
  }

  const stat = fsImpl.statSync(resolvedRoot);
  if (!stat.isDirectory()) {
    throw new Error('Project path must be a directory');
  }

  return typeof fsImpl.realpathSync === 'function'
    ? fsImpl.realpathSync(resolvedRoot)
    : resolvedRoot;
}

function assertNoSymlinkComponents(rootDir, targetPath, fsImpl = fs) {
  if (typeof fsImpl.lstatSync !== 'function') return;

  const root = path.resolve(rootDir);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Project target escapes root: ${targetPath}`);
  }

  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      if (fsImpl.lstatSync(current).isSymbolicLink()) {
        throw new Error(`Project target contains symlink: ${targetPath}`);
      }
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }
}

function resolveProjectTarget(projectRoot, relativePath, label = 'project target', options = {}, fsImpl = fs) {
  const resolvedRoot = path.resolve(projectRoot);
  const safeRelativePath = normalizeSafeRelativePath(relativePath, label, {
    allowHiddenSegments: true,
    ...options
  });
  const target = resolveInsideRoot(resolvedRoot, safeRelativePath, label, {
    allowHiddenSegments: true,
    ...options
  });
  assertNoSymlinkComponents(resolvedRoot, target, fsImpl);
  return target;
}

function readTextFile(projectRoot, relativePath, fsImpl = fs) {
  const target = resolveProjectTarget(projectRoot, relativePath, 'project file', {}, fsImpl);
  if (!fsImpl.existsSync(target)) {
    return { exists: false, path: relativePath, content: '', updatedAt: null };
  }

  const stat = fsImpl.statSync(target);
  if (!stat.isFile()) throw new Error(`Project target is not a file: ${relativePath}`);
  return {
    exists: true,
    path: relativePath,
    content: fsImpl.readFileSync(target, 'utf8'),
    updatedAt: stat.mtimeMs
  };
}

function writeTextFileAtomic(projectRoot, relativePath, content, fsImpl = fs) {
  const target = resolveProjectTarget(projectRoot, relativePath, 'project file', {}, fsImpl);
  const parentDir = path.dirname(target);
  fsImpl.mkdirSync(parentDir, { recursive: true });
  assertNoSymlinkComponents(path.resolve(projectRoot), parentDir, fsImpl);

  const tempPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    fsImpl.writeFileSync(tempPath, String(content ?? ''), 'utf8');
    fsImpl.renameSync(tempPath, target);
  } catch (error) {
    try {
      if (fsImpl.existsSync(tempPath)) fsImpl.unlinkSync(tempPath);
    } catch (_) {}
    throw error;
  }

  return {
    path: relativePath,
    content: String(content ?? ''),
    updatedAt: fsImpl.statSync(target).mtimeMs
  };
}

function deleteProjectFile(projectRoot, relativePath, fsImpl = fs) {
  const target = resolveProjectTarget(projectRoot, relativePath, 'project file', {}, fsImpl);
  if (!fsImpl.existsSync(target)) return false;
  const stat = fsImpl.statSync(target);
  if (!stat.isFile()) throw new Error(`Project target is not a file: ${relativePath}`);
  fsImpl.unlinkSync(target);
  return true;
}

function readJsonFile(projectRoot, relativePath, defaultValue = {}, fsImpl = fs) {
  const file = readTextFile(projectRoot, relativePath, fsImpl);
  if (!file.exists || !file.content.trim()) return defaultValue;
  return JSON.parse(file.content);
}

function writeJsonFileAtomic(projectRoot, relativePath, value, fsImpl = fs) {
  return writeTextFileAtomic(projectRoot, relativePath, JSON.stringify(value, null, 2), fsImpl);
}

function readTomlFile(projectRoot, relativePath, defaultValue = {}, fsImpl = fs) {
  const file = readTextFile(projectRoot, relativePath, fsImpl);
  if (!file.exists || !file.content.trim()) return defaultValue;
  return toml.parse(file.content);
}

function writeTomlFileAtomic(projectRoot, relativePath, value, fsImpl = fs) {
  return writeTextFileAtomic(projectRoot, relativePath, toml.stringify(value), fsImpl);
}

function redactSecrets(value, key = '') {
  if (SECRET_KEY_PATTERN.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map(item => redactSecrets(item));
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [childKey, redactSecrets(childValue, childKey)])
  );
}

function createProjectAdapter({ manifest, fsImpl = fs, mcpHandlers = {} } = {}) {
  const projectResources = manifest?.projectResources || {};
  const instructionPath = projectResources.instruction?.path ?? null;
  const skills = projectResources.skills || { canonicalRoot: '', readRoots: [] };
  const mcp = projectResources.mcp || { path: null, format: 'none' };

  function unsupportedInstruction() {
    return {
      supported: false,
      path: null,
      exists: false,
      content: '',
      updatedAt: null
    };
  }

  function readInstruction(projectRoot) {
    if (!instructionPath) return unsupportedInstruction();
    return {
      supported: true,
      ...readTextFile(projectRoot, instructionPath, fsImpl)
    };
  }

  function writeInstruction(projectRoot, content) {
    if (!instructionPath) return unsupportedInstruction();
    return {
      supported: true,
      ...writeTextFileAtomic(projectRoot, instructionPath, content, fsImpl)
    };
  }

  function deleteInstruction(projectRoot) {
    if (!instructionPath) return unsupportedInstruction();
    return {
      supported: true,
      path: instructionPath,
      deleted: deleteProjectFile(projectRoot, instructionPath, fsImpl)
    };
  }

  function listSkillRoots(projectRoot) {
    return (skills.readRoots || []).map(relativeRoot => ({
      relativeRoot,
      path: resolveProjectTarget(
        projectRoot,
        relativeRoot,
        'project skill root',
        { allowRoot: true },
        fsImpl
      )
    }));
  }

  function emptyProjectMcp() {
    return {
      supported: mcp.format !== 'none' && Boolean(mcp.path),
      path: mcp.path,
      format: mcp.format,
      servers: []
    };
  }

  return {
    describe() {
      return {
        instruction: {
          supported: Boolean(instructionPath),
          path: instructionPath
        },
        skills: {
          supported: Boolean(skills.canonicalRoot),
          canonicalRoot: skills.canonicalRoot,
          readRoots: [...(skills.readRoots || [])]
        },
        mcp: {
          supported: mcp.format !== 'none' && Boolean(mcp.path),
          path: mcp.path,
          format: mcp.format
        }
      };
    },
    readInstruction,
    writeInstruction,
    deleteInstruction,
    listSkillRoots,
    readProjectMcp: mcpHandlers.readProjectMcp || emptyProjectMcp,
    upsertProjectMcp: mcpHandlers.upsertProjectMcp || (() => emptyProjectMcp()),
    removeProjectMcp: mcpHandlers.removeProjectMcp || (() => emptyProjectMcp())
  };
}

module.exports = {
  assertExistingProjectRoot,
  assertNoSymlinkComponents,
  resolveProjectTarget,
  readTextFile,
  writeTextFileAtomic,
  deleteProjectFile,
  readJsonFile,
  writeJsonFileAtomic,
  readTomlFile,
  writeTomlFileAtomic,
  redactSecrets,
  createProjectAdapter
};
