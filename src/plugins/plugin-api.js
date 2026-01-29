const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('./constants');
const eventBus = require('./event-bus');
const { loadConfig } = require('../config/loader');
const packageJson = require('../../package.json');

/**
 * Create sandboxed plugin context with isolated API surface
 * @param {string} pluginName - Name of the plugin
 * @param {Object} pluginConfig - Plugin-specific configuration
 * @param {string} pluginDir - Plugin installation directory
 * @returns {Object} Plugin context object
 */
function createPluginContext(pluginName, pluginConfig, pluginDir) {
  const commandRegistry = new Map();

  // Storage API - persists plugin data to ~/.claude/cc-tool/plugins/config/<plugin-name>.json
  const storage = createStorageAPI(pluginName);

  // Logger API - prefixed logging
  const logger = {
    info: (msg) => console.log(`[${pluginName}] ${msg}`),
    warn: (msg) => console.warn(`[${pluginName}] ${msg}`),
    error: (msg) => console.error(`[${pluginName}] ${msg}`),
  };

  // Plugin context object
  const ctx = {
    // Event bus for cross-plugin communication
    events: eventBus,

    // Frozen plugin configuration
    config: Object.freeze({ ...pluginConfig }),

    // Prefixed logger
    logger,

    // Command registration (collected by plugin-manager)
    registerCommand: (name, handler) => {
      if (!name || typeof name !== 'string') {
        throw new Error('Command name must be a non-empty string');
      }
      if (typeof handler !== 'function') {
        throw new Error('Command handler must be a function');
      }
      commandRegistry.set(name, handler);
      logger.info(`Registered command: ${name}`);
    },

    // Get frozen copy of app configuration
    getAppConfig: () => {
      const config = loadConfig();
      return Object.freeze({ ...config });
    },

    // Get CTX version
    getVersion: () => packageJson.version,

    // Persistent key-value storage
    storage,

    // Internal: expose command registry for plugin-manager
    _getCommands: () => commandRegistry,
  };

  return ctx;
}

/**
 * Create storage API for plugin data persistence
 * @param {string} pluginName - Plugin name
 * @returns {Object} Storage API
 */
function createStorageAPI(pluginName) {
  const storageFile = path.join(CONFIG_DIR, `${pluginName}.json`);

  // Ensure config directory exists
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Load storage data
  function loadData() {
    try {
      if (fs.existsSync(storageFile)) {
        const content = fs.readFileSync(storageFile, 'utf8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.error(`[${pluginName}] Failed to load storage:`, error.message);
    }
    return {};
  }

  // Save storage data
  function saveData(data) {
    try {
      fs.writeFileSync(storageFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error(`[${pluginName}] Failed to save storage:`, error.message);
      throw error;
    }
  }

  return {
    get: (key) => {
      const data = loadData();
      return data[key];
    },

    set: (key, value) => {
      const data = loadData();
      data[key] = value;
      saveData(data);
    },

    delete: (key) => {
      const data = loadData();
      delete data[key];
      saveData(data);
    },
  };
}

module.exports = {
  createPluginContext,
};
