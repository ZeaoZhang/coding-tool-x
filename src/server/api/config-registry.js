/**
 * Config Registry API 路由
 *
 * Exposes config registry functionality via REST API.
 * Manages skills, commands, agents, plugins with enable/disable and per-platform support.
 */

const express = require('express');
const { ConfigRegistryService, CONFIG_TYPES, SUPPORTED_PLATFORMS } = require('../services/config-registry-service');
const { ConfigSyncManager } = require('../services/config-sync-manager');

const router = express.Router();
const registryService = new ConfigRegistryService();
const syncManager = new ConfigSyncManager();

// Valid config types
const VALID_TYPES = CONFIG_TYPES;

// Valid platforms
const VALID_PLATFORMS = SUPPORTED_PLATFORMS;

/**
 * Validate config type parameter
 * @param {string} type - Config type
 * @returns {string|null} Error message or null if valid
 */
function validateType(type) {
  if (!VALID_TYPES.includes(type)) {
    return `Invalid config type: ${type}. Must be one of: ${VALID_TYPES.join(', ')}`;
  }
  return null;
}

/**
 * Validate platform parameter
 * @param {string} platform - Platform name
 * @returns {string|null} Error message or null if valid
 */
function validatePlatform(platform) {
  if (!VALID_PLATFORMS.includes(platform)) {
    return `Invalid platform: ${platform}. Must be one of: ${VALID_PLATFORMS.join(', ')}`;
  }
  return null;
}

const PLATFORM_SYNC_METHODS = {
  claude: { sync: 'syncToClaude', remove: 'removeFromClaude' },
  codex: { sync: 'syncToCodex', remove: 'removeFromCodex' },
  gemini: { sync: 'syncToGemini', remove: 'removeFromGemini' },
  opencode: { sync: 'syncToOpenCode', remove: 'removeFromOpenCode' },
  omp: { sync: 'syncToOmp', remove: 'removeFromOmp' }
};

function syncPlatform(type, name, platform) {
  const method = PLATFORM_SYNC_METHODS[platform]?.sync;
  if (method && typeof syncManager[method] === 'function') {
    syncManager[method](type, name);
  }
}

function removePlatform(type, name, platform) {
  const method = PLATFORM_SYNC_METHODS[platform]?.remove;
  if (method && typeof syncManager[method] === 'function') {
    syncManager[method](type, name);
  }
}

function syncEnabledPlatforms(type, name, platforms = {}) {
  for (const platform of VALID_PLATFORMS) {
    if (platforms?.[platform]) {
      syncPlatform(type, name, platform);
    }
  }
}

function removeAllPlatforms(type, name) {
  for (const platform of VALID_PLATFORMS) {
    removePlatform(type, name, platform);
  }
}

/**
 * GET /api/config-registry/stats
 * Get statistics for all config types
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = registryService.getStats();

    res.json({
      success: true,
      stats
    });
  } catch (err) {
    console.error('[ConfigRegistry API] Get stats error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * GET /api/config-registry/:type
 * List all items for a config type (skills, commands, agents, plugins)
 * Returns { success: true, items: { name: registryEntry } }
 */
