const fs = require('fs');
const path = require('path');
const { PLUGINS_DIR, REGISTRY_FILE } = require('./constants');

/**
 * Ensure plugins directory exists
 */
function ensurePluginsDir() {
  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  }
}

/**
 * Load registry.json, create with empty structure if missing
 * @returns {Object} Registry data
 */
function loadRegistry() {
  ensurePluginsDir();

  if (!fs.existsSync(REGISTRY_FILE)) {
    const emptyRegistry = { plugins: {} };
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(emptyRegistry, null, 2), 'utf8');
    return emptyRegistry;
  }

  try {
    const content = fs.readFileSync(REGISTRY_FILE, 'utf8');
    const data = JSON.parse(content);

    // Ensure plugins key exists
    if (!data.plugins) {
      data.plugins = {};
    }

    return data;
  } catch (error) {
    console.error('Failed to load registry:', error.message);
    return { plugins: {} };
  }
}

/**
 * Save registry data to registry.json
 * @param {Object} data - Registry data
 */
function saveRegistry(data) {
  ensurePluginsDir();

  try {
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    throw new Error(`Failed to save registry: ${error.message}`);
  }
}

/**
 * Add plugin to registry
 * @param {string} name - Plugin name
 * @param {Object} info - Plugin information
 * @param {string} info.version - Plugin version
 * @param {boolean} [info.enabled=true] - Whether plugin is enabled
 * @param {string} [info.installedAt] - Installation timestamp
 * @param {string} [info.source] - Git URL or source
 * @param {number} [info.loadOrder=10] - Load order priority
 * @returns {Object} Updated registry
 */
function addPlugin(name, info) {
  const registry = loadRegistry();

  registry.plugins[name] = {
    version: info.version,
    enabled: info.enabled !== undefined ? info.enabled : true,
    installedAt: info.installedAt || new Date().toISOString(),
    source: info.source || '',
    loadOrder: info.loadOrder !== undefined ? info.loadOrder : 10,
  };

  saveRegistry(registry);
  return registry;
}

/**
 * Remove plugin from registry
 * @param {string} name - Plugin name
 * @returns {Object} Updated registry
 */
function removePlugin(name) {
  const registry = loadRegistry();

  if (registry.plugins[name]) {
    delete registry.plugins[name];
    saveRegistry(registry);
  }

  return registry;
}

/**
 * Get plugin info
 * @param {string} name - Plugin name
 * @returns {Object|null} Plugin info or null if not found
 */
function getPlugin(name) {
  const registry = loadRegistry();
  return registry.plugins[name] || null;
}

/**
 * List all plugins
 * @returns {Array} Array of plugin objects with name included
 */
function listPlugins() {
  const registry = loadRegistry();

  return Object.entries(registry.plugins).map(([name, info]) => ({
    name,
    ...info,
  }));
}

/**
 * Update plugin info (partial update)
 * @param {string} name - Plugin name
 * @param {Object} updates - Partial updates to apply
 * @returns {Object} Updated plugin info
 */
function updatePlugin(name, updates) {
  const registry = loadRegistry();

  if (!registry.plugins[name]) {
    throw new Error(`Plugin '${name}' not found in registry`);
  }

  registry.plugins[name] = {
    ...registry.plugins[name],
    ...updates,
  };

  saveRegistry(registry);
  return registry.plugins[name];
}

module.exports = {
  loadRegistry,
  saveRegistry,
  addPlugin,
  removePlugin,
  getPlugin,
  listPlugins,
  updatePlugin,
};
