const chalk = require('chalk');
const inquirer = require('inquirer');
const { installPlugin, uninstallPlugin, updatePlugin, updateAllPlugins } = require('../plugins/plugin-installer');
const { listPlugins, getPlugin, updatePlugin: updatePluginRegistry } = require('../plugins/registry');
const { createPluginContext } = require('../plugins/plugin-api');
const fs = require('fs');
const path = require('path');
const { INSTALLED_DIR } = require('../plugins/constants');

/**
 * Main plugin command handler
 * @param {Array} args - Command line arguments
 */
async function handlePluginCommand(args) {
  const [subcommand, ...subArgs] = args;

  if (!subcommand) {
    showHelp();
    return;
  }

  switch (subcommand) {
    case 'install':
      await handleInstall(subArgs);
      break;
    case 'remove':
    case 'uninstall':
      await handleRemove(subArgs);
      break;
    case 'list':
      handleList(subArgs);
      break;
    case 'enable':
      handleEnable(subArgs);
      break;
    case 'disable':
      handleDisable(subArgs);
      break;
    case 'info':
      handleInfo(subArgs);
      break;
    case 'config':
      handleConfig(subArgs);
      break;
    case 'update':
      await handleUpdate(subArgs);
      break;
    case 'help':
      showHelp();
      break;
    default:
      console.error(chalk.red(`\n❌ Unknown subcommand: ${subcommand}\n`));
      showHelp();
      process.exit(1);
  }
}

/**
 * Handle plugin install command
 * @param {Array} args - Subcommand arguments
 */
async function handleInstall(args) {
  const url = args[0];

  if (!url) {
    console.error(chalk.red('\n❌ Git URL is required\n'));
    console.log(chalk.gray('Usage: ctx plugin install <git-url>\n'));
    console.log(chalk.gray('Example: ctx plugin install https://github.com/user/ctx-plugin.git\n'));
    process.exit(1);
  }

  console.log(chalk.cyan(`\n📦 Installing plugin from ${url}...\n`));

  const result = await installPlugin(url);

  if (result.success) {
    console.log(chalk.green('\n✅ Plugin installed successfully!\n'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.cyan('Name:       ') + chalk.white(result.plugin.name));
    console.log(chalk.cyan('Version:    ') + chalk.white(result.plugin.version));
    console.log(chalk.cyan('Author:     ') + chalk.white(result.plugin.author || 'N/A'));
    console.log(chalk.cyan('Commands:   ') + chalk.white(result.plugin.commands || 0));
    console.log(chalk.cyan('Hooks:      ') + chalk.white(result.plugin.hooks || 0));
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.gray(`\n💡 Run ${chalk.cyan(`ctx plugin info ${result.plugin.name}`)} for more details\n`));
  } else {
    console.error(chalk.red('\n❌ Installation failed:\n'));
    console.error(chalk.red(result.error));
    console.log();
    process.exit(1);
  }
}

/**
 * Handle plugin remove command
 * @param {Array} args - Subcommand arguments
 */
async function handleRemove(args) {
  const name = args[0];

  if (!name) {
    console.error(chalk.red('\n❌ Plugin name is required\n'));
    console.log(chalk.gray('Usage: ctx plugin remove <name>\n'));
    process.exit(1);
  }

  // Check if plugin exists
  const plugin = getPlugin(name);
  if (!plugin) {
    console.error(chalk.red(`\n❌ Plugin "${name}" is not installed\n`));
    process.exit(1);
  }

  // Confirm uninstall
  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: `Are you sure you want to uninstall "${name}"?`,
      default: false
    }
  ]);

  if (!confirmed) {
    console.log(chalk.yellow('\n⚠️  Uninstall cancelled\n'));
    return;
  }

  console.log(chalk.cyan(`\n🗑️  Uninstalling plugin "${name}"...\n`));

  const result = uninstallPlugin(name);

  if (result.success) {
    console.log(chalk.green(`\n✅ ${result.message}\n`));
  } else {
    console.error(chalk.red('\n❌ Uninstall failed:\n'));
    console.error(chalk.red(result.error));
    console.log();
    process.exit(1);
  }
}

