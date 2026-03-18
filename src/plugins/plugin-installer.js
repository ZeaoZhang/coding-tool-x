const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const os = require('os');
const crypto = require('crypto');
const inquirer = require('inquirer');

const { PLUGINS_DIR, CONFIG_DIR, INSTALLED_DIR } = require('./constants');
const { validateManifest, checkVersionCompatibility } = require('./manifest-validator');
const { addPlugin, removePlugin, getPlugin, listPlugins, updatePlugin: updatePluginRegistry } = require('./registry');

// Core commands that plugins cannot override
const CORE_COMMANDS = [
  'start', 'stop', 'restart', 'status',
  'ui', 'logs', 'stats', 'doctor', 'reset',
  'claude', 'codex', 'gemini', 'proxy',
  'security', 'help', 'version'
];

/**
 * Validate Git URL format
 * @param {string} url - Git URL to validate
 * @returns {{ valid: boolean, error?: string }}
 */
function validateGitUrl(url) {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'Git URL is required' };
  }

  // Support HTTPS URLs
  const httpsPattern = /^https:\/\/github\.com\/[\w-]+\/[\w.-]+(?:\.git)?$/;
  // Support SSH URLs
  const sshPattern = /^git@github\.com:[\w-]+\/[\w.-]+(?:\.git)?$/;
  // Support generic git URLs
  const genericPattern = /^(https?|git):\/\/.+\.git$/;

  if (httpsPattern.test(url) || sshPattern.test(url) || genericPattern.test(url)) {
    return { valid: true };
  }

  return {
    valid: false,
    error: `Invalid Git URL format: "${url}". Expected formats:\n` +
      '  - https://github.com/user/repo.git\n' +
      '  - git@github.com:user/repo.git'
  };
}

/**
 * Generate a random temporary directory path
 * @returns {string} Temporary directory path
 */
function getTempDir() {
  const random = crypto.randomBytes(8).toString('hex');
  return path.join(os.tmpdir(), `ctx-plugin-${random}`);
}

/**
 * Execute a shell command and return result
 * @param {string} command - Command to execute
 * @param {Object} options - Options for execSync
 * @returns {{ success: boolean, output?: string, error?: string }}
 */
function execCommand(command, options = {}) {
  try {
    const output = execSync(command, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      ...options
    });
    return { success: true, output: output.trim() };
  } catch (error) {
    return {
      success: false,
      error: error.stderr || error.message || 'Command failed'
    };
  }
}

/**
 * Recursively delete a directory
 * @param {string} dirPath - Directory path to delete
 */
