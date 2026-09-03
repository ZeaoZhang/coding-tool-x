'use strict';

const { createPlatformRegistry } = require('../platforms/registry');
const { getDriverRegistry } = require('../platforms/driver-registry');
const { createSessionHistoryIndex } = require('./services/session-history-index');

let defaultContext;

function getPlatformRuntimeModule() {
  return require('../platforms/runtime');
}

function createLazyDependency(getValue) {
  return new Proxy({}, {
    get(_target, property) {
      const value = getValue();
      return typeof value?.[property] === 'function' ? value[property].bind(value) : value?.[property];
    }
  });
}

function getDefaultPlatformBindings() {
  const runtimeModule = getPlatformRuntimeModule();
  const registry = typeof runtimeModule.getPlatformRegistry === 'function'
    ? runtimeModule.getPlatformRegistry()
    : createPlatformRegistry();
  const runtime = typeof runtimeModule.getPlatformRuntime === 'function'
    ? runtimeModule.getPlatformRuntime()
    : null;
  return { registry, runtime };
}

function createPlatformContext({ registry, runtime, dependencies = {}, driverRegistry } = {}) {
  const runtimeModule = getPlatformRuntimeModule();
  const resolvedRegistry = registry || createPlatformRegistry();
  let sessionHistoryIndex = dependencies.sessionHistoryIndex || null;
  const indexDependency = sessionHistoryIndex || createLazyDependency(() => sessionHistoryIndex);
  const resolvedDependencies = {
    ...(typeof runtimeModule.getDefaultDependencies === 'function'
      ? runtimeModule.getDefaultDependencies()
      : {}),
    ...dependencies,
    sessionHistoryIndex: indexDependency
  };
  if (typeof runtimeModule.configureDefaultDependencies === 'function') {
    runtimeModule.configureDefaultDependencies(resolvedDependencies);
  }
  const resolvedRuntime = runtime || (typeof runtimeModule.createPlatformRuntime === 'function'
    ? runtimeModule.createPlatformRuntime({
      registry: resolvedRegistry,
      driverRegistry: driverRegistry || getDriverRegistry(),
      dependencies: resolvedDependencies
    })
    : { getDriver: () => null });
  if (!sessionHistoryIndex) {
    sessionHistoryIndex = createSessionHistoryIndex({ runtime: resolvedRuntime });
  }
  return Object.freeze({
    registry: resolvedRegistry,
    runtime: resolvedRuntime,
    dependencies: Object.freeze({ ...resolvedDependencies, sessionHistoryIndex })
  });
}

function getPlatformContext(options = {}) {
  const hasOptions = Object.keys(options).length > 0;
  const bindings = hasOptions ? null : getDefaultPlatformBindings();
  if (!defaultContext
    || hasOptions
    || (bindings.runtime && defaultContext.runtime !== bindings.runtime)
    || (bindings.registry && defaultContext.registry !== bindings.registry)) {
    defaultContext = createPlatformContext(hasOptions ? options : bindings);
  }
  return defaultContext;
}

function resetPlatformContext() {
  defaultContext = undefined;
}

module.exports = { createPlatformContext, getPlatformContext, resetPlatformContext };
