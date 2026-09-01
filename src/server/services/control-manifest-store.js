'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_CONTROL_MANIFEST = Object.freeze({
  version: 1,
  skills: {},
  mcp: {}
});

const FORBIDDEN_MCP_KEYS = new Set([
  'env',
  'environment',
  'envvars',
  'experimentalenvironment',
  'headers',
  'httpheaders',
  'token',
  'accesstoken',
  'password',
  'secret',
  'secretvalue',
  'authorization',
  'apikey',
  'privatekey',
  'credential',
  'credentials',
  'clientsecret',
  'bearertokenenvvar',
  'auth',
  'oauth',
  'server',
  'serverspec',
  'command',
  'args',
  'url'
]);

const SKILL_ENTRY_KEYS = new Set([
  'kind', 'controlKey', 'platform', 'scope', 'projectPath', 'sourceKey', 'source', 'artifact',
  'targetDirectory', 'cached', 'enabled', 'trust', 'projection', 'managed', 'lastError',
  'createdAt', 'updatedAt', 'name', 'description', 'sourceProvider', 'sourceScope',
  'fullDirectory', 'revision', 'repoId', 'repoProvider', 'repoOwner', 'repoName',
  'repoBranch', 'repoDirectory', 'repoHost', 'repoProjectPath', 'repoLocalPath', 'repoUrl',
  'readmeUrl', 'license', 'readonly', 'protected', 'isLocal'
]);
const MCP_ENTRY_KEYS = new Set([
  'kind', 'controlKey', 'platform', 'scope', 'projectPath', 'name', 'source', 'transport',
  'enabled', 'trust', 'riskTier', 'egressProfile', 'secretRefs', 'secretRef', 'managed',
  'createdAt', 'updatedAt', 'lastError'
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function containsForbiddenMcpKey(value) {
  if (Array.isArray(value)) {
    return value.some(containsForbiddenMcpKey);
  }
  if (!isPlainObject(value)) return false;

  return Object.entries(value).some(([key, child]) => {
    if (FORBIDDEN_MCP_KEYS.has(String(key).replace(/[_-]/g, '').toLowerCase())) {
      return true;
    }
    return containsForbiddenMcpKey(child);
  });
}

function sanitizeEntryMap(value, allowedKeys, label) {
  if (!isPlainObject(value)) throw new Error(`Invalid control manifest: ${label} must be an object`);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    if (!isPlainObject(entry)) throw new Error(`Invalid control manifest: ${label} entry must be an object`);
    return [key, Object.fromEntries(Object.entries(entry).filter(([field]) => allowedKeys.has(field)))];
  }));
}

function validateManifest(value) {
  if (!isPlainObject(value) || value.version !== 1 || !isPlainObject(value.skills) || !isPlainObject(value.mcp)) {
    throw new Error('Invalid control manifest');
  }
  if (containsForbiddenMcpKey(value.skills) || containsForbiddenMcpKey(value.mcp)) {
    throw new Error('Invalid control manifest: secret fields are not allowed');
  }
  return value;
}

function sanitizeManifest(value) {
  validateManifest(value);
  return {
    version: 1,
    ...(value.updatedAt !== undefined ? { updatedAt: value.updatedAt } : {}),
    ...(value.migrationVersion !== undefined ? { migrationVersion: value.migrationVersion } : {}),
    skills: sanitizeEntryMap(value.skills, SKILL_ENTRY_KEYS, 'skills'),
    mcp: sanitizeEntryMap(value.mcp, MCP_ENTRY_KEYS, 'mcp')
  };
}
class ControlManifestStore {
  constructor({ userPath, projectPathResolver, fsImpl = fs } = {}) {
    if (!userPath || typeof userPath !== 'string') {
      throw new Error('Control manifest user path is required');
    }
    if (typeof projectPathResolver !== 'function') {
      throw new Error('Control manifest project path resolver is required');
    }
    this.userPath = path.resolve(userPath);
    this.projectPathResolver = projectPathResolver;
    this.fs = fsImpl;
  }

  _resolvePath({ scope = 'user', projectPath = null } = {}) {
    if (scope === 'user') {
      if (projectPath !== null && projectPath !== undefined) {
        throw new Error('User control manifest cannot include projectPath');
      }
      return this.userPath;
    }
    if (scope !== 'project') {
      throw new Error('Invalid control manifest scope');
    }
    if (typeof projectPath !== 'string' || !path.isAbsolute(projectPath)) {
      throw new Error('Project control manifest requires a canonical absolute projectPath');
    }
    const resolvedProjectPath = path.resolve(projectPath);
    if (!this.fs.existsSync(resolvedProjectPath) || this.fs.realpathSync(resolvedProjectPath) !== resolvedProjectPath) {
      throw new Error('Project control manifest requires a canonical existing projectPath');
    }
    const resolved = this.projectPathResolver({ projectPath: resolvedProjectPath });
    if (!resolved || typeof resolved !== 'string') {
      throw new Error('Control manifest path resolver returned an invalid path');
    }
    return path.resolve(resolved);
  }

  _assertManifestPath(manifestPath) {
    try {
      if (this.fs.lstatSync(manifestPath).isSymbolicLink()) {
        throw new Error('Control manifest path cannot be a symlink');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  read(options = {}) {
    const manifestPath = this._resolvePath(options);
    this._assertManifestPath(manifestPath);
    if (!this.fs.existsSync(manifestPath)) {
      return clone(DEFAULT_CONTROL_MANIFEST);
    }

    try {
      const data = JSON.parse(this.fs.readFileSync(manifestPath, 'utf8'));
      return clone(sanitizeManifest(data));
    } catch (error) {
      if (error && error.message && error.message.startsWith('Invalid control manifest')) {
        throw error;
      }
      throw new Error('Invalid control manifest', { cause: error });
    }
  }

  write(options = {}, manifest = DEFAULT_CONTROL_MANIFEST) {
    const manifestPath = this._resolvePath(options);
    this._assertManifestPath(manifestPath);
    const safeManifest = sanitizeManifest(manifest);
    const directory = path.dirname(manifestPath);
    const tempPath = `${manifestPath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;

    try {
      this.fs.mkdirSync(directory, { recursive: true });
      this.fs.writeFileSync(tempPath, `${JSON.stringify(safeManifest, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      });
      if (typeof this.fs.chmodSync === 'function') {
        this.fs.chmodSync(tempPath, 0o600);
      }
      this.fs.renameSync(tempPath, manifestPath);
      if (typeof this.fs.chmodSync === 'function') {
        this.fs.chmodSync(manifestPath, 0o600);
      }
    } catch (error) {
      try {
        if (this.fs.existsSync(tempPath)) this.fs.unlinkSync(tempPath);
      } catch (_) {
        // Preserve the original write failure.
      }
      throw error;
    }

    return clone(safeManifest);
  }
}

module.exports = {
  ControlManifestStore,
  DEFAULT_CONTROL_MANIFEST
};
