/**
 * Config Registry Service
 *
 * Manages a unified config registry at ~/.cc-tool/config-registry.json
 * that tracks skills, commands, agents, plugins with enable/disable and per-platform support.
 *
 * Storage directories: ~/.cc-tool/configs/{skills,commands,agents,plugins}/
 */

const fs = require('fs');
const path = require('path');
const { PATHS, NATIVE_PATHS } = require('../../config/paths');

// Configuration paths
const CC_TOOL_DIR = PATHS.base;
const REGISTRY_FILE = PATHS.configRegistry;
const CONFIGS_DIR = PATHS.configs;

// Claude Code native directories
const CLAUDE_HOME_DIR = NATIVE_PATHS.claude.dir || path.dirname(NATIVE_PATHS.claude.settings);
const CLAUDE_DIRS = {
  skills: NATIVE_PATHS.claude.skills || path.join(CLAUDE_HOME_DIR, 'skills'),
  commands: NATIVE_PATHS.claude.commands || path.join(CLAUDE_HOME_DIR, 'commands'),
  agents: NATIVE_PATHS.claude.agents || path.join(CLAUDE_HOME_DIR, 'agents'),
  plugins: NATIVE_PATHS.claude.plugins || path.join(CLAUDE_HOME_DIR, 'plugins')
};

// Valid config types
const CONFIG_TYPES = ['skills', 'commands', 'agents', 'plugins'];
const SUPPORTED_PLATFORMS = ['claude', 'codex', 'gemini', 'opencode', 'pi'];

const PLATFORM_SUPPORT = {
  skills: { claude: true, codex: true, gemini: true, opencode: true, pi: true },
  commands: { claude: true, codex: true, gemini: true, opencode: true, pi: true },
  agents: { claude: true, codex: true, gemini: true, opencode: true, pi: false },
  plugins: { claude: true, codex: false, gemini: false, opencode: true, pi: true }
};

function normalizePlatforms(type, platforms = {}) {
  const support = PLATFORM_SUPPORT[type] || {};
  const normalized = {};

  for (const platform of SUPPORTED_PLATFORMS) {
    normalized[platform] = !!platforms?.[platform];
  }

  for (const platform of SUPPORTED_PLATFORMS) {
    if (support[platform] === false) {
      normalized[platform] = false;
    }
  }

  // Default to Claude enabled when no platform explicitly configured
  if (!platforms || Object.keys(platforms).length === 0) {
    normalized.claude = true;
  }

  return normalized;
}

function normalizeRelativeConfigName(name) {
  const raw = String(name || '').replace(/\\/g, '/').trim();
  if (!raw || raw.includes('\0')) {
    throw new Error('Invalid config name');
  }

  const normalized = path.posix.normalize(raw).replace(/^(\.\/)+/, '');
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error('Invalid config name');
  }

  if (path.isAbsolute(raw) || raw.startsWith('/')) {
    throw new Error('Absolute path is not allowed');
  }

  return normalized;
}

// Default registry structure
const DEFAULT_REGISTRY = {
  version: 1,
  skills: {},
  commands: {},
  agents: {},
  plugins: {}
};

/**
 * Ensure directory exists
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Config Registry Service
 */
class ConfigRegistryService {
  constructor() {
    this.registryPath = REGISTRY_FILE;
    this.configsDir = CONFIGS_DIR;

    // Ensure directories exist
    this._ensureDirs();
  }

  /**
   * Ensure all required directories exist
   * @private
   */
  _ensureDirs() {
    ensureDir(CC_TOOL_DIR);
    ensureDir(path.dirname(this.registryPath));
    ensureDir(this.configsDir);

    for (const type of CONFIG_TYPES) {
      ensureDir(path.join(this.configsDir, type));
    }
  }

  /**
   * Read registry from file
   * @returns {Object} Registry data
   */
  _readRegistry() {
    try {
      if (fs.existsSync(this.registryPath)) {
        const content = fs.readFileSync(this.registryPath, 'utf-8');
        const data = JSON.parse(content);

        // Ensure all type keys exist
        for (const type of CONFIG_TYPES) {
          if (!data[type]) {
            data[type] = {};
          }

          for (const [name, item] of Object.entries(data[type])) {
            if (!item || typeof item !== 'object') {
              continue;
            }
            data[type][name].platforms = normalizePlatforms(type, item.platforms);
          }
        }

        return data;
      }
    } catch (err) {
      console.error('[ConfigRegistry] Failed to read registry:', err.message);
    }

    return { ...DEFAULT_REGISTRY };
  }

