/**
 * Config Sync Manager
 *
 * Manages file synchronization between cc-tool central storage and CLI directories:
 * - Claude Code: ~/.claude/{skills,commands,agents,plugins}/
 * - Codex CLI: ~/.codex/skills/, ~/.codex/prompts/
 * - Gemini CLI: ~/.gemini/{skills,commands,agents}/
 * - OpenCode CLI: ~/.config/opencode/{skills,commands,agents,plugins}/
 * - OMP: ~/.omp/agent/{skills,commands,prompts,extensions}/
 *
 * Config types:
 * - skills: directory-based (each skill is a dir with SKILL.md)
 * - commands: file-based (.md), may be nested in subdirectories
 * - agents: file-based (.md), flat directory
 * - plugins: directory-based
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { PATHS, NATIVE_PATHS, HOME_DIR, ensureStorageDirMigrated } = require('../../config/paths');
const platformRuntime = require('../../platforms/runtime');
const { assertNoSymlinkComponents } = require('../../shared/project-config');
const { CONFIG_TYPES } = require('../../platforms/drivers/shared/resource-sync');

// Paths retained for the compatibility facade and existing consumers.
const HOME = HOME_DIR || os.homedir();
const CC_TOOL_CONFIGS = PATHS.configs;
const CLAUDE_CODE_DIR = NATIVE_PATHS.claude.dir || path.dirname(NATIVE_PATHS.claude.settings) || path.join(HOME, '.claude');
const CODEX_DIR = path.join(HOME, '.codex');
const GEMINI_DIR = path.join(HOME, '.gemini');
const OPENCODE_DIR = NATIVE_PATHS.opencode.config;
const OMP_AGENT_DIR = NATIVE_PATHS.omp.dir;
const CODEX_CONFIG_PATH = NATIVE_PATHS.codex.config;

class ConfigSyncManager {
  constructor({ registry, runtime } = {}) {
    ensureStorageDirMigrated();
    this.registry = registry || platformRuntime.getPlatformRegistry();
    this.runtime = runtime || platformRuntime.getPlatformRuntime();
    this.ccToolConfigs = CC_TOOL_CONFIGS;
    this.claudeDir = CLAUDE_CODE_DIR;
    this.codexDir = CODEX_DIR;
    this.geminiDir = GEMINI_DIR;
    this.opencodeDir = OPENCODE_DIR;
    this.ompDir = OMP_AGENT_DIR;
    this.configTypes = CONFIG_TYPES;
  }

  _resolveSourcePath(type, safeName, sourcePathOverride = null) {
    const defaultPath = path.join(this.ccToolConfigs, type, safeName);
    const sourcePath = sourcePathOverride
      ? (() => {
        if (typeof sourcePathOverride !== 'string' || !path.isAbsolute(sourcePathOverride)) {
          throw new Error('Controlled source path must be an absolute path');
        }
        return path.resolve(sourcePathOverride);
      })()
      : defaultPath;
    const allowedRoots = [
      path.join(this.ccToolConfigs, type),
      PATHS.skillArtifacts
    ].filter(Boolean).map(root => path.resolve(root));
    const allowedRoot = allowedRoots.find(root => (
      sourcePath === root || sourcePath.startsWith(`${root}${path.sep}`)
    ));
    if (!allowedRoot) throw new Error('Controlled source path escapes allowed storage');
    assertNoSymlinkComponents(allowedRoot, sourcePath, fs);
    if (sourcePathOverride && !fs.existsSync(sourcePath)) {
      throw new Error('Controlled source path not found');
    }
    return sourcePath;
  }

  syncToPlatform(platform, type, name, sourcePathOverride = null) {
    const key = String(platform || '').trim().toLowerCase();
    try {
      const driver = this.runtime?.getDriver?.(key, 'resourceSync');
      if (!driver || (typeof driver.status === 'string' && driver.status !== 'ok')) {
        return { status: 'unsupported', platform: key, capability: 'resourceSync', operation: 'sync' };
      }
      if (typeof driver.sync !== 'function') {
        return { status: 'unsupported', platform: key, capability: 'resourceSync', operation: 'sync' };
      }
      const safeName = this._normalizeSafeRelativeName(name);
      if (!safeName) {
        return { status: 'invalid', platform: key, capability: 'resourceSync', operation: 'sync', error: 'Invalid config item name' };
      }
      const sourcePath = this._resolveSourcePath(type, safeName, sourcePathOverride);
      const syncArgs = sourcePathOverride || driver.sync.length >= 3
        ? [type, safeName, sourcePath]
        : [type, safeName];
      return driver.sync(...syncArgs);
    } catch (error) {
      return {
        status: 'failed',
        platform: key,
        capability: 'resourceSync',
        operation: 'sync',
        error: error.message
      };
    }
  }

  removeFromPlatform(platform, type, name) {
    const key = String(platform || '').trim().toLowerCase();
    try {
      const driver = this.runtime?.getDriver?.(key, 'resourceSync');
      if (!driver || (typeof driver.status === 'string' && driver.status !== 'ok')) {
        return { status: 'unsupported', platform: key, capability: 'resourceSync', operation: 'remove' };
      }
      if (typeof driver.remove !== 'function') {
        return { status: 'unsupported', platform: key, capability: 'resourceSync', operation: 'remove' };
      }
      const safeName = this._normalizeSafeRelativeName(name);
      if (!safeName) {
        return { status: 'invalid', platform: key, capability: 'resourceSync', operation: 'remove', error: 'Invalid config item name' };
      }
      return driver.remove(type, safeName);
    } catch (error) {
      return {
        status: 'failed',
        platform: key,
        capability: 'resourceSync',
        operation: 'remove',
        error: error.message
      };
    }
  }

  _runResourceOperation(platform, operation, args) {
    const key = String(platform || '').trim().toLowerCase();
    try {
      const driver = this.runtime?.getDriver?.(key, 'resourceSync');
      if (!driver || typeof driver[operation] !== 'function') {
        return { success: false, error: `Resource sync is not supported by ${key}` };
      }
      const normalize = result => {
        if (result?.status === 'ok') return result.data;
        return {
          success: false,
          error: result?.error || `Resource sync ${operation} failed for ${key}`
        };
      };
      const result = driver[operation](...args);
      return result && typeof result.then === 'function' ? result.then(normalize) : normalize(result);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Compatibility methods for callers that still use the old manager API.
   * All platform behavior is implemented by the resourceSync Driver.
   */
  syncToClaude(type, name, sourcePathOverride = null) {
    return this._runResourceOperation('claude', 'sync', [type, name, sourcePathOverride]);
  }

  removeFromClaude(type, name) {
    return this._runResourceOperation('claude', 'remove', [type, name]);
  }

  syncToCodex(type, name, sourcePathOverride = null) {
    return this._runResourceOperation('codex', 'sync', [type, name, sourcePathOverride]);
  }

  removeFromCodex(type, name) {
    return this._runResourceOperation('codex', 'remove', [type, name]);
  }

  syncToGemini(type, name, sourcePathOverride = null) {
    return this._runResourceOperation('gemini', 'sync', [type, name, sourcePathOverride]);
  }

  removeFromGemini(type, name) {
    return this._runResourceOperation('gemini', 'remove', [type, name]);
  }

  syncToOpenCode(type, name, sourcePathOverride = null) {
    return this._runResourceOperation('opencode', 'sync', [type, name, sourcePathOverride]);
  }

  removeFromOpenCode(type, name) {
    return this._runResourceOperation('opencode', 'remove', [type, name]);
  }

  syncToOmp(type, name, sourcePathOverride = null) {
    return this._runResourceOperation('omp', 'sync', [type, name, sourcePathOverride]);
  }

  removeFromOmp(type, name) {
    return this._runResourceOperation('omp', 'remove', [type, name]);
  }

  /**
   * Batch sync based on registry data
   * @param {string} type - Config type
   * @param {Object} registryItems - Registry items { name: { enabled, platforms: { claude, codex, gemini, opencode, omp } } }
   * @returns {Object} Results summary
   */
  syncAll(type, registryItems) {
    const results = {
      synced: [],
      removed: [],
      errors: [],
      warnings: []
    };

    if (!registryItems || typeof registryItems !== 'object') {
      return results;
    }

    let platforms = [];
    try {
      platforms = this.registry?.list?.() || [];
    } catch (error) {
      results.errors.push({ type, operation: 'list-platforms', error: error.message });
      return results;
    }

    const definitions = new Map(
      platforms
        .filter(platform => platform && platform.key)
        .map(platform => [String(platform.key).trim().toLowerCase(), platform])
    );

    const invoke = (platform, operation, name) => (
      operation === 'sync'
        ? this.syncToPlatform(platform, type, name)
        : this.removeFromPlatform(platform, type, name)
    );

    const isSuccessful = result => result?.success === true || result?.status === 'ok';
    const isSkipped = result => result?.skipped === true || result?.status === 'unsupported';
    const appendResult = (name, platform, operation, result) => {
      if (isSkipped(result)) return;
      if (isSuccessful(result)) {
        if (operation === 'sync') {
          results.synced.push({ type, name, platform });
          if (Array.isArray(result.warnings) && result.warnings.length > 0) {
            results.warnings.push({ type, name, platform, warnings: result.warnings });
          }
        } else if (!result.message) {
          results.removed.push({ type, name, platform });
        }
      } else {
        results.errors.push({
          type,
          name,
          platform,
          error: result?.error || `${operation} failed`
        });
      }
    };

    const pending = [];
    for (const [name, item] of Object.entries(registryItems)) {
      if (!item || typeof item !== 'object') continue;
      const active = item.enabled === true && item.platforms && typeof item.platforms === 'object';

      for (const platform of definitions.keys()) {
        const definition = definitions.get(platform);
        if (definition?.resourceTypes?.[type] === false) continue;
        const shouldSync = active && item.platforms[platform] === true;
        const operation = shouldSync ? 'sync' : 'remove';
        const result = invoke(platform, operation, name);
        if (result && typeof result.then === 'function') {
          pending.push(result.then(value => appendResult(name, platform, operation, value)));
        } else {
          appendResult(name, platform, operation, result);
        }
      }
    }

    const finish = () => {
      console.log(`[ConfigSyncManager] syncAll(${type}): synced=${results.synced.length}, removed=${results.removed.length}, errors=${results.errors.length}`);
      return results;
    };

    return pending.length ? Promise.all(pending).then(finish) : finish();
  }

  _normalizeSafeRelativeName(name) {
    const raw = String(name || '').replace(/\\/g, '/').trim();
    if (!raw || raw.includes('\0')) {
      return null;
    }

    const normalized = path.posix.normalize(raw).replace(/^(\.\/)+/, '');
    if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
      return null;
    }

    if (path.isAbsolute(raw) || raw.startsWith('/')) {
      return null;
    }

    return normalized;
  }

}

module.exports = {
  ConfigSyncManager,
  CONFIG_TYPES,
  CC_TOOL_CONFIGS,
  CLAUDE_CODE_DIR,
  CODEX_DIR,
  GEMINI_DIR,
  OPENCODE_DIR
};
