'use strict';

const path = require('path');
const { createPlatformRegistry } = require('./registry');
const { resolveTemplate } = require('./path-resolver');
const { createPlatformPathContext } = require('./platform-path-context');

const PATH_CONTEXT_ENV_KEYS = [
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'DSH_HOME',
  'DSH_INSTALL_ANCHOR',
  'DSH_INSTALL_ROOT',
  'DSH_AGENTS_HOME',
  'DSH_BUNDLED_SKILL_DIR',
  'PATH',
  'OMP_COMMAND',
  'OMP_CONFIG_DIR',
  'OMP_PROFILE',
  'PI_CODING_AGENT_DIR',
  'OMP_CODING_AGENT_DIR'
];

let platformRegistry;
let platformRuntime;
let defaultDependencies = Object.freeze({});

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
  return path.isAbsolute(String(value));
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

function hasDeclaredHome(manifest) {
  return Boolean(manifest && manifest.paths && Object.prototype.hasOwnProperty.call(manifest.paths, 'home'));
}

function resolveResourceMappings(manifest, resolvedPaths = {}, pathOptions = {}, strictHome = false) {
  const resourceMappings = manifest.resourceMappings || {};
  const home = resolvedPaths.home || process.cwd();
  const homeDir = pathOptions.homeDir || require('os').homedir();
  const declaredHome = hasDeclaredHome(manifest);
  const resolved = { env: { ...process.env, ...(pathOptions.env || {}) }, home };
  return Object.fromEntries(Object.entries(resourceMappings).map(([type, value]) => {
    if (typeof value === 'string' && !value.trim()) return [type, value];
    const raw = expandTilde(resolveTemplate(value, resolved), homeDir);
    const target = isUrl(raw) || path.isAbsolute(raw) ? raw : path.join(home, raw);
    const requiresContainment = !isExplicitFilesystemRoot(value) || (strictHome && declaredHome);
    if (!isUrl(target) && requiresContainment) assertInsideHome(home, path.normalize(target), manifest.key, type);
    return [type, isUrl(target) ? target : path.normalize(target)];
  }));
}

function resolvePromptFile(manifest, resolvedPaths = {}, pathOptions = {}, strictHome = false) {
  if (manifest.promptFile === null || manifest.promptFile === undefined) return manifest.promptFile;
  if (typeof manifest.promptFile === 'string' && !manifest.promptFile.trim()) return manifest.promptFile;
  const home = resolvedPaths.home || process.cwd();
  const homeDir = pathOptions.homeDir || require('os').homedir();
  const raw = expandTilde(resolveTemplate(manifest.promptFile, { env: { ...process.env, ...(pathOptions.env || {}) }, home }), homeDir);
  if (isUrl(raw)) throw new Error(`Manifest ${manifest.key || 'platform'} promptFile must be a filesystem path`);
  const target = path.isAbsolute(raw) ? path.normalize(raw) : path.normalize(path.join(home, raw));
  const requiresContainment = !isExplicitFilesystemRoot(manifest.promptFile) || (strictHome && hasDeclaredHome(manifest));
  if (requiresContainment) assertInsideHome(home, target, manifest.key, 'promptFile');
  return target;
}

function buildResolvedManifest(rawManifest, resolvedPaths, pathOptions = {}, driverId) {
  if (!rawManifest) return null;
  const paths = resolvedPaths || rawManifest.paths;
  const strictHome = driverId === 'generic-mcp' || driverId === 'generic-prompt';
  const resourceMappings = rawManifest.resourceMappings
    ? resolveResourceMappings(rawManifest, paths || {}, pathOptions, strictHome)
    : rawManifest.resourceMappings;
  const promptFile = resolvePromptFile(rawManifest, paths || {}, pathOptions, strictHome);
  const selectedMapping = driverId === 'generic-mcp'
    ? rawManifest.resourceMappings && rawManifest.resourceMappings.mcp
    : driverId === 'generic-prompt'
      ? (rawManifest.resourceMappings && typeof rawManifest.resourceMappings.prompts === 'string' && rawManifest.resourceMappings.prompts.trim()
        ? rawManifest.resourceMappings.prompts
        : rawManifest.promptFile)
      : null;
  if (strictHome && !hasDeclaredHome(rawManifest) && isExplicitFilesystemRoot(selectedMapping) && paths && Object.prototype.hasOwnProperty.call(paths, 'home')) {
    const driverPaths = { ...paths };
    delete driverPaths.home;
    return { ...rawManifest, paths: driverPaths, resourceMappings, promptFile };
  }
  return { ...rawManifest, paths, resourceMappings, promptFile };
}

function isLegacyDriverId(driverId) {
  return typeof driverId === 'string' && driverId.startsWith('legacy:');
}

function getDefaultDependencies() {
  return { ...defaultDependencies };
}

