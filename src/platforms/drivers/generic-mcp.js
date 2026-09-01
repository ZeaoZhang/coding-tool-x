'use strict';

const fs = require('fs/promises');
const { constants: FS_CONSTANTS } = require('fs');
const crypto = require('crypto');
const path = require('path');

let temporaryFileCounter = 0;
const NOFOLLOW_FLAG = FS_CONSTANTS.O_NOFOLLOW || 0;

function failure({ platform, operation, error }) {
  const result = {
    status: 'failed',
    platform,
    capability: 'mcp',
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

function resolveTarget(manifest) {
  if (manifest.mcpFormat !== 'json') throw new Error("Manifest mcpFormat must be 'json'");
  const raw = manifest.resourceMappings && manifest.resourceMappings.mcp;
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Manifest requires resourceMappings.mcp');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) throw new Error('MCP mapping must be a filesystem path');
  const home = manifest.paths && manifest.paths.home;
  const target = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(home || process.cwd(), raw);
  if (home && !isInside(home, target)) throw new Error('MCP mapping escapes platform home');
  return target;
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

async function assertSafePath(fsImpl, target, home, allowMissing = false) {
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
        if (stat.isSymbolicLink()) {
          const real = typeof fsImpl.realpath === 'function' ? await fsImpl.realpath(current) : '';
          if (!isSystemAlias(current, real)) throw new Error(`MCP path contains symlink: ${current}`);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        missing = true;
      }
    }
    if (missing && !allowMissing) {
      const error = new Error(`MCP path does not exist: ${resolved}`);
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
  if (!isInside(await canonicalPath(fsImpl, home), await canonicalPath(fsImpl, target))) {
    throw new Error('MCP mapping escapes platform home');
  }
}

async function createCanonicalTarget(fsImpl, target, home, allowMissing) {
  await assertSafePath(fsImpl, target, home, allowMissing);
  const canonicalHome = home ? await canonicalPath(fsImpl, home) : null;
  const canonicalTarget = await canonicalPath(fsImpl, target);
  const canonicalParent = await canonicalPath(fsImpl, path.dirname(target));
  if (canonicalHome && (!isInside(canonicalHome, canonicalParent) || !isInside(canonicalHome, canonicalTarget))) {
    throw new Error('MCP mapping escapes platform home');
  }
  return { target: canonicalTarget, parent: canonicalParent, home: canonicalHome };
}

async function revalidateCanonicalTarget(fsImpl, canonical, target, home) {
  const currentParent = await canonicalPath(fsImpl, path.dirname(target));
  const currentTarget = await canonicalPath(fsImpl, target);
  const currentHome = home ? await canonicalPath(fsImpl, home) : null;
  if (currentParent !== canonical.parent || currentTarget !== canonical.target || currentHome !== canonical.home) {
    throw new Error('MCP target changed during operation');
  }
  await assertSafePath(fsImpl, target, home, true);
}

function sameFileIdentity(first, second) {
  return first && second && first.dev !== undefined && first.ino !== undefined &&
    first.dev === second.dev && first.ino === second.ino;
}

async function readFileByDescriptor(fsImpl, target, home) {
  const canonical = await createCanonicalTarget(fsImpl, target, home, false);
  if (typeof fsImpl.open !== 'function') throw new Error('MCP descriptor read is unavailable');
  const handle = await fsImpl.open(canonical.target, FS_CONSTANTS.O_RDONLY | NOFOLLOW_FLAG);
  try {
    const descriptorStat = typeof handle.stat === 'function'
      ? await handle.stat()
      : (typeof fsImpl.fstat === 'function' ? await fsImpl.fstat(handle.fd) : null);
    if (!descriptorStat) throw new Error('MCP descriptor identity is unavailable');
    await revalidateCanonicalTarget(fsImpl, canonical, target, home);
    const pathStat = await fsImpl.lstat(canonical.target);
    if (typeof pathStat.isSymbolicLink === 'function' && pathStat.isSymbolicLink()) {
      throw new Error(`MCP path contains symlink: ${canonical.target}`);
    }
    if (!sameFileIdentity(descriptorStat, pathStat)) throw new Error('MCP target changed during operation');
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

async function ensureDirectory(fsImpl, directory, canonicalHome) {
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
      if (!isSystemAlias(component, real)) throw new Error(`MCP path component is not a directory: ${component}`);
    } else if (typeof stat.isDirectory === 'function' && !stat.isDirectory()) {
      throw new Error(`MCP path component is not a directory: ${component}`);
    }
  };
  for (const part of path.relative(root, resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      await assertDirectory(current, await fsImpl.lstat(current));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try { await fsImpl.mkdir(current, { mode: 0o700 }); } catch (mkdirError) { if (mkdirError.code !== 'EEXIST') throw mkdirError; }
      await assertDirectory(current, await fsImpl.lstat(current));
    }
  }
  if (canonicalHome && !isInside(canonicalHome, await canonicalPath(fsImpl, resolved))) {
    throw new Error('MCP mapping escapes platform home');
  }
}

async function atomicWrite(fsImpl, target, content, canonicalHome) {
  const parent = path.dirname(target);
  const tempName = `.${path.basename(target)}.${process.pid}.${Date.now()}.${temporaryFileCounter++}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  let temporary;
  let handle;
  try {
    const canonicalParent = await canonicalPath(fsImpl, parent);
    if (canonicalHome && !isInside(canonicalHome, canonicalParent)) throw new Error('MCP mapping escapes platform home');
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
    await assertSafePath(fsImpl, temporary, canonicalHome, false);
    if (await canonicalPath(fsImpl, temporary) !== temporary) throw new Error('MCP temporary path changed during write');
    await assertSafePath(fsImpl, target, canonicalHome, true);
    await revalidateCanonicalTarget(fsImpl, { target, parent: canonicalParent, home: canonicalHome }, target, canonicalHome);
    await fsImpl.rename(temporary, target);
  } finally {
    if (handle) { try { await handle.close(); } catch { /* best effort close */ } }
    try {
      if (temporary && typeof fsImpl.rm === 'function') await fsImpl.rm(temporary, { force: true });
      else if (temporary && typeof fsImpl.unlink === 'function') await fsImpl.unlink(temporary);
    } catch { /* preserve typed write failure */ }
  }
}

function createGenericMcpDriver({ platform, manifest = {}, fsImpl = fs } = {}) {
  const read = async () => {
    try {
      const target = resolveTarget(manifest);
      return JSON.parse(await readFileByDescriptor(fsImpl, target, manifest.paths && manifest.paths.home));
    } catch (error) { return failure({ platform, operation: 'read', error }); }
  };
  const write = async value => {
    try {
      const target = resolveTarget(manifest);
      if (value === undefined) throw new Error('MCP value is required');
      const encoded = JSON.stringify(value, null, 2);
      if (encoded === undefined) throw new Error('MCP value must be JSON serializable');
      const home = manifest.paths && manifest.paths.home;
      const initial = await createCanonicalTarget(fsImpl, target, home, true);
      await ensureDirectory(fsImpl, initial.parent, initial.home);
      const canonical = await createCanonicalTarget(fsImpl, target, home, true);
      await atomicWrite(fsImpl, canonical.target, `${encoded}\n`, canonical.home);
      return { status: 'ok', platform, capability: 'mcp', operation: 'write', target };
    } catch (error) { return failure({ platform, operation: 'write', error }); }
  };
  const remove = async () => {
    try {
      const target = resolveTarget(manifest);
      const home = manifest.paths && manifest.paths.home;
      const canonical = await createCanonicalTarget(fsImpl, target, home, true);
      await revalidateCanonicalTarget(fsImpl, canonical, target, home);
      await fsImpl.rm(canonical.target, { force: true });
      return { status: 'ok', platform, capability: 'mcp', operation: 'remove', target };
    } catch (error) { return failure({ platform, operation: 'remove', error }); }
  };
  return { platform, capability: 'mcp', read, write, remove };
}

module.exports = { createGenericMcpDriver };
