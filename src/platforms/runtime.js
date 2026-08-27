'use strict';

const { createPlatformRegistry } = require('./registry');

let platformRegistry;
let platformRuntime;

function getDefaultDriverRegistry() {
  try {
    const { getDriverRegistry } = require('./driver-registry');
    return getDriverRegistry();
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND' || !error.message.includes("'./driver-registry'")) throw error;
    throw new Error('Platform driver registry is not available; create(id, context) cannot be resolved');
  }
}
function createPlatformRuntime({ registry, driverRegistry, dependencies = {} } = {}) {
  const resolvedRegistry = registry || createPlatformRegistry();
  return {
    registry: resolvedRegistry,
    getDriver(platform, capability, context = {}) {
      const driverId = resolvedRegistry.getCapability(platform, capability);
      if (!driverId) return null;
      if (!driverRegistry || typeof driverRegistry.create !== 'function') return null;
      const rawManifest = typeof resolvedRegistry.resolve === 'function' ? resolvedRegistry.resolve(platform) : null;
      const pathOptions = context.pathResolver || context.pathResolverOptions || dependencies.pathResolver || dependencies.pathResolverOptions || {};
      const resolvedPaths = rawManifest && typeof resolvedRegistry.resolvePaths === 'function'
        ? resolvedRegistry.resolvePaths(platform, pathOptions)
        : null;
      const manifest = rawManifest ? { ...rawManifest, paths: resolvedPaths || rawManifest.paths } : null;
      return driverRegistry.create(driverId, {
        ...dependencies,
        platform,
        capability,
        manifest,
        context,
        dependencies
      });
    },
    invoke(platform, capability, operation, args = []) {
      const driver = this.getDriver(platform, capability);
      if (!driver || typeof driver[operation] !== 'function') {
        throw new Error(`Unsupported platform capability operation: ${platform}.${capability}.${operation}`);
      }
      return driver[operation](...args);
    }
  };
}

function getPlatformRegistry() {
  if (!platformRegistry) platformRegistry = createPlatformRegistry();
  return platformRegistry;
}

function getPlatformRuntime() {
  if (!platformRuntime) {
    platformRuntime = createPlatformRuntime({
      registry: getPlatformRegistry(),
      driverRegistry: getDefaultDriverRegistry()
    });
  }
  return platformRuntime;
}

module.exports = { createPlatformRuntime, getPlatformRegistry, getPlatformRuntime };
