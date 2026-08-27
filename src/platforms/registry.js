'use strict';

const fs = require('fs');
const path = require('path');
const { PATHS } = require('../config/paths');
const { validateManifest, normalizeManifestError } = require('./manifest-schema');
const { resolveManifestPaths } = require('./path-resolver');

const BUILT_IN_MANIFESTS = [
  require('./manifests/claude.json'),
  require('./manifests/codex.json'),
  require('./manifests/gemini.json'),
  require('./manifests/opencode.json'),
  require('./manifests/omp.json')
];

function readUserFile(fsImpl) {
  const platformsFile = PATHS.platforms || path.join(PATHS.config || process.cwd(), 'platforms.json');
  try {
    if (!fsImpl.existsSync(platformsFile)) return null;
    return JSON.parse(fsImpl.readFileSync(platformsFile, 'utf8'));
  } catch (error) {
    return { platforms: [], diagnostics: [{ key: null, source: 'userFile', message: error.message }] };
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createPlatformRegistry({ builtIns, userFile, legacyUiConfig, fsImpl = fs, logger } = {}) {
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

  const loadedUserFile = userFile === undefined ? readUserFile(fsImpl) : userFile;
  if (loadedUserFile && Array.isArray(loadedUserFile.diagnostics)) diagnostics.push(...loadedUserFile.diagnostics);
  const userPlatforms = loadedUserFile && Array.isArray(loadedUserFile.platforms) ? loadedUserFile.platforms : [];
  for (const manifest of userPlatforms) {
    const result = validateManifest(manifest);
    if (!result.valid) {
      diagnostics.push({ key: manifest && manifest.key ? manifest.key : null, source: 'userFile', message: normalizeManifestError(result.errors) });
      continue;
    }
    if (builtInKeys.has(manifest.key)) continue;
    definitions.set(manifest.key, { ...clone(manifest), custom: manifest.custom !== false });
  }


  function resolve(key) {
    return definitions.get(String(key || '').trim().toLowerCase()) || null;
  }

  return {
    resolve,
    list({ enabledOnly = false } = {}) {
      const platforms = [...definitions.values()];
      return enabledOnly ? platforms.filter(platform => platform.enabled !== false) : platforms;
    },
    getCapability(key, capability) {
      const platform = resolve(key);
      return platform && platform.capabilities ? platform.capabilities[capability] || null : null;
    },
    resolvePaths(key, options) {
      const platform = resolve(key);
      if (!platform) return null;
      return resolveManifestPaths(platform, options);
    },
    getPublicDefinition(key) {
      const platform = resolve(key);
      if (!platform) return null;
      const { paths, sessionMapping, resourceMappings, ...publicDefinition } = platform;
      return clone(publicDefinition);
    },
    diagnostics() {
      return clone(diagnostics);
    }
  };
}

module.exports = { BUILT_IN_MANIFESTS, createPlatformRegistry };
