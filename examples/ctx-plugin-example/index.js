/**
 * Example CTX Plugin
 * 
 * This plugin demonstrates the complete plugin architecture including:
 * - Plugin lifecycle (activate/deactivate)
 * - Hook subscription
 * - Command registration
 * - Configuration usage
 * - Logging and state management
 */

const chalk = require('chalk');
const path = require('path');

// Plugin state
let config = {};
let hooks = {};
let logger = null;
let pluginState = {
  activatedAt: null,
  commandCount: 0,
  lastCommand: null,
};

/**
 * Main plugin activation function
 * Called when the plugin is loaded by the CTX system
 * 
 * @param {Object} ctx - CTX context object
 * @param {Object} ctx.config - Plugin configuration from plugin.json + user overrides
 * @param {Object} ctx.hooks - Hook registry
 * @param {Object} ctx.logger - Logger instance
 * @param {Function} ctx.registerCommand - Command registration function
 * @returns {Object} Plugin lifecycle object with optional deactivate function
 */
async function activate(ctx) {
  try {
    // Store context references
    config = ctx.config || {};
    hooks = ctx.hooks || {};
    logger = ctx.logger || console;

    logger.info(chalk.blue('[Example Plugin]'), 'Activating example plugin...');

    // Subscribe to hooks
    if (hooks.on) {
      hooks.on('init', handleInit);
      hooks.on('beforeCommand', handleBeforeCommand);
      hooks.on('afterCommand', handleAfterCommand);
      logger.debug('[Example Plugin]', 'Hook subscriptions registered');
    }

    // Register commands
    if (ctx.registerCommand) {
      ctx.registerCommand('hello', handleHelloCommand, {
        aliases: ['hi', 'greet'],
        description: 'Say hello from the example plugin',
      });

      ctx.registerCommand('config-demo', handleConfigDemoCommand, {
        aliases: ['cfg'],
        description: 'Demonstrate plugin configuration usage',
      });

      logger.debug('[Example Plugin]', 'Commands registered');
    }

    // Initialize plugin state
    pluginState.activatedAt = new Date();

    logger.info(chalk.green('[Example Plugin]'), 'Successfully activated');

    // Return lifecycle object
    return {
      deactivate: deactivate,
      getState: getState,
      setConfig: setConfig,
    };
  } catch (error) {
    logger.error(chalk.red('[Example Plugin]'), 'Activation failed:', error.message);
    throw error;
  }
}

/**
 * Plugin deactivation function
 * Called when the plugin is unloaded or the application terminates
 */
async function deactivate() {
  try {
    logger.info(chalk.blue('[Example Plugin]'), 'Deactivating example plugin...');

    // Unsubscribe from hooks
    if (hooks.off) {
      hooks.off('init', handleInit);
      hooks.off('beforeCommand', handleBeforeCommand);
      hooks.off('afterCommand', handleAfterCommand);
    }

    // Cleanup resources
    pluginState = {
      activatedAt: null,
      commandCount: 0,
      lastCommand: null,
    };

    logger.info(chalk.green('[Example Plugin]'), 'Successfully deactivated');
  } catch (error) {
    logger.error(chalk.red('[Example Plugin]'), 'Deactivation error:', error.message);
  }
}

/**
 * Hook handler: Called on plugin system initialization
 */
function handleInit() {
  logger.debug('[Example Plugin]', 'Init hook triggered');
}

/**
 * Hook handler: Called before any command execution
 * @param {Object} data - Command metadata
 */
function handleBeforeCommand(data) {
  logger.debug('[Example Plugin]', `Before command: ${data.command}`);
}

/**
 * Hook handler: Called after any command execution
 * @param {Object} data - Command result metadata
 */
function handleAfterCommand(data) {
  logger.debug('[Example Plugin]', `After command: ${data.command} (${data.status})`);
}

/**
 * Command handler: hello
 * Demonstrates basic command handling with arguments
 * 
 * @param {Object} args - Parsed command arguments
 * @param {Array} args._ - Positional arguments
 * @param {Object} args - Named options
 */
async function handleHelloCommand(args) {
  try {
    const name = args._?.[0] || 'World';
    const greeting = config.greeting || 'Hello';

    // Increment command counter
    pluginState.commandCount++;
    pluginState.lastCommand = 'hello';

    // Get language-specific greeting
    const localizedGreeting = getLocalizedGreeting(greeting);

    console.log(chalk.cyan(`${localizedGreeting}, ${name}!`));
    logger.debug('[Example Plugin]', `Hello command executed for: ${name}`);

    return { success: true, message: `${localizedGreeting}, ${name}!` };
  } catch (error) {
    logger.error('[Example Plugin]', 'Hello command error:', error.message);
    throw error;
  }
}

/**
 * Command handler: config-demo
 * Demonstrates plugin configuration usage
 */
async function handleConfigDemoCommand(args) {
  try {
    pluginState.commandCount++;
    pluginState.lastCommand = 'config-demo';

    console.log(chalk.cyan('\n=== Plugin Configuration Demo ===\n'));

    // Display config values
    console.log(chalk.yellow('Active Configuration:'));
    console.log(`  Greeting: ${chalk.green(config.greeting)}`);
    console.log(`  Language: ${chalk.green(config.language)}`);
    console.log(`  Log Level: ${chalk.green(config.logLevel)}`);
    
    if (config.enableFeatures) {
      console.log(chalk.yellow('\nFeature Flags:'));
      Object.entries(config.enableFeatures).forEach(([key, value]) => {
        const status = value ? chalk.green('enabled') : chalk.red('disabled');
        console.log(`  ${key}: ${status}`);
      });
    }

    // Display plugin state
    console.log(chalk.yellow('\nPlugin State:'));
    console.log(`  Activated: ${chalk.green(pluginState.activatedAt?.toISOString() || 'N/A')}`);
    console.log(`  Commands Executed: ${chalk.green(pluginState.commandCount)}`);
    console.log(`  Last Command: ${chalk.green(pluginState.lastCommand || 'N/A')}`);
    console.log();

    logger.debug('[Example Plugin]', 'Config demo command executed');
    return { success: true };
  } catch (error) {
    logger.error('[Example Plugin]', 'Config demo command error:', error.message);
    throw error;
  }
}

/**
 * Get localized greeting based on configured language
 * @param {string} greeting - Base greeting message
 * @returns {string} Localized greeting
 */
function getLocalizedGreeting(greeting) {
  const language = config.language || 'en';
  const greetings = {
    en: greeting,
    es: 'Hola',
    fr: 'Bonjour',
  };

  return greetings[language] || greeting;
}

/**
 * Get current plugin state
 * @returns {Object} Plugin state object
 */
function getState() {
  return {
    ...pluginState,
    config: { ...config },
  };
}

/**
 * Update plugin configuration at runtime
 * @param {Object} newConfig - Configuration updates
 */
function setConfig(newConfig) {
  config = { ...config, ...newConfig };
  logger.debug('[Example Plugin]', 'Configuration updated', newConfig);
}

/**
 * Plugin exports
 */
module.exports = {
  activate,
  deactivate,
  getState,
  setConfig,
};
