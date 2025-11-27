const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECTS_CACHE_TTL = 30 * 1000; // 30s
const projectsCache = new Map();

const HAS_MESSAGES_CACHE_LIMIT = 50000;
const hasMessagesCache = new Map();
let hasMessagesPersisted = {};
let hasMessagesPersistTimer = null;

function getCcToolDir() {
  return path.join(os.homedir(), '.claude', 'cc-tool');
}

function ensureDirExists(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getProjectsCacheKey(config) {
  return config?.projectsDir || '__default__';
}

function getCachedProjects(config) {
  const cacheEntry = projectsCache.get(getProjectsCacheKey(config));
  if (!cacheEntry) return null;
  if ((Date.now() - cacheEntry.timestamp) > PROJECTS_CACHE_TTL) {
    projectsCache.delete(getProjectsCacheKey(config));
    return null;
  }
  return cacheEntry.data;
}

function setCachedProjects(config, data) {
  projectsCache.set(getProjectsCacheKey(config), {
    data,
    timestamp: Date.now()
  });
}

function invalidateProjectsCache(configOrPath) {
  if (!configOrPath) {
    projectsCache.clear();
    return;
  }
  const key = typeof configOrPath === 'string'
    ? configOrPath
    : getProjectsCacheKey(configOrPath);
  projectsCache.delete(key);
}

const hasMessagesCacheFile = path.join(getCcToolDir(), 'session-has-cache.json');
loadHasMessagesCacheFromDisk();

function loadHasMessagesCacheFromDisk() {
  try {
    if (!fs.existsSync(hasMessagesCacheFile)) {
      hasMessagesPersisted = {};
      return;
    }
    const raw = fs.readFileSync(hasMessagesCacheFile, 'utf8');
    const parsed = JSON.parse(raw) || {};
    hasMessagesPersisted = parsed;
    Object.entries(parsed).forEach(([filePath, entry]) => {
      if (!entry || typeof entry !== 'object') return;
      const { size, mtimeMs, value } = entry;
      if (typeof size === 'number' && typeof mtimeMs === 'number' && typeof value === 'boolean') {
        hasMessagesCache.set(`${filePath}:${size}:${mtimeMs}`, value);
      }
    });
  } catch (err) {
    hasMessagesPersisted = {};
  }
}

function checkHasMessagesCache(filePath, stats) {
  if (!filePath || !stats) return undefined;
  const cacheKey = `${filePath}:${stats.size}:${stats.mtimeMs}`;
  if (!hasMessagesCache.has(cacheKey)) {
    return undefined;
  }
  return hasMessagesCache.get(cacheKey);
}

function rememberHasMessages(filePath, stats, value) {
  if (!filePath || !stats) return;
  const cacheKey = `${filePath}:${stats.size}:${stats.mtimeMs}`;
  if (hasMessagesCache.size >= HAS_MESSAGES_CACHE_LIMIT) {
    const firstKey = hasMessagesCache.keys().next().value;
    if (firstKey) {
      hasMessagesCache.delete(firstKey);
    }
  }
  hasMessagesCache.set(cacheKey, value);

  hasMessagesPersisted[filePath] = {
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    value
  };
  schedulePersistHasMessagesCache();
}

function schedulePersistHasMessagesCache() {
  if (hasMessagesPersistTimer) return;
  hasMessagesPersistTimer = setTimeout(() => {
    try {
      ensureDirExists(path.dirname(hasMessagesCacheFile));
      fs.writeFileSync(hasMessagesCacheFile, JSON.stringify(hasMessagesPersisted, null, 2), 'utf8');
    } catch (err) {
      // ignore persistence errors
    } finally {
      hasMessagesPersistTimer = null;
    }
  }, 1000);
}

module.exports = {
  getCachedProjects,
  setCachedProjects,
  invalidateProjectsCache,
  checkHasMessagesCache,
  rememberHasMessages
};
