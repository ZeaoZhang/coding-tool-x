'use strict';

const fs = require('fs/promises');
const { constants: FS_CONSTANTS } = require('fs');
const crypto = require('crypto');
const path = require('path');

let temporaryFileCounter = 0;
const NOFOLLOW_FLAG = FS_CONSTANTS.O_NOFOLLOW || 0;

function createFailure({ platform, capability, operation, error }) {
  const result = {
    status: 'failed',
    platform,
    capability,
    operation,
    error: error && error.message ? error.message : String(error)
  };
  if (error) Object.defineProperty(result, 'cause', { value: error, enumerable: false });
  return result;
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function isSystemAlias(current, realpath) {
  return (current === '/var' && realpath === '/private/var') ||
    (current === '/tmp' && realpath === '/private/tmp') ||
    (current === '/etc' && realpath === '/private/etc');
}

async function canonicalPath(fsImpl, target) {
  const resolved = path.resolve(target);
  if (typeof fsImpl.realpath !== 'function') return resolved;
  const missing = [];
  let current = resolved;
  while (true) {
    try {
      return path.join(await fsImpl.realpath(current), ...missing.reverse());
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

async function assertSafePath(fsImpl, target, home, labels, allowMissing = false) {
  if (typeof fsImpl.lstat !== 'function') return;
  const checkComponents = async value => {
    const resolved = path.resolve(value);
    const root = path.parse(resolved).root;
    const parts = path.relative(root, resolved).split(path.sep).filter(Boolean);
    let current = root;
    let missing = false;
    for (const part of parts) {
      current = path.join(current, part);
      try {
        const stat = await fsImpl.lstat(current);
        if (typeof stat.isSymbolicLink === 'function' && stat.isSymbolicLink()) {
          const real = typeof fsImpl.realpath === 'function' ? await fsImpl.realpath(current) : '';
          if (!isSystemAlias(current, real)) throw new Error(labels.pathContainsSymlink(current));
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        missing = true;
      }
    }
    if (missing && !allowMissing) {
      const error = new Error(labels.pathDoesNotExist(resolved));
      error.code = 'ENOENT';
      throw error;
    }
  };
  if (!home) {
    await checkComponents(target);
    return;
  }
  await checkComponents(home);
  await checkComponents(target);
  const canonicalHome = await canonicalPath(fsImpl, home);
  const canonicalTarget = await canonicalPath(fsImpl, target);
  if (!isInside(canonicalHome, canonicalTarget)) throw new Error(labels.mappingEscapesHome);
}

async function createCanonicalTarget(fsImpl, target, home, labels, allowMissing) {
  await assertSafePath(fsImpl, target, home, labels, allowMissing);
  const canonicalHome = home ? await canonicalPath(fsImpl, home) : null;
  const canonicalTarget = await canonicalPath(fsImpl, target);
  const canonicalParent = await canonicalPath(fsImpl, path.dirname(target));
  if (canonicalHome && (!isInside(canonicalHome, canonicalParent) || !isInside(canonicalHome, canonicalTarget))) {
    throw new Error(labels.mappingEscapesHome);
  }
  return { target: canonicalTarget, parent: canonicalParent, home: canonicalHome };
}

async function revalidateCanonicalTarget(fsImpl, canonical, target, home, labels) {
  const currentParent = await canonicalPath(fsImpl, path.dirname(target));
  const currentTarget = await canonicalPath(fsImpl, target);
  const currentHome = home ? await canonicalPath(fsImpl, home) : null;
  if (currentParent !== canonical.parent || currentTarget !== canonical.target || currentHome !== canonical.home) {
    throw new Error(labels.targetChanged);
  }
  await assertSafePath(fsImpl, target, home, labels, true);
}

function sameFileIdentity(first, second) {
  return first && second && first.dev !== undefined && first.ino !== undefined &&
    first.dev === second.dev && first.ino === second.ino;
}

async function readFileByDescriptor(fsImpl, target, home, labels) {
  const canonical = await createCanonicalTarget(fsImpl, target, home, labels, false);
  if (typeof fsImpl.open !== 'function') throw new Error(labels.descriptorReadUnavailable);
  const handle = await fsImpl.open(canonical.target, FS_CONSTANTS.O_RDONLY | NOFOLLOW_FLAG);
  try {
    const descriptorStat = typeof handle.stat === 'function'
      ? await handle.stat()
      : (typeof fsImpl.fstat === 'function' ? await fsImpl.fstat(handle.fd) : null);
    if (!descriptorStat) throw new Error(labels.descriptorIdentityUnavailable);
    await revalidateCanonicalTarget(fsImpl, canonical, target, home, labels);
    const pathStat = await fsImpl.lstat(canonical.target);
    if (typeof pathStat.isSymbolicLink === 'function' && pathStat.isSymbolicLink()) {
      throw new Error(labels.pathContainsSymlink(canonical.target));
    }
    if (!sameFileIdentity(descriptorStat, pathStat)) throw new Error(labels.targetChanged);
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

async function ensureDirectory(fsImpl, directory, canonicalHome, labels) {
  if (typeof fsImpl.lstat !== 'function') {
    await fsImpl.mkdir(directory, { recursive: true });
    return;
  }
  const resolved = path.resolve(directory);
  const root = path.parse(resolved).root;
  let current = root;
  const assertDirectory = async (component, stat) => {
    if (typeof stat.isSymbolicLink === 'function' && stat.isSymbolicLink()) {
      const real = typeof fsImpl.realpath === 'function' ? await fsImpl.realpath(component) : '';
      if (!isSystemAlias(component, real)) throw new Error(labels.pathComponentNotDirectory(component));
    } else if (typeof stat.isDirectory === 'function' && !stat.isDirectory()) {
      throw new Error(labels.pathComponentNotDirectory(component));
    }
  };
  for (const part of path.relative(root, resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      await assertDirectory(current, await fsImpl.lstat(current));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try {
        await fsImpl.mkdir(current, { mode: 0o700 });
      } catch (mkdirError) {
        if (mkdirError.code !== 'EEXIST') throw mkdirError;
      }
      await assertDirectory(current, await fsImpl.lstat(current));
    }
  }
  if (canonicalHome && !isInside(canonicalHome, await canonicalPath(fsImpl, resolved))) {
    throw new Error(labels.mappingEscapesHome);
  }
}

async function atomicWrite(fsImpl, target, content, canonicalHome, labels) {
  const parent = path.dirname(target);
  const tempName = `.${path.basename(target)}.${process.pid}.${Date.now()}.${temporaryFileCounter++}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  let temporary;
  let handle;
  try {
    const canonicalParent = await canonicalPath(fsImpl, parent);
    if (canonicalHome && !isInside(canonicalHome, canonicalParent)) throw new Error(labels.mappingEscapesHome);
    // Node has no portable openat/renameat2. Revalidation immediately before
    // path-based rename bounds the unavoidable ancestor-swap window.
    temporary = path.join(canonicalParent, tempName);
    if (typeof fsImpl.open === 'function') {
      handle = await fsImpl.open(temporary, 'wx', 0o600);
      await handle.writeFile(content, 'utf8');
      await handle.close();
      handle = undefined;
    } else {
      await fsImpl.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    }
    await assertSafePath(fsImpl, temporary, canonicalHome, labels, false);
    if (await canonicalPath(fsImpl, temporary) !== temporary) throw new Error(labels.temporaryPathChanged);
    await assertSafePath(fsImpl, target, canonicalHome, labels, true);
    await revalidateCanonicalTarget(fsImpl, { target, parent: canonicalParent, home: canonicalHome }, target, canonicalHome, labels);
    await fsImpl.rename(temporary, target);
  } finally {
    if (handle) { try { await handle.close(); } catch { /* best effort close */ } }
    try {
      if (temporary && typeof fsImpl.rm === 'function') await fsImpl.rm(temporary, { force: true });
      else if (temporary && typeof fsImpl.unlink === 'function') await fsImpl.unlink(temporary);
    } catch { /* preserve typed write failure */ }
  }
}

function createSecureFileDriver({
  platform,
  capability,
  manifest = {},
  fsImpl = fs,
  labels,
  resolveTarget,
  deserialize = value => value,
  serialize = value => value,
  validateWrite = () => {}
} = {}) {
  const read = async () => {
    try {
      const target = resolveTarget(manifest);
      return deserialize(await readFileByDescriptor(fsImpl, target, manifest.paths && manifest.paths.home, labels));
    } catch (error) {
      return createFailure({ platform, capability, operation: 'read', error });
    }
  };

  const write = async value => {
    try {
      const target = resolveTarget(manifest);
      validateWrite(value);
      const encoded = serialize(value);
      if (typeof encoded !== 'string') throw new Error(labels.serializedValueMustBeString);
      const home = manifest.paths && manifest.paths.home;
      const initial = await createCanonicalTarget(fsImpl, target, home, labels, true);
      await ensureDirectory(fsImpl, initial.parent, initial.home, labels);
      const canonical = await createCanonicalTarget(fsImpl, target, home, labels, true);
      await atomicWrite(fsImpl, canonical.target, encoded, canonical.home, labels);
      return { status: 'ok', platform, capability, operation: 'write', target };
    } catch (error) {
      return createFailure({ platform, capability, operation: 'write', error });
    }
  };

  const remove = async () => {
    try {
      const target = resolveTarget(manifest);
      const home = manifest.paths && manifest.paths.home;
      const canonical = await createCanonicalTarget(fsImpl, target, home, labels, true);
      await revalidateCanonicalTarget(fsImpl, canonical, target, home, labels);
      await fsImpl.rm(canonical.target, { force: true });
      return { status: 'ok', platform, capability, operation: 'remove', target };
    } catch (error) {
      return createFailure({ platform, capability, operation: 'remove', error });
    }
  };

  return { platform, capability, read, write, remove };
}

module.exports = {
  createSecureFileDriver,
  // exported for focused internal reuse if needed by future secure drivers/tests
  _test: {
    createFailure,
    isInside,
    canonicalPath,
    assertSafePath,
    createCanonicalTarget,
    revalidateCanonicalTarget,
    readFileByDescriptor,
    ensureDirectory,
    atomicWrite
  }
};