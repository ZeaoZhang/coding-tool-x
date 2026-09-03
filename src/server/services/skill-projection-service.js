'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { NATIVE_PATHS, PATHS } = require('../../config/paths');
const { getOmpPaths } = require('../../platforms/drivers/omp/config');
const { normalizeSafeRelativePath, resolveInsideRoot } = require('../../shared/config-artifact-paths');
const { assertNoSymlinkComponents } = require('../../shared/project-config');

const SUPPORTED_MODES = new Set(['native-copy', 'native-filter']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function removePath(fsImpl, target) {
  if (!fsImpl.existsSync(target)) return;
  const stat = fsImpl.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fsImpl.unlinkSync(target);
    return;
  }
  fsImpl.rmSync(target, { recursive: true, force: true });
}

class SkillProjectionService {
  constructor({ registry, nativeRoots = {}, artifactRoot = PATHS.skillArtifacts, fsImpl = fs } = {}) {
    if (!registry || typeof registry.resolve !== 'function') {
      throw new Error('SkillProjectionService requires a platform registry');
    }
    this.registry = registry;
    this.nativeRoots = nativeRoots;
    this.artifactRoot = artifactRoot ? path.resolve(artifactRoot) : null;
    this.fs = fsImpl;
  }

  getCapability(platform, scope = 'user') {
    const manifest = this.registry.resolve(platform);
    const capability = manifest?.skillActivation?.[scope];
    if (!capability || !SUPPORTED_MODES.has(capability.mode)) {
      return { mode: 'unsupported', format: capability?.format || null };
    }
    return {
      mode: capability.mode,
      format: capability.format || null
    };
  }