function deleteDirectory(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

/**
 * Ensure a directory exists
 * @param {string} dirPath - Directory path to create
 */
function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Copy directory recursively
 * @param {string} src - Source directory
 * @param {string} dest - Destination directory
 */
function copyDirectory(src, dest) {
  ensureDirectory(dest);

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Check for name conflicts with existing plugins
 * @param {string} pluginName - Plugin name to check
 * @returns {{ conflict: boolean, reason?: string }}
 */
function checkNameConflict(pluginName) {
  const existingPlugin = getPlugin(pluginName);

  if (existingPlugin) {
    return {
      conflict: true,
      reason: `A plugin named "${pluginName}" is already installed (version ${existingPlugin.version})`
    };
  }

  return { conflict: false };
}

/**
 * Check for command name conflicts with core commands
 * @param {Array} pluginCommands - Array of command names from plugin
 * @returns {{ conflict: boolean, reason?: string, conflicts?: Array }}
 */
function checkCommandConflicts(pluginCommands) {
  if (!pluginCommands || !Array.isArray(pluginCommands)) {
    return { conflict: false };
  }

  const conflicts = [];

  for (const cmd of pluginCommands) {
    const cmdName = typeof cmd === 'string' ? cmd : cmd.name;
    if (CORE_COMMANDS.includes(cmdName)) {
      conflicts.push(cmdName);
    }
  }

  if (conflicts.length > 0) {
    return {
      conflict: true,
      reason: `Plugin commands conflict with core commands: ${conflicts.join(', ')}`,
      conflicts
    };
  }

  return { conflict: false };
}

/**
 * Install npm dependencies for a plugin
 * @param {string} pluginDir - Plugin directory path
 * @returns {{ success: boolean, error?: string }}
 */
function installDependencies(pluginDir) {
  const packageJsonPath = path.join(pluginDir, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return { success: true }; // No dependencies to install
  }

  const result = execCommand('npm install --production --ignore-scripts', {
    cwd: pluginDir,
    timeout: 120000 // 2 minute timeout
  });

  if (!result.success) {
    return {
      success: false,
      error: `Failed to install dependencies: ${result.error}`
    };
  }

  return { success: true };
}

/**
 * Install a plugin from a Git URL
 * @param {string} gitUrl - Git repository URL
 * @returns {Promise<{ success: boolean, plugin?: Object, error?: string }>}
 */
async function installPlugin(gitUrl) {
  let tempDir = null;
  let installedDir = null;
  let registryAdded = false;
  let pluginName = null;

  try {
    // Step 1: Validate Git URL format
    const urlValidation = validateGitUrl(gitUrl);
    if (!urlValidation.valid) {
      return { success: false, error: urlValidation.error };
    }

    // Step 2: Security warning and user confirmation
    console.warn('\n[WARN]  WARNING: Plugins have full system access!');
    console.warn('Only install plugins from trusted sources.');
    console.warn(`Source: ${gitUrl}\n`);

    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message: 'Do you want to continue with the installation?',
        default: false
      }
    ]);

    if (!confirmed) {
      return {
        success: false,
        error: 'Installation cancelled by user'
      };
    }

    // Step 3: Clone to temp directory
    tempDir = getTempDir();
    const cloneResult = execCommand(`git clone --depth 1 "${gitUrl}" "${tempDir}"`, {
      timeout: 60000 // 1 minute timeout
    });

    if (!cloneResult.success) {
      return {
        success: false,
        error: `Failed to clone repository: ${cloneResult.error}`
      };
    }

    // Step 4: Read and validate plugin.json
    const manifestPath = path.join(tempDir, 'plugin.json');

    if (!fs.existsSync(manifestPath)) {
      return {
        success: false,
        error: 'Invalid plugin: plugin.json not found in repository root'
      };
    }

    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (parseError) {
      return {
        success: false,
        error: `Failed to parse plugin.json: ${parseError.message}`
      };
    }

    const validation = validateManifest(manifest);
    if (!validation.valid) {
      const errorMessages = validation.errors
        .map(e => `  - ${e.field}: ${e.message}`)
        .join('\n');
      return {
        success: false,
        error: `Invalid plugin.json:\n${errorMessages}`
      };
    }

    pluginName = manifest.name;

    // Step 5: Check version compatibility
    if (manifest.minVersion) {
      const versionCheck = checkVersionCompatibility(manifest.minVersion);
      if (!versionCheck.compatible) {
        return {
          success: false,
          error: versionCheck.reason
        };
      }
    }

    // Step 6: Check for name conflicts with existing plugins
    const nameCheck = checkNameConflict(pluginName);
    if (nameCheck.conflict) {
      return {
        success: false,
        error: nameCheck.reason
      };
    }

    // Step 7: Check for command name conflicts with core commands
    const commandCheck = checkCommandConflicts(manifest.commands);
    if (commandCheck.conflict) {
      return {
        success: false,
        error: commandCheck.reason
      };
    }

    // Step 8: Install npm dependencies if package.json exists
    const depResult = installDependencies(tempDir);
    if (!depResult.success) {
      return {
        success: false,
        error: depResult.error
      };
    }

    // Step 9: Move to final location
    installedDir = path.join(INSTALLED_DIR, pluginName);
    ensureDirectory(INSTALLED_DIR);

    // Remove any existing directory (shouldn't exist due to conflict check, but be safe)
    if (fs.existsSync(installedDir)) {
      deleteDirectory(installedDir);
    }

    // Move temp dir to installed dir
    copyDirectory(tempDir, installedDir);

    // Step 10: Update registry
    addPlugin(pluginName, {
      version: manifest.version,
      enabled: true,
      source: gitUrl,
      loadOrder: manifest.loadOrder || 10
    });
    registryAdded = true;

    // Clean up temp directory
    deleteDirectory(tempDir);
    tempDir = null;

    // Return success with plugin info
    return {
      success: true,
      plugin: {
        name: pluginName,
        version: manifest.version,
        description: manifest.description,
        author: manifest.author,
        commands: manifest.commands ? manifest.commands.length : 0,
        hooks: manifest.hooks ? manifest.hooks.length : 0,
        source: gitUrl,
        installedAt: new Date().toISOString()
      }
    };

  } catch (error) {
    // ROLLBACK on any failure
    if (tempDir) {
      deleteDirectory(tempDir);
    }

    if (installedDir && fs.existsSync(installedDir)) {
      deleteDirectory(installedDir);
    }

    if (registryAdded && pluginName) {
      removePlugin(pluginName);
    }

    return {
      success: false,
      error: `Installation failed: ${error.message}`
    };
  }
}

/**
 * Uninstall a plugin by name
 * @param {string} name - Plugin name to uninstall
 * @returns {{ success: boolean, message?: string, error?: string }}
 */
