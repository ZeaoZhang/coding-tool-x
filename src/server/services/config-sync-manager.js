/**
 * Config Sync Manager
 *
 * Manages file synchronization between cc-tool central storage and CLI directories:
 * - Claude Code: ~/.claude/{skills,commands,agents,rules}/
 * - Codex CLI: ~/.codex/skills/, ~/.codex/prompts/
 *
 * Config types:
 * - skills: directory-based (each skill is a dir with SKILL.md)
 * - commands: file-based (.md), may be nested in subdirectories
 * - agents: file-based (.md), flat directory
 * - rules: file-based (.md), may be nested in subdirectories
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { convertSkillToCodex, convertCommandToCodex } = require('./format-converter');

// Paths
const HOME = os.homedir();
const CC_TOOL_CONFIGS = path.join(HOME, '.claude', 'cc-tool', 'configs');
const CLAUDE_CODE_DIR = path.join(HOME, '.claude');
const CODEX_DIR = path.join(HOME, '.codex');

// Config type definitions
const CONFIG_TYPES = {
  skills: {
    isDirectory: true,
    markerFile: 'SKILL.md',
    claudeTarget: 'skills',
    codexTarget: 'skills',
    codexSupported: true,
    convertForCodex: true
  },
  commands: {
    isDirectory: false,
    extension: '.md',
    claudeTarget: 'commands',
    codexTarget: 'prompts',
    codexSupported: true,
    convertForCodex: true
  },
  agents: {
    isDirectory: false,
    extension: '.md',
    claudeTarget: 'agents',
    codexSupported: false
  },
  rules: {
    isDirectory: false,
    extension: '.md',
    claudeTarget: 'rules',
    codexSupported: false
  }
};

class ConfigSyncManager {
  constructor() {
    this.ccToolConfigs = CC_TOOL_CONFIGS;
    this.claudeDir = CLAUDE_CODE_DIR;
    this.codexDir = CODEX_DIR;
    this.configTypes = CONFIG_TYPES;
  }

  /**
   * Sync a config item to Claude Code
   * @param {string} type - Config type (skills, commands, agents, rules)
   * @param {string} name - Item name (directory name for skills, file path for others)
   * @returns {Object} Result with success status
   */
  syncToClaude(type, name) {
    const config = this.configTypes[type];
    if (!config) {
      console.log(`[ConfigSyncManager] Unknown config type: ${type}`);
      return { success: false, error: `Unknown config type: ${type}` };
    }

    const sourcePath = path.join(this.ccToolConfigs, type, name);
    const targetPath = path.join(this.claudeDir, config.claudeTarget, name);

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

    const targetPath = path.join(this.claudeDir, config.claudeTarget, name);

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

        // Clean up empty parent directories for commands/rules
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
   * Only skills and commands are supported
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

    const sourcePath = path.join(this.ccToolConfigs, type, name);

    if (!fs.existsSync(sourcePath)) {
      console.log(`[ConfigSyncManager] Source not found: ${sourcePath}`);
      return { success: false, error: 'Source not found' };
    }

    try {
      const warnings = [];

      if (type === 'skills') {
        // Skills: copy directory, convert SKILL.md content
        const targetPath = path.join(this.codexDir, config.codexTarget, name);
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
        const targetPath = path.join(this.codexDir, config.codexTarget, name);
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

    if (!config.codexSupported) {
      return { success: true, skipped: true, reason: 'Not supported by Codex' };
    }

    const targetPath = path.join(this.codexDir, config.codexTarget, name);

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
   * Batch sync based on registry data
   * @param {string} type - Config type
   * @param {Object} registryItems - Registry items { name: { enabled, platforms: { claude, codex } } }
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

    for (const [name, item] of Object.entries(registryItems)) {
      if (!item || typeof item !== 'object') continue;

      const { enabled, platforms } = item;

      if (enabled && platforms) {
        // Sync to enabled platforms
        if (platforms.claude) {
          const result = this.syncToClaude(type, name);
          if (result.success && !result.skipped) {
            results.synced.push({ type, name, platform: 'claude' });
          } else if (!result.success) {
            results.errors.push({ type, name, platform: 'claude', error: result.error });
          }
        } else {
          // Platform disabled, remove
          const result = this.removeFromClaude(type, name);
          if (result.success && !result.message) {
            results.removed.push({ type, name, platform: 'claude' });
          }
        }

        if (platforms.codex) {
          const result = this.syncToCodex(type, name);
          if (result.success && !result.skipped) {
            results.synced.push({ type, name, platform: 'codex' });
            if (result.warnings && result.warnings.length > 0) {
              results.warnings.push({ type, name, platform: 'codex', warnings: result.warnings });
            }
          } else if (!result.success) {
            results.errors.push({ type, name, platform: 'codex', error: result.error });
          }
        } else {
          // Platform disabled, remove
          const result = this.removeFromCodex(type, name);
          if (result.success && !result.message && !result.skipped) {
            results.removed.push({ type, name, platform: 'codex' });
          }
        }
      } else {
        // Item disabled, remove from all platforms
        const claudeResult = this.removeFromClaude(type, name);
        if (claudeResult.success && !claudeResult.message) {
          results.removed.push({ type, name, platform: 'claude' });
        }

        const codexResult = this.removeFromCodex(type, name);
        if (codexResult.success && !codexResult.message && !codexResult.skipped) {
          results.removed.push({ type, name, platform: 'codex' });
        }
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
}

module.exports = {
  ConfigSyncManager,
  CONFIG_TYPES,
  CC_TOOL_CONFIGS,
  CLAUDE_CODE_DIR,
  CODEX_DIR
};
