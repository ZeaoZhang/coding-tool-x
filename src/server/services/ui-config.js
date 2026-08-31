'use strict';

const fs = require('fs');
const path = require('path');
const { PATHS } = require('../../config/paths');
const {
  DEFAULT_ENABLED_CLI_PLATFORMS,
  migrateLegacyCliConfig
} = require('../../shared/platforms');

const UI_CONFIG_FILE = PATHS.uiConfig;
const OPTIONAL_UI_CONFIG_FIELDS = ['remoteNotifications', 'claudeNotificationDisabledByUser'];

const DEFAULT_UI_CONFIG = {
  theme: 'light',
  panelVisibility: {
    showChannels: true,
    showLogs: true
  },
  channelBalance: {
    showRemaining: false
  },
  channelLocks: {
    claude: false,
    codex: false,
    gemini: false,
    opencode: false,
    omp: false
  },
  channelCollapse: {
    claude: [],
    codex: [],
    gemini: [],
    opencode: [],
    omp: []
  },
  channelOrder: {
    claude: [],
    codex: [],
    gemini: [],
    opencode: [],
    omp: []
  },
  enabledCliPlatforms: DEFAULT_ENABLED_CLI_PLATFORMS
};

let uiConfigCache = null;
let cacheInitialized = false;
let watcherInitialized = false;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureConfigDir() {
  const dir = path.dirname(UI_CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getAllowedPlatformKeys() {
  // Keep this require lazy: runtime's registry construction reads configuration.
  try {
    const { getPlatformRegistry } = require('../../platforms/runtime');
    const registry = getPlatformRegistry();
    const platforms = registry && typeof registry.list === 'function' ? registry.list() : [];
    const keys = platforms
      .map(platform => String(platform && platform.key || '').trim().toLowerCase())
      .filter(Boolean);
    return keys.length ? keys : [...DEFAULT_ENABLED_CLI_PLATFORMS];
  } catch (error) {
    return [...DEFAULT_ENABLED_CLI_PLATFORMS];
  }
}

function normalizeUIConfig(config = {}) {
  const source = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  const allowedKeys = getAllowedPlatformKeys();
  const migrationInput = {
    homeCliColumns: source.homeCliColumns,
    dashboardChannelOrder: source.dashboardChannelOrder,
    customCliPlatforms: source.customCliPlatforms,
    allowedKeys,
    fallback: DEFAULT_ENABLED_CLI_PLATFORMS
  };
  if (Object.prototype.hasOwnProperty.call(source, 'enabledCliPlatforms')) {
    migrationInput.enabledCliPlatforms = source.enabledCliPlatforms;
  }
  const enabledCliPlatforms = migrateLegacyCliConfig(migrationInput);

  const normalized = {
    theme: source.theme || DEFAULT_UI_CONFIG.theme,
    panelVisibility: { ...DEFAULT_UI_CONFIG.panelVisibility, ...(source.panelVisibility || {}) },
    channelBalance: { ...DEFAULT_UI_CONFIG.channelBalance, ...(source.channelBalance || {}) },
    channelLocks: { ...DEFAULT_UI_CONFIG.channelLocks, ...(source.channelLocks || {}) },
    channelCollapse: { ...DEFAULT_UI_CONFIG.channelCollapse, ...(source.channelCollapse || {}) },
    channelOrder: { ...DEFAULT_UI_CONFIG.channelOrder, ...(source.channelOrder || {}) },
    enabledCliPlatforms
  };
  for (const field of OPTIONAL_UI_CONFIG_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, field)) normalized[field] = clone(source[field]);
  }
  return clone(normalized);
}

function writeCanonicalConfig(config) {
  ensureConfigDir();
  const temporaryFile = path.join(
    path.dirname(UI_CONFIG_FILE),
    `.${path.basename(UI_CONFIG_FILE)}.${process.pid}.${Date.now()}.tmp`
  );
  try {
    fs.writeFileSync(temporaryFile, JSON.stringify(config, null, 2), 'utf8');
    fs.renameSync(temporaryFile, UI_CONFIG_FILE);
  } catch (error) {
    try { fs.unlinkSync(temporaryFile); } catch { /* best effort cleanup */ }
    throw error;
  }
}

function readUIConfigFromFile() {
  ensureConfigDir();

  if (!fs.existsSync(UI_CONFIG_FILE)) return clone(DEFAULT_UI_CONFIG);

  let data;
  try {
    const content = fs.readFileSync(UI_CONFIG_FILE, 'utf8');
    data = JSON.parse(content);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('UI config must be an object');
  } catch (error) {
    console.error('Error loading UI config:', error);
    return normalizeUIConfig({});
  }

  const normalized = normalizeUIConfig(data);
  if (JSON.stringify(data) !== JSON.stringify(normalized)) {
    try {
      writeCanonicalConfig(normalized);
    } catch (error) {
      console.error('Error rewriting UI config:', error);
    }
  }
  return normalized;
}

function installConfigWatcher() {
  if (watcherInitialized) return;
  try {
    fs.watchFile(UI_CONFIG_FILE, { persistent: false }, () => {
      uiConfigCache = readUIConfigFromFile();
    });
    watcherInitialized = true;
  } catch (err) {
    console.error('Failed to watch UI config file:', err);
  }
}

function initializeCache() {
  if (cacheInitialized) return;
  uiConfigCache = readUIConfigFromFile();
  cacheInitialized = true;
  installConfigWatcher();
}

function loadUIConfig() {
  if (!cacheInitialized) initializeCache();
  return clone(uiConfigCache);
}

function saveUIConfig(config) {
  try {
    const normalizedConfig = normalizeUIConfig(config);
    writeCanonicalConfig(normalizedConfig);
    uiConfigCache = clone(normalizedConfig);
    cacheInitialized = true;
    installConfigWatcher();
    return clone(normalizedConfig);
  } catch (error) {
    console.error('Error saving UI config:', error);
    throw error;
  }
}

function updateUIConfig(key, value) {
  const config = loadUIConfig();
  config[key] = value;
  return saveUIConfig(config);
}

function updateNestedUIConfig(parentKey, childKey, value) {
  const config = loadUIConfig();
  if (!config[parentKey] || typeof config[parentKey] !== 'object') config[parentKey] = {};
  config[parentKey][childKey] = value;
  return saveUIConfig(config);
}

module.exports = {
  loadUIConfig,
  saveUIConfig,
  updateUIConfig,
  updateNestedUIConfig,
  normalizeUIConfig,
  DEFAULT_UI_CONFIG
};