/**
 * Handle plugin list command
 * @param {Array} args - Subcommand arguments
 */
function handleList(args) {
  const plugins = listPlugins();

  if (plugins.length === 0) {
    console.log(chalk.yellow('\n⚠️  No plugins installed\n'));
    console.log(chalk.gray('💡 Install a plugin with: ') + chalk.cyan('ctx plugin install <git-url>\n'));
    return;
  }

  console.log(chalk.cyan(`\n📦 Installed Plugins (${plugins.length})\n`));
  console.log(chalk.gray('═'.repeat(80)));

  // Sort by name
  plugins.sort((a, b) => a.name.localeCompare(b.name));

  for (const plugin of plugins) {
    const status = plugin.enabled
      ? chalk.green('✓ enabled ')
      : chalk.gray('✗ disabled');

    console.log('\n' + chalk.white.bold(plugin.name) + ' ' + chalk.gray(`v${plugin.version}`) + ' ' + status);

    // Try to read manifest for description
    const manifestPath = path.join(INSTALLED_DIR, plugin.name, 'plugin.json');
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (manifest.description) {
          console.log(chalk.gray('  ' + manifest.description));
        }
        if (manifest.author) {
          console.log(chalk.gray(`  Author: ${manifest.author}`));
        }
      } catch (err) {
        // Ignore read errors
      }
    }

    if (plugin.source) {
      console.log(chalk.gray(`  Source: ${plugin.source}`));
    }

    console.log(chalk.gray(`  Installed: ${new Date(plugin.installedAt).toLocaleDateString()}`));
  }

  console.log('\n' + chalk.gray('═'.repeat(80)));
  console.log(chalk.gray(`\n💡 Use ${chalk.cyan('ctx plugin info <name>')} for detailed information\n`));
}

/**
 * Handle plugin enable command
 * @param {Array} args - Subcommand arguments
 */
function handleEnable(args) {
  const name = args[0];

  if (!name) {
    console.error(chalk.red('\n❌ Plugin name is required\n'));
    console.log(chalk.gray('Usage: ctx plugin enable <name>\n'));
    process.exit(1);
  }

  const plugin = getPlugin(name);
  if (!plugin) {
    console.error(chalk.red(`\n❌ Plugin "${name}" is not installed\n`));
    process.exit(1);
  }

  if (plugin.enabled) {
    console.log(chalk.yellow(`\n⚠️  Plugin "${name}" is already enabled\n`));
    return;
  }

  try {
    updatePluginRegistry(name, { enabled: true });
    console.log(chalk.green(`\n✅ Plugin "${name}" has been enabled\n`));
    console.log(chalk.gray('💡 Restart ctx for changes to take effect\n'));
  } catch (error) {
    console.error(chalk.red(`\n❌ Failed to enable plugin: ${error.message}\n`));
    process.exit(1);
  }
}

/**
 * Handle plugin disable command
 * @param {Array} args - Subcommand arguments
 */
function handleDisable(args) {
  const name = args[0];

  if (!name) {
    console.error(chalk.red('\n❌ Plugin name is required\n'));
    console.log(chalk.gray('Usage: ctx plugin disable <name>\n'));
    process.exit(1);
  }

  const plugin = getPlugin(name);
  if (!plugin) {
    console.error(chalk.red(`\n❌ Plugin "${name}" is not installed\n`));
    process.exit(1);
  }

  if (!plugin.enabled) {
    console.log(chalk.yellow(`\n⚠️  Plugin "${name}" is already disabled\n`));
    return;
  }

  try {
    updatePluginRegistry(name, { enabled: false });
    console.log(chalk.green(`\n✅ Plugin "${name}" has been disabled\n`));
    console.log(chalk.gray('💡 Restart ctx for changes to take effect\n'));
  } catch (error) {
    console.error(chalk.red(`\n❌ Failed to disable plugin: ${error.message}\n`));
    process.exit(1);
  }
}

