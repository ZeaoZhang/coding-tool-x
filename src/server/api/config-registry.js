/**
 * Config Registry API 路由
 *
 * Exposes config registry functionality via REST API.
 * Manages skills, commands, agents, plugins with enable/disable and per-platform support.
 */

const express = require('express');
const path = require('path');
const { ConfigRegistryService, CONFIG_TYPES, SUPPORTED_PLATFORMS } = require('../services/config-registry-service');
const { ConfigSyncManager } = require('../services/config-sync-manager');
const { ControlManifestStore } = require('../services/control-manifest-store');
const { EffectiveControlService } = require('../services/effective-control-service');
const { PATHS } = require('../../config/paths');
const { SkillProjectionService } = require('../services/skill-projection-service');
const { validateKnownProjectCwd } = require('../services/project-path-validation');
const { getPlatformRegistry } = require('../../platforms/runtime');

let effectiveControlService;

function getEffectiveControlService() {
  if (!effectiveControlService && PATHS.effectiveControlManifest) {
    effectiveControlService = new EffectiveControlService({
      store: new ControlManifestStore({
        userPath: PATHS.effectiveControlManifest,
        projectPathResolver: ({ projectPath }) => require('path').join(projectPath, '.ctx-control.json')
      }),
      projection: new SkillProjectionService({
        registry: getPlatformRegistry()
      })
    });
  }
  return effectiveControlService;
}

async function resolveSkillControlScope(body = {}) {
  const scope = body.scope || 'user';
  if (scope === 'user') return { scope, projectPath: null };
  if (scope !== 'project') throw new Error('Invalid scope: expected "user" or "project"');
  const projectPath = await validateKnownProjectCwd(body.projectPath || body.cwd);
  if (!projectPath) throw new Error('Project scope requires a valid projectPath');
  return { scope, projectPath };
}

function fallbackSkillControlKey(name, platform, scopeOptions) {
  const location = scopeOptions.scope === 'project' ? scopeOptions.projectPath : 'user';
  return `skill:${platform}:${scopeOptions.scope}:${location}:local:${platform}:${name}`;
}

const router = express.Router();
const registryService = new ConfigRegistryService();
const syncManager = new ConfigSyncManager();

// Valid config types
const VALID_TYPES = CONFIG_TYPES;

function getValidPlatforms() {
  const registry = getPlatformRegistry();
  return (registry?.list?.({ enabledOnly: true }) || [])
    .map(platform => platform && String(platform.key || '').trim().toLowerCase())
    .filter(Boolean);
}

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
  const validPlatforms = getValidPlatforms();
  if (!validPlatforms.includes(String(platform || '').trim().toLowerCase())) {
    return `Invalid platform: ${platform}. Must be one of: ${validPlatforms.join(', ')}`;
  }
  return null;
}

const RESERVED_REGISTRY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

function normalizeRegistryName(name) {
  const raw = String(name || '').replace(/\\/g, '/').trim();
  const normalized = path.posix.normalize(raw).replace(/^(\.\/)+/, '');
  if (
    !raw
    || raw.includes('\0')
    || path.posix.isAbsolute(raw)
    || !normalized
    || normalized === '.'
    || normalized === '..'
    || normalized.startsWith('../')
    || RESERVED_REGISTRY_NAMES.has(normalized)
  ) {
    throw new Error('Invalid config name');
  }
  return normalized;
}

const PLATFORM_SYNC_METHODS = {
  claude: { sync: 'syncToClaude', remove: 'removeFromClaude' },
  codex: { sync: 'syncToCodex', remove: 'removeFromCodex' },
  gemini: { sync: 'syncToGemini', remove: 'removeFromGemini' },
  opencode: { sync: 'syncToOpenCode', remove: 'removeFromOpenCode' },
  omp: { sync: 'syncToOmp', remove: 'removeFromOmp' }
};

async function syncPlatform(type, name, platform) {
  if (typeof syncManager.syncToPlatform === 'function') {
    return syncManager.syncToPlatform(platform, type, name);
  }
  const method = PLATFORM_SYNC_METHODS[platform]?.sync;
  if (method && typeof syncManager[method] === 'function') {
    return syncManager[method](type, name);
  }
  return { status: 'unsupported', platform, operation: 'sync' };
}

async function removePlatform(type, name, platform) {
  return syncManager.removeFromPlatform(platform, type, name);
}

async function syncEnabledPlatforms(type, name, platforms = {}) {
  await Promise.all(getValidPlatforms()
    .filter(platform => platforms?.[platform])
    .map(platform => syncPlatform(type, name, platform)));
}

async function removeAllPlatforms(type, name) {
  await Promise.all(getValidPlatforms().map(platform => removePlatform(type, name, platform)));
}

function getEffectiveSkillRegistryItems() {
  registryService.migrateSkillControls?.();
  const items = registryService.listItems('skills');
  const controlService = getEffectiveControlService();
  if (!controlService?.getSkill) return items;

  return Object.fromEntries(Object.entries(items || {}).map(([rawName, item]) => {
    const name = normalizeRegistryName(rawName);
    const platforms = { ...(item.platforms || {}) };
    const controlKeys = {};
    let hasControl = false;
    for (const platform of VALID_PLATFORMS) {
      const controlKey = item.controlKey || fallbackSkillControlKey(name, platform, { scope: 'user', projectPath: null });
      const control = controlService.getSkill(controlKey, { scope: 'user' });
      if (!control) continue;
      hasControl = true;
      controlKeys[platform] = control.controlKey || controlKey;
      platforms[platform] = control.enabled === true
        && control.trust === 'approved'
        && control.artifact?.state === 'ready';
    }
    return [
      name,
      hasControl
        ? { ...item, enabled: Object.values(platforms).some(Boolean), platforms, controlKeys }
        : { ...item, platforms }
    ];
  }));
}

