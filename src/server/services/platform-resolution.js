const { resolvePlatform } = require('../../platforms/access');

function resolveManagedPlatform(rawPlatform, options = {}) {
  const raw = rawPlatform == null ? '' : String(rawPlatform);
  const normalized = raw.trim().toLowerCase();
  const fallback = options.fallback === undefined ? 'claude' : options.fallback;

  if (!normalized) {
    const resolved = resolvePlatform('', { ...options, fallback });
    return {
      platform: resolved.key,
      warning: null,
      deprecated: false
    };
  }

  if (normalized === 'pi') {
    const resolved = resolvePlatform('omp', options);
    return {
      platform: resolved.key,
      warning: 'Platform "pi" is deprecated; use "omp".',
      deprecated: true
    };
  }

  const resolved = resolvePlatform(normalized, options);
  return {
    platform: resolved.key,
    warning: null,
    deprecated: false
  };
}

module.exports = {
  resolveManagedPlatform
};
