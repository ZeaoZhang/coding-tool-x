'use strict';

const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function resolveTemplate(value, resolved) {
  return String(value)
    .replace(/\$([A-Z][A-Z0-9_]*)/g, (_, name) => resolved.env[name] || '')
    .replace(/\{home\}/g, resolved.home);
}

function loadNativePathResolvers() {
  return require('../config/paths');
}

function resolveNativeHome(pathResolverId, env, commandRunner) {
  if (pathResolverId === 'declarative') return undefined;
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

function resolveManifestPaths(manifest, options = {}) {
  const env = { ...process.env, ...(options.env || {}) };
  const homeDir = options.homeDir || os.homedir();
  const commandRunner = options.commandRunner || execFileSync;
  const nativeHome = resolveNativeHome(manifest.pathResolverId || 'declarative', env, commandRunner);
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
  resolved.home = expand(homeValue);
  if (!resolved.home) throw new Error(`Manifest ${manifest.key || 'platform'} requires a non-empty home path`);
  const paths = {};
  for (const [name, value] of Object.entries(declared)) {
    const explicitAbsolute = path.isAbsolute(String(value));
    const raw = resolveTemplate(value, resolved);
    const candidate = expand(raw);
    if (name !== 'home' && !explicitAbsolute) {
      const relative = path.relative(resolved.home, candidate);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`Manifest ${manifest.key || 'platform'} path ${name} escapes home`);
      }
    }
    paths[name] = candidate;
  }
  if (!Object.prototype.hasOwnProperty.call(paths, 'home')) paths.home = resolved.home;
  return paths;
}

module.exports = { resolveManifestPaths, resolveTemplate };