  _assertNativeRoot(root) {
    const resolved = path.resolve(root);
    try {
      const rootStat = this.fs.lstatSync(resolved);
      if (rootStat.isSymbolicLink()) {
        throw new Error('Native Skill root contains a symlink');
      }
      if (!rootStat.isDirectory()) {
        throw new Error('Native Skill root is not a directory');
      }
      return resolved;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    let existing = path.dirname(resolved);
    while (!this.fs.existsSync(existing)) {
      const parent = path.dirname(existing);
      if (parent === existing) break;
      existing = parent;
    }
    const stat = this.fs.lstatSync(existing);
    if (stat.isSymbolicLink()) {
      throw new Error('Native Skill root contains a symlink');
    }
    return resolved;
  }

  _userRoot(platform) {
    let root;
    if (this.nativeRoots[platform]) root = this.nativeRoots[platform];
    else if (platform === 'claude') root = NATIVE_PATHS.claude.skills;
    else if (platform === 'codex') root = NATIVE_PATHS.codex.skills || path.join(NATIVE_PATHS.codex.dir, 'skills');
    else if (platform === 'gemini') root = NATIVE_PATHS.gemini.skills || path.join(NATIVE_PATHS.gemini.dir, 'skills');
    else if (platform === 'opencode') root = path.join(NATIVE_PATHS.opencode.config, 'skills');
    else if (platform === 'omp') root = getOmpPaths().skills;
    else throw new Error(`Unsupported Skill platform: ${platform}`);
    return this._assertNativeRoot(root);
  }

  _projectRoot(entry) {
    if (typeof entry.projectPath !== 'string' || !path.isAbsolute(entry.projectPath)) {
      throw new Error('Project Skill projection requires an absolute projectPath');
    }
    const root = path.resolve(entry.projectPath);
    if (!this.fs.existsSync(root) || !this.fs.statSync(root).isDirectory()) {
      throw new Error('Project Skill projection requires an existing projectPath');
    }
    const canonical = this.fs.realpathSync(root);
    if (canonical !== root) {
      throw new Error('Project Skill projection requires a canonical projectPath');
    }
    this._assertNativeRoot(root);
    return canonical;
  }

  _targetPath(entry) {
    const platform = String(entry.platform || '').trim().toLowerCase();
    const scope = entry.scope || 'user';
    const capability = this.getCapability(platform, scope);
    if (capability.mode === 'unsupported') {
      return { capability, target: null, root: null };
    }
    if (capability.mode !== 'native-copy') {
      return { capability, target: null, root: null };
    }

    const root = scope === 'project'
      ? (() => {
        const manifest = this.registry.resolve(platform);
        const relativeRoot = manifest?.projectResources?.skills?.canonicalRoot;
        if (!relativeRoot) throw new Error(`Project Skills are not supported for ${platform}`);
        const projectRoot = this._projectRoot(entry);
        return resolveInsideRoot(projectRoot, relativeRoot, 'project skill root', {
          allowHiddenSegments: true,
          allowRoot: true
        });
      })()
      : this._userRoot(platform);
    this._assertNativeRoot(root);
    const safeDirectory = normalizeSafeRelativePath(entry.targetDirectory, 'Skill target directory', {
      allowHiddenSegments: true
    });
    const target = resolveInsideRoot(root, safeDirectory, 'Skill target directory', {
      allowHiddenSegments: true
    });
    assertNoSymlinkComponents(root, target, this.fs);
    return { capability, target, root };
  }

  _copyTree(source, destination) {
    const sourceStat = this.fs.lstatSync(source);
    if (sourceStat.isSymbolicLink()) throw new Error(`Skill artifact contains symlink: ${source}`);
    if (sourceStat.isDirectory()) {
      this.fs.mkdirSync(destination, { recursive: true });
      assertNoSymlinkComponents(destination, destination, this.fs);
      for (const entry of this.fs.readdirSync(source, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error(`Skill artifact contains symlink: ${path.join(source, entry.name)}`);
        this._copyTree(path.join(source, entry.name), path.join(destination, entry.name));
      }
      return;
    }
    if (!sourceStat.isFile()) throw new Error(`Unsupported Skill artifact entry: ${source}`);
    const parent = path.dirname(destination);
    this.fs.mkdirSync(parent, { recursive: true });
    assertNoSymlinkComponents(path.dirname(destination), destination, this.fs);
    this.fs.copyFileSync(source, destination);
  }

  _artifactRoot(entry) {
    const root = entry.artifact?.root;
    if (!root || !path.isAbsolute(root) || !this.fs.existsSync(root)) {
      throw new Error('Skill artifact is not available');
    }
    const resolved = path.resolve(root);
    if (this.artifactRoot) {
      this._assertNativeRoot(this.artifactRoot);
      const relative = path.relative(this.artifactRoot, resolved);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error('Skill artifact root escapes the artifact store');
      }
      assertNoSymlinkComponents(this.artifactRoot, resolved, this.fs);
    }
    const stat = this.fs.lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('Skill artifact root is not a directory');
    }
    const skillMd = path.join(resolved, 'SKILL.md');
    if (!this.fs.existsSync(skillMd) || this.fs.lstatSync(skillMd).isSymbolicLink()) {
      throw new Error('Skill artifact must contain a root SKILL.md');
    }
    return resolved;
  }

  _atomicCopy(source, target) {
    const parent = path.dirname(target);
    this.fs.mkdirSync(parent, { recursive: true });
    const temp = `${target}.tmp-${process.pid}-${crypto.randomBytes(5).toString('hex')}`;
    const backup = `${target}.bak-${process.pid}-${crypto.randomBytes(5).toString('hex')}`;
    let movedExisting = false;
    try {
      assertNoSymlinkComponents(parent, parent, this.fs);
      this._copyTree(source, temp);
      if (this.fs.existsSync(target)) {
        if (this.fs.lstatSync(target).isSymbolicLink()) throw new Error(`Skill projection target contains symlink: ${target}`);
        this.fs.renameSync(target, backup);
        movedExisting = true;
      }
      this.fs.renameSync(temp, target);
      if (movedExisting) removePath(this.fs, backup);
    } catch (error) {
      removePath(this.fs, temp);
      if (movedExisting && this.fs.existsSync(backup) && !this.fs.existsSync(target)) {
        this.fs.renameSync(backup, target);
      } else {
        removePath(this.fs, backup);
      }
      throw error;
    }
    return target;
  }

