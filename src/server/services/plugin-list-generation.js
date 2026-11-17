'use strict';

/**
 * Process-local invalidation generation for plugin list caches.
 *
 * Plugin mutations that run through platform drivers (for example DSH's
 * `dsh plugin` command) never reach PluginsService mutation methods, so they
 * cannot clear that service's per-platform list cache directly. Drivers bump
 * the platform generation after a successful mutation; PluginsService treats
 * entries recorded under an older generation as stale.
 */

const generations = new Map();

function normalizePlatform(platform) {
  return String(platform || '').trim().toLowerCase();
}

function getPluginListGeneration(platform) {
  const key = normalizePlatform(platform);
  if (!key) return 0;
  return generations.get(key) || 0;
}

function bumpPluginListGeneration(platform) {
  const key = normalizePlatform(platform);
  if (!key) return 0;
  const next = (generations.get(key) || 0) + 1;
  generations.set(key, next);
  return next;
}

module.exports = {
  bumpPluginListGeneration,
  getPluginListGeneration
};
