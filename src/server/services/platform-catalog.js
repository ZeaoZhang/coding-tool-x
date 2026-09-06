'use strict';

const { normalizePlatformKey } = require('../../shared/platforms');
const { getPlatformContext } = require('../platform-context');

const WEB_UI_PORT = 19999;

function isSupportedCapability(manifest, capability) {
  if (!capability) return true;
  const driver = manifest?.capabilities?.[capability];
  return driver !== undefined && driver !== null && driver !== 'unsupported';
}

function supportsResourceType(manifest, resourceType) {
  if (!resourceType) return true;
  if (manifest?.resourceTypes?.[resourceType] === false) return false;
  return isSupportedCapability(manifest, 'resourceSync');
}

function createPlatformCatalog({ registry, runtime } = {}) {
  if (!registry || typeof registry.list !== 'function') {
    throw new TypeError('Platform catalog requires a registry');
  }
  if (!runtime || typeof runtime.getDriver !== 'function') {
    throw new TypeError('Platform catalog requires a runtime');
  }

  function list({ capability, resourceType, enabledOnly = true } = {}) {
    return registry.list({ enabledOnly })
      .filter(manifest => manifest && manifest.key)
      .filter(manifest => isSupportedCapability(manifest, capability))
      .filter(manifest => supportsResourceType(manifest, resourceType));
  }

  function get(key) {
    const normalizedKey = normalizePlatformKey(key);
    return normalizedKey ? list({ enabledOnly: false }).find(manifest => (
      normalizePlatformKey(manifest.key) === normalizedKey
    )) || null : null;
  }

  function driver(key, capability) {
    const manifest = get(key);
    if (!manifest || !isSupportedCapability(manifest, capability)) return null;
    const driverId = manifest.capabilities?.[capability];
    if (!driverId || driverId === 'unsupported') return null;
    const driver = runtime.getDriver(manifest.key, capability);
    return driver && driver.status === 'unsupported' ? null : driver;
  }

  function ports() {
    const entries = [{ key: 'webUI', defaultPort: WEB_UI_PORT, label: 'Web UI', platform: null }];
    for (const manifest of list({ enabledOnly: true })) {
      if (!manifest.portKey || !Number.isFinite(manifest.defaultPort)) continue;
      entries.push({
        key: manifest.portKey,
        defaultPort: manifest.defaultPort,
        label: manifest.portLabel || manifest.label || manifest.key,
        platform: manifest.key
      });
    }
    return entries;
  }

  return Object.freeze({
    list,
    keys(options = {}) {
      return list(options).map(manifest => normalizePlatformKey(manifest.key));
    },
    get,
    driver,
    ports
  });
}


function getPlatformCatalog() {
  const context = getPlatformContext();
  return createPlatformCatalog(context);
}

module.exports = { createPlatformCatalog, getPlatformCatalog, WEB_UI_PORT };