/**
 * Handle plugin info command
 * @param {Array} args - Subcommand arguments
 */
function handleInfo(args) {
  const name = args[0];

  if (!name) {
    console.error(chalk.red('\n❌ Plugin name is required\n'));
    console.log(chalk.gray('Usage: ctx plugin info <name>\n'));
    process.exit(1);
  }

  const plugin = getPlugin(name);
  if (!plugin) {
    console.error(chalk.red(`\n❌ Plugin "${name}" is not installed\n`));
    process.exit(1);
  }

  // Read manifest
  const manifestPath = path.join(INSTALLED_DIR, name, 'plugin.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(chalk.red(`\n❌ Plugin manifest not found: ${manifestPath}\n`));
    process.exit(1);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    console.error(chalk.red(`\n❌ Failed to read plugin manifest: ${error.message}\n`));
    process.exit(1);
  }

  // Display plugin information
  console.log(chalk.cyan(`\n📦 Plugin Information: ${name}\n`));
  console.log(chalk.gray('═'.repeat(80)));

  console.log(chalk.white('\nBasic Info:'));
  console.log(chalk.cyan('  Name:        ') + chalk.white(manifest.name));
  console.log(chalk.cyan('  Version:     ') + chalk.white(manifest.version));
  console.log(chalk.cyan('  Description: ') + chalk.white(manifest.description || 'N/A'));
  console.log(chalk.cyan('  Author:      ') + chalk.white(manifest.author || 'N/A'));
  console.log(chalk.cyan('  License:     ') + chalk.white(manifest.license || 'N/A'));

  console.log(chalk.white('\nStatus:'));
  console.log(chalk.cyan('  Enabled:     ') + (plugin.enabled ? chalk.green('Yes') : chalk.gray('No')));
  console.log(chalk.cyan('  Load Order:  ') + chalk.white(plugin.loadOrder || 10));
  console.log(chalk.cyan('  Installed:   ') + chalk.white(new Date(plugin.installedAt).toLocaleString()));

  if (plugin.updatedAt) {
    console.log(chalk.cyan('  Updated:     ') + chalk.white(new Date(plugin.updatedAt).toLocaleString()));
  }

  if (plugin.source) {
    console.log(chalk.cyan('  Source:      ') + chalk.white(plugin.source));
  }

  if (manifest.minVersion) {
    console.log(chalk.cyan('  Min Version: ') + chalk.white(manifest.minVersion));
  }

  // Commands
  if (manifest.commands && manifest.commands.length > 0) {
    console.log(chalk.white('\nCommands:'));
    manifest.commands.forEach(cmd => {
      const cmdName = typeof cmd === 'string' ? cmd : cmd.name;
      const cmdDesc = typeof cmd === 'object' ? cmd.description : '';
      console.log(chalk.cyan('  • ') + chalk.white(cmdName) + (cmdDesc ? chalk.gray(` - ${cmdDesc}`) : ''));
    });
  }

  // Hooks
  if (manifest.hooks && manifest.hooks.length > 0) {
    console.log(chalk.white('\nHooks:'));
    manifest.hooks.forEach(hook => {
      console.log(chalk.cyan('  • ') + chalk.white(hook));
    });
  }

  // Configuration
  const configFile = path.join(require('../plugins/constants').CONFIG_DIR, `${name}.json`);
  if (fs.existsSync(configFile)) {
    try {
      const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      const keys = Object.keys(config);
      if (keys.length > 0) {
        console.log(chalk.white('\nConfiguration:'));
        keys.forEach(key => {
          const value = config[key];
          const displayValue = typeof value === 'object' ? JSON.stringify(value) : value;
          console.log(chalk.cyan(`  ${key}: `) + chalk.white(displayValue));
        });
      }
    } catch (err) {
      // Ignore read errors
    }
  }

  console.log('\n' + chalk.gray('═'.repeat(80)) + '\n');
}

