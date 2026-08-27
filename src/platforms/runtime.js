'use strict';

const path = require('path');
const { createPlatformRegistry } = require('./registry');
const { resolveTemplate } = require('./path-resolver');

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

function isUrl(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(String(value));
}


function isExplicitFilesystemRoot(value) {
  const raw = String(value);
  return path.isAbsolute(raw) || raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\');
}
function expandTilde(value, homeDir) {
  if (value === '~') return homeDir;
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(homeDir, value.slice(2));
  return value;
}

function assertInsideHome(home, candidate, manifestKey, mappingName) {
  const relative = path.relative(home, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Manifest ${manifestKey || 'platform'} resource mapping ${mappingName} escapes home`);
  }
}

function resolveResourceMappings(manifest, resolvedPaths = {}, pathOptions = {}) {
  const resourceMappings = manifest.resourceMappings || {};
  const home = resolvedPaths.home || process.cwd();
  const homeDir = pathOptions.homeDir || require('os').homedir();
  const resolved = { env: { ...process.env, ...(pathOptions.env || {}) }, home };
  return Object.fromEntries(Object.entries(resourceMappings).map(([type, value]) => {
    const raw = expandTilde(resolveTemplate(value, resolved), homeDir);
    const target = isUrl(raw) || path.isAbsolute(raw) ? raw : path.join(home, raw);
    if (!isUrl(target) && !isExplicitFilesystemRoot(value)) assertInsideHome(home, path.normalize(target), manifest.key, type);
    return [type, isUrl(target) ? target : path.normalize(target)];
  }));
}

function buildResolvedManifest(rawManifest, resolvedPaths, pathOptions = {}) {
  if (!rawManifest) return null;
  const paths = resolvedPaths || rawManifest.paths;
  const resourceMappings = rawManifest.resourceMappings
    ? resolveResourceMappings(rawManifest, paths || {}, pathOptions)
    : rawManifest.resourceMappings;
  return { ...rawManifest, paths, resourceMappings };
}
function createPlatformRuntime({ registry, driverRegistry, dependencies = {} } = {}) {
  const resolvedRegistry = registry || createPlatformRegistry();
  return {
    getDriver(platform, capability, context = {}) {
      const driverId = resolvedRegistry.getCapability(platform, capability);
      if (!driverId) return null;
      if (!driverRegistry || typeof driverRegistry.create !== 'function') return null;
      const rawManifest = typeof resolvedRegistry.resolve === 'function' ? resolvedRegistry.resolve(platform) : null;
      const pathOptions = context.pathResolver || context.pathResolverOptions || dependencies.pathResolver || dependencies.pathResolverOptions || {};
      const resolvedPaths = rawManifest && typeof resolvedRegistry.resolvePaths === 'function'
        ? resolvedRegistry.resolvePaths(platform, pathOptions)
        : null;
      const manifest = buildResolvedManifest(rawManifest, resolvedPaths, pathOptions);
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
