const fs = require('fs');
const path = require('path');
const { getPlugin } = require('./registry');
const { INSTALLED_DIR, CONFIG_DIR } = require('./constants');
const { createPluginContext } = require('./plugin-api');

// Track loaded plugins
const loadedPlugins = new Map();

/**
 * Load and activate a plugin
 * @param {string} name - Plugin name
 * @returns {Object} Result object with success status and optional error
 */
function loadPlugin(name, options = {}) {
  // ERROR ISOLATION: Wrap entire function to prevent CTX crash
  try {
    // Check if already loaded
    if (loadedPlugins.has(name)) {
      return {
        success: true,
        message: `Plugin '${name}' already loaded`,
      };
    }

    // Get plugin info from registry
    const pluginInfo = options.pluginInfo || getPlugin(name);
    if (!pluginInfo) {
      return {
        success: false,
        error: `Plugin '${name}' not found in registry`,
      };
    }

    // Check if enabled
    if (!pluginInfo.enabled) {
      return {
        success: false,
        error: `Plugin '${name}' is disabled`,
      };
    }

    // Construct path to installed plugin
    const pluginDir = path.join(INSTALLED_DIR, name);
    if (!fs.existsSync(pluginDir)) {
      return {
        success: false,
        error: `Plugin directory not found: ${pluginDir}`,
      };
    }

    // Read and validate plugin.json
    const pluginJsonPath = path.join(pluginDir, 'plugin.json');
    if (!fs.existsSync(pluginJsonPath)) {
      return {
        success: false,
        error: `plugin.json not found in ${pluginDir}`,
      };
    }

    let pluginJson;
    try {
      const content = fs.readFileSync(pluginJsonPath, 'utf8');
      pluginJson = JSON.parse(content);
    } catch (error) {
      return {
        success: false,
        error: `Failed to parse plugin.json: ${error.message}`,
      };
    }

    // Validate plugin.json structure
    if (!pluginJson.name || !pluginJson.version || !pluginJson.main) {
      return {
        success: false,
        error: 'Invalid plugin.json: missing name, version, or main',
      };
    }

    // Require plugin's main file
    const mainPath = path.join(pluginDir, pluginJson.main);

    // SECURITY: Verify resolved path is within pluginDir (prevent path traversal)
    const resolvedMainPath = path.resolve(mainPath);
    const resolvedPluginDir = path.resolve(pluginDir);
    if (!resolvedMainPath.startsWith(resolvedPluginDir + path.sep)) {
      return {
        success: false,
        error: `Security violation: Main file path traversal detected: ${pluginJson.main}`,
      };
    }

    if (!fs.existsSync(mainPath)) {
      return {
        success: false,
        error: `Main file not found: ${mainPath}`,
      };
    }

    let pluginModule;
    try {
      pluginModule = require(mainPath);
    } catch (error) {
      return {
        success: false,
        error: `Failed to require plugin: ${error.message}`,
      };
    }

    // Verify exports: { activate, deactivate }
    if (typeof pluginModule.activate !== 'function') {
      return {
        success: false,
        error: 'Plugin must export an activate() function',
      };
    }

    // Load plugin-specific configuration
    const pluginConfigPath = path.join(CONFIG_DIR, `${name}.json`);
    let pluginConfig = {};
    if (fs.existsSync(pluginConfigPath)) {
      try {
        const configContent = fs.readFileSync(pluginConfigPath, 'utf8');
        pluginConfig = JSON.parse(configContent);
      } catch (error) {
        // Non-fatal: log but continue with empty config
        console.warn(`[plugin-loader] Failed to load config for ${name}:`, error.message);
      }
    }

    // Create plugin context
    const ctx = createPluginContext(name, pluginConfig, pluginDir);

    // Call activate() wrapped in try/catch
    try {
      pluginModule.activate(ctx);
    } catch (error) {
      return {
        success: false,
        error: `Plugin activation failed: ${error.message}`,
      };
    }

    // Track loaded plugin
    loadedPlugins.set(name, {
      module: pluginModule,
      context: ctx,
      info: pluginJson,
      loadedAt: new Date().toISOString(),
    });

    return {
      success: true,
      message: `Plugin '${name}' loaded successfully`,
    };
  } catch (error) {
    // ERROR ISOLATION: Catch any unexpected errors
    return {
      success: false,
      error: `Unexpected error loading plugin '${name}': ${error.message}`,
    };
  }
}

/**
 * Unload and deactivate a plugin
 * @param {string} name - Plugin name
 * @returns {Object} Result object with success status
 */
function unloadPlugin(name) {
  try {
    // Check if loaded
    if (!loadedPlugins.has(name)) {
      return {
        success: false,
        error: `Plugin '${name}' is not loaded`,
      };
    }

    const plugin = loadedPlugins.get(name);

    // Call deactivate() if exists
    if (typeof plugin.module.deactivate === 'function') {
      try {
        plugin.module.deactivate();
      } catch (error) {
        // Log but don't fail unload
        console.error(`[plugin-loader] Error during deactivation of '${name}':`, error.message);
      }
    }

    // Remove from tracking
    loadedPlugins.delete(name);

    return {
      success: true,
      message: `Plugin '${name}' unloaded successfully`,
    };
  } catch (error) {
    return {
      success: false,
      error: `Unexpected error unloading plugin '${name}': ${error.message}`,
    };
  }
}

/**
 * Get list of currently loaded plugin names
 * @returns {Array<string>} Array of loaded plugin names
 */
function getLoadedPlugins() {
  return Array.from(loadedPlugins.keys());
}

/**
 * Get loaded plugin details (internal use)
 * @param {string} name - Plugin name
 * @returns {Object|undefined} Plugin details or undefined
 */
function getLoadedPluginDetails(name) {
  return loadedPlugins.get(name);
}

module.exports = {
  loadPlugin,
  unloadPlugin,
  getLoadedPlugins,
  getLoadedPluginDetails,
};