/**
 * Handle plugin config command
 * @param {Array} args - Subcommand arguments
 */
function handleConfig(args) {
  const [name, key, ...valueParts] = args;

  if (!name) {
    console.error(chalk.red('\n❌ Plugin name is required\n'));
    console.log(chalk.gray('Usage: ctx plugin config <name> [key] [value]\n'));
    console.log(chalk.gray('Examples:\n'));
    console.log(chalk.gray('  ctx plugin config my-plugin              # View all config'));
    console.log(chalk.gray('  ctx plugin config my-plugin apiKey       # View specific key'));
    console.log(chalk.gray('  ctx plugin config my-plugin apiKey xyz   # Set key\n'));
    process.exit(1);
  }

  const plugin = getPlugin(name);
  if (!plugin) {
    console.error(chalk.red(`\n❌ Plugin "${name}" is not installed\n`));
    process.exit(1);
  }

  const configFile = path.join(require('../plugins/constants').CONFIG_DIR, `${name}.json`);

  // Ensure config directory exists
  const configDir = path.dirname(configFile);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  // Load existing config
  let config = {};
  if (fs.existsSync(configFile)) {
    try {
      config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    } catch (error) {
      console.error(chalk.red(`\n❌ Failed to read config: ${error.message}\n`));
      process.exit(1);
    }
  }

  // No key provided - view all config
  if (!key) {
    console.log(chalk.cyan(`\n⚙️  Configuration for "${name}"\n`));
    console.log(chalk.gray('═'.repeat(80)));

    const keys = Object.keys(config);
    if (keys.length === 0) {
      console.log(chalk.gray('\n  No configuration set\n'));
    } else {
      console.log();
      keys.forEach(k => {
        const value = config[k];
        const displayValue = typeof value === 'object'
          ? JSON.stringify(value, null, 2).split('\n').map((line, i) => i === 0 ? line : '      ' + line).join('\n')
          : value;
        console.log(chalk.cyan(`  ${k}: `) + chalk.white(displayValue));
      });
      console.log();
    }

    console.log(chalk.gray('═'.repeat(80)) + '\n');
    return;
  }

  // No value provided - view specific key
  if (valueParts.length === 0) {
    if (config[key] === undefined) {
      console.log(chalk.yellow(`\n⚠️  Key "${key}" is not set\n`));
    } else {
      console.log(chalk.cyan(`\n⚙️  ${key}: `) + chalk.white(JSON.stringify(config[key], null, 2)) + '\n');
    }
    return;
  }

  // Set value
  const value = valueParts.join(' ');

  // Try to parse as JSON if it looks like JSON
  let parsedValue = value;
  if (value.startsWith('{') || value.startsWith('[') || value === 'true' || value === 'false' || !isNaN(value)) {
    try {
      parsedValue = JSON.parse(value);
    } catch (err) {
      // Keep as string if not valid JSON
    }
  }

  config[key] = parsedValue;

  try {
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf8');
    console.log(chalk.green(`\n✅ Configuration updated: ${key} = ${JSON.stringify(parsedValue)}\n`));
  } catch (error) {
    console.error(chalk.red(`\n❌ Failed to save config: ${error.message}\n`));
    process.exit(1);
  }
}

/**
 * Handle plugin update command
 * @param {Array} args - Subcommand arguments
 */