function canReuseDefaultPathContext(pathOptions = {}) {
  return !pathOptions || (
    typeof pathOptions === 'object'
    && !Array.isArray(pathOptions)
    && Object.keys(pathOptions).length === 0
  );
}

function getDefaultPathContextFingerprint(platform, manifest) {
  try {
    const pathConfig = require('../config/paths');
    const nativeKey = manifest?.pathResolverId || platform;
    const native = pathConfig.NATIVE_PATHS?.[nativeKey] || null;
    const state = typeof pathConfig.getPlatformStatePaths === 'function'
      ? pathConfig.getPlatformStatePaths(platform)
      : null;
    let homeDir = pathConfig.HOME_DIR || '';
    if (!homeDir) {
      const { resolvePreferredHomeDir } = require('../utils/home-dir');
      homeDir = typeof resolvePreferredHomeDir === 'function'
        ? resolvePreferredHomeDir(process.platform, process.env, require('os').homedir())
        : '';
    }
    return JSON.stringify({
      homeDir,
      native,
      state,
      env: Object.fromEntries(PATH_CONTEXT_ENV_KEYS.map(key => [key, process.env[key] || '']))
    });
  } catch {
    return '';
  }
}

function configureDefaultDependencies(dependencies = {}) {
  if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
    throw new TypeError('Platform default dependencies must be an object');
  }
  defaultDependencies = Object.freeze({ ...dependencies });
  return getDefaultDependencies();
}

function createPlatformRuntime({ registry, driverRegistry, dependencies = {} } = {}) {
  const resolvedDependencies = { ...dependencies };
  const resolvedRegistry = registry || createPlatformRegistry();
  const defaultPathContextCache = new Map();
  const runtime = {
    getDriver(platform, capability, context = {}) {
      const driverId = resolvedRegistry.getCapability(platform, capability);
      if (!driverId) return null;
      if (!driverRegistry || typeof driverRegistry.create !== 'function') return null;
      const rawManifest = typeof resolvedRegistry.resolve === 'function' ? resolvedRegistry.resolve(platform) : null;
      const pathOptions = context.pathResolver || context.pathResolverOptions || resolvedDependencies.pathResolver || resolvedDependencies.pathResolverOptions || {};
      let pathContext = null;
      let resolvedPaths = null;
      if (rawManifest) {
        const cacheKey = String(platform || '').trim().toLowerCase();
        const useCache = canReuseDefaultPathContext(pathOptions);
        const cached = useCache ? defaultPathContextCache.get(cacheKey) : null;
        const pathContextFingerprint = useCache
          ? getDefaultPathContextFingerprint(cacheKey, rawManifest)
          : '';
        if (cached && cached.fingerprint === pathContextFingerprint) {
          ({ pathContext, resolvedPaths } = cached);
        } else {
          if (typeof resolvedRegistry.resolvePathContext === 'function') {
            pathContext = resolvedRegistry.resolvePathContext(platform, pathOptions);
            resolvedPaths = pathContext && pathContext.paths;
          } else if (typeof resolvedRegistry.resolvePaths === 'function') {
            resolvedPaths = resolvedRegistry.resolvePaths(platform, pathOptions);
            pathContext = createPlatformPathContext({
              key: platform,
              manifest: rawManifest,
              resolvedPaths,
              pathOptions
            });
          }
          if (useCache && (pathContext || resolvedPaths)) {
            defaultPathContextCache.set(cacheKey, {
              pathContext,
              resolvedPaths,
              fingerprint: pathContextFingerprint
            });
          }
        }
      }
      const manifest = isLegacyDriverId(driverId)
        ? rawManifest
        : buildResolvedManifest(rawManifest, resolvedPaths, pathOptions, driverId);
      const driverContext = {
        ...resolvedDependencies,
        platform,
        capability,
        manifest,
        pathContext,
        paths: pathContext ? pathContext.native : resolvedPaths,
        context,
        dependencies: resolvedDependencies
      };
      Object.defineProperty(driverContext, 'runtime', { value: runtime });
      return driverRegistry.create(driverId, driverContext);
    },
    invoke(platform, capability, operation, args = []) {
      const driver = runtime.getDriver(platform, capability);
      if (!driver || typeof driver[operation] !== 'function') {
        throw new Error(`Unsupported platform capability operation: ${platform}.${capability}.${operation}`);
      }
      return driver[operation](...args);
    }
  };
  return runtime;
}

function getPlatformRegistry() {
  if (!platformRegistry) platformRegistry = createPlatformRegistry();
  return platformRegistry;
}

function getPlatformRuntime() {
  if (!platformRuntime) {
    platformRuntime = createPlatformRuntime({
      registry: getPlatformRegistry(),
      driverRegistry: getDefaultDriverRegistry(),
      dependencies: getDefaultDependencies()
    });
  }
  return platformRuntime;
}

module.exports = {
  configureDefaultDependencies,
  createPlatformRuntime,
  getPlatformRegistry,
  getPlatformRuntime,
  getDefaultDependencies
};
