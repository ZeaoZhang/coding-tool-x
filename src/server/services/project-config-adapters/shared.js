'use strict';

const fs = require('fs');
const { randomUUID } = require('crypto');
const path = require('path');
const toml = require('@iarna/toml');
const {
  normalizeSafeRelativePath,
  resolveInsideRoot
} = require('../config-artifact-paths');

const SECRET_KEY_PATTERN = /(?:token|secret|password|api[-_]?key|access[_-]?token|authorization|headers?|env(?:ironment)?|auth|oauth|credential|private[_-]?key)/i;
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
const MCP_ID_PATTERN = /^[a-zA-Z0-9_.-]{1,100}$/;
const RESERVED_MCP_IDS = new Set(['__proto__', 'constructor', 'prototype']);

function validateMcpId(id) {
  const normalized = String(id || '').trim();
  if (!MCP_ID_PATTERN.test(normalized) || RESERVED_MCP_IDS.has(normalized)) {
    throw new Error('Invalid MCP server ID');
  }
  return normalized;
}

function isRedactedSecret(value) {
  return value === '[REDACTED]' || value === '[redacted]';
}

function mergeSecretValue(existing, incoming) {
  if (incoming === undefined || incoming === null || isRedactedSecret(incoming)) return existing;
  if (isPlainObject(existing) && isPlainObject(incoming)) {
    const merged = { ...existing };
    for (const [key, value] of Object.entries(incoming)) {
      merged[key] = isRedactedSecret(value)
        ? existing[key]
        : value;
    }
    return merged;
  }
  return incoming;
}

function mergeMcpPatch(existingNative, incomingSpec, fromNative = value => value, toNative = value => value) {
  const existing = isPlainObject(fromNative(existingNative)) ? fromNative(existingNative) : {};
  const incoming = isPlainObject(incomingSpec) ? incomingSpec : {};
  const merged = { ...existing, ...incoming };
  for (const key of ['env', 'headers']) {
    if (Object.prototype.hasOwnProperty.call(existing, key) || Object.prototype.hasOwnProperty.call(incoming, key)) {
      merged[key] = mergeSecretValue(existing[key], incoming[key]);
    }
  }
  if (
    typeof existing.url === 'string'
    && typeof incoming.url === 'string'
    && /(?:%5B|\[)redacted(?:%5D|\])/i.test(incoming.url)
  ) {
    merged.url = existing.url;
  }

  const type = merged.type || existing.type || 'stdio';
  merged.type = type;
  if (type === 'stdio') {
    delete merged.url;
  } else {
    delete merged.command;
    delete merged.args;
    delete merged.cwd;
    delete merged.env;
  }
  return toNative(merged);
}

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

  const tempPath = `${target}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  let fileDescriptor;
  try {
    const constants = fsImpl.constants || fs.constants;
    const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0);
    fileDescriptor = fsImpl.openSync(tempPath, flags, 0o600);
    const tempRealPath = fsImpl.realpathSync(tempPath);
    const rootRealPath = fsImpl.realpathSync(path.resolve(projectRoot));
    const relative = path.relative(rootRealPath, tempRealPath);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Project target escapes root: ${relativePath}`);
    }
    fsImpl.writeFileSync(fileDescriptor, String(content ?? ''), 'utf8');
    fsImpl.closeSync(fileDescriptor);
    fileDescriptor = undefined;
    assertNoSymlinkComponents(path.resolve(projectRoot), parentDir, fsImpl);
    fsImpl.renameSync(tempPath, target);
  } catch (error) {
    if (fileDescriptor !== undefined) {
      try {
        fsImpl.closeSync(fileDescriptor);
      } catch (_) {}
    }
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

const SENSITIVE_URL_QUERY_KEY = /^(?:token|secret|password|api[-_]?key|access[_-]?token|authorization|key)$/i;

function redactUrlSecrets(value) {
  if (typeof value !== 'string') return value;
  try {
    const parsed = new URL(value);
    parsed.username = '';
    parsed.password = '';
    for (const key of parsed.searchParams.keys()) {
      if (SENSITIVE_URL_QUERY_KEY.test(key)) parsed.searchParams.set(key, '[REDACTED]');
    }
    return parsed.toString();
  } catch {
    return value
      .replace(/\/\/[^/@\s:]+:[^@/\s]+@/g, '//[REDACTED]@')
      .replace(/([?&](?:token|secret|password|api[-_]?key|access[_-]?token|authorization|key)=)[^&\s]+/gi, '$1[REDACTED]');
  }
}

function redactSecrets(value, key = '') {
  if (SECRET_KEY_PATTERN.test(key)) return '[REDACTED]';
  if (/^url$/i.test(key)) return redactUrlSecrets(value);
  if (Array.isArray(value)) return value.map(item => redactSecrets(item));
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [childKey, redactSecrets(childValue, childKey)])
  );
}

function readMcpServerMap(projectRoot, relativePath, serverKey, fsImpl = fs) {
  const config = readJsonFile(projectRoot, relativePath, {}, fsImpl);
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { config: {}, servers: {} };
  }
  if (!config[serverKey] || typeof config[serverKey] !== 'object' || Array.isArray(config[serverKey])) {
    config[serverKey] = {};
  }
  return { config, servers: config[serverKey] };
}