async function handleUpdate(args) {
  const name = args[0];
  const isUpdateAll = name === '--all' || name === '-a';

  if (!name) {
    console.error(chalk.red('\n❌ Plugin name is required\n'));
    console.log(chalk.gray('Usage: ctx plugin update <name>\n'));
    console.log(chalk.gray('       ctx plugin update --all\n'));
    process.exit(1);
  }

  if (isUpdateAll) {
    console.log(chalk.cyan('\n🔄 Updating all plugins...\n'));

    const result = await updateAllPlugins();

    console.log(chalk.gray('═'.repeat(80)));

    for (const pluginResult of result.results) {
      if (pluginResult.success) {
        if (pluginResult.plugin && pluginResult.plugin.updated) {
          console.log(chalk.green(`✓ ${pluginResult.name}: `) +
            chalk.gray(`v${pluginResult.plugin.oldVersion}`) +
            chalk.white(' → ') +
            chalk.green(`v${pluginResult.plugin.newVersion}`));
        } else {
          console.log(chalk.gray(`○ ${pluginResult.name}: up to date`));
        }
      } else {
        console.log(chalk.red(`✗ ${pluginResult.name}: ${pluginResult.error}`));
      }
    }

    console.log(chalk.gray('═'.repeat(80)));
    console.log(chalk.white('\nSummary:'));
    console.log(chalk.green(`  Updated:   ${result.summary.updated}`));
    console.log(chalk.gray(`  Unchanged: ${result.summary.unchanged}`));
    if (result.summary.failed > 0) {
      console.log(chalk.red(`  Failed:    ${result.summary.failed}`));
    }
    console.log();

    if (!result.success) {
      process.exit(1);
    }
  } else {
    // Update single plugin
    const plugin = getPlugin(name);
    if (!plugin) {
      console.error(chalk.red(`\n❌ Plugin "${name}" is not installed\n`));
      process.exit(1);
    }

    console.log(chalk.cyan(`\n🔄 Updating plugin "${name}"...\n`));

    const result = await updatePlugin(name);

    if (result.success) {
      console.log(chalk.green(`\n✅ ${result.message}\n`));
      if (result.plugin && result.plugin.updated) {
        console.log(chalk.gray(`  ${result.plugin.oldVersion} → ${result.plugin.newVersion}\n`));
      }
    } else {
      console.error(chalk.red('\n❌ Update failed:\n'));
      console.error(chalk.red(result.error));
      console.log();
      process.exit(1);
    }
  }
}

/**
 * Show plugin command help
 */
function showHelp() {
  console.log(chalk.cyan('\n📦 Plugin Management Commands\n'));
  console.log(chalk.gray('═'.repeat(80)));

  console.log(chalk.white('\nUsage: ') + chalk.cyan('ctx plugin <subcommand> [options]\n'));

  console.log(chalk.white('Subcommands:\n'));

  const commands = [
    ['install <url>', 'Install plugin from Git URL'],
    ['remove <name>', 'Uninstall plugin'],
    ['list', 'List installed plugins with status'],
    ['enable <name>', 'Enable disabled plugin'],
    ['disable <name>', 'Disable plugin without removing'],
    ['info <name>', 'Show plugin manifest, config, and hooks'],
    ['config <name> [key] [value]', 'View or set plugin configuration'],
    ['update <name>', 'Update plugin to latest version'],
    ['update --all', 'Update all installed plugins'],
    ['help', 'Show this help message']
  ];

  commands.forEach(([cmd, desc]) => {
    console.log('  ' + chalk.cyan(cmd.padEnd(30)) + chalk.gray(desc));
  });

  console.log('\n' + chalk.white('Examples:\n'));

  console.log(chalk.gray('  ctx plugin install https://github.com/user/ctx-plugin.git'));
  console.log(chalk.gray('  ctx plugin list'));
  console.log(chalk.gray('  ctx plugin info my-plugin'));
  console.log(chalk.gray('  ctx plugin config my-plugin apiKey abc123'));
  console.log(chalk.gray('  ctx plugin update my-plugin'));
  console.log(chalk.gray('  ctx plugin update --all'));
  console.log(chalk.gray('  ctx plugin disable my-plugin'));
  console.log(chalk.gray('  ctx plugin remove my-plugin\n'));

  console.log(chalk.gray('═'.repeat(80)) + '\n');
}

module.exports = {
  handlePluginCommand
};
