'use strict';

const { ok, unsupported, failed } = require('./driver-result');

function createCapabilityDriver({
  platform,
  capability,
  servicePath,
  localServicePath,
  methods = {},
  adapterPath,
  adapterLocalPath,
  adapterMethods = {},
  requireImpl,
  prependPlatform = false,
  context = {}
} = {}) {
  let service;
  let adapter;
  const loadAdapter = () => {
    if (!adapter && (adapterPath || adapterLocalPath)) {
      adapter = adapterPath && requireImpl ? requireImpl(adapterPath) : require(adapterLocalPath);
    }
    return adapter;
  };
  const load = () => {
    if (!service) service = requireImpl ? requireImpl(servicePath) : require(localServicePath);
    return service;
  };
  const driver = { platform, capability, ...context };
  for (const [operation, methodName] of Object.entries(methods)) {
    driver[operation] = (...args) => {
      try {
        const target = load();
        if (typeof target?.[methodName] !== 'function') return unsupported(platform, capability, operation);
        const value = target[methodName](...(prependPlatform ? [platform, ...args] : args));
        const wrap = result => ok(platform, capability, operation, result);
        return value && typeof value.then === 'function'
          ? value.then(wrap).catch(error => failed(platform, capability, operation, error))
          : wrap(value);
      } catch (error) {
        return failed(platform, capability, operation, error);
      }
    };
  }
  for (const [operation, methodName] of Object.entries(adapterMethods)) {
    driver[operation] = (...args) => {
      try {
        const target = loadAdapter();
        if (typeof target?.[methodName] !== 'function') return unsupported(platform, capability, operation);
        const value = target[methodName](...args);
        const wrap = result => ok(platform, capability, operation, result);
        return value && typeof value.then === 'function'
          ? value.then(wrap).catch(error => failed(platform, capability, operation, error))
          : wrap(value);
      } catch (error) {
        return failed(platform, capability, operation, error);
      }
    };
  }
  Object.defineProperty(driver, '_service', { value: load, enumerable: false });
  return driver;
}

module.exports = { createCapabilityDriver };