  enable(entry) {
    if (entry?.protected || entry?.projection?.mode === 'unsupported') {
      return { ...(entry?.projection || {}), mode: 'unsupported', state: 'unsupported', status: 'unsupported', requiresRestart: false };
    }
    const { capability, target } = this._targetPath(entry);
    if (capability.mode === 'unsupported') {
      return { ...(entry.projection || {}), mode: 'unsupported', state: 'unsupported', status: 'unsupported', requiresRestart: false };
    }
    if (capability.mode !== 'native-copy') {
      return { ...(entry.projection || {}), mode: capability.mode, state: 'unsupported', status: 'unsupported', requiresRestart: false };
    }
    if (this.fs.existsSync(target) && entry.projection?.sourceKey !== entry.sourceKey) {
      return {
        ...(entry.projection || {}),
        state: 'conflict',
        status: 'conflict',
        conflictWith: entry.projection?.sourceKey || 'unknown'
      };
    }
    const source = this._artifactRoot(entry);
    this._atomicCopy(source, target);
    return {
      ...(entry.projection || {}),
      mode: capability.mode,
      state: 'enabled',
      status: 'enabled',
      path: target,
      sourceKey: entry.sourceKey || null,
      updatedAt: Date.now(),
      requiresRestart: true
    };
  }

  disable(entry) {
    if (entry?.protected || entry?.projection?.mode === 'unsupported') {
      return { ...(entry?.projection || {}), mode: 'unsupported', state: 'unsupported', status: 'unsupported', requiresRestart: false };
    }
    const { capability, target } = this._targetPath(entry);
    if (capability.mode === 'unsupported') {
      return { ...(entry.projection || {}), mode: 'unsupported', state: 'unsupported', status: 'unsupported', requiresRestart: false };
    }
    if (capability.mode !== 'native-copy') {
      return { ...(entry.projection || {}), mode: capability.mode, state: 'unsupported', status: 'unsupported', requiresRestart: false };
    }
    if (this.fs.existsSync(target) && entry.projection?.sourceKey !== entry.sourceKey) {
      return {
        ...(entry.projection || {}),
        state: 'conflict',
        status: 'conflict',
        conflictWith: entry.projection?.sourceKey || 'unknown'
      };
    }
    if (this.fs.existsSync(target)) {
      if (this.fs.lstatSync(target).isSymbolicLink()) throw new Error(`Skill projection target contains symlink: ${target}`);
      removePath(this.fs, target);
    }
    return {
      ...(entry.projection || {}),
      mode: capability.mode,
      state: 'disabled',
      status: 'disabled',
      sourceKey: entry.sourceKey || null,
      updatedAt: Date.now(),
      requiresRestart: true
    };
  }

  async reconcile(entries = []) {
    const results = [];
    const targets = new Map();
    for (const entry of entries) {
      if (!entry?.managed || !entry.enabled || entry.trust !== 'approved' || entry.artifact?.state !== 'ready') continue;
      const targetKey = [
        entry.platform || '',
        entry.targetDirectory || ''
      ].join(':');
      if (targets.has(targetKey)) {
        results.push({
          controlKey: entry.controlKey,
          status: 'conflict',
          conflictWith: targets.get(targetKey)
        });
        continue;
      }
      try {
        const projection = await this.enable(entry);
        if (projection.status === 'unsupported' || projection.state === 'unsupported') {
          results.push({ controlKey: entry.controlKey, status: 'unsupported' });
          continue;
        }
        targets.set(targetKey, entry.controlKey);
        results.push({ controlKey: entry.controlKey, projection });
      } catch (error) {
        results.push({ controlKey: entry.controlKey, status: 'failed', error: error.message });
      }
    }
    return results;
  }
}

module.exports = {
  SkillProjectionService
};
