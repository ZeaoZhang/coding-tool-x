// 配置加载和保存
const fs = require('fs');
const path = require('path');
const os = require('os');
const DEFAULT_CONFIG = require('./default');
const { PATHS, ensureStorageDirMigrated } = require('./paths');
const eventBus = require('../plugins/event-bus');

const LEGACY_CONFIG_FILES = [
  path.join(__dirname, '../../config.json'),
  path.join(os.homedir(), '.claude', 'config.json')
];

function getConfigFilePath() {
  ensureStorageDirMigrated();
  return PATHS.configFile;
}

/**
 * 展开 ~ 为用户主目录
 */
function expandHome(filepath) {
  if (filepath.startsWith('~')) {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

function mergePricing(defaultPricing, overrides = {}) {
  const merged = {};
  Object.keys(defaultPricing).forEach((key) => {
    merged[key] = {
      ...defaultPricing[key],
      ...(overrides && overrides[key] ? overrides[key] : {})
    };
    if (!merged[key].mode) {
      merged[key].mode = 'auto';
    }
  });
  return merged;
}

function mergeDefaultModels(defaultModels, overrides = {}) {
  const merged = {};
  Object.keys(defaultModels).forEach((key) => {
    // If user config has this tool type, use it; otherwise use default
    merged[key] = (overrides && overrides[key]) ? overrides[key] : defaultModels[key];
  });
  return merged;
}

function mergeDefaultSpeedTestModels(defaultModels, overrides = {}) {
  return {
    ...defaultModels,
    ...(overrides || {})
  };
}

function readJsonFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content);
}

function migrateLegacyConfigIfNeeded(configFilePath) {
  if (fs.existsSync(configFilePath)) return;

  for (const legacyPath of LEGACY_CONFIG_FILES) {
    try {
      if (!legacyPath || legacyPath === configFilePath) continue;
      if (!fs.existsSync(legacyPath)) continue;
      const legacyConfig = readJsonFile(legacyPath);
      const dir = path.dirname(configFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(configFilePath, JSON.stringify(legacyConfig, null, 2), 'utf8');
      console.log(`[Config] 已迁移历史配置: ${legacyPath} -> ${configFilePath}`);
      return;
    } catch (error) {
      console.warn(`[Config] 迁移历史配置失败: ${legacyPath}`, error.message);
    }
  }
}

/**
 * 加载配置
 */
function loadConfig() {
  const configFilePath = getConfigFilePath();
  migrateLegacyConfigIfNeeded(configFilePath);

  try {
    if (fs.existsSync(configFilePath)) {
      const userConfig = readJsonFile(configFilePath);
      const config = { ...DEFAULT_CONFIG, ...userConfig };
      config.projectsDir = expandHome(config.projectsDir || DEFAULT_CONFIG.projectsDir);

      // 合并 ports 配置
      config.ports = { ...DEFAULT_CONFIG.ports, ...userConfig.ports };
      config.pricing = mergePricing(DEFAULT_CONFIG.pricing, userConfig.pricing);
      config.defaultModels = mergeDefaultModels(DEFAULT_CONFIG.defaultModels, userConfig.defaultModels);
      config.defaultSpeedTestModels = mergeDefaultSpeedTestModels(
        DEFAULT_CONFIG.defaultSpeedTestModels,
        userConfig.defaultSpeedTestModels
      );

      // 确保有 currentProject，使用 defaultProject 作为 currentProject
      if (!config.currentProject && config.defaultProject) {
        config.currentProject = config.defaultProject;
      }

      eventBus.emitSync('config:loaded', { config });
      return config;
    }
  } catch (error) {
    console.error(`加载配置文件失败，使用默认配置: ${configFilePath}`);
  }
  const defaultConfig = {
    ...DEFAULT_CONFIG,
    projectsDir: expandHome(DEFAULT_CONFIG.projectsDir),
    currentProject: DEFAULT_CONFIG.defaultProject
  };
  eventBus.emitSync('config:loaded', { config: defaultConfig });
  return defaultConfig;
}

/**
 * 保存配置
 */
function saveConfig(config) {
  const configFilePath = getConfigFilePath();
  try {
    const dir = path.dirname(configFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2), 'utf8');
    eventBus.emitSync('config:saved', { config });
  } catch (error) {
    console.error(`保存配置失败 (${configFilePath}):`, error.message);
  }
}

module.exports = {
  loadConfig,
  saveConfig,
  expandHome,
  getConfigFilePath
};
