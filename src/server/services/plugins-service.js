/**
 * Plugins Service
 *
 * Wraps the plugin system for API access
 */

const fs = require('fs');
const path = require('path');
const { listPlugins, getPlugin, updatePlugin: updatePluginRegistry } = require('../../plugins/registry');
const { installPlugin: installPluginCore, uninstallPlugin: uninstallPluginCore } = require('../../plugins/plugin-installer');
const { initializePlugins, shutdownPlugins } = require('../../plugins/plugin-manager');
const { INSTALLED_DIR, CONFIG_DIR } = require('../../plugins/constants');

class PluginsService {
  /**
   * List all installed plugins with their status
   * @returns {Object} { plugins: Array }
   */
  listPlugins() {
    const plugins = listPlugins();

    // Enhance with additional info
    const enhancedPlugins = plugins.map(plugin => {
      const pluginDir = path.join(INSTALLED_DIR, plugin.name);
      const manifestPath = path.join(pluginDir, 'plugin.json');

      let manifest = null;
      if (fs.existsSync(manifestPath)) {
        try {
          manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch (err) {
          // Ignore parse errors
        }
      }

      return {
        ...plugin,
        description: manifest?.description || '',
        author: manifest?.author || '',
        commands: manifest?.commands || [],
        hooks: manifest?.hooks || []
      };
    });

    return { plugins: enhancedPlugins };
  }

  /**
   * Get single plugin details
   * @param {string} name - Plugin name
   * @returns {Object|null} Plugin details or null
   */
  getPlugin(name) {
    const plugin = getPlugin(name);
    if (!plugin) {
      return null;
    }

    const pluginDir = path.join(INSTALLED_DIR, name);
    const manifestPath = path.join(pluginDir, 'plugin.json');

    let manifest = null;
    if (fs.existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch (err) {
        // Ignore parse errors
      }
    }

    return {
      name,
      ...plugin,
      description: manifest?.description || '',
      author: manifest?.author || '',
      commands: manifest?.commands || [],
      hooks: manifest?.hooks || [],
      manifest
    };
  }

  /**
   * Install plugin from Git URL
   * @param {string} gitUrl - Git repository URL
   * @returns {Promise<Object>} Installation result
   */
  async installPlugin(gitUrl) {
    return await installPluginCore(gitUrl);
  }

  /**
   * Uninstall plugin
   * @param {string} name - Plugin name
   * @returns {Object} Uninstallation result
   */
  uninstallPlugin(name) {
    return uninstallPluginCore(name);
  }

  /**
   * Toggle plugin enabled/disabled
   * @param {string} name - Plugin name
   * @param {boolean} enabled - Enable or disable
   * @returns {Object} Updated plugin info
   */
  togglePlugin(name, enabled) {
    const plugin = getPlugin(name);
    if (!plugin) {
      throw new Error(`Plugin "${name}" not found`);
    }

    updatePluginRegistry(name, { enabled });

    return {
      name,
      ...getPlugin(name)
    };
  }

  /**
   * Update plugin config
   * @param {string} name - Plugin name
   * @param {Object} config - Configuration object
   * @returns {Object} Result
   */
  updatePluginConfig(name, config) {
    const plugin = getPlugin(name);
    if (!plugin) {
      throw new Error(`Plugin "${name}" not found`);
    }

    const configFile = path.join(CONFIG_DIR, `${name}.json`);

    // Ensure config directory exists
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }

    fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf8');

    return {
      success: true,
      message: `Configuration updated for plugin "${name}"`
    };
  }

  /**
   * Get plugin repositories (for future use)
   * @returns {Array} Empty array for now
   */
  getRepos() {
    // TODO: Implement plugin repository system
    return [];
  }

  /**
   * Add repository (for future use)
   * @param {Object} repo - Repository info
   * @returns {Array} Updated repos list
   */
  addRepo(repo) {
    // TODO: Implement plugin repository system
    throw new Error('Plugin repositories not yet implemented');
  }

  /**
   * Remove repository (for future use)
   * @param {string} id - Repository ID
   * @returns {Array} Updated repos list
   */
  removeRepo(id) {
    // TODO: Implement plugin repository system
    throw new Error('Plugin repositories not yet implemented');
  }
}

module.exports = { PluginsService };
