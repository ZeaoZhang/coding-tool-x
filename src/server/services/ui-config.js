const fs = require('fs');
const path = require('path');
const os = require('os');

const UI_CONFIG_DIR = path.join(os.homedir(), '.claude', 'cc-tool');
const UI_CONFIG_FILE = path.join(UI_CONFIG_DIR, 'ui-config.json');

// Default UI config
const DEFAULT_UI_CONFIG = {
  theme: 'light',
  panelVisibility: {
    showChannels: true,
    showLogs: true
  },
  channelLocks: {
    claude: false,
    codex: false,
    gemini: false
  },
  channelCollapse: {
    claude: [],
    codex: [],
    gemini: []
  },
  channelOrder: {
    claude: [],
    codex: [],
    gemini: []
  }
};

// 内存缓存
let uiConfigCache = null;
let cacheInitialized = false;

// Ensure UI config directory exists
function ensureConfigDir() {
  if (!fs.existsSync(UI_CONFIG_DIR)) {
    fs.mkdirSync(UI_CONFIG_DIR, { recursive: true });
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
    return {
      theme: data.theme || DEFAULT_UI_CONFIG.theme,
      panelVisibility: { ...DEFAULT_UI_CONFIG.panelVisibility, ...data.panelVisibility },
      channelLocks: { ...DEFAULT_UI_CONFIG.channelLocks, ...data.channelLocks },
      channelCollapse: { ...DEFAULT_UI_CONFIG.channelCollapse, ...data.channelCollapse },
      channelOrder: { ...DEFAULT_UI_CONFIG.channelOrder, ...data.channelOrder }
    };
  } catch (error) {
    console.error('Error loading UI config:', error);
    return { ...DEFAULT_UI_CONFIG };
  }
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
    fs.writeFileSync(UI_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    // 同时更新缓存
    uiConfigCache = JSON.parse(JSON.stringify(config));
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
  return config;
}

// Update nested config
function updateNestedUIConfig(parentKey, childKey, value) {
  const config = loadUIConfig();
  if (!config[parentKey]) {
    config[parentKey] = {};
  }
  config[parentKey][childKey] = value;
  saveUIConfig(config);
  return config;
}

module.exports = {
  loadUIConfig,
  saveUIConfig,
  updateUIConfig,
  updateNestedUIConfig
};
