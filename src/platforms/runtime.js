'use strict';

const { createPlatformRegistry } = require('./registry');

let platformRegistry;
let platformRuntime;

function createPlatformRuntime({ registry, driverRegistry, dependencies = {} } = {}) {
  const resolvedRegistry = registry || createPlatformRegistry();
  return {
    registry: resolvedRegistry,
    getDriver(platform, capability, context = {}) {
      const driverId = resolvedRegistry.getCapability(platform, capability);
      if (!driverId) return null;
      if (!driverRegistry || typeof driverRegistry.resolve !== 'function') return null;
      return driverRegistry.resolve(driverId, { platform, capability, context, dependencies });
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
  if (!platformRuntime) platformRuntime = createPlatformRuntime({ registry: getPlatformRegistry() });
  return platformRuntime;
}

module.exports = { createPlatformRuntime, getPlatformRegistry, getPlatformRuntime };