  /**
   * Write registry to file (atomic write via temp file + rename)
   * @param {Object} data - Registry data to write
   */
  _writeRegistry(data) {
    try {
      ensureDir(path.dirname(this.registryPath));

      const tempPath = this.registryPath + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.registryPath);
    } catch (err) {
      console.error('[ConfigRegistry] Failed to write registry:', err.message);
      throw err;
    }
  }

  /**
   * Get a single item from registry
   * @param {string} type - Config type (skills, commands, agents, plugins)
   * @param {string} name - Item name/key
   * @returns {Object|null} Registry entry or null
   */
  getItem(type, name) {
    if (!CONFIG_TYPES.includes(type)) {
      throw new Error(`Invalid config type: ${type}`);
    }

    const registry = this._readRegistry();
    return registry[type][name] || null;
  }

  /**
   * Set/update an item in registry
   * @param {string} type - Config type
   * @param {string} name - Item name/key
   * @param {Object} data - Item data
   * @returns {Object} Updated entry
   */
  setItem(type, name, data) {
    if (!CONFIG_TYPES.includes(type)) {
      throw new Error(`Invalid config type: ${type}`);
    }

    const registry = this._readRegistry();
    const now = new Date().toISOString();

    const existing = registry[type][name];
    const entry = {
      ...data,
      enabled: data.enabled !== undefined ? data.enabled : true,
      platforms: normalizePlatforms(type, data.platforms),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      source: data.source || 'local'
    };

    registry[type][name] = entry;
    this._writeRegistry(registry);

    return entry;
  }

  /**
   * Remove an item from registry
   * @param {string} type - Config type
   * @param {string} name - Item name/key
   * @returns {boolean} True if removed, false if not found
   */
  removeItem(type, name) {
    if (!CONFIG_TYPES.includes(type)) {
      throw new Error(`Invalid config type: ${type}`);
    }

    const registry = this._readRegistry();

    if (!registry[type][name]) {
      return false;
    }

    delete registry[type][name];
    this._writeRegistry(registry);

    // Also remove the actual config files
    const configPath = this.getConfigPath(type, name);
    if (fs.existsSync(configPath)) {
      try {
        const stats = fs.statSync(configPath);
        if (stats.isDirectory()) {
          fs.rmSync(configPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(configPath);
        }
      } catch (err) {
        console.error(`[ConfigRegistry] Failed to remove config files for ${type}/${name}:`, err.message);
      }
    }

    return true;
  }

  /**
   * List all items of a type
   * @param {string} type - Config type
   * @returns {Object} { name: registryEntry } map
   */
  listItems(type) {
    if (!CONFIG_TYPES.includes(type)) {
      throw new Error(`Invalid config type: ${type}`);
    }

    const registry = this._readRegistry();
    return registry[type] || {};
  }

  /**
   * Toggle enabled status for an item
   * @param {string} type - Config type
   * @param {string} name - Item name/key
   * @param {boolean} enabled - New enabled status
   * @returns {Object} Updated entry
   */
  toggleEnabled(type, name, enabled) {
    if (!CONFIG_TYPES.includes(type)) {
      throw new Error(`Invalid config type: ${type}`);
    }

    const registry = this._readRegistry();
    const entry = registry[type][name];

    if (!entry) {
      throw new Error(`Item "${name}" not found in ${type}`);
    }

    entry.enabled = enabled;
    entry.updatedAt = new Date().toISOString();

    this._writeRegistry(registry);

    return entry;
  }

  /**
   * Toggle platform support for an item
   * @param {string} type - Config type
   * @param {string} name - Item name/key
   * @param {string} platform - Platform name (claude, codex, gemini, opencode)
   * @param {boolean} enabled - New platform status
   * @returns {Object} Updated entry
   */
  togglePlatform(type, name, platform, enabled) {
    if (!CONFIG_TYPES.includes(type)) {
      throw new Error(`Invalid config type: ${type}`);
    }

    if (!SUPPORTED_PLATFORMS.includes(platform)) {
      throw new Error(`Invalid platform: ${platform}`);
    }

    if (PLATFORM_SUPPORT[type] && PLATFORM_SUPPORT[type][platform] === false) {
      throw new Error(`Platform "${platform}" is not supported for ${type}`);
    }

    const registry = this._readRegistry();
    const entry = registry[type][name];

    if (!entry) {
      throw new Error(`Item "${name}" not found in ${type}`);
    }

    if (!entry.platforms) {
      entry.platforms = normalizePlatforms(type, {});
    }

    entry.platforms[platform] = enabled;
    entry.updatedAt = new Date().toISOString();

    this._writeRegistry(registry);

    return entry;
  }

  /**
   * Import configs from Claude Code native directories
   * @param {string} type - Config type to import
   * @returns {Object} { imported: number, skipped: number, items: string[] }
   */
  importFromClaude(type) {
    if (!CONFIG_TYPES.includes(type)) {
      throw new Error(`Invalid config type: ${type}`);
    }

    const sourceDir = CLAUDE_DIRS[type];
    const destDir = path.join(this.configsDir, type);

    if (!fs.existsSync(sourceDir)) {
      return { imported: 0, skipped: 0, items: [] };
    }

    const registry = this._readRegistry();
    const result = {
      imported: 0,
      skipped: 0,
      items: []
    };

    if (type === 'skills') {
      // Skills are directory-based with SKILL.md marker
      this._importSkills(sourceDir, destDir, registry, result);
    } else if (type === 'plugins') {
      // Plugins are directory-based (similar to skills)
      this._importPlugins(sourceDir, destDir, registry, result);
    } else {
      // Commands and agents are file-based (.md files)
      this._importFileBasedConfigs(type, sourceDir, destDir, '', registry, result);
    }

    this._writeRegistry(registry);

    return result;
  }

  /**
   * Import skills (directory-based)
   * @private
   */
  _importSkills(sourceDir, destDir, registry, result) {
    try {
      const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) {
          continue;
        }

        const skillDir = path.join(sourceDir, entry.name);
        const skillMdPath = path.join(skillDir, 'SKILL.md');

        // Check if it's a valid skill directory
        if (!fs.existsSync(skillMdPath)) {
          continue;
        }

        const name = entry.name;

        // Skip if already in registry
        if (registry.skills[name]) {
          result.skipped++;
          continue;
        }

        // Copy to cc-tool configs
        const destPath = path.join(destDir, name);
        try {
          this._copyDirRecursive(skillDir, destPath);

          // Add to registry
          registry.skills[name] = {
            enabled: true,
            platforms: normalizePlatforms('skills', { claude: true }),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            source: 'imported'
          };

          result.imported++;
          result.items.push(name);
        } catch (err) {
          console.error(`[ConfigRegistry] Failed to import skill "${name}":`, err.message);
        }
      }
    } catch (err) {
      console.error('[ConfigRegistry] Failed to scan skills directory:', err.message);
    }
  }

  /**
   * Import plugins (directory-based, similar to skills)
   * Plugins are directories containing plugin.json or similar marker
   * @private
   */
  _importPlugins(sourceDir, destDir, registry, result) {
    try {
      const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) {
          continue;
        }

        const pluginDir = path.join(sourceDir, entry.name);

        // Check if it's a valid plugin directory (has plugin.json or any content)
        // Plugins may have various structures, so we just check it's a non-empty directory
        const contents = fs.readdirSync(pluginDir);
        if (contents.length === 0) {
          continue;
        }

        const name = entry.name;

        // Skip if already in registry
        if (registry.plugins[name]) {
          result.skipped++;
          continue;
        }

        // Copy to cc-tool configs
        const destPath = path.join(destDir, name);
        try {
          this._copyDirRecursive(pluginDir, destPath);

          // Add to registry
          registry.plugins[name] = {
            enabled: true,
            platforms: normalizePlatforms('plugins', { claude: true }),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            source: 'imported'
          };

          result.imported++;
          result.items.push(name);
        } catch (err) {
          console.error(`[ConfigRegistry] Failed to import plugin "${name}":`, err.message);
        }
      }
    } catch (err) {
      console.error('[ConfigRegistry] Failed to scan plugins directory:', err.message);
    }
  }

  /**
   * Import file-based configs (commands, agents)
   * @private
   */
  _importFileBasedConfigs(type, sourceDir, destDir, relativePath, registry, result) {
    try {
      const currentSource = relativePath ? path.join(sourceDir, relativePath) : sourceDir;

      if (!fs.existsSync(currentSource)) {
        return;
      }

      const entries = fs.readdirSync(currentSource, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith('.')) {
          continue;
        }

        const entryRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;

        if (entry.isDirectory()) {
          // Recursively scan subdirectories
          this._importFileBasedConfigs(type, sourceDir, destDir, entryRelativePath, registry, result);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          // This is a config file
          const name = normalizeRelativeConfigName(entryRelativePath);

          // Skip if already in registry
          if (registry[type][name]) {
            result.skipped++;
            continue;
          }

          // Copy file to cc-tool configs
          const sourcePath = path.join(sourceDir, name);
          const destPath = path.join(destDir, name);

          try {
            // Ensure destination directory exists
            ensureDir(path.dirname(destPath));

            fs.copyFileSync(sourcePath, destPath);

            // Add to registry
            registry[type][name] = {
              enabled: true,
              platforms: normalizePlatforms(type, { claude: true }),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              source: 'imported'
            };

            result.imported++;
            result.items.push(name);
          } catch (err) {
            console.error(`[ConfigRegistry] Failed to import ${type}/${name}:`, err.message);
          }
        }
      }
    } catch (err) {
      console.error(`[ConfigRegistry] Failed to scan ${type} directory:`, err.message);
    }
  }

  /**
   * Recursively copy a directory
   * @private
   */
  _copyDirRecursive(src, dest) {
    ensureDir(dest);

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
   * Get statistics for all config types
   * @returns {Object} Stats with counts per type and enabled/disabled breakdown
   */
  getStats() {
    const registry = this._readRegistry();
    const stats = {
      total: 0,
      byType: {},
      byPlatform: {
        claude: 0,
        codex: 0,
        gemini: 0,
        opencode: 0,
        pi: 0
      }
    };

    for (const type of CONFIG_TYPES) {
      const items = Object.values(registry[type] || {});
      const typeStats = {
        total: items.length,
        enabled: items.filter(i => i.enabled).length,
        disabled: items.filter(i => !i.enabled).length,
        claude: items.filter(i => i.platforms?.claude).length,
        codex: items.filter(i => i.platforms?.codex).length,
        gemini: items.filter(i => i.platforms?.gemini).length,
        opencode: items.filter(i => i.platforms?.opencode).length,
        pi: items.filter(i => i.platforms?.pi).length
      };

      stats.byType[type] = typeStats;
      stats.total += typeStats.total;
      stats.byPlatform.claude += typeStats.claude;
      stats.byPlatform.codex += typeStats.codex;
      stats.byPlatform.gemini += typeStats.gemini;
      stats.byPlatform.opencode += typeStats.opencode;
      stats.byPlatform.pi += typeStats.pi;
    }

    return stats;
  }

  /**
   * Get the path to a config in cc-tool storage
   * @param {string} type - Config type
   * @param {string} name - Item name/key
   * @returns {string} Full path to config
   */
  getConfigPath(type, name) {
    if (!CONFIG_TYPES.includes(type)) {
      throw new Error(`Invalid config type: ${type}`);
    }

    const safeName = normalizeRelativeConfigName(name);
    return path.join(this.configsDir, type, safeName);
  }

  /**
   * Check if a config file/directory exists in storage
   * @param {string} type - Config type
   * @param {string} name - Item name/key
   * @returns {boolean} True if exists
   */
  configExists(type, name) {
    const configPath = this.getConfigPath(type, name);
    return fs.existsSync(configPath);
  }

  /**
   * Get config content
   * @param {string} type - Config type
   * @param {string} name - Item name/key
   * @returns {string|null} File content or null
   */
  getConfigContent(type, name) {
    const configPath = this.getConfigPath(type, name);

    if (!fs.existsSync(configPath)) {
      return null;
    }

    const stats = fs.statSync(configPath);

    if (stats.isDirectory()) {
      // For skills, return SKILL.md content
      const skillMdPath = path.join(configPath, 'SKILL.md');
      if (fs.existsSync(skillMdPath)) {
        return fs.readFileSync(skillMdPath, 'utf-8');
      }
      return null;
    }

    return fs.readFileSync(configPath, 'utf-8');
  }

  /**
   * Sync registry with actual files in storage
   * Adds missing entries, removes orphaned entries
   * @returns {Object} { added: number, removed: number }
   */
  syncRegistry() {
    const registry = this._readRegistry();
    const result = { added: 0, removed: 0 };

    for (const type of CONFIG_TYPES) {
      const typeDir = path.join(this.configsDir, type);

      if (!fs.existsSync(typeDir)) {
        continue;
      }

      // Find orphaned registry entries (file deleted)
      for (const name of Object.keys(registry[type])) {
        if (!this.configExists(type, name)) {
          delete registry[type][name];
          result.removed++;
        }
      }

      // Find missing registry entries (file exists but not registered)
      if (type === 'skills') {
        this._syncSkillsRegistry(typeDir, registry, result);
      } else if (type === 'plugins') {
        this._syncPluginsRegistry(typeDir, registry, result);
      } else {
        this._syncFileBasedRegistry(type, typeDir, '', registry, result);
      }
    }

    this._writeRegistry(registry);

    return result;
  }

  /**
   * Sync skills registry
   * @private
   */
  _syncSkillsRegistry(typeDir, registry, result) {
    try {
      const entries = fs.readdirSync(typeDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) {
          continue;
        }

        const skillMdPath = path.join(typeDir, entry.name, 'SKILL.md');
        if (!fs.existsSync(skillMdPath)) {
          continue;
        }

        const name = entry.name;

        if (!registry.skills[name]) {
          registry.skills[name] = {
            enabled: true,
            platforms: normalizePlatforms('skills', { claude: true }),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            source: 'synced'
          };
          result.added++;
        }
      }
    } catch (err) {
      console.error('[ConfigRegistry] Failed to sync skills registry:', err.message);
    }
  }

  /**
   * Sync plugins registry
   * @private
   */
  _syncPluginsRegistry(typeDir, registry, result) {
    try {
      const entries = fs.readdirSync(typeDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) {
          continue;
        }

        const pluginDir = path.join(typeDir, entry.name);
        const contents = fs.readdirSync(pluginDir);
        if (contents.length === 0) {
          continue;
        }

        const name = entry.name;

        if (!registry.plugins[name]) {
          registry.plugins[name] = {
            enabled: true,
            platforms: normalizePlatforms('plugins', { claude: true }),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            source: 'synced'
          };
          result.added++;
        }
      }
    } catch (err) {
      console.error('[ConfigRegistry] Failed to sync plugins registry:', err.message);
    }
  }

  /**
   * Sync file-based config registry
   * @private
   */
  _syncFileBasedRegistry(type, baseDir, relativePath, registry, result) {
    try {
      const currentDir = relativePath ? path.join(baseDir, relativePath) : baseDir;

      if (!fs.existsSync(currentDir)) {
        return;
      }

      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith('.')) {
          continue;
        }

        const entryRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;

        if (entry.isDirectory()) {
          this._syncFileBasedRegistry(type, baseDir, entryRelativePath, registry, result);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const name = normalizeRelativeConfigName(entryRelativePath);

          if (!registry[type][name]) {
            registry[type][name] = {
              enabled: true,
              platforms: normalizePlatforms(type, { claude: true }),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              source: 'synced'
            };
            result.added++;
          }
        }
      }
    } catch (err) {
      console.error(`[ConfigRegistry] Failed to sync ${type} registry:`, err.message);
    }
  }
}

module.exports = {
  ConfigRegistryService,
  CONFIG_TYPES,
  SUPPORTED_PLATFORMS,
  CONFIGS_DIR,
  REGISTRY_FILE
};
