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
const toml = require('toml');
const tomlStringify = require('@iarna/toml').stringify;
const { convertSkillToCodex, convertCommandToCodex, convertCommandToGemini } = require('./format-converter');
const { PATHS, NATIVE_PATHS, HOME_DIR, ensureStorageDirMigrated } = require('../../config/paths');
const platformRuntime = require('../../platforms/runtime');

// Paths
const HOME = HOME_DIR || os.homedir();
const CC_TOOL_CONFIGS = PATHS.configs;
const CLAUDE_CODE_DIR = NATIVE_PATHS.claude.dir || path.dirname(NATIVE_PATHS.claude.settings) || path.join(HOME, '.claude');
const CODEX_DIR = path.join(HOME, '.codex');
const GEMINI_DIR = path.join(HOME, '.gemini');
const OPENCODE_DIR = NATIVE_PATHS.opencode.config;
const OMP_AGENT_DIR = NATIVE_PATHS.omp.dir;
const CODEX_CONFIG_PATH = NATIVE_PATHS.codex.config;

// Config type definitions
const CONFIG_TYPES = {
  skills: {
    isDirectory: true,
    markerFile: 'SKILL.md',
    claudeTarget: 'skills',
    codexTarget: 'skills',
    codexSupported: true,
    convertForCodex: true,
    geminiTarget: 'skills',
    geminiSupported: true,
    opencodeTarget: 'skills',
    opencodeLegacyTarget: 'skill',
    opencodeSupported: true,
    ompTarget: 'skills',
    ompSupported: true
  },
  commands: {
    isDirectory: false,
    extension: '.md',
    claudeTarget: 'commands',
    codexTarget: 'prompts',
    codexSupported: true,
    convertForCodex: true,
    geminiTarget: 'commands',
    geminiExtension: '.toml',
    geminiSupported: true,
    opencodeTarget: 'commands',
    opencodeLegacyTarget: 'command',
    opencodeSupported: true,
    ompTarget: 'commands',
    ompSupported: true
  },
  agents: {
    isDirectory: false,
    extension: '.md',
    claudeTarget: 'agents',
    codexSupported: true,
    geminiTarget: 'agents',
    geminiSupported: true,
    opencodeTarget: 'agents',
    opencodeLegacyTarget: 'agent',
    opencodeSupported: true,
    ompSupported: false
  },
  plugins: {
    isDirectory: true,
    claudeTarget: 'plugins',
    codexSupported: false,
    geminiSupported: false,
    opencodeTarget: 'plugins',
    opencodeLegacyTarget: 'plugin',
    opencodeSupported: true,
    ompTarget: 'extensions',
    ompSupported: true
  }
};

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

  syncToPlatform(platform, type, name) {
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
      const sourcePath = path.join(this.ccToolConfigs, type, safeName);
      return driver.sync.length >= 3
        ? driver.sync(type, safeName, sourcePath)
        : driver.sync(type, safeName);
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

  /**
   * Sync a config item to Claude Code
   * @param {string} type - Config type (skills, commands, agents, plugins)
   * @param {string} name - Item name (directory name for skills, file path for others)
   * @returns {Object} Result with success status
   */
  syncToClaude(type, name) {
    const config = this.configTypes[type];
    if (!config) {
      console.log(`[ConfigSyncManager] Unknown config type: ${type}`);
      return { success: false, error: `Unknown config type: ${type}` };
    }

    const safeName = this._normalizeSafeRelativeName(name);
    if (!safeName) {
      return { success: false, error: 'Invalid config item name' };
    }
    const sourcePath = path.join(this.ccToolConfigs, type, safeName);
    const targetPath = path.join(this.claudeDir, config.claudeTarget, safeName);

    // Check if source exists
    if (!fs.existsSync(sourcePath)) {
      console.log(`[ConfigSyncManager] Source not found: ${sourcePath}`);
      return { success: false, error: 'Source not found' };
    }

    try {
      if (config.isDirectory) {
        // Copy entire directory recursively
        this._ensureDir(path.dirname(targetPath));
        this._copyDirRecursive(sourcePath, targetPath);
        console.log(`[ConfigSyncManager] Synced ${type}/${name} to Claude Code (directory)`);
      } else {
        // Copy single file, preserving subdirectory structure
        this._ensureDir(path.dirname(targetPath));
        this._copyFile(sourcePath, targetPath);
        console.log(`[ConfigSyncManager] Synced ${type}/${name} to Claude Code (file)`);
      }

      return { success: true, target: targetPath };
    } catch (err) {
      console.error(`[ConfigSyncManager] Sync to Claude failed:`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Remove a config item from Claude Code
   * @param {string} type - Config type
   * @param {string} name - Item name
   * @returns {Object} Result with success status
   */
  removeFromClaude(type, name) {
    const config = this.configTypes[type];
    if (!config) {
      return { success: false, error: `Unknown config type: ${type}` };
    }

    const safeName = this._normalizeSafeRelativeName(name);
    if (!safeName) {
      return { success: false, error: 'Invalid config item name' };
    }
    const targetPath = path.join(this.claudeDir, config.claudeTarget, safeName);

    if (!fs.existsSync(targetPath)) {
      console.log(`[ConfigSyncManager] Target not found (already removed): ${targetPath}`);
      return { success: true, message: 'Already removed' };
    }

    try {
      if (config.isDirectory) {
        // Remove entire directory
        this._removeRecursive(targetPath);
        console.log(`[ConfigSyncManager] Removed ${type}/${name} from Claude Code (directory)`);
      } else {
        // Remove file
        fs.unlinkSync(targetPath);
        console.log(`[ConfigSyncManager] Removed ${type}/${name} from Claude Code (file)`);

        // Clean up empty parent directories for file-based configs
        this._cleanupEmptyParents(path.dirname(targetPath), path.join(this.claudeDir, config.claudeTarget));
      }

      return { success: true };
    } catch (err) {
      console.error(`[ConfigSyncManager] Remove from Claude failed:`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Sync a config item to Codex CLI
   * Supports skills, commands, agents
   * @param {string} type - Config type
   * @param {string} name - Item name
   * @returns {Object} Result with success status and any warnings
   */
  syncToCodex(type, name) {
    const config = this.configTypes[type];
    if (!config) {
      return { success: false, error: `Unknown config type: ${type}` };
    }

    if (!config.codexSupported) {
      console.log(`[ConfigSyncManager] ${type} not supported by Codex, skipping`);
      return { success: true, skipped: true, reason: 'Not supported by Codex' };
    }

    const safeName = this._normalizeSafeRelativeName(name);
    if (!safeName) {
      return { success: false, error: 'Invalid config item name' };
    }
    const sourcePath = path.join(this.ccToolConfigs, type, safeName);

    if (!fs.existsSync(sourcePath)) {
      console.log(`[ConfigSyncManager] Source not found: ${sourcePath}`);
      return { success: false, error: 'Source not found' };
    }

    try {
      const warnings = [];

      if (type === 'agents') {
        const sourceContent = fs.readFileSync(sourcePath, 'utf-8');
        const { frontmatter } = this._parseFrontmatter(sourceContent);
        const fileName = path.basename(safeName, path.extname(safeName));

        const codexConfig = this._readCodexConfigToml();
        codexConfig.features = this._isPlainObject(codexConfig.features) ? codexConfig.features : {};
        codexConfig.features.multi_agent = true;
        codexConfig.agents = this._isPlainObject(codexConfig.agents) ? codexConfig.agents : {};

        const existing = codexConfig.agents[fileName];
        if (Object.prototype.hasOwnProperty.call(codexConfig.agents, fileName) &&
            !this._isPlainObject(existing)) {
          return { success: false, error: `Agent name "${fileName}" conflicts with global [agents] key` };
        }

        const entry = this._isPlainObject(existing) ? { ...existing } : {};
        entry.description = (frontmatter.description || fileName).trim();

        const model = typeof frontmatter.model === 'string' ? frontmatter.model.trim() : '';
        const existingConfigFile = this._normalizeCodexPath(entry.config_file);
        const isExistingManagedConfig = this._isManagedCodexAgentConfigPath(existingConfigFile);
        if (model) {
          const managedConfigPath = isExistingManagedConfig
            ? existingConfigFile
            : this._getCodexManagedAgentConfigPath(fileName);
          const parsedConfigFile = this._readCodexAgentConfigFile(managedConfigPath);
          const configData = this._isPlainObject(parsedConfigFile?.data) ? parsedConfigFile.data : {};
          configData.model = model;
          this._writeCodexAgentConfigFile(managedConfigPath, configData);
          entry.config_file = managedConfigPath;
        } else if (isExistingManagedConfig) {
          const resolvedConfigPath = this._resolveCodexPath(existingConfigFile);
          if (resolvedConfigPath && fs.existsSync(resolvedConfigPath)) {
            fs.unlinkSync(resolvedConfigPath);
          }
          delete entry.config_file;
        }

        codexConfig.agents[fileName] = entry;

        this._writeCodexConfigToml(codexConfig);
        console.log(`[ConfigSyncManager] Synced ${type}/${name} to Codex (config.toml agents table)`);
        return { success: true, target: CODEX_CONFIG_PATH, warnings };
      }

      if (type === 'skills') {
        // Skills: copy directory, convert SKILL.md content
        const targetPath = path.join(this.codexDir, config.codexTarget, safeName);
        this._ensureDir(targetPath);

        // Copy all files, converting SKILL.md
        this._copyDirWithConversion(sourcePath, targetPath, (filePath, content) => {
          if (path.basename(filePath) === 'SKILL.md') {
            const result = convertSkillToCodex(content);
            if (result.warnings && result.warnings.length > 0) {
              warnings.push(...result.warnings);
            }
            return result.content;
          }
          return content;
        });

        console.log(`[ConfigSyncManager] Synced ${type}/${name} to Codex (skill directory)`);
        return { success: true, target: targetPath, warnings };

      } else if (type === 'commands') {
        // Commands: convert and write to prompts directory
        const content = fs.readFileSync(sourcePath, 'utf-8');
        const result = convertCommandToCodex(content);

        if (result.warnings && result.warnings.length > 0) {
          warnings.push(...result.warnings);
        }

        // Target path in codex prompts (same relative path structure)
        const targetPath = path.join(this.codexDir, config.codexTarget, safeName);
        this._ensureDir(path.dirname(targetPath));
        fs.writeFileSync(targetPath, result.content, 'utf-8');

        console.log(`[ConfigSyncManager] Synced ${type}/${name} to Codex (prompt)`);
        return { success: true, target: targetPath, warnings };
      }

      return { success: false, error: 'Unexpected type' };
    } catch (err) {
      console.error(`[ConfigSyncManager] Sync to Codex failed:`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Remove a config item from Codex CLI
   * @param {string} type - Config type
   * @param {string} name - Item name
   * @returns {Object} Result with success status
   */
  removeFromCodex(type, name) {
    const config = this.configTypes[type];
    if (!config) {
      return { success: false, error: `Unknown config type: ${type}` };
    }

    const safeName = this._normalizeSafeRelativeName(name);
    if (!safeName) {
      return { success: false, error: 'Invalid config item name' };
    }

    if (!config.codexSupported) {
      return { success: true, skipped: true, reason: 'Not supported by Codex' };
    }

    if (type === 'agents') {
      try {
        const configData = this._readCodexConfigToml();
        const agentsTable = this._isPlainObject(configData.agents) ? configData.agents : {};
        const fileName = path.basename(safeName, path.extname(safeName));

        const existing = agentsTable[fileName];
        if (!this._isPlainObject(existing)) {
          return { success: true, message: 'Already removed' };
        }

        const existingConfigFile = this._normalizeCodexPath(existing.config_file);
        if (existingConfigFile && this._isManagedCodexAgentConfigPath(existingConfigFile)) {
          const resolvedPath = this._resolveCodexPath(existingConfigFile);
          if (resolvedPath && fs.existsSync(resolvedPath)) {
            fs.unlinkSync(resolvedPath);
          }
        }

        delete agentsTable[fileName];
        configData.agents = agentsTable;
        this._writeCodexConfigToml(configData);
        console.log(`[ConfigSyncManager] Removed ${type}/${name} from Codex (config.toml agents table)`);
        return { success: true };
      } catch (err) {
        console.error(`[ConfigSyncManager] Remove from Codex failed:`, err.message);
        return { success: false, error: err.message };
      }
    }

    const targetPath = path.join(this.codexDir, config.codexTarget, safeName);

    if (!fs.existsSync(targetPath)) {
      console.log(`[ConfigSyncManager] Target not found (already removed): ${targetPath}`);
      return { success: true, message: 'Already removed' };
    }

    try {
      if (type === 'skills') {
        // Remove entire directory
        this._removeRecursive(targetPath);
        console.log(`[ConfigSyncManager] Removed ${type}/${name} from Codex (skill directory)`);
      } else {
        // Remove file
        fs.unlinkSync(targetPath);
        console.log(`[ConfigSyncManager] Removed ${type}/${name} from Codex (prompt)`);

        // Clean up empty parent directories
        this._cleanupEmptyParents(path.dirname(targetPath), path.join(this.codexDir, config.codexTarget));
      }

      return { success: true };
    } catch (err) {
      console.error(`[ConfigSyncManager] Remove from Codex failed:`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Sync a config item to Gemini CLI
   * Supports skills, commands, and agents.
   * @param {string} type - Config type
   * @param {string} name - Item name
   * @returns {Object} Result with success status
   */
  syncToGemini(type, name) {
    const config = this.configTypes[type];
    if (!config) {
      return { success: false, error: `Unknown config type: ${type}` };
    }

    if (!config.geminiSupported) {
      console.log(`[ConfigSyncManager] ${type} not supported by Gemini, skipping`);
      return { success: true, skipped: true, reason: 'Not supported by Gemini' };
    }

    const safeName = this._normalizeSafeRelativeName(name);
    if (!safeName) {
      return { success: false, error: 'Invalid config item name' };
    }
    const sourcePath = path.join(this.ccToolConfigs, type, safeName);
    if (!fs.existsSync(sourcePath)) {
      console.log(`[ConfigSyncManager] Source not found: ${sourcePath}`);
      return { success: false, error: 'Source not found' };
    }

    try {
      const targetPath = this._getGeminiTargetPath(config, safeName);
      this._ensureDir(path.dirname(targetPath));
      if (config.isDirectory) {
        this._copyDirRecursive(sourcePath, targetPath);
        console.log(`[ConfigSyncManager] Synced ${type}/${name} to Gemini (directory)`);
      } else if (type === 'commands') {
        const content = fs.readFileSync(sourcePath, 'utf-8');
        const result = convertCommandToGemini(content);
        fs.writeFileSync(targetPath, result.content, 'utf-8');
        console.log(`[ConfigSyncManager] Synced ${type}/${name} to Gemini (command TOML)`);
        return { success: true, target: targetPath, warnings: result.warnings || [] };
      } else {
        this._copyFile(sourcePath, targetPath);
        console.log(`[ConfigSyncManager] Synced ${type}/${name} to Gemini (file)`);
      }
      return { success: true, target: targetPath };
    } catch (err) {
      console.error(`[ConfigSyncManager] Sync to Gemini failed:`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Remove a config item from Gemini CLI
   * @param {string} type - Config type
   * @param {string} name - Item name
   * @returns {Object} Result with success status
   */
  removeFromGemini(type, name) {
    const config = this.configTypes[type];
    if (!config) {
      return { success: false, error: `Unknown config type: ${type}` };
    }

    const safeName = this._normalizeSafeRelativeName(name);
    if (!safeName) {
      return { success: false, error: 'Invalid config item name' };
    }

    if (!config.geminiSupported) {
      return { success: true, skipped: true, reason: 'Not supported by Gemini' };
    }

    const targetPath = this._getGeminiTargetPath(config, safeName);
    if (!fs.existsSync(targetPath)) {
      console.log(`[ConfigSyncManager] Target not found (already removed): ${targetPath}`);
      return { success: true, message: 'Already removed' };
    }

    try {
      if (config.isDirectory) {
        this._removeRecursive(targetPath);
        console.log(`[ConfigSyncManager] Removed ${type}/${name} from Gemini (directory)`);
      } else {
        fs.unlinkSync(targetPath);
        console.log(`[ConfigSyncManager] Removed ${type}/${name} from Gemini (file)`);
        this._cleanupEmptyParents(path.dirname(targetPath), path.join(this.geminiDir, config.geminiTarget));
      }
      return { success: true };
    } catch (err) {
      console.error(`[ConfigSyncManager] Remove from Gemini failed:`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Sync a config item to OpenCode CLI
   * Supports skills, commands, agents, plugins
   * @param {string} type - Config type
   * @param {string} name - Item name
   * @returns {Object} Result with success status
   */
  syncToOpenCode(type, name) {
    const config = this.configTypes[type];
    if (!config) {
      return { success: false, error: `Unknown config type: ${type}` };
    }

    if (!config.opencodeSupported) {
      console.log(`[ConfigSyncManager] ${type} not supported by OpenCode, skipping`);
      return { success: true, skipped: true, reason: 'Not supported by OpenCode' };
    }

    const safeName = this._normalizeSafeRelativeName(name);
    if (!safeName) {
      return { success: false, error: 'Invalid config item name' };
    }
    const sourcePath = path.join(this.ccToolConfigs, type, safeName);
    if (!fs.existsSync(sourcePath)) {
      console.log(`[ConfigSyncManager] Source not found: ${sourcePath}`);
      return { success: false, error: 'Source not found' };
    }

    try {
      const targetBaseDir = this._getOpenCodeTypeBaseDir(config);
      const targetPath = path.join(targetBaseDir, safeName);

      if (config.isDirectory) {
        this._ensureDir(path.dirname(targetPath));
        this._copyDirRecursive(sourcePath, targetPath);
        console.log(`[ConfigSyncManager] Synced ${type}/${name} to OpenCode (directory)`);
      } else {
        this._ensureDir(path.dirname(targetPath));
        this._copyFile(sourcePath, targetPath);
        console.log(`[ConfigSyncManager] Synced ${type}/${name} to OpenCode (file)`);
      }

      return { success: true, target: targetPath };
    } catch (err) {
      console.error(`[ConfigSyncManager] Sync to OpenCode failed:`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Remove a config item from OpenCode CLI
   * @param {string} type - Config type
   * @param {string} name - Item name
   * @returns {Object} Result with success status
   */
  removeFromOpenCode(type, name) {
    const config = this.configTypes[type];
    if (!config) {
      return { success: false, error: `Unknown config type: ${type}` };
    }

    const safeName = this._normalizeSafeRelativeName(name);
    if (!safeName) {
      return { success: false, error: 'Invalid config item name' };
    }

    if (!config.opencodeSupported) {
      return { success: true, skipped: true, reason: 'Not supported by OpenCode' };
    }

    const targetBaseDir = this._getOpenCodeTypeBaseDir(config);
    const targetPath = path.join(targetBaseDir, safeName);

    if (!fs.existsSync(targetPath)) {
      console.log(`[ConfigSyncManager] Target not found (already removed): ${targetPath}`);
      return { success: true, message: 'Already removed' };
    }

    try {
      if (config.isDirectory) {
        this._removeRecursive(targetPath);
        console.log(`[ConfigSyncManager] Removed ${type}/${name} from OpenCode (directory)`);
      } else {
        fs.unlinkSync(targetPath);
        console.log(`[ConfigSyncManager] Removed ${type}/${name} from OpenCode (file)`);
        this._cleanupEmptyParents(path.dirname(targetPath), targetBaseDir);
      }

      return { success: true };
    } catch (err) {
      console.error(`[ConfigSyncManager] Remove from OpenCode failed:`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Sync a config item to OMP.
   * OMP treats commands as slash-command files and plugins as extensions/packages.
   */
  syncToOmp(type, name) {
    const config = this.configTypes[type];
    if (!config) {
      return { success: false, error: `Unknown config type: ${type}` };
    }

    if (!config.ompSupported) {
      console.log(`[ConfigSyncManager] ${type} not supported natively by OMP, skipping`);
      return { success: true, skipped: true, reason: 'Not supported natively by OMP' };
    }

    const safeName = this._normalizeSafeRelativeName(name);
    if (!safeName) {
      return { success: false, error: 'Invalid config item name' };
    }

    const sourcePath = path.join(this.ccToolConfigs, type, safeName);
    if (!fs.existsSync(sourcePath)) {
      console.log(`[ConfigSyncManager] Source not found: ${sourcePath}`);
      return { success: false, error: 'Source not found' };
    }

    const targetPath = path.join(this.ompDir, config.ompTarget, safeName);
    try {
      if (config.isDirectory) {
        this._ensureDir(path.dirname(targetPath));
        this._copyDirRecursive(sourcePath, targetPath);
        console.log(`[ConfigSyncManager] Synced ${type}/${name} to OMP (directory)`);
      } else {
        this._ensureDir(path.dirname(targetPath));
        this._copyFile(sourcePath, targetPath);
        console.log(`[ConfigSyncManager] Synced ${type}/${name} to OMP (file)`);
      }

      return { success: true, target: targetPath };
    } catch (err) {
      console.error('[ConfigSyncManager] Sync to OMP failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  removeFromOmp(type, name) {
    const config = this.configTypes[type];
    if (!config) {
      return { success: false, error: `Unknown config type: ${type}` };
    }

    const safeName = this._normalizeSafeRelativeName(name);
    if (!safeName) {
      return { success: false, error: 'Invalid config item name' };
    }

    if (!config.ompSupported) {
      return { success: true, skipped: true, reason: 'Not supported natively by OMP' };
    }

    const targetPath = path.join(this.ompDir, config.ompTarget, safeName);
    if (!fs.existsSync(targetPath)) {
      return { success: true, message: 'Already removed' };
    }

    try {
      if (config.isDirectory) {
        this._removeRecursive(targetPath);
      } else {
        fs.unlinkSync(targetPath);
        this._cleanupEmptyParents(path.dirname(targetPath), path.join(this.ompDir, config.ompTarget));
      }
      console.log(`[ConfigSyncManager] Removed ${type}/${name} from OMP`);
      return { success: true };
    } catch (err) {
      console.error('[ConfigSyncManager] Remove from OMP failed:', err.message);
      return { success: false, error: err.message };
    }
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
      platforms = this.registry?.list?.({ enabledOnly: true }) || [];
    } catch (error) {
      results.errors.push({ type, operation: 'list-platforms', error: error.message });
      return results;
    }

    const definitions = new Map(
      platforms
        .filter(platform => platform && platform.key)
        .map(platform => [String(platform.key).toLowerCase(), platform])
    );
    const legacyMethods = {
      claude: { sync: 'syncToClaude', remove: 'removeFromClaude' },
      codex: { sync: 'syncToCodex', remove: 'removeFromCodex' },
      gemini: { sync: 'syncToGemini', remove: 'removeFromGemini' },
      opencode: { sync: 'syncToOpenCode', remove: 'removeFromOpenCode' },
      omp: { sync: 'syncToOmp', remove: 'removeFromOmp' }
    };

    const invoke = (platform, operation, name) => {
      const definition = definitions.get(platform);
      const driverId = definition?.capabilities?.resourceSync;
      const legacyMethod = legacyMethods[platform]?.[operation];
      if (typeof driverId === 'string' && driverId.startsWith('legacy:') && legacyMethod) {
        return this[legacyMethod](type, name);
      }
      return operation === 'sync'
        ? this.syncToPlatform(platform, type, name)
        : this.removeFromPlatform(platform, type, name);
    };

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

    for (const [name, item] of Object.entries(registryItems)) {
      if (!item || typeof item !== 'object') continue;
      const active = item.enabled === true && item.platforms && typeof item.platforms === 'object';

      for (const platform of definitions.keys()) {
        const shouldSync = active && item.platforms[platform] === true;
        const operation = shouldSync ? 'sync' : 'remove';
        appendResult(name, platform, operation, invoke(platform, operation, name));
      }
    }

    console.log(`[ConfigSyncManager] syncAll(${type}): synced=${results.synced.length}, removed=${results.removed.length}, errors=${results.errors.length}`);
    return results;
  }

  // ==================== Helper Methods ====================

  /**
   * Ensure a directory exists
   */
  _ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Recursively copy a directory
   */
  _copyDirRecursive(src, dest) {
    this._ensureDir(dest);

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this._copyDirRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * Copy a directory with content transformation
   * @param {string} src - Source directory
   * @param {string} dest - Destination directory
   * @param {Function} transform - Function(filePath, content) => transformedContent
   */
  _copyDirWithConversion(src, dest, transform) {
    this._ensureDir(dest);

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this._copyDirWithConversion(srcPath, destPath, transform);
      } else {
        // Check if it's a text file that should be transformed
        const ext = path.extname(entry.name).toLowerCase();
        const textExtensions = ['.md', '.txt', '.json', '.js', '.ts', '.py', '.sh', '.yaml', '.yml'];

        if (textExtensions.includes(ext)) {
          const content = fs.readFileSync(srcPath, 'utf-8');
          const transformed = transform(srcPath, content);
          fs.writeFileSync(destPath, transformed, 'utf-8');
        } else {
          // Binary file, copy as-is
          fs.copyFileSync(srcPath, destPath);
        }
      }
    }
  }

  /**
   * Copy a single file
   */
  _copyFile(src, dest) {
    fs.copyFileSync(src, dest);
  }

  /**
   * Resolve OpenCode base target directory for a config type.
   * OpenCode supports both plural (new) and singular (legacy) folder names.
   */
  _getOpenCodeTypeBaseDir(config) {
    const modernDir = path.join(this.opencodeDir, config.opencodeTarget);
    // 技能目录强制使用 modern/plural 形式，避免 legacy 目录带来的跨平台历史污染
    if (config === this.configTypes.skills) {
      return modernDir;
    }

    if (!config.opencodeLegacyTarget) {
      return modernDir;
    }

    const legacyDir = path.join(this.opencodeDir, config.opencodeLegacyTarget);
    if (fs.existsSync(legacyDir) && !fs.existsSync(modernDir)) {
      return legacyDir;
    }

    return modernDir;
  }

  _getGeminiTargetPath(config, safeName) {
    const targetName = config.geminiExtension
      ? safeName.replace(new RegExp(`${this._escapeRegExp(path.extname(safeName))}$`, 'i'), config.geminiExtension)
      : safeName;
    return path.join(this.geminiDir, config.geminiTarget, targetName);
  }

  _escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Recursively remove a file or directory
   */
  _removeRecursive(target) {
    if (!fs.existsSync(target)) {
      return;
    }

    fs.rmSync(target, { recursive: true, force: true });
  }

  /**
   * Clean up empty parent directories up to the base directory
   */
  _cleanupEmptyParents(dir, baseDir) {
    // Normalize paths for comparison
    const normalizedDir = path.resolve(dir);
    const normalizedBase = path.resolve(baseDir);

    // Don't go above base directory
    if (!normalizedDir.startsWith(normalizedBase) || normalizedDir === normalizedBase) {
      return;
    }

    try {
      const entries = fs.readdirSync(dir);
      if (entries.length === 0) {
        fs.rmdirSync(dir);
        console.log(`[ConfigSyncManager] Removed empty directory: ${dir}`);
        // Recurse to parent
        this._cleanupEmptyParents(path.dirname(dir), baseDir);
      }
    } catch (err) {
      // Ignore errors (directory might not exist or permission issues)
    }
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

  _parseFrontmatter(content) {
    const result = {
      frontmatter: {},
      body: content
    };

    const normalized = content.trim().replace(/^\uFEFF/, '');
    const match = normalized.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
    if (!match) {
      return result;
    }

    const frontmatterText = match[1];
    result.body = match[2].trim();

    for (const line of frontmatterText.split('\n')) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;
      const key = line.slice(0, colonIndex).trim();
      let value = line.slice(colonIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result.frontmatter[key] = value;
    }

    return result;
  }

  _isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  _normalizeCodexPath(configPath) {
    return typeof configPath === 'string' ? configPath.trim() : '';
  }

  _resolveCodexPath(configPath) {
    const normalized = this._normalizeCodexPath(configPath);
    if (!normalized) return '';

    if (normalized.startsWith('~/')) {
      return path.join(HOME, normalized.slice(2));
    }

    if (path.isAbsolute(normalized)) {
      return normalized;
    }

    return path.resolve(path.dirname(CODEX_CONFIG_PATH), normalized);
  }

  _isManagedCodexAgentConfigPath(configPath) {
    const resolved = this._resolveCodexPath(configPath);
    if (!resolved) return false;

    const managedRoot = path.resolve(this._getCodexManagedAgentConfigDir()) + path.sep;
    return resolved.startsWith(managedRoot) || resolved === path.resolve(this._getCodexManagedAgentConfigDir());
  }

  _getCodexManagedAgentConfigDir() {
    return path.join(this.codexDir, 'agents');
  }

  _getCodexManagedAgentConfigPath(fileName) {
    return path.join(this._getCodexManagedAgentConfigDir(), `${fileName}.toml`);
  }

  _writeCodexAgentConfigFile(configPath, data) {
    const resolved = this._resolveCodexPath(configPath);
    this._ensureDir(path.dirname(resolved));
    const tempPath = `${resolved}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tempPath, tomlStringify(data), 'utf-8');
    fs.renameSync(tempPath, resolved);
  }

  _readCodexAgentConfigFile(configPath) {
    const resolved = this._resolveCodexPath(configPath);
    if (!resolved || !fs.existsSync(resolved)) {
      return null;
    }

    try {
      const content = fs.readFileSync(resolved, 'utf-8');
      return {
        content,
        data: toml.parse(content)
      };
    } catch (err) {
      return {
        content: fs.readFileSync(resolved, 'utf-8'),
        data: null
      };
    }
  }

  _readCodexConfigToml() {
    if (!fs.existsSync(CODEX_CONFIG_PATH)) {
      return {};
    }
    const content = fs.readFileSync(CODEX_CONFIG_PATH, 'utf-8');
    return toml.parse(content);
  }

  _writeCodexConfigToml(config) {
    this._ensureDir(path.dirname(CODEX_CONFIG_PATH));
    const tempPath = `${CODEX_CONFIG_PATH}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tempPath, tomlStringify(config), 'utf-8');
    fs.renameSync(tempPath, CODEX_CONFIG_PATH);
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
