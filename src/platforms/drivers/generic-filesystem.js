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
async function assertNoSymlinkComponents(fsImpl, target) {
  if (typeof fsImpl.lstat !== 'function') return;
  const resolved = path.resolve(target);
  const root = path.parse(resolved).root;
  const parts = path.relative(root, resolved).split(path.sep).filter(Boolean);
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    try {
      const stat = await fsImpl.lstat(current);
      if (index > 0 && stat.isSymbolicLink()) throw new Error(`Resource path contains symlink: ${target}`);
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }
  const finalStat = await fsImpl.lstat(resolved).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (finalStat && finalStat.isSymbolicLink()) throw new Error(`Resource path contains symlink: ${target}`);
}

async function assertSafeRoot(fsImpl, root, { allowMissingRoot = false } = {}) {
  if (typeof fsImpl.realpath !== 'function' || typeof fsImpl.lstat !== 'function') return path.resolve(root);
  const resolvedRoot = path.resolve(root);
  await assertNoSymlinkComponents(fsImpl, resolvedRoot);
  try {
    return await fsImpl.realpath(resolvedRoot);
  } catch (error) {
    if (error.code !== 'ENOENT' || !allowMissingRoot) throw error;
    let current = path.dirname(resolvedRoot);
    while (true) {
      try {
        await assertNoSymlinkComponents(fsImpl, current);
        return await fsImpl.realpath(current);
      } catch (parentError) {
        if (parentError.code !== 'ENOENT') throw parentError;
        const next = path.dirname(current);
        if (next === current) return resolvedRoot;
        current = next;
      }
    }
  }
}

async function assertContainedTarget(fsImpl, root, target, { allowMissingTarget = false, allowMissingRoot = false } = {}) {
  if (typeof fsImpl.realpath !== 'function' || typeof fsImpl.lstat !== 'function') return;
  const rootReal = await assertSafeRoot(fsImpl, root, { allowMissingRoot });
  await assertNoSymlinkComponents(fsImpl, target);
  const targetReal = await fsImpl.realpath(target).catch(error => {
    if (allowMissingTarget && error.code === 'ENOENT') return null;
    throw error;
  });
  if (!targetReal) return;
  const relative = path.relative(rootReal, targetReal);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
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
        await assertSafeRoot(fsImpl, root);
        const names = await fsImpl.readdir(root);
        const resources = [];
        for (const name of names) {
          const target = resolveTarget(root, name);
          await assertContainedTarget(fsImpl, root, target);
          const stat = await fsImpl.stat(target);
          resources.push({ name, target, type: stat.isDirectory() ? 'directory' : 'file', size: stat.size, mtimeMs: stat.mtimeMs });
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
        await assertSafeRoot(fsImpl, root, { allowMissingRoot: true });
        await assertContainedTarget(fsImpl, root, path.dirname(target), { allowMissingTarget: true, allowMissingRoot: true });
        const sourceStat = await fsImpl.stat(sourceRoot);
        await fsImpl.mkdir(path.dirname(target), { recursive: true });
        await assertSafeRoot(fsImpl, root);
        await assertContainedTarget(fsImpl, root, path.dirname(target));
        await assertContainedTarget(fsImpl, root, target, { allowMissingTarget: true });
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
        await assertSafeRoot(fsImpl, root);
        await assertContainedTarget(fsImpl, root, target, { allowMissingTarget: true });
        await fsImpl.rm(target, { recursive: true, force: true });
        return { status: 'ok', target };
      } catch (error) {
        return failure({ platform, operation: 'remove', type, name, error });
      }
    }
  };
}

module.exports = { createGenericFilesystemDriver };