function createJsonMcpHandlers({
  relativePath,
  format,
  serverKey = 'mcpServers',
  toNative = value => value,
  fromNative = value => value,
  validateId = validateMcpId,
  fsImpl = fs
} = {}) {
  function readProjectMcp(projectRoot) {
    const { servers } = readMcpServerMap(projectRoot, relativePath, serverKey, fsImpl);
    return {
      supported: true,
      path: relativePath,
      format,
      servers: Object.entries(servers).map(([id, nativeSpec]) => {
        const normalizedId = validateId(id);
        return {
          id: normalizedId,
          scope: 'project',
          server: redactSecrets(fromNative(nativeSpec)),
          enabled: nativeSpec?.enabled !== false
        };
      })
    };
  }

  function readProjectMcpSpec(projectRoot, id) {
    const normalizedId = validateId(id);
    const { servers } = readMcpServerMap(projectRoot, relativePath, serverKey, fsImpl);
    if (!Object.prototype.hasOwnProperty.call(servers, normalizedId)) return null;
    return fromNative(servers[normalizedId]);
  }
  function upsertProjectMcp(projectRoot, id, spec) {
    const normalizedId = validateId(id);
    const { config, servers } = readMcpServerMap(projectRoot, relativePath, serverKey, fsImpl);
    const existing = servers[normalizedId] && typeof servers[normalizedId] === 'object' ? servers[normalizedId] : {};
    servers[normalizedId] = mergeMcpPatch(existing, spec, fromNative, toNative);
    writeJsonFileAtomic(projectRoot, relativePath, config, fsImpl);
    return {
      success: true,
      supported: true,
      path: relativePath,
      format,
      id: normalizedId,
      scope: 'project',
      server: redactSecrets(fromNative(servers[normalizedId])),
      enabled: servers[normalizedId].enabled !== false
    };
  }

  function removeProjectMcp(projectRoot, id) {
    const normalizedId = validateId(id);
    const { config, servers } = readMcpServerMap(projectRoot, relativePath, serverKey, fsImpl);
    const removed = Object.prototype.hasOwnProperty.call(servers, normalizedId);
    if (removed) {
      delete servers[normalizedId];
      writeJsonFileAtomic(projectRoot, relativePath, config, fsImpl);
    }
    return { success: true, supported: true, path: relativePath, format, id: normalizedId, scope: 'project', removed };
  }

  return { readProjectMcp, readProjectMcpSpec, upsertProjectMcp, removeProjectMcp };
}

function createTomlMcpHandlers({
  relativePath,
  format,
  serverKey = 'mcp_servers',
  toNative = value => value,
  fromNative = value => value,
  validateId = validateMcpId,
  fsImpl = fs
} = {}) {
  function readTomlServerMap(projectRoot) {
    const config = readTomlFile(projectRoot, relativePath, {}, fsImpl);
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      return { config: {}, servers: {} };
    }
    if (!config[serverKey] || typeof config[serverKey] !== 'object' || Array.isArray(config[serverKey])) {
      config[serverKey] = {};
    }
    return { config, servers: config[serverKey] };
  }

  function readProjectMcp(projectRoot) {
    const { servers } = readTomlServerMap(projectRoot);
    return {
      supported: true,
      path: relativePath,
      format,
      servers: Object.entries(servers).map(([id, nativeSpec]) => {
        const normalizedId = validateId(id);
        return {
          id: normalizedId,
          scope: 'project',
          server: redactSecrets(fromNative(nativeSpec)),
          enabled: nativeSpec?.enabled !== false
        };
      })
    };
  }

  function readProjectMcpSpec(projectRoot, id) {
    const normalizedId = validateId(id);
    const { servers } = readTomlServerMap(projectRoot);
    if (!Object.prototype.hasOwnProperty.call(servers, normalizedId)) return null;
    return fromNative(servers[normalizedId]);
  }

  function upsertProjectMcp(projectRoot, id, spec) {
    const normalizedId = validateId(id);
    const { config, servers } = readTomlServerMap(projectRoot);
    const existing = servers[normalizedId] && typeof servers[normalizedId] === 'object' ? servers[normalizedId] : {};
    servers[normalizedId] = mergeMcpPatch(existing, spec, fromNative, toNative);
    writeTomlFileAtomic(projectRoot, relativePath, config, fsImpl);
    return {
      success: true,
      supported: true,
      path: relativePath,
      format,
      id: normalizedId,
      scope: 'project',
      server: redactSecrets(fromNative(servers[normalizedId])),
      enabled: servers[normalizedId].enabled !== false
    };
  }

  function removeProjectMcp(projectRoot, id) {
    const normalizedId = validateId(id);
    const { config, servers } = readTomlServerMap(projectRoot);
    const removed = Object.prototype.hasOwnProperty.call(servers, normalizedId);
    if (removed) {
      delete servers[normalizedId];
      writeTomlFileAtomic(projectRoot, relativePath, config, fsImpl);
    }
    return { success: true, supported: true, path: relativePath, format, id: normalizedId, scope: 'project', removed };
  }

  return { readProjectMcp, readProjectMcpSpec, upsertProjectMcp, removeProjectMcp };
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
    readProjectMcpSpec: mcpHandlers.readProjectMcpSpec || (() => null),
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
  redactSecrets,
  validateMcpId,
  mergeMcpPatch,
  createProjectAdapter,
  createJsonMcpHandlers,
  createTomlMcpHandlers
};
