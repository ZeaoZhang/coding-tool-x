const { loadRegistry, listPlugins } = require('./registry');
const { loadPlugin, unloadPlugin, getLoadedPlugins, getLoadedPluginDetails } = require('./plugin-loader');
const eventBus = require('./event-bus');

// Module state
let initialized = false;
const registeredCommands = new Map(); // { commandName: { pluginName, handler } }

/**
 * Initialize all enabled plugins
 * @param {Object} [options] - Initialization options
 * @param {Object} [options.config] - Application configuration
 * @param {Array} [options.args] - CLI arguments
 * @returns {Object} Result with loaded count and failed plugins
 */
function initializePlugins(options = {}) {
  if (initialized) {
    return {
      loaded: getLoadedPlugins().length,
      failed: [],
      message: 'Plugins already initialized',
    };
  }

  const { config = {}, args = [] } = options;
  const failed = [];
  let loadedCount = 0;

  // Load registry
  const registry = loadRegistry();
  const plugins = Object.entries(registry.plugins || {});

  // Sort plugins by loadOrder (lower = earlier)
  const sortedPlugins = plugins
    .filter(([, info]) => info.enabled)
    .sort((a, b) => (a[1].loadOrder || 10) - (b[1].loadOrder || 10));

  // Load each enabled plugin
  for (const [name, pluginInfo] of sortedPlugins) {
    const result = loadPlugin(name, { pluginInfo });

    if (result.success) {
      loadedCount++;

      // Collect registered commands from this plugin
      const pluginDetails = getLoadedPluginDetails(name);
      if (pluginDetails && pluginDetails.context) {
        const commands = pluginDetails.context._getCommands();
        commands.forEach((handler, cmdName) => {
          registeredCommands.set(cmdName, { pluginName: name, handler });
        });
      }
    } else {
      failed.push({ name, error: result.error });
    }
  }

  // Emit cli:init event
  eventBus.emitSync('cli:init', { config, args });

  initialized = true;

  return {
    loaded: loadedCount,
    failed,
  };
}

/**
 * Shutdown all loaded plugins
 * @returns {Object} Confirmation of shutdown
 */
function shutdownPlugins() {
  if (!initialized) {
    return {
      success: true,
      message: 'Plugins not initialized, nothing to shutdown',
    };
  }

  // Emit cli:shutdown event
  eventBus.emitSync('cli:shutdown', {});

  // Unload each loaded plugin in reverse order
  const loadedNames = getLoadedPlugins();
  const errors = [];

  for (const name of loadedNames.reverse()) {
    const result = unloadPlugin(name);
    if (!result.success) {
      errors.push({ name, error: result.error });
    }
  }

  // Clear command registry
  registeredCommands.clear();
  initialized = false;

  return {
    success: errors.length === 0,
    unloaded: loadedNames.length - errors.length,
    errors,
  };
}

/**
 * Get all registered commands from plugins
 * @returns {Map} Map of { commandName: { pluginName, handler } }
 */
function getRegisteredCommands() {
  return new Map(registeredCommands);
}

/**
 * Check if a command is registered by a plugin
 * @param {string} name - Command name
 * @returns {boolean} True if command exists
 */
function isPluginCommand(name) {
  return registeredCommands.has(name);
}

/**
 * Execute a plugin-registered command
 * @param {string} name - Command name
 * @param {Array} args - Command arguments
 * @returns {Object} Result with success status and result/error
 */
async function executePluginCommand(name, args = []) {
  if (!registeredCommands.has(name)) {
    return {
      success: false,
      error: `Command '${name}' not found`,
    };
  }

  const { pluginName, handler } = registeredCommands.get(name);

  try {
    const result = await handler(args);
    return {
      success: true,
      result,
      pluginName,
    };
  } catch (error) {
    return {
      success: false,
      error: `Error executing command '${name}' from plugin '${pluginName}': ${error.message}`,
      pluginName,
    };
  }
}

/**
 * Check if plugins are initialized
 * @returns {boolean} Initialization status
 */
function isInitialized() {
  return initialized;
}

module.exports = {
  initializePlugins,
  shutdownPlugins,
  getRegisteredCommands,
  isPluginCommand,
  executePluginCommand,
  isInitialized,
};
