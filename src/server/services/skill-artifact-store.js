'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  normalizeSafeRelativePath,
  resolveInsideRoot
} = require('../../shared/config-artifact-paths');

const FORBIDDEN_METADATA_KEYS = new Set([
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
  'serverspec'
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizedKey(key) {
  return String(key).replace(/[_-]/g, '').toLowerCase();
}

function assertSafeMetadata(value) {
  if (Array.isArray(value)) {
    value.forEach(assertSafeMetadata);
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_METADATA_KEYS.has(normalizedKey(key))) {
      throw new Error(`Skill artifact metadata contains forbidden secret field: ${key}`);
    }
    assertSafeMetadata(child);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function contentBuffer(file) {
  if (Buffer.isBuffer(file.content)) return Buffer.from(file.content);
  if (file.encoding === 'base64') return Buffer.from(String(file.content || ''), 'base64');
  if (file.content === undefined || file.content === null) {
    throw new Error(`Skill artifact file ${file.relativePath || ''} has no content`);
  }
  return Buffer.from(String(file.content), 'utf8');
}

function normalizePlatform(platform) {
  const value = String(platform || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(value)) throw new Error('Invalid Skill artifact platform');
  return value;
}

function normalizeFormat(format) {
  const value = String(format || '').trim();
  if (!/^[a-z][a-z0-9-]*$/.test(value)) throw new Error('Invalid Skill artifact format');
  return value;
}

function hashFileTree(files) {
  const hash = crypto.createHash('sha256');
  const normalized = files
    .map(file => ({
      relativePath: normalizeSafeRelativePath(file.relativePath, 'Skill artifact file path', { allowHiddenSegments: true }),
      content: contentBuffer(file)
    }))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  for (const file of normalized) {
    hash.update(file.relativePath);
    hash.update('\0');
    hash.update(file.content);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function ensureNoSymlinkPath(fsImpl, root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('Skill artifact path escapes root');
  }
  if (fsImpl.existsSync(resolvedRoot)) {
    const rootStat = fsImpl.lstatSync(resolvedRoot);
    if (rootStat.isSymbolicLink()) throw new Error(`Skill artifact path contains symlink: ${resolvedRoot}`);
    if (!rootStat.isDirectory()) throw new Error('Skill artifact root is not a directory');
  }

  let current = resolvedRoot;
  const relative = path.relative(resolvedRoot, resolvedTarget);
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = path.join(current, segment);
    if (!fsImpl.existsSync(current)) continue;
    const stat = fsImpl.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`Skill artifact path contains symlink: ${current}`);
  }
}

function removePath(fsImpl, target) {
  if (!fsImpl.existsSync(target)) return;
  const stat = fsImpl.lstatSync(target);
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    fsImpl.rmSync(target, { recursive: true, force: true });
  } else {
    fsImpl.unlinkSync(target);
  }
}

class SkillArtifactStore {
  constructor({ root, fsImpl = fs, hashFileTree: hashTree = hashFileTree } = {}) {
    if (!root || typeof root !== 'string') throw new Error('Skill artifact root is required');
    this.root = path.resolve(root);
    this.fs = fsImpl;
    this.hashFileTree = hashTree;
  }

  _artifactDir({ platform, sourceKey, format }) {
    const normalizedPlatform = normalizePlatform(platform);
    const normalizedFormat = normalizeFormat(format);
    const key = String(sourceKey || '').trim();
    if (!key) throw new Error('Skill artifact sourceKey is required');
    const sourceHash = crypto.createHash('sha256').update(key).digest('hex');
    const platformDir = path.join(this.root, normalizedPlatform);
    const sourceDir = path.join(platformDir, sourceHash);
    const formatDir = path.join(sourceDir, normalizedFormat);
    ensureNoSymlinkPath(this.fs, this.root, platformDir);
    ensureNoSymlinkPath(this.fs, this.root, sourceDir);
    ensureNoSymlinkPath(this.fs, this.root, formatDir);
    return { normalizedPlatform, normalizedFormat, sourceKey: key, sourceHash, platformDir, sourceDir, formatDir };
  }

  _normalizeFiles(files) {
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error('Skill artifact files are required');
    }
    const seen = new Set();
    const normalized = files.map(file => {
      if (!isPlainObject(file) || file.type === 'symlink' || file.symlink || file.linkTarget) {
        throw new Error('Skill artifact symlink entries are not allowed');
      }
      const relativePath = normalizeSafeRelativePath(file.relativePath, 'Skill artifact file path', {
        allowHiddenSegments: true
      });
      if (seen.has(relativePath)) throw new Error(`Duplicate Skill artifact file: ${relativePath}`);
      seen.add(relativePath);
      return {
        relativePath,
        content: contentBuffer(file),
        mode: Number.isInteger(file.mode) ? file.mode & 0o777 : null
      };
    });
    const skillFile = normalized.find(file => file.relativePath === 'SKILL.md');
    if (!skillFile || skillFile.content.length === 0) {
      throw new Error('Skill artifact must contain a non-empty root SKILL.md');
    }
    return normalized;
  }

  _writeFiles(tempContentDir, files) {
    this.fs.mkdirSync(tempContentDir, { recursive: true });
    for (const file of files) {
      const destination = resolveInsideRoot(tempContentDir, file.relativePath, 'Skill artifact file path', {
        allowHiddenSegments: true
      });
      ensureNoSymlinkPath(this.fs, tempContentDir, destination);
      this.fs.mkdirSync(path.dirname(destination), { recursive: true });
      this.fs.writeFileSync(destination, file.content);
      if (file.mode !== null && typeof this.fs.chmodSync === 'function') {
        this.fs.chmodSync(destination, file.mode);
      }
    }
  }

  publishSkill({ platform, sourceKey, files, format, metadata = {} } = {}) {
    const paths = this._artifactDir({ platform, sourceKey, format });
    const normalizedFiles = this._normalizeFiles(files);
    assertSafeMetadata(metadata);
    const contentHash = this.hashFileTree(normalizedFiles);
    const now = Date.now();
    const safeMetadata = clone(metadata);
    const artifactMetadata = {
      ...safeMetadata,
      platform: paths.normalizedPlatform,
      sourceKey: paths.sourceKey,
      format: paths.normalizedFormat,
      contentHash,
      state: 'ready',
      fetchedAt: safeMetadata.fetchedAt || now,
      updatedAt: now
    };
    const parentDir = paths.sourceDir;
    const tempFormatDir = path.join(parentDir, `.${paths.normalizedFormat}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
    const tempContentDir = path.join(tempFormatDir, 'content');
    const tempMetadataPath = path.join(tempFormatDir, 'metadata.json');
    const targetFormatDir = paths.formatDir;
    const backupFormatDir = path.join(parentDir, `.${paths.normalizedFormat}.bak-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);

    try {
      this.fs.mkdirSync(parentDir, { recursive: true });
      ensureNoSymlinkPath(this.fs, this.root, parentDir);
      this._writeFiles(tempContentDir, normalizedFiles);
      this.fs.writeFileSync(tempMetadataPath, `${JSON.stringify(artifactMetadata, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      });
      if (typeof this.fs.chmodSync === 'function') this.fs.chmodSync(tempMetadataPath, 0o600);

      let movedExisting = false;
      if (this.fs.existsSync(targetFormatDir)) {
        ensureNoSymlinkPath(this.fs, this.root, targetFormatDir);
        this.fs.renameSync(targetFormatDir, backupFormatDir);
        movedExisting = true;
      }
      try {
        this.fs.renameSync(tempFormatDir, targetFormatDir);
      } catch (error) {
        if (movedExisting && this.fs.existsSync(backupFormatDir) && !this.fs.existsSync(targetFormatDir)) {
          this.fs.renameSync(backupFormatDir, targetFormatDir);
        }
        throw error;
      }
      if (movedExisting) removePath(this.fs, backupFormatDir);
    } catch (error) {
      removePath(this.fs, tempFormatDir);
      removePath(this.fs, backupFormatDir);
      throw error;
    }

    return {
      ...clone(artifactMetadata),
      root: path.join(targetFormatDir, 'content'),
      metadataPath: path.join(targetFormatDir, 'metadata.json')
    };
  }

  _readMetadata(metadataPath, fallback = {}) {
    try {
      const parsed = JSON.parse(this.fs.readFileSync(metadataPath, 'utf8'));
      if (!isPlainObject(parsed)) return null;
      assertSafeMetadata(parsed);
      return {
        ...parsed,
        root: fallback.root || path.join(path.dirname(metadataPath), 'content'),
        metadataPath
      };
    } catch (error) {
      if (error.message && error.message.includes('forbidden secret')) throw error;
      return null;
    }
  }

  list({ platform } = {}) {
    const normalizedPlatform = normalizePlatform(platform);
    const platformDir = path.join(this.root, normalizedPlatform);
    if (!this.fs.existsSync(platformDir)) return [];
    ensureNoSymlinkPath(this.fs, this.root, platformDir);
    const result = [];
    for (const sourceEntry of this.fs.readdirSync(platformDir, { withFileTypes: true })) {
      if (!sourceEntry.isDirectory() || sourceEntry.isSymbolicLink()) continue;
      const sourceDir = path.join(platformDir, sourceEntry.name);
      ensureNoSymlinkPath(this.fs, this.root, sourceDir);
      for (const formatEntry of this.fs.readdirSync(sourceDir, { withFileTypes: true })) {
        if (!formatEntry.isDirectory() || formatEntry.isSymbolicLink()) continue;
        const formatDir = path.join(sourceDir, formatEntry.name);
        ensureNoSymlinkPath(this.fs, this.root, formatDir);
        const metadata = this._readMetadata(path.join(formatDir, 'metadata.json'));
        if (!metadata || !this.fs.existsSync(metadata.root)) continue;
        if (this.fs.lstatSync(metadata.root).isSymbolicLink()) continue;
        result.push(metadata);
      }
    }
    return result;
  }

  get({ platform, sourceKey, format } = {}) {
    const normalizedPlatform = normalizePlatform(platform);
    const normalizedSourceKey = String(sourceKey || '').trim();
    const sourceHash = crypto.createHash('sha256').update(normalizedSourceKey).digest('hex');
    const sourceDir = path.join(this.root, normalizedPlatform, sourceHash);
    if (!this.fs.existsSync(sourceDir)) return null;
    ensureNoSymlinkPath(this.fs, this.root, sourceDir);
    if (!this.fs.lstatSync(sourceDir).isDirectory()) return null;
    const formats = format
      ? [normalizeFormat(format)]
      : this.fs.readdirSync(sourceDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && !entry.isSymbolicLink())
        .map(entry => entry.name);
    for (const formatName of formats) {
      const formatDir = path.join(sourceDir, formatName);
      if (!this.fs.existsSync(formatDir)) continue;
      ensureNoSymlinkPath(this.fs, this.root, formatDir);
      if (!this.fs.lstatSync(formatDir).isDirectory()) continue;
      const metadata = this._readMetadata(path.join(formatDir, 'metadata.json'));
      if (metadata && metadata.sourceKey === normalizedSourceKey) return metadata;
    }
    return null;
  }

  markState({ platform, sourceKey, format, state, lastError = null } = {}) {
    const artifact = this.get({ platform, sourceKey, format });
    if (!artifact) throw new Error('Skill artifact not found');
    const allowedStates = new Set(['ready', 'metadata_only', 'stale', 'missing', 'pending', 'orphaned', 'failed', 'unsupported']);
    if (!allowedStates.has(state)) throw new Error('Invalid Skill artifact state');
    const metadata = {
      ...artifact,
      state,
      ...(lastError ? { lastError: String(lastError) } : { lastError: null }),
      updatedAt: Date.now()
    };
    const persisted = { ...metadata };
    delete persisted.root;
    delete persisted.metadataPath;
    const metadataPath = artifact.metadataPath;
    const tempPath = `${metadataPath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      this.fs.writeFileSync(tempPath, `${JSON.stringify(persisted, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      });
      this.fs.renameSync(tempPath, metadataPath);
    } catch (error) {
      removePath(this.fs, tempPath);
      throw error;
    }
    return { ...metadata, metadataPath, root: artifact.root };
  }
}

module.exports = {
  SkillArtifactStore,
  hashFileTree
};
