const SUPPORTED_PLATFORMS = Object.freeze([
  'claude',
  'codex',
  'gemini',
  'opencode',
  'omp'
]);

function resolveManagedPlatform(rawPlatform, options = {}) {
  const fallback = options.fallback || 'claude';
  const raw = rawPlatform == null ? '' : String(rawPlatform);
  const normalized = raw.trim().toLowerCase();

  if (!normalized) {
    return {
      platform: fallback,
      warning: null,
      deprecated: false
    };
  }

  if (normalized === 'pi') {
    return {
      platform: 'omp',
      warning: 'Platform "pi" is deprecated; use "omp".',
      deprecated: true
    };
  }

  if (!SUPPORTED_PLATFORMS.includes(normalized)) {
    throw new Error(`Invalid platform: ${raw.trim() || raw}`);
  }

  return {
    platform: normalized,
    warning: null,
    deprecated: false
  };
}

module.exports = {
  SUPPORTED_PLATFORMS,
  resolveManagedPlatform
};
