'use strict';

const { normalizePlatformKey } = require('../shared/platforms');

const ERROR_CODES = new Set(['not_found', 'unsupported', 'invalid', 'failed']);

function defaultStatus(code) {
  if (code === 'invalid') return 400;
  if (code === 'failed') return 500;
  return 404;
}

function normalizeDetail(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function createPlatformAccessError(code, details = {}) {
  const normalizedCode = ERROR_CODES.has(code) ? code : 'failed';
  const platform = normalizeDetail(details.platform);
  const capability = normalizeDetail(details.capability);
  const operation = normalizeDetail(details.operation);
  const message = details.message || [
    normalizedCode,
    platform,
    capability,
    operation
  ].filter(Boolean).join(': ');
  const error = new Error(message || 'Platform access failed');
  Object.assign(error, {
    code: normalizedCode,
    status: details.status || defaultStatus(normalizedCode),
    platform,
    capability,
    operation
  });
  if (details.cause !== undefined) {
    Object.defineProperty(error, 'cause', {
      configurable: true,
      enumerable: false,
      value: details.cause,
      writable: false
    });
  }
  return error;
}

function getDefaultContext() {
  return require('../server/platform-context').getPlatformContext();
}

function getDependencies(options = {}) {
  const context = options.registry && options.runtime ? null : getDefaultContext();
  return {
    registry: options.registry || context.registry,
    runtime: options.runtime || context.runtime
  };
}

function resolveKey(key, fallback) {
  const normalized = normalizePlatformKey(key);
  if (normalized) return normalized;
  const fallbackKey = normalizePlatformKey(fallback);
  if (fallbackKey) return fallbackKey;
  throw createPlatformAccessError('invalid', {
    platform: normalized,
    message: 'A platform key is required when no fallback is configured'
  });
}

function resolvePlatform(key, options = {}) {
  const { registry } = getDependencies(options);
  const normalizedKey = resolveKey(key, options.fallback);
  if (!registry || typeof registry.resolve !== 'function') {
    throw createPlatformAccessError('failed', {
      platform: normalizedKey,
      message: 'Platform Registry is not available'
    });
  }

  let manifest;
  try {
    manifest = registry.resolve(normalizedKey);
  } catch (cause) {
    throw createPlatformAccessError('failed', {
      platform: normalizedKey,
      message: `Failed to resolve platform ${normalizedKey}`,
      cause
    });
  }
  if (!manifest) {
    throw createPlatformAccessError('not_found', {
      platform: normalizedKey,
      message: `Unknown platform: ${normalizedKey}`
    });
  }
  return { key: normalizedKey, manifest };
}

function resolveCapability(key, capability, options = {}) {
  const normalizedCapability = normalizeDetail(capability);
  if (!normalizedCapability) {
    throw createPlatformAccessError('invalid', {
      capability: normalizedCapability,
      message: 'A capability name is required'
    });
  }
  const resolved = resolvePlatform(key, options);
  const { registry, runtime } = getDependencies(options);
  let driverId;
  try {
    driverId = typeof registry?.getCapability === 'function'
      ? registry.getCapability(resolved.key, normalizedCapability)
      : resolved.manifest?.capabilities?.[normalizedCapability];
  } catch (cause) {
    throw createPlatformAccessError('failed', {
      platform: resolved.key,
      capability: normalizedCapability,
      message: `Failed to resolve capability ${resolved.key}.${normalizedCapability}`,
      cause
    });
  }
  if (!driverId || driverId === 'unsupported') {
    throw createPlatformAccessError('unsupported', {
      platform: resolved.key,
      capability: normalizedCapability,
      message: `Unsupported platform capability: ${resolved.key}.${normalizedCapability}`
    });
  }
  if (!runtime || typeof runtime.getDriver !== 'function') {
    throw createPlatformAccessError('unsupported', {
      platform: resolved.key,
      capability: normalizedCapability,
      message: `No Driver is available for ${resolved.key}.${normalizedCapability}`
    });
  }

  let driver;
  try {
    driver = runtime.getDriver(resolved.key, normalizedCapability);
  } catch (cause) {
    throw createPlatformAccessError('failed', {
      platform: resolved.key,
      capability: normalizedCapability,
      message: `Failed to create Driver for ${resolved.key}.${normalizedCapability}`,
      cause
    });
  }
  if (!driver) {
    throw createPlatformAccessError('unsupported', {
      platform: resolved.key,
      capability: normalizedCapability,
      message: `No Driver is available for ${resolved.key}.${normalizedCapability}`
    });
  }
  return { ...resolved, driver };
}

function resolveOperation(key, capability, operation, options = {}) {
  const normalizedOperation = normalizeDetail(operation);
  if (!normalizedOperation) {
    throw createPlatformAccessError('invalid', {
      platform: normalizePlatformKey(key),
      capability: normalizeDetail(capability),
      message: 'An operation name is required'
    });
  }
  const resolved = resolveCapability(key, capability, options);
  if (typeof resolved.driver[normalizedOperation] !== 'function') {
    throw createPlatformAccessError('unsupported', {
      platform: resolved.key,
      capability: normalizeDetail(capability),
      operation: normalizedOperation,
      message: `Unsupported platform operation: ${resolved.key}.${normalizeDetail(capability)}.${normalizedOperation}`
    });
  }
  return {
    ...resolved,
    operation: resolved.driver[normalizedOperation].bind(resolved.driver)
  };
}

module.exports = {
  resolvePlatform,
  resolveCapability,
  resolveOperation,
  createPlatformAccessError
};
