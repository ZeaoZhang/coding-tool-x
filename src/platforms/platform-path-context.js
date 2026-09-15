'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const PLATFORM_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const PATH_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

function resolveDefaultHomeDir() {
  try {
    const configured = require('../config/paths').HOME_DIR;
    if (typeof configured === 'string' && configured.trim()) return configured;
  } catch {
    // Fall through to the shared home-directory resolver.
  }
  try {
    const { resolvePreferredHomeDir } = require('../utils/home-dir');
    if (typeof resolvePreferredHomeDir === 'function') {
      return resolvePreferredHomeDir(process.platform, process.env, os.homedir());
    }
  } catch {
    // Fall through to the operating-system home directory.
  }
  return os.homedir();
}

function getDefaultPlatformPathsFile(env = process.env, homeDir = os.homedir()) {
  const home = homeDir || env.HOME || env.USERPROFILE || process.cwd();
  return path.join(home, '.cc-tool', 'config', 'platform-paths.json');
}

function invalidOverlay(message, key = null) {
  const error = new Error(message);
  error.key = key;
  return error;
}

function normalizePathOverlay(value) {
  if (value === undefined || value === null) return { platforms: {} };
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw invalidOverlay('path overlay must be an object');
  }

  const source = value.platforms === undefined ? {} : value.platforms;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw invalidOverlay('path overlay platforms must be an object');
  }

  const platforms = {};
  for (const [rawKey, entry] of Object.entries(source)) {
    const key = String(rawKey).trim().toLowerCase();
    if (!PLATFORM_KEY_PATTERN.test(key)) {
      throw invalidOverlay(`invalid platform key: ${rawKey}`, rawKey);
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw invalidOverlay(`platform ${key} must contain a paths object`, key);
    }
    const rawPaths = entry.paths === undefined ? {} : entry.paths;
    if (!rawPaths || typeof rawPaths !== 'object' || Array.isArray(rawPaths)) {
      throw invalidOverlay(`platform ${key} paths must be an object`, key);
    }

    const paths = {};
    for (const [name, pathValue] of Object.entries(rawPaths)) {
      if (!PATH_NAME_PATTERN.test(name)) {
        throw invalidOverlay(`platform ${key} contains an invalid path name: ${name}`, key);
      }
      if (typeof pathValue !== 'string') {
        throw invalidOverlay(`platform ${key} path ${name} must be a string`, key);
      }
      paths[name] = pathValue;
    }
    platforms[key] = { paths };
  }

  return { platforms };
}

function readPlatformPathOverlay({
  fsImpl = fs,
  filePath = getDefaultPlatformPathsFile(),
  logger
} = {}) {
  try {
    if (!fsImpl.existsSync(filePath)) return { platforms: {}, diagnostics: [] };
    const value = JSON.parse(fsImpl.readFileSync(filePath, 'utf8'));
    return { ...normalizePathOverlay(value), diagnostics: [] };
  } catch (error) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn(`[platform-paths] ignored ${filePath}: ${error.message}`);
    }
    return {
      platforms: {},
      diagnostics: [{
        key: error.key || null,
        source: 'pathOverlay',
        reason: 'invalid path overlay',
        message: error.message
      }]
    };
  }
}

function mergePathOverlay(manifest, overlay) {
  if (!manifest || typeof manifest !== 'object') return manifest;
  const normalized = normalizePathOverlay(overlay);
  const entry = normalized.platforms[String(manifest.key || '').trim().toLowerCase()];
  if (!entry || !Object.keys(entry.paths).length) return JSON.parse(JSON.stringify(manifest));
  return {
    ...JSON.parse(JSON.stringify(manifest)),
    paths: {
      ...(manifest.paths || {}),
      ...entry.paths
    }
  };
}

