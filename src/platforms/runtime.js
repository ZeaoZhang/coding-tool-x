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
    return { create: () => null };
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
      return driverRegistry.create(driverId, { platform, capability, context, dependencies });
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
