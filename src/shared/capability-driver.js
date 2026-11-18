'use strict';

const { ok, unsupported, failed } = require('./driver-result');

function createCapabilityDriver({
  platform,
  capability,
  servicePath,
  localServicePath,
  methods = {},
  customMethods = {},
  adapterPath,
  adapterLocalPath,
  adapterMethods = {},
  preservePayloadUpdatedAt = false,
  parserVersion = 1,
  requireImpl,
  prependPlatform = false,
  context = {},
  ...injected
} = {}) {
  let service;
  let adapter;
  let configured = false;
  let adapterConfigured = false;
  const configureService = target => {
    if (configured) return;
    if (typeof target?.configure === 'function') {
      target.configure({ ...injected, ...context, platform, capability });
    }
    configured = true;
  };
  const loadAdapter = () => {
    if (!adapter && (adapterPath || adapterLocalPath)) {
      adapter = adapterPath && requireImpl ? requireImpl(adapterPath) : require(adapterLocalPath);
    }
    if (!adapterConfigured && adapter) {
      if (typeof adapter.configure === 'function') {
        adapter.configure({ ...injected, ...context, platform, capability });
      }
      adapterConfigured = true;
    }
    return adapter;
  };
  const load = () => {
    if (!service) {
      service = requireImpl ? requireImpl(servicePath) : require(localServicePath);
      configureService(service);
    }
    return service;
  };
  const driver = { platform, capability, preservePayloadUpdatedAt, parserVersion, ...context };
  for (const [operation, methodName] of Object.entries(methods)) {
    driver[operation] = (...args) => {
      try {
        const target = load();
        if (typeof target?.[methodName] !== 'function') return unsupported(platform, capability, operation);
        const value = target[methodName](...args);
        const wrap = result => {
          if (typeof onSuccess === 'function') onSuccess(operation, result);
          return ok(platform, capability, operation, result);
        };
        return value && typeof value.then === 'function'
          ? value.then(wrap).catch(error => failed(platform, capability, operation, error))
          : wrap(value);
      } catch (error) {
        return failed(platform, capability, operation, error);
      }
    };
  }
  for (const [operation, customMethod] of Object.entries(customMethods)) {
    driver[operation] = (...args) => {
      try {
        const target = load();
        const value = customMethod(target, ...(prependPlatform ? [platform, ...args] : args));
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
  // The shared session index owns outline generation for every CLI that uses
  // it. Drivers with a native outline implementation (OpenCode) keep theirs.
  const sessionHistoryIndex = injected.sessionHistoryIndex
    || injected.dependencies?.sessionHistoryIndex
    || context.sessionHistoryIndex;
  if (
    capability === 'sessions'
    && typeof driver.outline !== 'function'
    && typeof sessionHistoryIndex?.getSessionOutline === 'function'
  ) {
    driver.outline = request => {
      const sessionId = request?.params?.sessionId || request?.sessionId;
      if (!sessionId) return unsupported(platform, capability, 'outline');
      const options = request?.config ? { config: request.config } : {};
      if (request?.query?.fresh === '1' || request?.query?.force === '1') options.force = true;
      try {
        const value = sessionHistoryIndex.getSessionOutline(platform, sessionId, options);
        const wrap = result => ok(platform, capability, 'outline', result);
        return value && typeof value.then === 'function'
          ? value.then(wrap).catch(error => failed(platform, capability, 'outline', error))
          : wrap(value);
      } catch (error) {
        return failed(platform, capability, 'outline', error);
      }
    };
  }
  Object.defineProperty(driver, '_service', { value: load, enumerable: false });
  return driver;
}

module.exports = { createCapabilityDriver };
