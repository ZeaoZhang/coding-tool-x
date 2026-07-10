const fs = require('fs');
const path = require('path');
const { PATHS } = require('../../config/paths');
const {
  DEFAULT_HOME_CLI_COLUMNS,
  normalizeCustomCliPlatforms,
  normalizeHomeCliColumns
} = require('../../shared/platforms');

const UI_CONFIG_FILE = PATHS.uiConfig;

// Default UI config
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
  dashboardChannelOrder: DEFAULT_HOME_CLI_COLUMNS,
  homeCliColumns: DEFAULT_HOME_CLI_COLUMNS,
  customCliPlatforms: []
};

// 内存缓存
let uiConfigCache = null;
let cacheInitialized = false;

// Ensure UI config directory exists
function ensureConfigDir() {
  const dir = path.dirname(UI_CONFIG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 从文件读取并缓存
function readUIConfigFromFile() {
  ensureConfigDir();

  if (!fs.existsSync(UI_CONFIG_FILE)) {
    return { ...DEFAULT_UI_CONFIG };
  }

  try {
    const content = fs.readFileSync(UI_CONFIG_FILE, 'utf8');
    const data = JSON.parse(content);
    // Merge with defaults to ensure all keys exist
    return normalizeUIConfig({
      ...DEFAULT_UI_CONFIG,
      ...data,
      theme: data.theme || DEFAULT_UI_CONFIG.theme,
      panelVisibility: { ...DEFAULT_UI_CONFIG.panelVisibility, ...data.panelVisibility },
      channelBalance: { ...DEFAULT_UI_CONFIG.channelBalance, ...data.channelBalance },
      channelLocks: { ...DEFAULT_UI_CONFIG.channelLocks, ...data.channelLocks },
      channelCollapse: { ...DEFAULT_UI_CONFIG.channelCollapse, ...data.channelCollapse },
      channelOrder: { ...DEFAULT_UI_CONFIG.channelOrder, ...data.channelOrder }
    });
  } catch (error) {
    console.error('Error loading UI config:', error);
    return normalizeUIConfig({ ...DEFAULT_UI_CONFIG });
  }
}

function normalizeUIConfig(config = {}) {
  const customCliPlatforms = normalizeCustomCliPlatforms(config.customCliPlatforms);
  const legacyOrder = Array.isArray(config.homeCliColumns)
    ? config.homeCliColumns
    : config.dashboardChannelOrder;
  const homeCliColumns = normalizeHomeCliColumns(legacyOrder, customCliPlatforms);

  return {
    ...DEFAULT_UI_CONFIG,
    ...config,
    panelVisibility: { ...DEFAULT_UI_CONFIG.panelVisibility, ...(config.panelVisibility || {}) },
    channelBalance: { ...DEFAULT_UI_CONFIG.channelBalance, ...(config.channelBalance || {}) },
    channelLocks: { ...DEFAULT_UI_CONFIG.channelLocks, ...(config.channelLocks || {}) },
    channelCollapse: { ...DEFAULT_UI_CONFIG.channelCollapse, ...(config.channelCollapse || {}) },
    channelOrder: { ...DEFAULT_UI_CONFIG.channelOrder, ...(config.channelOrder || {}) },
    dashboardChannelOrder: homeCliColumns,
    homeCliColumns,
    customCliPlatforms
  };
}

// 初始化缓存（延迟初始化）
function initializeCache() {
  if (cacheInitialized) return;
  uiConfigCache = readUIConfigFromFile();
  cacheInitialized = true;

  // 监听文件变化，更新缓存
  try {
    fs.watchFile(UI_CONFIG_FILE, { persistent: false }, () => {
      uiConfigCache = readUIConfigFromFile();
    });
  } catch (err) {
    console.error('Failed to watch UI config file:', err);
  }
}

// Load UI config（使用缓存）
function loadUIConfig() {
  if (!cacheInitialized) {
    initializeCache();
  }
  return JSON.parse(JSON.stringify(uiConfigCache)); // 深拷贝返回
}

// Save UI config（同时更新缓存）
function saveUIConfig(config) {
  ensureConfigDir();

  try {
    const normalizedConfig = normalizeUIConfig(config);
    fs.writeFileSync(UI_CONFIG_FILE, JSON.stringify(normalizedConfig, null, 2), 'utf8');
    // 同时更新缓存
    uiConfigCache = JSON.parse(JSON.stringify(normalizedConfig));
  } catch (error) {
    console.error('Error saving UI config:', error);
    throw error;
  }
}

// Update specific config key
function updateUIConfig(key, value) {
  const config = loadUIConfig();
  config[key] = value;
  saveUIConfig(config);
  return loadUIConfig();
}

// Update nested config
function updateNestedUIConfig(parentKey, childKey, value) {
  const config = loadUIConfig();
  if (!config[parentKey]) {
    config[parentKey] = {};
  }
  config[parentKey][childKey] = value;
  saveUIConfig(config);
  return loadUIConfig();
}

module.exports = {
  loadUIConfig,
  saveUIConfig,
  updateUIConfig,
  updateNestedUIConfig,
  normalizeUIConfig,
  DEFAULT_UI_CONFIG
};
