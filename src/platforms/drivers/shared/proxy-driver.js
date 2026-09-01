'use strict';

const { ok, unsupported, failed } = require('./driver-result');

function createProxyDriver({
  platform,
  servicePath,
  localServicePath,
  exports: names,
  requireImpl,
  capability = 'proxy',
  manifest = {}
} = {}) {
  let service;
  const loadService = () => {
    if (!service) service = requireImpl ? requireImpl(servicePath) : require(localServicePath);
    return service;
  };
  const call = (operation, args = []) => {
    try {
      const target = loadService();
      const method = names[operation];
      if (!target || typeof target[method] !== 'function') return unsupported(platform, capability, operation);
      const value = target[method](...args);
      const wrap = result => ok(platform, capability, operation, result);
      return value && typeof value.then === 'function' ? value.then(wrap).catch(error => failed(platform, capability, operation, error)) : wrap(value);
    } catch (error) {
      return failed(platform, capability, operation, error);
    }
  };
  const driver = { platform, capability, manifest };
  for (const operation of ['status', 'start', 'stop']) {
    driver[operation] = (...args) => call(operation, args);
  }
  driver.restoreOnBoot = async ({ config = {} } = {}) => {
    const started = await driver.start({ preserveStartTime: true });
    if (started.status !== 'ok') return { ...started, operation: 'restoreOnBoot' };
    return ok(platform, capability, 'restoreOnBoot', started.data, {
      port: started.data?.port || (manifest.portKey && config.ports?.[manifest.portKey]) || manifest.defaultPort || null
    });
  };
  driver.handleRequest = (...args) => names.handleRequest
    ? call('handleRequest', args)
    : unsupported(platform, capability, 'handleRequest');
  Object.defineProperty(driver, '_service', { value: loadService, enumerable: false });
  return driver;
}

module.exports = { createProxyDriver };
