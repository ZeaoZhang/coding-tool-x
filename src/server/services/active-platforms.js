'use strict';

/**
 * Resolve the CLI platforms the user actually enabled in the Web UI.
 *
 * Background work (proxy restore, health checks, native log cursors, session
 * indexing) must not inspect CLIs the user removed from the frontend: every
 * extra platform means thousands of session files and unrelated proxies.
 *
 * The UI config is read directly so CLI commands (`ctx status`) can use this
 * without constructing the server's platform registry.
 */

const fs = require('fs');
const { PATHS } = require('../../config/paths');

let cachedMtimeMs = -1;
let cachedKeys = null;

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * @returns {Set<string>|null} enabled platform keys, or null when the config
 *   does not declare a selection (callers should keep all platforms).
 */
function getEnabledCliPlatformKeys() {
  const configPath = PATHS.uiConfig;
  if (!configPath) return null;
  let stat;
  try {
    stat = fs.statSync(configPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      cachedKeys = null;
      cachedMtimeMs = -1;
    }
    return cachedKeys;
  }
  if (stat.mtimeMs === cachedMtimeMs) return cachedKeys;
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    cachedKeys = Array.isArray(parsed?.enabledCliPlatforms)
      ? new Set(parsed.enabledCliPlatforms.map(normalizeKey).filter(Boolean))
      : null;
    cachedMtimeMs = stat.mtimeMs;
    return cachedKeys;
  } catch (_) {
    return cachedKeys;
  }
}

function filterEnabledPlatforms(platforms = [], keys = getEnabledCliPlatformKeys()) {
  if (!keys) return platforms;
  return platforms.filter(platform => platform && keys.has(normalizeKey(platform.key)));
}

module.exports = { getEnabledCliPlatformKeys, filterEnabledPlatforms };
