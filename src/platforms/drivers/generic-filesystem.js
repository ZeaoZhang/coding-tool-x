'use strict';

const fs = require('fs/promises');
const path = require('path');

function failure({ platform, operation, type, name, error }) {
  const result = {
    status: 'failed',
    platform,
    capability: 'resourceSync',
    operation,
    error: error && error.message ? error.message : String(error)
  };
  if (type !== undefined) result.type = type;
  if (name !== undefined) result.name = name;
  if (error) Object.defineProperty(result, 'cause', { value: error, enumerable: false });
  return result;
}

function mappedRoot(manifest, type) {
  const mapping = manifest.resourceMappings || {};
  return mapping[type] || (manifest.paths && manifest.paths[type]);
}

function normalizeName(name) {
  const rawName = String(name || '');
  if (path.isAbsolute(rawName)) throw new Error(`Resource path must be relative: ${name}`);
  const normalizedName = path.normalize(rawName);
  if (!normalizedName || normalizedName === '.' || normalizedName === '..' || normalizedName.startsWith(`..${path.sep}`)) {
    throw new Error(`Resource path escapes target root: ${name}`);
  }
  return normalizedName;
}

function resolveTarget(root, name) {
  const normalizedName = normalizeName(name);
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, normalizedName);
  const relative = path.relative(resolvedRoot, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Resource path escapes target root: ${name}`);
  }
  return target;
}
async function assertSafeTarget(fsImpl, root, target) {
  if (typeof fsImpl.realpath !== 'function' || typeof fsImpl.lstat !== 'function') return;
  const resolvedRoot = path.resolve(root);
  const rootReal = await fsImpl.realpath(resolvedRoot);
  const rootStat = await fsImpl.lstat(resolvedRoot);
  if (rootStat.isSymbolicLink()) throw new Error(`Resource root contains symlink: ${root}`);
  const relative = path.relative(resolvedRoot, target);
  const components = relative ? relative.split(path.sep) : [];
  let current = resolvedRoot;
  for (const component of components) {
    current = path.join(current, component);
    try {
      const stat = await fsImpl.lstat(current);
      if (stat.isSymbolicLink()) throw new Error(`Resource path contains symlink: ${target}`);
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }
  const targetReal = await fsImpl.realpath(target).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (targetReal && (targetReal === rootReal || path.relative(rootReal, targetReal).startsWith(`..${path.sep}`) || path.isAbsolute(path.relative(rootReal, targetReal)))) {
    throw new Error(`Resource path escapes target root: ${target}`);
  }
}
function createGenericFilesystemDriver({ platform, manifest = {}, fsImpl = fs } = {}) {
  function getRoot(type) {
    const root = mappedRoot(manifest, type);
    if (!root) throw new Error(`Unknown resource mapping: ${type}`);
    return root;
  }

  return {
    async list(type) {
      try {
        const root = getRoot(type);
        await assertSafeTarget(fsImpl, root, root);
        const names = await fsImpl.readdir(root);
        const resources = [];
        for (const name of names) {
          const target = resolveTarget(root, name);
          await assertSafeTarget(fsImpl, root, target);
          const stat = await fsImpl.stat(target);
          resources.push({
            name,
            target,
            type: stat.isDirectory() ? 'directory' : 'file',
            size: stat.size,
            mtimeMs: stat.mtimeMs
          });
        }
        return resources;
      } catch (error) {
        return failure({ platform, operation: 'list', type, error });
      }
    },
    async sync(type, name, sourceRoot) {
      try {
        const root = getRoot(type);
        const target = resolveTarget(root, name);
        await assertSafeTarget(fsImpl, root, root);
        await assertSafeTarget(fsImpl, root, path.dirname(target));
        const sourceStat = await fsImpl.stat(sourceRoot);
        await fsImpl.mkdir(path.dirname(target), { recursive: true });
        await assertSafeTarget(fsImpl, root, target);
        if (sourceStat.isDirectory()) {
          await fsImpl.cp(sourceRoot, target, { recursive: true });
        } else {
          await fsImpl.copyFile(sourceRoot, target);
        }
        return { status: 'ok', target };
      } catch (error) {
        return failure({ platform, operation: 'sync', type, name, error });
      }
    },
    async remove(type, name) {
      try {
        const root = getRoot(type);
        const target = resolveTarget(root, name);
        await assertSafeTarget(fsImpl, root, root);
        await assertSafeTarget(fsImpl, root, target);
        await fsImpl.rm(target, { recursive: true, force: true });
        return { status: 'ok', target };
      } catch (error) {
        return failure({ platform, operation: 'remove', type, name, error });
      }
    }
  };
}

module.exports = { createGenericFilesystemDriver };