/**
 * GET /api/config-registry/stats
 * Get statistics for all config types
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = registryService.getStats();
    if (stats?.byType?.skills) {
      const effectiveSkills = Object.values(getEffectiveSkillRegistryItems());
      const skillStats = {
        total: effectiveSkills.length,
        enabled: effectiveSkills.filter(item => item.enabled).length,
        disabled: effectiveSkills.filter(item => !item.enabled).length
      };
      for (const platform of VALID_PLATFORMS) {
        skillStats[platform] = effectiveSkills.filter(item => item.platforms?.[platform]).length;
        stats.byPlatform[platform] += skillStats[platform] - (stats.byType.skills[platform] || 0);
      }
      stats.byType.skills = skillStats;
    }

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

    const items = type === 'skills'
      ? getEffectiveSkillRegistryItems()
      : registryService.listItems(type);

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
          await syncPlatform(type, name, 'claude');
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
    const name = normalizeRegistryName(decodeURIComponent(req.params.name));
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

    if (type === 'skills') {
      const platform = String(req.body.platform || 'claude').trim().toLowerCase();
      const platformError = validatePlatform(platform);
      if (platformError) {
        return res.status(400).json({ success: false, message: platformError });
      }
      registryService.migrateSkillControls?.();
      const controlService = getEffectiveControlService();
      if (!controlService) throw new Error('Effective control service is unavailable');
      const scopeOptions = await resolveSkillControlScope(req.body);
      const item = controlService.setSkillEnabled({
        controlKey: req.body.controlKey || existing.controlKey || fallbackSkillControlKey(name, platform, scopeOptions),
        platform,
        ...scopeOptions,
        enabled
      });
      return res.json({ success: true, item });
    }

    // Commands, agents and plugins retain the legacy registry behaviour.
    const item = registryService.toggleEnabled(type, name, enabled);
    if (enabled) {
      // Sync to platforms where platform=true
      await syncEnabledPlatforms(type, name, item.platforms);
    } else {
      // Remove from all platforms.
      await removeAllPlatforms(type, name);
    }

    return res.json({
      success: true,
      item
    });
  } catch (err) {
    console.error('[ConfigRegistry API] Toggle enabled error:', err);
    const status = /Invalid config name|Absolute path|Invalid platform/i.test(err.message || '') ? 400 : 500;
    res.status(status).json({
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
    const { type } = req.params;
    const platform = String(req.params.platform || '').trim().toLowerCase();
    const name = normalizeRegistryName(decodeURIComponent(req.params.name));
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

    if (type === 'skills') {
      registryService.migrateSkillControls?.();
      const controlService = getEffectiveControlService();
      if (!controlService) throw new Error('Effective control service is unavailable');
      const scopeOptions = await resolveSkillControlScope(req.body);
      const item = controlService.setSkillEnabled({
        controlKey: req.body.controlKey || existing.controlKey || fallbackSkillControlKey(name, platform, scopeOptions),
        platform,
        ...scopeOptions,
        enabled
      });
      return res.json({ success: true, item });
    }

    const item = registryService.togglePlatform(type, name, platform, enabled);
    if (enabled && item.enabled) {
      // Sync to this platform (only if item is enabled)
      await syncPlatform(type, name, platform);
    } else {
      // Remove from this platform.
      await removePlatform(type, name, platform);
    }

    return res.json({
      success: true,
      item
    });
  } catch (err) {
    console.error('[ConfigRegistry API] Toggle platform error:', err);
    const status = /Invalid config name|Absolute path|Invalid platform/i.test(err.message || '') ? 400 : 500;
    res.status(status).json({
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

    const items = type === 'skills'
      ? getEffectiveSkillRegistryItems()
      : registryService.listItems(type);
    if (type === 'skills') {
      const controlService = getEffectiveControlService();
      if (!controlService) throw new Error('Effective control service is unavailable');
      const results = [];
      const errors = [];
      for (const [name, item] of Object.entries(items || {})) {
        for (const platform of VALID_PLATFORMS) {
          if (!item?.platforms?.[platform]) continue;
          try {
            results.push(controlService.setSkillEnabled({
              controlKey: item.controlKeys?.[platform] || item.controlKey || fallbackSkillControlKey(name, platform, { scope: 'user', projectPath: null }),
              platform,
              scope: 'user',
              enabled: true
            }));
          } catch (error) {
            errors.push({ name, platform, message: error.message });
          }
        }
      }
      return res.json({
        success: true,
        type,
        synced: results.filter(result => result.enabled).length,
        removed: 0,
        errors,
        warnings: []
      });
    }

    // Sync all items based on their registry state
    const result = await syncManager.syncAll(type, items);
    return res.json({
      success: true,
      type,
      synced: result.synced.length,
      removed: result.removed.length,
      errors: result.errors,
      warnings: result.warnings
    });
  } catch (err) {
    console.error('[ConfigRegistry API] Sync error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

module.exports = router;
