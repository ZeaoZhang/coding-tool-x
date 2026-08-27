'use strict';

const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function resolveTemplate(value, resolved) {
  return String(value)
    .replace(/\$([A-Z][A-Z0-9_]*)/g, (_, name) => resolved.env[name] || '')
    .replace(/\{home\}/g, resolved.home);
}

function isBareEnvReference(value) {
  return /^\$[A-Z][A-Z0-9_]*$/.test(String(value));
}

function loadNativePathResolvers() {
  return require('../config/paths');
}

function resolveExistingEnvPath(envValue) {
  if (typeof envValue !== 'string') return '';
  return envValue.trim() || '';
}

function expandUserHome(value, homeDir) {
  if (value === '~') return homeDir;
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(homeDir, value.slice(2));
  return value;
}

function normalizeOmpProfileName(profile = '') {
  const value = String(profile || '').trim();
  return value && value !== 'default' ? value : '';
}

function resolveInjectedOmpHome(env, commandRunner, homeDir, hasInjectedHomeDir, hasInjectedCommandRunner) {
  if (hasInjectedCommandRunner) {
    const command = String(env.OMP_COMMAND || 'omp').trim() || 'omp';
    try {
      const output = commandRunner(command, ['config', 'path'], {
        encoding: 'utf8',
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 3000,
        windowsHide: true
      });
      const configuredByCli = String(output || '').trim().split(/\r?\n/).find(Boolean);
      if (configuredByCli) return path.resolve(expandUserHome(configuredByCli, homeDir));
    } catch {
      // Fall through to injected environment/profile paths.
    }
  }

  const configuredDir = resolveExistingEnvPath(env.PI_CODING_AGENT_DIR || env.OMP_CODING_AGENT_DIR);
  if (configuredDir) return path.resolve(expandUserHome(configuredDir, homeDir));

  const hasInjectedOmpEnv = Boolean(env.OMP_CONFIG_DIR || env.PI_CODING_AGENT_DIR || env.OMP_CODING_AGENT_DIR || env.OMP_PROFILE);
  if (!hasInjectedHomeDir && !hasInjectedOmpEnv && !hasInjectedCommandRunner) return undefined;
  const profile = normalizeOmpProfileName(env.OMP_PROFILE);
  const configRoot = expandUserHome(resolveExistingEnvPath(env.OMP_CONFIG_DIR) || path.join(homeDir, '.omp'), homeDir);
  return path.resolve(profile ? path.join(configRoot, 'profiles', profile, 'agent') : path.join(configRoot, 'agent'));
}

function resolveNativeHome(pathResolverId, env, commandRunner, homeDir, hasInjectedHomeDir, hasInjectedCommandRunner) {
  if (pathResolverId === 'declarative') return undefined;
  if (pathResolverId === 'omp') {
    const injectedOmpHome = resolveInjectedOmpHome(env, commandRunner, homeDir, hasInjectedHomeDir, hasInjectedCommandRunner);
    if (injectedOmpHome) return injectedOmpHome;
  }
  if (hasInjectedHomeDir && pathResolverId !== 'omp') {
    switch (pathResolverId) {
      case 'claude': return env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude');
      case 'codex': return env.CODEX_HOME || path.join(homeDir, '.codex');
      case 'gemini': return path.join(homeDir, '.gemini');
      case 'opencode': return path.join(homeDir, '.config', 'opencode');
      default: return undefined;
    }
  }
  const {
    getClaudeConfigDir,
    getCodexDir,
    getGeminiDir,
    getOpenCodeConfigDir,
    getOpenCodeDataDir,
    getOmpAgentDir
  } = loadNativePathResolvers();
  switch (pathResolverId) {
    case 'claude': return env.CLAUDE_CONFIG_DIR || getClaudeConfigDir();
    case 'codex': return env.CODEX_HOME || getCodexDir();
    case 'gemini': return getGeminiDir();
    case 'opencode': return getOpenCodeConfigDir() || getOpenCodeDataDir();
    case 'omp': return getOmpAgentDir(env, { commandRunner });
    default: return undefined;
  }
}

function assertInsideHome(root, candidate, manifestKey, pathName) {
  const relative = path.relative(root, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Manifest ${manifestKey || 'platform'} path ${pathName} escapes home`);
  }
}

function resolveManifestPaths(manifest, options = {}) {
  const env = { ...process.env, ...(options.env || {}) };
  const hasInjectedHomeDir = Object.prototype.hasOwnProperty.call(options, 'homeDir');
  const homeDir = options.homeDir || os.homedir();
  const commandRunner = options.commandRunner || execFileSync;
  const nativeHome = resolveNativeHome(manifest.pathResolverId || 'declarative', env, commandRunner, homeDir, hasInjectedHomeDir, Object.prototype.hasOwnProperty.call(options, 'commandRunner'));
  const declared = manifest.paths || {};
  const homeValue = declared.home || nativeHome || homeDir;
  const resolved = { env, home: '' };
  const expand = (value, { allowRelativeHomeFallback = true } = {}) => {
    let result = resolveTemplate(value, resolved);
    if (!result) return '';
    if (result === '~') result = homeDir;
    else if (result.startsWith('~/') || result.startsWith('~\\')) result = path.join(homeDir, result.slice(2));
    else if (!path.isAbsolute(result) && allowRelativeHomeFallback) result = path.join(resolved.home || homeDir, result);
    return path.normalize(result);
  };
  const homeSource = String(homeValue);
  const rawHome = resolveTemplate(homeValue, resolved);
  const explicitHomeRoot = path.isAbsolute(homeSource) || (isBareEnvReference(homeSource) && path.isAbsolute(rawHome));
  resolved.home = expand(homeValue);
  if (!resolved.home) throw new Error(`Manifest ${manifest.key || 'platform'} requires a non-empty home path`);
  if (!explicitHomeRoot) assertInsideHome(homeDir, resolved.home, manifest.key, 'home');
  const paths = {};
  for (const [name, value] of Object.entries(declared)) {
    const explicitAbsolute = path.isAbsolute(String(value));
    const raw = resolveTemplate(value, resolved);
    const candidate = expand(raw);
    if (name !== 'home' && !explicitAbsolute) {
      assertInsideHome(resolved.home, candidate, manifest.key, name);
    }
    paths[name] = candidate;
  }
  if (!Object.prototype.hasOwnProperty.call(paths, 'home')) paths.home = resolved.home;
  return paths;
}

module.exports = { resolveManifestPaths, resolveTemplate };
