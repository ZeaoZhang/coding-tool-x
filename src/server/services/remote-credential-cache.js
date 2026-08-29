'use strict';

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

function key(provider, hostname) {
  return `${String(provider || '').toLowerCase()}:${String(hostname || '').toLowerCase()}`;
}

function get(provider, hostname, now = Date.now()) {
  const entry = cache.get(key(provider, hostname));
  if (!entry || now - entry.cachedAt >= entry.ttlMs) {
    if (entry) cache.delete(key(provider, hostname));
    return { hit: false, value: null };
  }
  return { hit: true, value: entry.value };
}

function set(provider, hostname, value, ttlMs = DEFAULT_TTL_MS, now = Date.now()) {
  cache.set(key(provider, hostname), {
    value: value || null,
    cachedAt: now,
    ttlMs: Math.max(0, Number(ttlMs) || DEFAULT_TTL_MS)
  });
  return value || null;
}

function clear(provider, hostname) {
  if (provider && hostname) {
    cache.delete(key(provider, hostname));
    return;
  }
  if (provider) {
    const prefix = `${String(provider).toLowerCase()}:`;
    for (const cacheKey of cache.keys()) {
      if (cacheKey.startsWith(prefix)) cache.delete(cacheKey);
    }
    return;
  }
  cache.clear();
}

module.exports = { DEFAULT_TTL_MS, get, set, clear };