router.get('/:type', async (req, res) => {
  try {
    const { type } = req.params;

    const typeError = validateType(type);
    if (typeError) {
      return res.status(400).json({
        success: false,
        message: typeError
      });
    }

    const items = registryService.listItems(type);

    res.json({
      success: true,
      type,
      items
    });
  } catch (err) {
    console.error('[ConfigRegistry API] List items error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * POST /api/config-registry/:type/import
 * Import configs from Claude Code native directories to cc-tool
 * - Scans ~/.claude/{type}/
 * - Copies new items to cc-tool/configs/{type}/
 * - Registers them with enabled: true
 * - Syncs back to Claude (since they were already there)
 * Returns { success: true, imported: number, skipped: number, items: [...] }
 */
router.post('/:type/import', async (req, res) => {
  try {
    const { type } = req.params;

    const typeError = validateType(type);
    if (typeError) {
      return res.status(400).json({
        success: false,
        message: typeError
      });
    }

    // Import from Claude Code directories
    const result = registryService.importFromClaude(type);

    // Sync imported items back to Claude (they were already there but now managed by cc-tool)
    // This ensures consistency between registry and actual files
    if (result.imported > 0) {
      for (const name of result.items) {
        const item = registryService.getItem(type, name);
        if (item && item.enabled && item.platforms?.claude) {
          syncManager.syncToClaude(type, name);
        }
      }
    }

    res.json({
      success: true,
      type,
      imported: result.imported,
      skipped: result.skipped,
      items: result.items
    });
  } catch (err) {
    console.error('[ConfigRegistry API] Import error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * PUT /api/config-registry/:type/:name/toggle
 * Toggle enabled/disabled status
 * Body: { enabled: boolean }
 * - Updates registry
 * - If enabling: sync to platforms where platform=true
 * - If disabling: remove from all platforms
 * Returns { success: true, item: updatedEntry }
 */
router.put('/:type/:name/toggle', async (req, res) => {
  try {
    const { type } = req.params;
    const name = decodeURIComponent(req.params.name);
    const { enabled } = req.body;

    const typeError = validateType(type);
    if (typeError) {
      return res.status(400).json({
        success: false,
        message: typeError
      });
    }

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'enabled must be a boolean'
      });
    }

    // Check if item exists
    const existing = registryService.getItem(type, name);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: `Item "${name}" not found in ${type}`
      });
    }

    // Update registry
    const item = registryService.toggleEnabled(type, name, enabled);

    // Apply sync based on new state
    if (enabled) {
      // Sync to platforms where platform=true
      syncEnabledPlatforms(type, name, item.platforms);
    } else {
      // Remove from all platforms
      removeAllPlatforms(type, name);
    }

    res.json({
      success: true,
      item
    });
  } catch (err) {
    console.error('[ConfigRegistry API] Toggle enabled error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * PUT /api/config-registry/:type/:name/platform/:platform
 * Toggle platform (claude/codex/gemini/opencode) for an item
 * Body: { enabled: boolean }
 * - Updates registry
 * - If enabling platform: sync to that platform (if item is enabled)
 * - If disabling platform: remove from that platform
 * Returns { success: true, item: updatedEntry }
 */
router.put('/:type/:name/platform/:platform', async (req, res) => {
  try {
    const { type, platform } = req.params;
    const name = decodeURIComponent(req.params.name);
    const { enabled } = req.body;

    const typeError = validateType(type);
    if (typeError) {
      return res.status(400).json({
        success: false,
        message: typeError
      });
    }

    const platformError = validatePlatform(platform);
    if (platformError) {
      return res.status(400).json({
        success: false,
        message: platformError
      });
    }

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'enabled must be a boolean'
      });
    }

    // Check if item exists
    const existing = registryService.getItem(type, name);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: `Item "${name}" not found in ${type}`
      });
    }

    // Update registry
    const item = registryService.togglePlatform(type, name, platform, enabled);

    // Apply sync based on new state
    if (enabled && item.enabled) {
      // Sync to this platform (only if item is enabled)
      syncPlatform(type, name, platform);
    } else {
      // Remove from this platform
      removePlatform(type, name, platform);
    }

    res.json({
      success: true,
      item
    });
  } catch (err) {
    console.error('[ConfigRegistry API] Toggle platform error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * POST /api/config-registry/:type/sync
 * Force sync all items of a type to their platforms based on registry
 * Returns { success: true, synced: number }
 */
router.post('/:type/sync', async (req, res) => {
  try {
    const { type } = req.params;

    const typeError = validateType(type);
    if (typeError) {
      return res.status(400).json({
        success: false,
        message: typeError
      });
    }

    // Get all items for this type
    const items = registryService.listItems(type);

    // Sync all items based on their registry state
    const result = syncManager.syncAll(type, items);

    res.json({
      success: true,
      type,
      synced: result.synced.length,
      removed: result.removed.length,
      errors: result.errors,
      warnings: result.warnings
    });
  } catch (err) {
    console.error('[ConfigRegistry API] Sync all error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

module.exports = router;