function getOpenCodeDataDir(homeDir, env) {
  if (process.platform === 'win32') {
    return path.join(env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'), 'opencode');
  }
  return path.join(env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share'), 'opencode');
}

function getOpenCodeConfigDir(homeDir, env) {
  if (process.platform === 'win32') {
    return path.join(env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'opencode');
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(homeDir, '.config'), 'opencode');
}

function getOmpFallbackDir(homeDir, env) {
  const configured = env.PI_CODING_AGENT_DIR || env.OMP_CODING_AGENT_DIR;
  if (configured) return path.resolve(configured.replace(/^~(?=$|[\\/])/, homeDir));
  const configRoot = env.OMP_CONFIG_DIR || path.join(homeDir, '.omp');
  const expandedRoot = configRoot.replace(/^~(?=$|[\\/])/, homeDir);
  const profile = env.OMP_PROFILE && env.OMP_PROFILE !== 'default' ? env.OMP_PROFILE : '';
  return path.resolve(profile
    ? path.join(expandedRoot, 'profiles', profile, 'agent')
    : path.join(expandedRoot, 'agent'));
}

function getDefaultNativePaths(platform, homeDir, env, rootOverride) {
  const roots = {
    claude: rootOverride || path.join(homeDir, '.claude'),
    codex: rootOverride || path.join(homeDir, '.codex'),
    gemini: rootOverride || path.join(homeDir, '.gemini'),
    opencode: rootOverride || getOpenCodeConfigDir(homeDir, env),
    omp: rootOverride || getOmpFallbackDir(homeDir, env)
  };
  const root = roots[platform] || homeDir;

  switch (platform) {
    case 'claude':
      return {
        dir: root,
        settings: path.join(root, 'settings.json'),
        settingsBackup: path.join(root, 'settings.json.cc-tool-backup'),
        prompt: path.join(root, 'CLAUDE.md'),
        projects: path.join(root, 'projects'),
        skills: path.join(root, 'skills'),
        commands: path.join(root, 'commands'),
        agents: path.join(root, 'agents'),
        plugins: path.join(root, 'plugins'),
        mcp: path.join(homeDir, '.claude.json'),
        credentials: path.join(root, '.credentials.json')
      };
    case 'codex':
      return {
        dir: root,
        config: path.join(root, 'config.toml'),
        configBackup: path.join(root, 'config.toml.cc-tool-backup'),
        auth: path.join(root, 'auth.json'),
        authBackup: path.join(root, 'auth.json.cc-tool-backup'),
        sessions: path.join(root, 'sessions')
      };
    case 'gemini':
      return {
        dir: root,
        env: path.join(root, '.env'),
        envBackup: path.join(root, '.env.cc-tool-backup'),
        tmp: path.join(root, 'tmp'),
        settings: path.join(root, 'settings.json'),
        settingsBackup: path.join(root, 'settings.json.cc-tool-backup'),
        googleAccounts: path.join(root, 'google_accounts.json'),
        oauthCredentialsLegacy: path.join(root, 'oauth_creds.json'),
        oauthCredentialsEncrypted: path.join(root, 'mcp-oauth-tokens-v2.json')
      };
    case 'opencode': {
      const data = getOpenCodeDataDir(homeDir, env);
      return {
        data,
        config: root,
        sessions: path.join(data, 'storage', 'session'),
        projects: path.join(data, 'storage', 'project'),
        messages: path.join(data, 'storage', 'message'),
        log: path.join(data, 'log'),
        auth: path.join(data, 'auth.json')
      };
    }
    case 'omp':
      return {
        dir: root,
        config: path.join(root, 'config.yml'),
        settings: path.join(root, 'config.yml'),
        settingsJsonLegacy: path.join(root, 'settings.json'),
        auth: path.join(root, 'auth.json'),
        models: path.join(root, 'models.yml'),
        modelsYml: path.join(root, 'models.yml'),
        modelsJsonLegacy: path.join(root, 'models.json'),
        mcp: path.join(root, 'mcp.json'),
        sessions: path.join(root, 'sessions'),
        skills: path.join(root, 'skills'),
        prompts: path.join(root, 'prompts'),
        commands: path.join(root, 'commands'),
        notes: path.join(root, 'notes'),
        extensions: path.join(root, 'extensions'),
        themes: path.join(root, 'themes'),
        packages: path.join(root, 'packages')
      };
    default:
      return { dir: homeDir };
  }
}

function getNativeDefaultsFromConfig(platform, homeDir, pathOptions) {
  if (pathOptions && (pathOptions.homeDir || pathOptions.env || pathOptions.commandRunner)) return null;
  try {
    const { NATIVE_PATHS } = require('../config/paths');
    return NATIVE_PATHS[platform] || null;
  } catch {
    return null;
  }
}

function createPlatformPathContext({ key, platform, manifest, resolvedPaths = {}, pathOptions = {}, customized = false } = {}) {
  const platformKey = String(platform || key || manifest?.key || '').trim().toLowerCase();
  const homeDir = pathOptions.homeDir || resolveDefaultHomeDir();
  const env = { ...process.env, ...(pathOptions.env || {}) };
  const resolverId = manifest && manifest.pathResolverId;
  const nativeKey = ['claude', 'codex', 'gemini', 'opencode', 'omp'].includes(resolverId)
    ? resolverId
    : platformKey;
  const resolvedHome = resolvedPaths.home || homeDir;
  const configDefaults = getNativeDefaultsFromConfig(nativeKey, homeDir, pathOptions);
  const defaults = configDefaults && (
    configDefaults.dir === resolvedHome ||
    configDefaults.config === resolvedHome ||
    configDefaults.data === resolvedHome
  )
    ? configDefaults
    : getDefaultNativePaths(nativeKey, homeDir, env, resolvedHome);
  const native = { ...defaults };

  for (const [name, value] of Object.entries(resolvedPaths)) {
    if (name !== 'home' && typeof value === 'string') native[name] = value;
  }
  if (nativeKey === 'opencode' && !Object.prototype.hasOwnProperty.call(resolvedPaths, 'data')) {
    native.data = defaults.data;
  }
  if (!native.dir && nativeKey !== 'opencode') native.dir = resolvedHome;

  let state = {};
  try {
    const { getPlatformStatePaths } = require('../config/paths');
    state = getPlatformStatePaths(platformKey);
    for (const category of [
      'channels',
      'activeChannel',
      'proxyRuntime',
      'requestSnapshots',
      'localSkills',
      'skillRepos',
      'skillCaches',
      'pluginRepos',
      'pluginMarketCache',
      'gatewaySecret'
    ]) {
      if (typeof resolvedPaths[category] === 'string' && resolvedPaths[category].trim()) {
        state[category] = resolvedPaths[category];
      }
    }
  } catch {
    // The path context remains usable for isolated registry tests.
  }

  return Object.freeze({
    platform: platformKey,
    customized: Boolean(customized),
    home: resolvedHome,
    paths: Object.freeze({ ...resolvedPaths }),
    native: Object.freeze(native),
    state: Object.freeze(state)
  });
}

module.exports = {
  PLATFORM_KEY_PATTERN,
  createPlatformPathContext,
  getDefaultPlatformPathsFile,
  mergePathOverlay,
  normalizePathOverlay,
  readPlatformPathOverlay
};