function uninstallPlugin(name) {
  try {
    // Check if plugin exists in registry
    const plugin = getPlugin(name);
    if (!plugin) {
      return {
        success: false,
        error: `Plugin "${name}" is not installed`
      };
    }

    // Remove from registry first
    removePlugin(name);

    // Delete installed directory
    const pluginDir = path.join(INSTALLED_DIR, name);
    if (fs.existsSync(pluginDir)) {
      deleteDirectory(pluginDir);
    }

    // Delete config file if exists
    const configFile = path.join(CONFIG_DIR, `${name}.json`);
    if (fs.existsSync(configFile)) {
      fs.unlinkSync(configFile);
    }

    return {
      success: true,
      message: `Plugin "${name}" has been uninstalled successfully`
    };

  } catch (error) {
    return {
      success: false,
      error: `Failed to uninstall plugin "${name}": ${error.message}`
    };
  }
}

/**
 * Update a plugin to the latest version
 * @param {string} name - Plugin name to update
 * @returns {Promise<{ success: boolean, plugin?: Object, message?: string, error?: string }>}
 */
async function updatePlugin(name) {
  try {
    // Check if plugin exists
    const pluginInfo = getPlugin(name);
    if (!pluginInfo) {
      return {
        success: false,
        error: `Plugin "${name}" is not installed`
      };
    }

    const pluginDir = path.join(INSTALLED_DIR, name);

    if (!fs.existsSync(pluginDir)) {
      return {
        success: false,
        error: `Plugin directory not found: ${pluginDir}`
      };
    }

    // Get old version for comparison
    const manifestPath = path.join(pluginDir, 'plugin.json');
    let oldVersion = pluginInfo.version;

    // Git pull to get latest changes
    const pullResult = execCommand('git pull --ff-only', {
      cwd: pluginDir,
      timeout: 60000
    });

    if (!pullResult.success) {
      // Try a fetch and reset if pull fails
      const fetchResult = execCommand('git fetch origin && git reset --hard origin/HEAD', {
        cwd: pluginDir,
        timeout: 60000
      });

      if (!fetchResult.success) {
        return {
          success: false,
          error: `Failed to update plugin: ${fetchResult.error}`
        };
      }
    }

    // Reinstall dependencies
    const depResult = installDependencies(pluginDir);
    if (!depResult.success) {
      return {
        success: false,
        error: depResult.error
      };
    }

    // Read updated manifest
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (parseError) {
      return {
        success: false,
        error: `Failed to read updated plugin.json: ${parseError.message}`
      };
    }

    // Validate updated manifest
    const validation = validateManifest(manifest);
    if (!validation.valid) {
      return {
        success: false,
        error: `Updated plugin.json is invalid. Please contact the plugin author.`
      };
    }

    // Check version compatibility
    if (manifest.minVersion) {
      const versionCheck = checkVersionCompatibility(manifest.minVersion);
      if (!versionCheck.compatible) {
        return {
          success: false,
          error: `Updated plugin requires newer CTX version: ${versionCheck.reason}`
        };
      }
    }

    // Update registry with new version
    updatePluginRegistry(name, {
      version: manifest.version,
      updatedAt: new Date().toISOString()
    });

    const wasUpdated = oldVersion !== manifest.version;

    return {
      success: true,
      plugin: {
        name: name,
        oldVersion: oldVersion,
        newVersion: manifest.version,
        updated: wasUpdated
      },
      message: wasUpdated
        ? `Plugin "${name}" updated from v${oldVersion} to v${manifest.version}`
        : `Plugin "${name}" is already at the latest version (v${manifest.version})`
    };

  } catch (error) {
    return {
      success: false,
      error: `Failed to update plugin "${name}": ${error.message}`
    };
  }
}

/**
 * Update all installed plugins
 * @returns {Promise<{ success: boolean, results: Array, summary: { updated: number, failed: number, unchanged: number } }>}
 */
async function updateAllPlugins() {
  const plugins = listPlugins();
  const results = [];
  const summary = {
    updated: 0,
    failed: 0,
    unchanged: 0
  };

  if (plugins.length === 0) {
    return {
      success: true,
      results: [],
      summary
    };
  }

  for (const plugin of plugins) {
    const result = await updatePlugin(plugin.name);

    results.push({
      name: plugin.name,
      ...result
    });

    if (result.success) {
      if (result.plugin && result.plugin.updated) {
        summary.updated++;
      } else {
        summary.unchanged++;
      }
    } else {
      summary.failed++;
    }
  }

  return {
    success: summary.failed === 0,
    results,
    summary
  };
}

module.exports = {
  installPlugin,
  uninstallPlugin,
  updatePlugin,
  updateAllPlugins,
  // Export utilities for testing
  validateGitUrl,
  checkNameConflict,
  checkCommandConflicts,
  CORE_COMMANDS
};
