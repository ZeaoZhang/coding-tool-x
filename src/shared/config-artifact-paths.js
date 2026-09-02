const path = require('path');

function isWindowsAbsolutePath(input = '') {
  return path.win32.isAbsolute(String(input || '')) || /^[a-zA-Z]:[\\/]/.test(String(input || ''));
}

function normalizeSafeRelativePath(input, label = 'path', options = {}) {
  const {
    allowEmpty = false,
    allowHiddenSegments = false,
    allowBackslash = true
  } = options;

  const rawInput = String(input ?? '').trim();
  if (!rawInput) {
    if (allowEmpty) return '';
    throw new Error(`Invalid ${label}`);
  }
  if (rawInput.includes('\0')) {
    throw new Error(`Invalid ${label}`);
  }
  if (path.isAbsolute(rawInput) || isWindowsAbsolutePath(rawInput) || rawInput.startsWith('//') || rawInput.startsWith('\\\\')) {
    throw new Error(`Invalid ${label}`);
  }
  if (!allowBackslash && rawInput.includes('\\')) {
    throw new Error(`Invalid ${label}`);
  }

  const normalizedInput = rawInput.replace(/\\/g, '/');
  const normalized = path.posix.normalize(normalizedInput).replace(/^(\.\/)+/, '');
  if (!normalized || normalized === '.') {
    if (allowEmpty) return '';
    throw new Error(`Invalid ${label}`);
  }
  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new Error(`Invalid ${label}`);
  }

  const segments = normalized.split('/').filter(Boolean);
  if (!allowHiddenSegments && segments.some(segment => segment.startsWith('.'))) {
    throw new Error(`Invalid ${label}`);
  }

  return normalized;
}

function normalizeSafeFileStem(input, label = 'name', options = {}) {
  const {
    allowDots = true,
    allowHidden = false,
    pattern = allowDots
      ? /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
      : /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/
  } = options;
  const rawInput = String(input ?? '').trim();
  if (!rawInput || rawInput.includes('\0')) {
    throw new Error(`Invalid ${label}`);
  }
  if (rawInput.includes('/') || rawInput.includes('\\') || rawInput.includes('..')) {
    throw new Error(`Invalid ${label}`);
  }
  if (!allowHidden && rawInput.startsWith('.')) {
    throw new Error(`Invalid ${label}`);
  }
  if (pattern && !pattern.test(rawInput)) {
    throw new Error(`Invalid ${label}`);
  }
  return rawInput;
}

function resolveInsideRoot(rootDir, relativePath, label = 'path', options = {}) {
  const { allowRoot = false } = options;
  const resolvedRoot = path.resolve(rootDir);
  const safeRelativePath = normalizeSafeRelativePath(relativePath, label, options);
  const resolvedPath = path.resolve(resolvedRoot, safeRelativePath);
  const isInside = resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}${path.sep}`);
  if (!isInside || (!allowRoot && resolvedPath === resolvedRoot)) {
    throw new Error(`${label} escapes target directory`);
  }
  return resolvedPath;
}

function assertInsideAllowedRoots(targetPath, roots = [], label = 'path', options = {}) {
  const { allowRoot = false } = options;
  const resolvedTarget = path.resolve(String(targetPath || ''));
  const allowed = roots.some(root => {
    if (!root) return false;
    const resolvedRoot = path.resolve(root);
    if (!allowRoot && resolvedTarget === resolvedRoot) return false;
    return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
  });
  if (!allowed) {
    throw new Error(`${label} escapes allowed directories`);
  }
  return resolvedTarget;
}

function pathHasProtectedSegment(relativePath, protectedSegments = []) {
  const normalized = normalizeSafeRelativePath(relativePath, 'path', { allowHiddenSegments: true });
  const segments = normalized.split('/').filter(Boolean);
  return protectedSegments.some(segment => segments.includes(segment));
}

module.exports = {
  assertInsideAllowedRoots,
  isWindowsAbsolutePath,
  normalizeSafeFileStem,
  normalizeSafeRelativePath,
  pathHasProtectedSegment,
  resolveInsideRoot
};
