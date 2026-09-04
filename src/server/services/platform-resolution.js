const { resolvePlatform, createPlatformAccessError } = require('../../platforms/access');

function resolveManagedPlatform(rawPlatform, options = {}) {
  const raw = rawPlatform == null ? '' : String(rawPlatform);
  const normalized = raw.trim().toLowerCase();
  const fallback = options.fallback === undefined ? 'claude' : options.fallback;

  try {
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
  } catch (error) {
    if (error?.code === 'not_found') {
      throw createPlatformAccessError('invalid', {
        platform: raw.trim() || raw,
        message: `Invalid platform: ${raw.trim() || raw}`,
        cause: error
      });
    }
    throw error;
  }
}

module.exports = {
  resolveManagedPlatform
};
