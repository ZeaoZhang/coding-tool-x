'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateManifest, normalizeManifestError } = require('./manifest-schema');
const { resolveManifestPaths } = require('./path-resolver');

const BUILT_IN_MANIFESTS = [
  require('./manifests/claude.json'),
  require('./manifests/codex.json'),
  require('./manifests/gemini.json'),
  require('./manifests/opencode.json'),
  require('./manifests/omp.json')
];

function getDefaultPlatformsFile(env = process.env, homeDir = os.homedir()) {
  const home = homeDir || env.HOME || env.USERPROFILE || process.cwd();
  return path.join(home, '.cc-tool', 'config', 'platforms.json');
}

function readUserFile(fsImpl, platformsFile) {
  const filePath = platformsFile || getDefaultPlatformsFile();
  try {
    if (!fsImpl.existsSync(filePath)) return null;
    return JSON.parse(fsImpl.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return { platforms: [], diagnostics: [{ key: null, source: 'userFile', message: error.message }] };
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const LEGACY_CAPABILITIES = ['projects', 'sessions', 'channels', 'proxy', 'statistics', 'resourceSync', 'nativeConfig'];

function normalizeLegacyPlatform(input) {
  if (!input || typeof input !== 'object') return null;
  const key = String(input.key || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(key)) return null;
  const label = String(input.label || input.name || key).trim();
  const command = String(input.command || key).trim();
  if (!label || !command) return null;
  return {
    key,
    label,
    title: String(input.title || label).trim() || label,
    command,
    iconToken: String(input.iconToken || input.icon || 'terminal').trim() || 'terminal',
    color: String(input.color || '').trim(),
    defaultVisible: input.enabled !== false,
    custom: true,
    capabilities: Object.fromEntries(LEGACY_CAPABILITIES.map(capability => [capability, 'unsupported']))
  };
}

function createPlatformRegistry({ builtIns, userFile, legacyUiConfig, fsImpl = fs, logger, platformsFile } = {}) {
  const diagnostics = [];
  const definitions = new Map();
  const builtInKeys = new Set();
  const sourceBuiltIns = builtIns || BUILT_IN_MANIFESTS;

  for (const manifest of sourceBuiltIns) {
    const result = validateManifest(manifest);
    if (!result.valid) {
      throw new Error(`Invalid built-in platform manifest ${manifest && manifest.key ? manifest.key : '(unknown)'}: ${normalizeManifestError(result.errors)}`);
    }
    if (definitions.has(manifest.key)) {
      throw new Error(`Duplicate built-in platform manifest key: ${manifest.key}`);
    }
    builtInKeys.add(manifest.key);
    definitions.set(manifest.key, clone(manifest));
  }

  const loadedUserFile = userFile === undefined ? readUserFile(fsImpl, platformsFile) : userFile;
  if (loadedUserFile && Array.isArray(loadedUserFile.diagnostics)) diagnostics.push(...loadedUserFile.diagnostics);
  const userPlatforms = loadedUserFile && Array.isArray(loadedUserFile.platforms) ? loadedUserFile.platforms : [];
  for (const manifest of userPlatforms) {
    const result = validateManifest(manifest);
    if (!result.valid) {
      diagnostics.push({
        key: manifest && manifest.key ? manifest.key : null,
        source: 'userFile',
        reason: 'invalid manifest or capability driver',
        message: normalizeManifestError(result.errors)
      });
      continue;
    }
    if (builtInKeys.has(manifest.key)) continue;
    if (definitions.has(manifest.key)) {
      diagnostics.push({ key: manifest.key, source: 'userFile', message: 'duplicate platform key ignored' });
      continue;
    }
    definitions.set(manifest.key, { ...clone(manifest), custom: manifest.custom !== false });
  }

  const legacyPlatforms = legacyUiConfig?.customCliPlatforms;
  if (Array.isArray(legacyPlatforms)) {
    for (const legacyPlatform of legacyPlatforms) {
      const normalized = normalizeLegacyPlatform(legacyPlatform);
      if (!normalized) {
        diagnostics.push({
          key: legacyPlatform?.key || null,
          source: 'legacyUiConfig',
          reason: 'invalid legacy custom platform metadata',
          message: 'invalid legacy custom platform metadata'
        });
        continue;
      }
      if (builtInKeys.has(normalized.key) || definitions.has(normalized.key)) continue;
      definitions.set(normalized.key, normalized);
    }
  }


  function getStored(key) {
    return definitions.get(String(key || '').trim().toLowerCase()) || null;
  }

  function resolve(key) {
    const platform = getStored(key);
    return platform ? clone(platform) : null;
  }

  return {
    resolve,
    list({ enabledOnly = false } = {}) {
      const platforms = [...definitions.values()].filter(platform => !enabledOnly || platform.enabled !== false);
      return clone(platforms);
    },
    getCapability(key, capability) {
      const platform = getStored(key);
      return platform && platform.capabilities ? platform.capabilities[capability] || null : null;
    },
    resolvePaths(key, options) {
      const platform = getStored(key);
      if (!platform) return null;
      return resolveManifestPaths(platform, options);
    },
    getPublicDefinition(key) {
      const platform = getStored(key);
      if (!platform) return null;
      const capabilities = {};
      for (const [capability, driverId] of Object.entries(platform.capabilities || {})) {
        capabilities[capability] = driverId !== 'unsupported';
      }
      return clone({
        key: platform.key,
        label: platform.label,
        title: platform.title,
        command: platform.command,
        iconToken: platform.iconToken,
        color: platform.color,
        defaultVisible: platform.defaultVisible,
        capabilities,
        ...(platform.projectResources ? { projectResources: platform.projectResources } : {})
      });
    },
    diagnostics() {
      return clone(diagnostics);
    }
  };
}

module.exports = { BUILT_IN_MANIFESTS, createPlatformRegistry, getDefaultPlatformsFile };
